import { test, expect } from '@playwright/test';

// Worker-level regression tests for PR #2 review findings. These talk to the
// local `wrangler dev` worker (local D1/R2 only) over HTTP — no browser.

const WORKER = 'http://127.0.0.1:8787';
const BOOTSTRAP = 'test-bootstrap';

// 1:100 metric preset = 28.3465 PDF points per metre.
const PPM_1_100 = 28.3465;

interface JsonResponse<T> {
  status: number;
  body: T;
}

async function mintToken(): Promise<string> {
  const res = await fetch(`${WORKER}/admin/mcp/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOOTSTRAP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `e2e-api-${Date.now()}` }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

function client(headers: Record<string, string>) {
  return async function call<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<JsonResponse<T>> {
    const res = await fetch(`${WORKER}${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}

async function bearerClient() {
  const token = await mintToken();
  return client({ Authorization: `Bearer ${token}` });
}

async function adminSessionClient() {
  const ts = Date.now();
  const email = `e2e-admin-${ts}@drivenwp.com`;
  const password = `admin-pass-${ts}`;
  const created = await fetch(`${WORKER}/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOOTSTRAP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'admin' }),
  });
  expect(created.status).toBe(200);
  const login = await fetch(`${WORKER}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('takeoff_session='));
  if (!cookie) throw new Error('login did not set a session cookie');
  return client({ Cookie: cookie });
}

interface ItemDto {
  id: string;
  unit: string;
  totalValue: number;
  shapes: Array<{ id: string; pageIndex: number; value: number; points: Array<{ x: number; y: number }> }>;
}

function square(sideMetres: number): Array<{ x: number; y: number }> {
  const s = sideMetres * PPM_1_100;
  return [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s },
  ];
}

async function newProject(call: ReturnType<typeof client>, name: string): Promise<string> {
  const res = await call<{ id: string }>('POST', '/api/projects', { name: `${name} ${Date.now()}` });
  expect(res.status).toBe(200);
  return res.body.id;
}

async function newItem(
  call: ReturnType<typeof client>,
  projectId: string,
  type: string,
  unit: string
): Promise<string> {
  const id = crypto.randomUUID();
  const res = await call('POST', '/api/measure/items', {
    project_id: projectId,
    id,
    label: `${type} item`,
    type,
    color: '#10b981',
    unit,
  });
  expect(res.status).toBe(200);
  return id;
}

async function listItems(call: ReturnType<typeof client>, projectId: string): Promise<ItemDto[]> {
  const res = await call<ItemDto[]>('GET', `/api/measure/items/${projectId}`);
  expect(res.status).toBe(200);
  return res.body;
}

test('snap_to_vector works in PDF-point space over MCP and REST', async () => {
  const token = await mintToken();
  const call = client({ Authorization: `Bearer ${token}` });
  const projectId = await newProject(call, 'Snap');

  // The canvas uploads vector caches in 2× content-pixel space: a PDF vertex
  // at (100, 100) is stored as (200, 200).
  const upload = await call('PUT', `/api/measure/pages/${projectId}/0/vector-cache`, {
    vertices: [{ x: 200, y: 200 }],
    segments: [],
  });
  expect(upload.status).toBe(200);

  const near = { x: 99, y: 99.5 }; // PDF points, within tolerance of (100, 100)

  const mcp = await fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'snap_to_vector',
        arguments: { project_id: projectId, page_index: 0, points: [near] },
      },
    }),
  });
  expect(mcp.status).toBe(200);
  const rpc = (await mcp.json()) as {
    result: { isError: boolean; structuredContent: { snapped: Array<{ x: number; y: number }> } };
  };
  expect(rpc.result.isError).toBe(false);
  expect(rpc.result.structuredContent.snapped[0]).toEqual({ x: 100, y: 100 });

  const rest = await call<{ snapped: Array<{ x: number; y: number }> }>('POST', '/api/measure/snap', {
    project_id: projectId,
    page_index: 0,
    points: [near],
  });
  expect(rest.status).toBe(200);
  expect(rest.body.snapped[0]).toEqual({ x: 100, y: 100 });
});

test('retried shape create lands the latest payload and reparent', async () => {
  const call = await bearerClient();
  const projectId = await newProject(call, 'Shape upsert');
  expect(
    (await call('POST', '/api/measure/scale/preset', {
      project_id: projectId,
      page_index: 0,
      preset_label: '1:100',
    })).status
  ).toBe(200);
  const first = await newItem(call, projectId, 'AREA', 'sq m');
  const second = await newItem(call, projectId, 'AREA', 'sq m');
  const shapeId = crypto.randomUUID();

  const post = (itemId: string, side: number) =>
    call('POST', '/api/measure/shapes/area', {
      project_id: projectId,
      page_index: 0,
      item_id: itemId,
      shape_id: shapeId,
      points: square(side),
      snap: false,
    });

  // Original create (imagine the response was lost) …
  expect((await post(first, 10)).status).toBe(200);
  // … then the user enlarged the shape and the hook retried with the same id.
  expect((await post(first, 20)).status).toBe(200);

  let items = await listItems(call, projectId);
  let a = items.find((i) => i.id === first)!;
  expect(a.shapes).toHaveLength(1);
  expect(a.shapes[0].value).toBeCloseTo(400, 1);
  expect(a.totalValue).toBeCloseTo(400, 1);

  // A retry that also moved the shape to another item must reparent it and
  // recompute BOTH items' totals.
  expect((await post(second, 20)).status).toBe(200);
  items = await listItems(call, projectId);
  a = items.find((i) => i.id === first)!;
  const b = items.find((i) => i.id === second)!;
  expect(a.shapes).toHaveLength(0);
  expect(a.totalValue).toBeCloseTo(0, 5);
  expect(b.shapes.map((s) => s.id)).toEqual([shapeId]);
  expect(b.totalValue).toBeCloseTo(400, 1);

  // The create path must not pull a shape into a different project.
  const otherProject = await newProject(call, 'Shape upsert other');
  await call('POST', '/api/measure/scale/preset', {
    project_id: otherProject,
    page_index: 0,
    preset_label: '1:100',
  });
  const foreignItem = await newItem(call, otherProject, 'AREA', 'sq m');
  const hijack = await call<{ error: string }>('POST', '/api/measure/shapes/area', {
    project_id: otherProject,
    page_index: 0,
    item_id: foreignItem,
    shape_id: shapeId,
    points: square(5),
    snap: false,
  });
  expect(hijack.status).toBe(400);
  expect(hijack.body.error).toMatch(/different project/);
  items = await listItems(call, projectId);
  expect(items.find((i) => i.id === second)!.totalValue).toBeCloseTo(400, 1);
});

test('raw item create/update reject unknown assembly ids', async () => {
  const call = await bearerClient();
  const projectId = await newProject(call, 'Assembly id');
  const itemId = await newItem(call, projectId, 'AREA', 'sq m');

  const update = await call<{ error: string }>('PUT', `/api/measure/items/${itemId}`, {
    assembly_id: 'no-such-assembly',
  });
  expect(update.status).toBe(400);
  expect(update.body.error).toMatch(/not found/);

  const create = await call<{ error: string }>('POST', '/api/measure/items', {
    project_id: projectId,
    id: crypto.randomUUID(),
    label: 'Copied assembly item',
    type: 'AREA',
    color: '#10b981',
    unit: 'sq m',
    assembly_id: 'no-such-assembly',
  });
  expect(create.status).toBe(400);

  const items = await listItems(call, projectId);
  expect(items).toHaveLength(1);
});

test('assemblies only attach to items measured in a compatible unit', async () => {
  const admin = await adminSessionClient();
  const material = await admin<{ id: string }>('POST', '/api/memory/materials', {
    name: `Membrane ${Date.now()}`,
    unit: 'sq m',
    unit_cost: 12.5,
  });
  expect(material.status).toBe(200);
  const assembly = await admin<{ id: string }>('POST', '/api/memory/assemblies', {
    name: `Wet area membrane ${Date.now()}`,
    unit: 'm2',
    lines: [{ material_id: material.body.id, qty_per_unit: 1.1 }],
  });
  expect(assembly.status).toBe(200);

  const call = await bearerClient();
  const projectId = await newProject(call, 'Assembly units');
  const linear = await newItem(call, projectId, 'LINEAR', 'm');
  const area = await newItem(call, projectId, 'AREA', 'sq m');

  const wrong = await call<{ error: string }>('POST', '/api/memory/apply-assembly', {
    project_id: projectId,
    item_id: linear,
    assembly_id: assembly.body.id,
  });
  expect(wrong.status).toBe(400);
  expect(wrong.body.error).toMatch(/cannot attach/);

  const wrongRaw = await call('PUT', `/api/measure/items/${linear}`, {
    assembly_id: assembly.body.id,
  });
  expect(wrongRaw.status).toBe(400);

  const right = await call<{ assemblyId?: string }>('POST', '/api/memory/apply-assembly', {
    project_id: projectId,
    item_id: area,
    assembly_id: assembly.body.id,
  });
  expect(right.status).toBe(200);
  expect(right.body.assemblyId).toBe(assembly.body.id);

  const items = await listItems(call, projectId);
  expect(items.find((i) => i.id === linear)).not.toHaveProperty('assemblyId');
});

test('server recalibration refuses to mix units on a multi-page item', async () => {
  const call = await bearerClient();
  const projectId = await newProject(call, 'Recal guard');
  for (const [page, preset] of [
    [0, '1:100'],
    [1, '1:50'],
  ] as const) {
    expect(
      (await call('POST', '/api/measure/scale/preset', {
        project_id: projectId,
        page_index: page,
        preset_label: preset,
      })).status
    ).toBe(200);
  }
  const wall = await newItem(call, projectId, 'LINEAR', 'm');
  // 10 m on each page.
  for (const [page, ppm] of [
    [0, PPM_1_100],
    [1, 56.6929],
  ] as const) {
    const res = await call('POST', '/api/measure/shapes/linear', {
      project_id: projectId,
      page_index: page,
      item_id: wall,
      points: [
        { x: 0, y: 0 },
        { x: 10 * ppm, y: 0 },
      ],
      snap: false,
    });
    expect(res.status).toBe(200);
  }
  // A count spanning an uncalibrated page must not block recalibration.
  for (const page of [0, 2]) {
    expect(
      (await call('POST', '/api/measure/shapes/count', {
        project_id: projectId,
        page_index: page,
        points: [{ x: 5, y: 5 }],
        name: 'Floor wastes',
      })).status
    ).toBe(200);
  }

  const toFeet = await call<{ error: string }>('POST', '/api/measure/scale/preset', {
    project_id: projectId,
    page_index: 0,
    preset_label: '1/4" = 1\'0"',
  });
  expect(toFeet.status).toBe(400);
  expect(toFeet.body.error).toMatch(/Cannot recalibrate page 0/);

  let items = await listItems(call, projectId);
  let item = items.find((i) => i.id === wall)!;
  expect(item.unit).toBe('m');
  expect(item.totalValue).toBeCloseTo(20, 3);
  const project = await call<{ pages: Array<{ page_index: number; scale_json: string }> }>(
    'GET',
    `/api/projects/${projectId}`
  );
  const page0 = project.body.pages.find((p) => p.page_index === 0)!;
  expect(JSON.parse(page0.scale_json)).toMatchObject({ unit: 'm', pixelsPerUnit: PPM_1_100 });

  // Same-unit recalibration is still allowed and recomputes page 0 (10 m of
  // points at 1:100 read as 5 m at 1:50).
  const sameUnit = await call('POST', '/api/measure/scale/preset', {
    project_id: projectId,
    page_index: 0,
    preset_label: '1:50',
  });
  expect(sameUnit.status).toBe(200);
  items = await listItems(call, projectId);
  item = items.find((i) => i.id === wall)!;
  expect(item.totalValue).toBeCloseTo(15, 3);
});

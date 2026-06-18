import type {
  Point,
  Shape,
  ScaleCalibration,
  TakeoffItem,
  QuoteDraft,
} from '@takeoff/shared';

const BASE = '';

// Auth: in production, Cloudflare Access sits in front of the app and the
// browser carries the Access cookie automatically. Locally there's no Access,
// so the canvas reads a one-off bearer token from localStorage. Mint one with
//   curl -X POST :8787/admin/mcp/tokens \
//        -H "Authorization: Bearer $MCP_BOOTSTRAP_TOKEN" \
//        -H "Content-Type: application/json" -d '{"name":"local-dev"}'
// then in DevTools: localStorage.takeoff_token = '<token>'
function devAuthHeaders(): Record<string, string> {
  try {
    const t = typeof localStorage !== 'undefined' ? localStorage.getItem('takeoff_token') : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...devAuthHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: {
    create: (name: string, customerId?: string) =>
      req<{ id: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, customer_id: customerId }),
      }),
    list: () =>
      req<Array<{ id: string; name: string; created_at: number }>>('/api/projects'),
    get: (id: string) => req<unknown>(`/api/projects/${id}`),
    requestUploadUrl: (projectId: string, filename: string) =>
      req<{ file_key: string }>(`/api/projects/${projectId}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ filename }),
      }),
    uploadPdfBytes: async (projectId: string, fileKey: string, bytes: ArrayBuffer) => {
      // The fileKey returned by requestUploadUrl has slashes; the route is
      // `/api/projects/:id/upload/:key{.+}` so we just concatenate.
      const res = await fetch(`/api/projects/${projectId}/upload/${fileKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', ...devAuthHeaders() },
        body: bytes,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
      return res.json() as Promise<{ ok: boolean; key: string }>;
    },
    registerPdf: (
      projectId: string,
      body: {
        file_key: string;
        name?: string;
        page_count: number;
        page_sizes: Array<{ width: number; height: number }>;
        start_page_index?: number;
      }
    ) =>
      req<{ pdf_id: string; page_count: number }>(`/api/projects/${projectId}/pdfs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    fetchPdfBlob: async (projectId: string, fileKey: string): Promise<Blob> => {
      const res = await fetch(`/api/projects/${projectId}/pdfs/${fileKey}`, {
        headers: devAuthHeaders(),
      });
      if (!res.ok) throw new Error(`pdf fetch failed: ${res.status}`);
      return res.blob();
    },
  },

  scale: {
    preset: (projectId: string, pageIndex: number, presetLabel: string) =>
      req<ScaleCalibration>('/api/measure/scale/preset', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          preset_label: presetLabel,
        }),
      }),
    manual: (
      projectId: string,
      pageIndex: number,
      p1: Point,
      p2: Point,
      realDistance: number,
      unit: string
    ) =>
      req<ScaleCalibration>('/api/measure/scale/manual', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          p1,
          p2,
          real_distance: realDistance,
          unit,
        }),
      }),
  },

  shapes: {
    area: (body: {
      project_id: string;
      page_index: number;
      points: Point[];
      item_id?: string;
      shape_id?: string;
      name?: string;
      color?: string;
      deduction?: boolean;
      snap?: boolean;
    }) =>
      req<Shape>('/api/measure/shapes/area', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    linear: (body: {
      project_id: string;
      page_index: number;
      points: Point[];
      item_id?: string;
      shape_id?: string;
      name?: string;
      color?: string;
      deduction?: boolean;
      snap?: boolean;
    }) =>
      req<Shape>('/api/measure/shapes/linear', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    count: (body: {
      project_id: string;
      page_index: number;
      points: Point[];
      item_id?: string;
      shape_id?: string;
      name?: string;
      color?: string;
      deduction?: boolean;
    }) =>
      req<Shape>('/api/measure/shapes/count', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    arc: (body: {
      project_id: string;
      page_index: number;
      start: Point;
      end: Point;
      bulge: number;
      item_id?: string;
      shape_id?: string;
      name?: string;
      color?: string;
      deduction?: boolean;
    }) =>
      req<Shape>('/api/measure/shapes/arc', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      req<{ deleted: boolean; item_id: string | null }>(`/api/measure/shapes/${id}`, {
        method: 'DELETE',
      }),
    note: (body: {
      project_id: string;
      page_index: number;
      points: Point[];
      text: string;
      item_id?: string;
      shape_id?: string;
      name?: string;
      color?: string;
    }) =>
      req<Shape>('/api/measure/shapes/note', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      patch: {
        points?: Point[];
        deduction?: boolean;
        value?: number;
        item_id?: string;
        text?: string;
      }
    ) =>
      req<{ updated: boolean; item_id: string | null; previous_item_id?: string }>(
        `/api/measure/shapes/${id}`,
        { method: 'PUT', body: JSON.stringify(patch) }
      ),
  },

  items: {
    list: (projectId: string) => req<TakeoffItem[]>(`/api/measure/items/${projectId}`),
    create: (body: {
      project_id: string;
      id?: string;
      label: string;
      type: string;
      color: string;
      unit: string;
      properties?: unknown;
      formula?: string;
      price?: number;
      group?: string;
      visible?: boolean;
      depth?: number;
      assembly_id?: string;
      sub_items?: unknown;
      hidden_pages?: number[];
    }) =>
      req<TakeoffItem>('/api/measure/items', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      patch: Partial<{
        label: string;
        color: string;
        unit: string;
        properties: unknown;
        formula: string;
        price: number | null;
        group: string;
        visible: boolean;
        depth: number | null;
        assembly_id: string | null;
        hidden_pages: number[];
        sub_items: unknown;
      }>
    ) =>
      req<TakeoffItem>(`/api/measure/items/${id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      req<{ deleted: boolean }>(`/api/measure/items/${id}`, {
        method: 'DELETE',
      }),
  },

  vectorCache: {
    upload: (projectId: string, pageIndex: number, cache: unknown) =>
      req(`/api/measure/pages/${projectId}/${pageIndex}/vector-cache`, {
        method: 'PUT',
        body: JSON.stringify(cache),
      }),
  },

  legend: {
    set: (projectId: string, pageIndex: number, legend: unknown) =>
      req(`/api/measure/pages/${projectId}/${pageIndex}/legend`, {
        method: 'PUT',
        body: JSON.stringify(legend),
      }),
  },

  pageName: {
    set: (projectId: string, pageIndex: number, name: string) =>
      req(`/api/measure/pages/${projectId}/${pageIndex}/name`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }),
  },

  memory: {
    searchProjects: (q: string) =>
      req<Array<{ project_id: string; name: string; customer_name?: string; total?: number }>>(
        `/api/memory/projects/search?q=${encodeURIComponent(q)}`
      ),
    searchCustomers: (q: string) =>
      req<Array<{ id: string; name: string; xeroContactId?: string }>>(
        `/api/memory/customers/search?q=${encodeURIComponent(q)}`
      ),
    listAssemblies: () => req('/api/memory/assemblies'),
    // Methodology, rate cards, counting rule, product system, Pavilion
    // Studio sheet conventions, FFE schedule expectations, worked examples
    // — every piece of skill knowledge the in-app agent pulls before
    // measuring. See migrations/0005_takeoff_knowledge.sql + the seed.
    getTakeoffKnowledge: (params: { topic?: string; builder?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.topic) qs.set('topic', params.topic);
      if (params.builder) qs.set('builder', params.builder);
      const q = qs.toString();
      return req<
        Array<{
          id: string;
          topic: string;
          title: string;
          body_md: string;
          builder: string | null;
        }>
      >(`/api/memory/takeoff-knowledge${q ? `?${q}` : ''}`);
    },
    // Validated apply-assembly path — the server checks the assembly exists
    // before stamping its id onto the item. The agent must NOT route this
    // through api.items.update({ assembly_id }), which writes the id raw and
    // makes the item silently disappear from buildQuote if the assembly was
    // stale or hallucinated.
    applyAssembly: (body: { project_id: string; item_id: string; assembly_id: string }) =>
      req<TakeoffItem>('/api/memory/apply-assembly', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    quote: (projectId: string) => req<QuoteDraft>(`/api/memory/quote/${projectId}`),
  },

  xero: {
    pushQuote: (projectId: string, customerXeroId: string, reference?: string) =>
      req<{ xero_id: string; deep_link: string }>('/xero/push', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          kind: 'QUOTE',
          customer_xero_id: customerXeroId,
          reference,
        }),
      }),
    pushInvoice: (projectId: string, customerXeroId: string, reference?: string) =>
      req<{ xero_id: string; deep_link: string }>('/xero/push', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          kind: 'INVOICE',
          customer_xero_id: customerXeroId,
          reference,
        }),
      }),
    pullInvoice: (body: { invoice_id?: string; invoice_number?: string }) =>
      req<{
        invoice_id: string;
        invoice_number: string;
        status: string;
        contact_name: string | null;
        contact_xero_id: string | null;
        date: string | null;
        due_date: string | null;
        total: number;
        subtotal: number;
        total_tax: number;
        currency: string;
        reference: string | null;
        line_items: Array<{
          description: string | null;
          quantity: number | null;
          unit_amount: number | null;
          line_amount: number | null;
          account_code: string | null;
          tax_type: string | null;
          item_code: string | null;
          tracking: Array<{ name: string; option: string }>;
        }>;
        deep_link: string;
      }>('/xero/invoices/pull', { method: 'POST', body: JSON.stringify(body) }),
  },

  // Snap proposed points to nearest PDF vector geometry for a page. Same
  // server-side implementation the canvas + MCP use; the agent calls this
  // after the model proposes approximate polygon vertices from vision.
  snap: (body: { project_id: string; page_index: number; points: Point[]; tolerance_px?: number }) =>
    req<{ snapped: Point[] }>('/api/measure/snap', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Anthropic proxy — one model turn. The agent/chat owns the running
  // transcript; the worker holds the API key and never persists messages.
  ai: {
    turn: (body: {
      messages: unknown[];
      system?: string;
      model?: string;
      maxTokens?: number;
      toolNames?: string[];
    }) =>
      req<{
        content: Array<Record<string, unknown>>;
        stopReason: string;
        usage: { input_tokens: number; output_tokens: number } | null;
      }>('/api/ai/turn', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};

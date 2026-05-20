import type {
  Point,
  Shape,
  ScaleCalibration,
  TakeoffItem,
  QuoteDraft,
} from '@takeoff/shared';

const BASE = '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
      const res = await fetch(`/api/projects/${projectId}/upload/${fileKey}`, {
        method: 'PUT',
        body: bytes,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      return res.json();
    },
    registerPdf: (
      projectId: string,
      body: {
        file_key: string;
        name?: string;
        page_count: number;
        page_sizes: Array<{ width: number; height: number }>;
      }
    ) =>
      req<{ pdf_id: string }>(`/api/projects/${projectId}/pdfs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
    area: (projectId: string, pageIndex: number, points: Point[], itemId?: string) =>
      req<Shape>('/api/measure/shapes/area', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          points,
          item_id: itemId,
        }),
      }),
    linear: (projectId: string, pageIndex: number, points: Point[], itemId?: string) =>
      req<Shape>('/api/measure/shapes/linear', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          points,
          item_id: itemId,
        }),
      }),
    count: (projectId: string, pageIndex: number, points: Point[], itemId?: string) =>
      req<Shape>('/api/measure/shapes/count', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          points,
          item_id: itemId,
        }),
      }),
    arc: (
      projectId: string,
      pageIndex: number,
      start: Point,
      end: Point,
      bulge: number,
      itemId?: string
    ) =>
      req<Shape>('/api/measure/shapes/arc', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          page_index: pageIndex,
          start,
          end,
          bulge,
          item_id: itemId,
        }),
      }),
  },

  items: {
    list: (projectId: string) => req<TakeoffItem[]>(`/api/measure/items/${projectId}`),
  },

  vectorCache: {
    upload: (projectId: string, pageIndex: number, cache: unknown) =>
      req(`/api/measure/pages/${projectId}/${pageIndex}/vector-cache`, {
        method: 'PUT',
        body: JSON.stringify(cache),
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
  },
};

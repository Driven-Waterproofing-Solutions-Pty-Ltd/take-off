// Web replacement for the desktop Tauri-backed storage layer.
// Project state lives in D1 via the REST API (see hooks/useProjectManagerWeb.ts).
// Only templates are kept here, backed by localStorage as a lightweight client-side store.
// The "real" assemblies / pricing live in the worker memory layer (/api/memory/assemblies).

import type { ItemTemplate, TakeoffItem, ProjectData, PlanSet } from '../types';

const TEMPLATES_KEY = 'takeoff.templates.v1';

function readTemplates(): ItemTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as ItemTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeTemplates(list: ItemTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

export const saveTemplate = async (template: ItemTemplate): Promise<void> => {
  const list = readTemplates().filter((t) => t.id !== template.id);
  list.push(template);
  writeTemplates(list);
};

export const getTemplates = async (): Promise<ItemTemplate[]> => {
  return readTemplates();
};

export const deleteTemplate = async (id: string): Promise<void> => {
  writeTemplates(readTemplates().filter((t) => t.id !== id));
};

export const exportTemplatesToJSON = async (templates: ItemTemplate[]): Promise<Blob> => {
  const json = JSON.stringify(templates, null, 2);
  return new Blob([json], { type: 'application/json' });
};

export const importTemplatesFromJSON = async (file: File): Promise<void> => {
  const text = await file.text();
  const templates = JSON.parse(text) as ItemTemplate[];
  if (!Array.isArray(templates)) throw new Error('Invalid template file');
  const existing = new Map(readTemplates().map((t) => [t.id, t]));
  for (const t of templates) {
    const id = t.id || crypto.randomUUID();
    existing.set(id, { ...t, id });
  }
  writeTemplates([...existing.values()]);
};

// Project import/export — JSON only on web (zip with PDFs is a desktop concept;
// PDFs live in R2 on the web side).
export interface ProjectState {
  items: TakeoffItem[];
  projectData: ProjectData;
  planSets: PlanSet[];
  totalPages: number;
  projectName: string;
}

export const exportProjectToZip = async (
  items: TakeoffItem[],
  projectData: ProjectData,
  planSets: PlanSet[],
  totalPages: number,
  projectName: string
): Promise<Blob> => {
  // "Zip" is a misnomer on web — we emit a plain JSON snapshot.
  // PDFs are referenced by R2 key, not embedded.
  const snapshot = {
    items,
    projectData,
    planSets: planSets.map((p) => ({
      id: p.id,
      name: p.name,
      pageCount: p.pageCount,
      startPageIndex: p.startPageIndex,
      pages: p.pages,
    })),
    totalPages,
    projectName,
    exportedAt: new Date().toISOString(),
  };
  return new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
};

export const importProjectFromZip = async (data: File | Uint8Array): Promise<ProjectState> => {
  const text =
    data instanceof File
      ? await data.text()
      : new TextDecoder().decode(data);
  const parsed = JSON.parse(text);
  return {
    items: parsed.items ?? [],
    projectData: parsed.projectData ?? {},
    planSets: parsed.planSets ?? [],
    totalPages: parsed.totalPages ?? 0,
    projectName: parsed.projectName ?? 'Imported Project',
  };
};

// Stubs kept for API compatibility with the desktop hook (no-ops on web).
export const saveProjectData = async (..._args: unknown[]): Promise<void> => {};
export const savePlanFile = async (_id: string, _file: File): Promise<void> => {};
export const clearProjectData = async (): Promise<void> => {};
export const loadProjectFromStorage = async (): Promise<ProjectState | null> => null;

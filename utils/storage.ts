import JSZip from 'jszip';
import Database from '@tauri-apps/plugin-sql';
import { PlanSet, ProjectData, TakeoffItem, ItemTemplate } from '../types';

// SQLite Table Structure:
// meta: key (TEXT PRIMARY KEY), value (TEXT JSON)
// files: id (TEXT PRIMARY KEY), name (TEXT), data (BLOB)
// templates: id (TEXT PRIMARY KEY), data (TEXT JSON)

let dbInstance: Database | null = null;

const getDB = async () => {
  if (!dbInstance) {
    // Requires tauri-plugin-sql with "sqlite" feature enabled
    dbInstance = await Database.load('sqlite:protakeoff.db');

    // Initialize Tables
    await dbInstance.execute(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT,
        data BLOB
      );
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        data TEXT
      );
    `);
  }
  return dbInstance;
};

export interface ProjectState {
  items: TakeoffItem[];
  projectData: ProjectData;
  planSets: PlanSet[];
  totalPages: number;
  projectName: string;
}

// Save metadata
export const saveProjectData = async (
  items: TakeoffItem[],
  projectData: ProjectData,
  planSets: PlanSet[],
  totalPages: number,
  projectName: string = "Untitled Project"
) => {
  const db = await getDB();

  // We strip file blobs from planSets for metadata to keep JSON light
  const planSetsMeta = planSets.map(p => ({
    id: p.id,
    name: p.name,
    pageCount: p.pageCount,
    startPageIndex: p.startPageIndex,
    pages: p.pages
  }));

  const data = {
    items,
    projectData,
    planSetsMeta,
    totalPages,
    projectName,
    updatedAt: Date.now(),
    version: 2
  };

  await db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ($1, $2)", ['current_project', JSON.stringify(data)]);
};

// Save a specific file (blob) to SQLite
export const savePlanFile = async (id: string, file: File) => {
  const db = await getDB();
  const buffer = await file.arrayBuffer();
  // Tauri SQL plugin requires Uint8Array for BLOBs
  await db.execute(
    "INSERT OR REPLACE INTO files (id, name, data) VALUES ($1, $2, $3)",
    [id, file.name, new Uint8Array(buffer)]
  );
};

// Clear all data
export const clearProjectData = async () => {
  const db = await getDB();
  await db.execute("DELETE FROM meta WHERE key = 'current_project'");
  await db.execute("DELETE FROM files");
};

// Load complete state
export const loadProjectFromStorage = async (): Promise<ProjectState | null> => {
  const db = await getDB();

  const result = await db.select("SELECT value FROM meta WHERE key = 'current_project'") as any[];
  if (result.length === 0) return null;

};

// --- License Persistence ---
export const saveLicenseKey = async (key: string) => {
  const db = await getDB();
  await db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ($1, $2)", ['license_key', key]);
}

export const getLicenseKey = async (): Promise<string | null> => {
  const db = await getDB();
  const result = await db.select("SELECT value FROM meta WHERE key = 'license_key'") as any[];
  return result.length > 0 ? result[0].value : null;
}

// --- File Handle Persistence (Stubbed for SQLite version) ---
// Since we store files directly in DB, we don't strictly need file handles unless we want to "Save As" back to disk later.

export const saveFileHandle = async (handle: any) => {
  // Not implemented for SQLite persistence model
  return;
};

export const getFileHandle = async (): Promise<any | null> => {
  return null;
};

// --- ZIP Export / Import ---

export const exportProjectToZip = async (
  items: TakeoffItem[],
  projectData: ProjectData,
  planSets: PlanSet[],
  totalPages: number,
  projectName: string = "Untitled Project"
): Promise<Blob> => {
  const zip = new JSZip();

  const planSetsMeta = planSets.map(p => ({
    id: p.id,
    name: p.name,
    pageCount: p.pageCount,
    startPageIndex: p.startPageIndex,
    fileName: `${p.id}.pdf`,
    pages: p.pages
  }));

  const projectState = {
    version: 2,
    appVersion: "1.1.0",
    items,
    projectData,
    planSetsMeta,
    totalPages,
    projectName,
    exportedAt: new Date().toISOString()
  };

  zip.file('project.json', JSON.stringify(projectState, null, 2));

  const assets = zip.folder('assets');
  if (assets) {
    for (const plan of planSets) {
      assets.file(`${plan.id}.pdf`, plan.file);
    }
  }

  return await zip.generateAsync({ type: 'blob' });
};

export const importProjectFromZip = async (zipData: File | Uint8Array): Promise<ProjectState> => {
  const zip = await JSZip.loadAsync(zipData);

  const jsonFile = zip.file('project.json');
  if (!jsonFile) throw new Error("Invalid project file: missing project.json");

  const jsonStr = await jsonFile.async('string');
  const data = JSON.parse(jsonStr);

  const reconstructedPlanSets: PlanSet[] = [];
  const assets = zip.folder('assets');

  if (data.planSetsMeta && assets) {
    for (const pMeta of data.planSetsMeta) {
      const pdfFile = assets.file(pMeta.fileName || `${pMeta.id}.pdf`);
      if (pdfFile) {
        // Ensure we get a full blob/arraybuffer
        const arrayBuffer = await pdfFile.async('arraybuffer');
        // Explicitly create a Blob with correct MIME
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const file = new File([blob], (pMeta.name || "plan") + '.pdf', { type: 'application/pdf', lastModified: Date.now() });

        reconstructedPlanSets.push({
          id: pMeta.id,
          name: pMeta.name,
          pageCount: pMeta.pageCount,
          startPageIndex: pMeta.startPageIndex,
          file,
          pages: pMeta.pages
        });
      }
    }
  }

  return {
    items: data.items || [],
    projectData: data.projectData || {},
    totalPages: data.totalPages || 0,
    planSets: reconstructedPlanSets,
    projectName: data.projectName || "Untitled Project"
  };
};

// --- Template System ---

export const saveTemplate = async (template: ItemTemplate) => {
  const db = await getDB();
  await db.execute("INSERT OR REPLACE INTO templates (id, data) VALUES ($1, $2)", [template.id, JSON.stringify(template)]);
};

export const getTemplates = async (): Promise<ItemTemplate[]> => {
  const db = await getDB();
  const result = await db.select("SELECT data FROM templates") as any[];
  return result.map(r => JSON.parse(r.data));
};

export const deleteTemplate = async (id: string) => {
  const db = await getDB();
  await db.execute("DELETE FROM templates WHERE id = $1", [id]);
};

export const exportTemplatesToJSON = async (templates: ItemTemplate[]) => {
  const json = JSON.stringify(templates, null, 2);
  return new Blob([json], { type: 'application/json' });
};

export const importTemplatesFromJSON = async (file: File) => {
  const text = await file.text();
  const templates = JSON.parse(text) as ItemTemplate[];
  if (!Array.isArray(templates)) throw new Error("Invalid template file");

  const db = await getDB();
  for (const t of templates) {
    const id = t.id || crypto.randomUUID();
    await db.execute("INSERT OR REPLACE INTO templates (id, data) VALUES ($1, $2)", [id, JSON.stringify({ ...t, id })]);
  }
};
import JSZip from 'jszip';
import Database from '@tauri-apps/plugin-sql';
import { exists, writeFile, readFile, mkdir, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
// import { join } from '@tauri-apps/api/path'; // Not strictly needed if we use BaseDirectory and relative paths
import { PlanSet, ProjectData, TakeoffItem, ItemTemplate } from '../types';

// SQLite Table Structure:
// meta: key (TEXT PRIMARY KEY), value (TEXT JSON)
// files: id (TEXT PRIMARY KEY), name (TEXT), data (BLOB) - data column is deprecated, used for legacy migration only
// templates: id (TEXT PRIMARY KEY), data (TEXT JSON)

// File System Structure:
// $APPLOCALDATA/protakeoff/pdf_store/{id}.pdf

const PDF_STORE_DIR = 'protakeoff/pdf_store';

// --- Database Types ---
interface MetaRow {
  key: string;
  value: string;
}

interface FileRow {
  id: string;
  name: string;
  data: Uint8Array | number[] | null; // Nullable now
}

interface TemplateRow {
  id: string;
  data: string;
}

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

// Ensure storage directory exists
const ensureStorageDir = async () => {
  try {
    const dirExists = await exists(PDF_STORE_DIR, { baseDir: BaseDirectory.AppLocalData });
    if (!dirExists) {
      await mkdir(PDF_STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
    }
  } catch (e) {
    console.error("Failed to ensure storage directory:", e);
    // Try creating it anyway, error might be "not found"
    try {
      await mkdir(PDF_STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
    } catch (e2) {
      console.error("Critical: Could not create storage directory", e2);
      throw e2;
    }
  }
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

// Save a specific file to File System and record in SQLite
export const savePlanFile = async (id: string, file: File) => {
  const db = await getDB();
  await ensureStorageDir();

  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);
  const filePath = `${PDF_STORE_DIR}/${id}.pdf`;

  // Write to filesystem
  await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppLocalData });

  // Update DB record (without BLOB data)
  // We explicitly set data to NULL to save space if it was previously populated
  await db.execute(
    "INSERT OR REPLACE INTO files (id, name, data) VALUES ($1, $2, NULL)",
    [id, file.name]
  );
};

// Clear all data
export const clearProjectData = async () => {
  const db = await getDB();
  await db.execute("DELETE FROM meta WHERE key = 'current_project'");
  
  // Clean up files
  try {
    const files = await db.select("SELECT id FROM files") as FileRow[];
    for (const row of files) {
       const filePath = `${PDF_STORE_DIR}/${row.id}.pdf`;
       try {
         const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppLocalData });
         if (fileExists) {
           await remove(filePath, { baseDir: BaseDirectory.AppLocalData });
         }
       } catch (e) {
         console.warn(`Failed to delete file ${row.id}`, e);
       }
    }
  } catch (e) {
    console.error("Error cleaning up files:", e);
  }

  await db.execute("DELETE FROM files");
};

// Load complete state
export const loadProjectFromStorage = async (): Promise<ProjectState | null> => {
  const db = await getDB();

  const result = await db.select("SELECT value FROM meta WHERE key = 'current_project'") as MetaRow[];
  if (result.length === 0) return null;

  try {
    const data = JSON.parse(result[0].value);
    const planSets: PlanSet[] = [];

    // Rehydrate PlanSets by fetching associated files
    if (data.planSetsMeta && Array.isArray(data.planSetsMeta)) {
      await ensureStorageDir();

      for (const meta of data.planSetsMeta) {
        const fileResult = await db.select("SELECT name, data FROM files WHERE id = $1", [meta.id]) as FileRow[];
        
        if (fileResult.length > 0) {
          const fileRow = fileResult[0];
          let fileData: Uint8Array | null = null;
          const filePath = `${PDF_STORE_DIR}/${meta.id}.pdf`;

          // 1. Try reading from File System first
          try {
            const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppLocalData });
            if (fileExists) {
              fileData = await readFile(filePath, { baseDir: BaseDirectory.AppLocalData });
            }
          } catch (e) {
            console.warn(`Error reading file ${meta.id} from disk`, e);
          }

          // 2. Migration Fallback: If not on disk, check DB BLOB
          if (!fileData && fileRow.data) {
             console.log(`Migrating file ${meta.id} from DB to FS`);
             if (fileRow.data instanceof Uint8Array) {
               fileData = new Uint8Array(Array.from(fileRow.data));
             } else {
               fileData = new Uint8Array(fileRow.data as unknown as number[]);
             }
             
             // Save to disk for next time
             try {
                await writeFile(filePath, fileData, { baseDir: BaseDirectory.AppLocalData });
                // Optional: Clear data from DB to free space immediately? 
                // Let's safe-keep it until next save, or just update now.
                // await db.execute("UPDATE files SET data = NULL WHERE id = $1", [meta.id]);
             } catch (e) {
                console.error("Failed to migrate file to disk", e);
             }
          }

          if (fileData) {
            const blob = new Blob([fileData as any], { type: 'application/pdf' });
            const file = new File([blob], fileRow.name, { type: 'application/pdf' });
            
            planSets.push({
              ...meta,
              file
            });
          } else {
            console.error(`File data missing for plan ${meta.id}`);
            // Push placeholder or skip? Skipping might break index alignment if not careful, 
            // but planSetsMeta usually has enough info.
            // If we skip, the UI might crash if it expects a file.
            // Let's creating a dummy file to prevent crash, but user will see empty/error
            const dummyBlob = new Blob([], { type: 'application/pdf' });
            planSets.push({
               ...meta,
               file: new File([dummyBlob], fileRow.name || "Missing File.pdf", { type: 'application/pdf' })
            });
          }
        }
      }
    }

    return {
      items: data.items || [],
      projectData: data.projectData || {},
      totalPages: data.totalPages || 0,
      planSets,
      projectName: data.projectName || "Untitled Project"
    };

  } catch (error) {
    console.error("Failed to parse project data:", error);
    return null;
  }
};

// --- File Handle Persistence (Stubbed for SQLite version) ---
export const saveFileHandle = async (_handle: unknown): Promise<void> => {
  // Not implemented for SQLite persistence model
  return;
};

export const getFileHandle = async (): Promise<unknown | null> => {
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
      // plan.file is a File object, JSZip handles it directly
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
  const result = await db.select("SELECT data FROM templates") as TemplateRow[];
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

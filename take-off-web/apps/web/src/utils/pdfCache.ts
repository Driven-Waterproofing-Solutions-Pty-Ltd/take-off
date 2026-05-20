// Web-side PDF page-image cache, backed by IndexedDB.
// Same exported shape as the desktop pdfCache so BlueprintCanvas / RamCacheContext
// can keep their existing imports unchanged.

const DB_NAME = 'takeoff-pdf-cache';
const STORE = 'pages';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function keyOf(fileId: string, pageIndex: number): string {
  return `${fileId}_${pageIndex}`;
}

export const ensureCacheDir = async (): Promise<void> => {
  await openDB();
};

export const getPageImage = async (fileId: string, pageIndex: number): Promise<Blob | null> => {
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(keyOf(fileId, pageIndex));
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
};

export const savePageImage = async (
  fileId: string,
  pageIndex: number,
  blob: Blob
): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, keyOf(fileId, pageIndex));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('savePageImage failed', e);
  }
};

export const clearCache = async (): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

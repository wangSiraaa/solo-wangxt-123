import type { Project } from './types';

// 工程数据全部存放在 IndexedDB（库 dc-bench / 表 projects），不使用任何后端。
const DB_NAME = 'dc-bench';
const STORE = 'projects';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export async function saveProject(project: Project): Promise<void> {
  await tx('readwrite', (store) => store.put(project));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return tx('readonly', (store) => store.get(id) as IDBRequest<Project | undefined>);
}

export async function listProjects(): Promise<Project[]> {
  const all = await tx('readonly', (store) => store.getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function hasAnyProject(): Promise<boolean> {
  return (await listProjects()).length > 0;
}

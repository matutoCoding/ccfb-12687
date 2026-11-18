// 浏览器本地 IndexedDB 封装：图纸、配方、排产、批注全部离线存储
import type { ID } from '../types';

const DB_NAME = 'indigo-studio';
const DB_VERSION = 1;

interface StoreDef {
  name: StoreName;
  keyPath: string;
  indexes?: { name: string; field: string }[];
}

export const STORE_DEFS: StoreDef[] = [
  { name: 'fabrics', keyPath: 'id' },
  { name: 'projects', keyPath: 'id' },
  { name: 'recipes', keyPath: 'id' },
  { name: 'dyes', keyPath: 'id' },
  { name: 'sims', keyPath: 'projectId' },
  { name: 'orders', keyPath: 'id' },
  { name: 'plan', keyPath: 'id' },
  { name: 'shares', keyPath: 'token' },
  { name: 'annotations', keyPath: 'id', indexes: [{ name: 'token', field: 'token' }] },
  { name: 'settings', keyPath: 'id' },
];

export type StoreName =
  | 'fabrics'
  | 'projects'
  | 'recipes'
  | 'dyes'
  | 'sims'
  | 'orders'
  | 'plan'
  | 'shares'
  | 'annotations'
  | 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const def of STORE_DEFS) {
        if (db.objectStoreNames.contains(def.name)) continue;
        const store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        for (const ix of def.indexes ?? []) {
          store.createIndex(ix.name, ix.field);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function put<T extends object>(store: StoreName, value: T): Promise<T> {
  await tx(store, 'readwrite', (s) => s.put(value));
  return value;
}

export async function get<T>(store: StoreName, key: ID): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export async function remove(store: StoreName, key: ID): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export async function clearStore(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

/** 按索引查询（批注按 token 查） */
export async function queryByIndex<T>(store: StoreName, index: string, value: ID): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const s = t.objectStore(store);
    if (!s.indexNames.contains(index)) {
      reject(new Error(`索引 ${index} 不存在`));
      return;
    }
    const req = s.index(index).getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

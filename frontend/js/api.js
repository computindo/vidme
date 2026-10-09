export async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw Error(await r.text());
  return r.json();
}

export const IDB_NAME = 'vidme-uploads';
export const IDB_STORE = 'uploads';

export function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

export async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbGet(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

let _idbPutHook = null;
export function setIdbPutHook(fn) {
  _idbPutHook = fn;
}

async function rawIdbPut(k, v) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function idbPut(k, v) {
  if (_idbPutHook) {
    return _idbPutHook(k, v, rawIdbPut);
  }
  return rawIdbPut(k, v);
}

export async function idbDel(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

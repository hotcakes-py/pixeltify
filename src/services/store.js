// Persistencia PIXELTIFY.
// - Metadatos (tracks sin src), playlists, historial y likes → localStorage.
// - Audio subido por el usuario (File/blob) → IndexedDB (funciona en web y desktop).
// - Descargas en desktop → viven en disco (Música/Pixeltify) y se reescanean al abrir.

const LS_TRACKS = "pixeltify:tracks";
const LS_PL = "pixeltify:playlists";
const LS_HIST = "pixeltify:history";
const LS_LIKED = "pixeltify:liked";

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

export const loadTracksMeta = () => readLS(LS_TRACKS, []);
export const saveTracksMeta = (tracks) => writeLS(LS_TRACKS, tracks.map(stripSrc));
export const loadPlaylists = () => readLS(LS_PL, []);
export const savePlaylists = (pl) => writeLS(LS_PL, pl);
export const loadHistory = () => readLS(LS_HIST, []);
export const saveHistory = (h) => writeLS(LS_HIST, h.slice(0, 10));
export const loadLiked = () => readLS(LS_LIKED, []);
export const saveLiked = (l) => writeLS(LS_LIKED, l);

export function stripSrc(track) {
  const { src, ...rest } = track;
  return rest;
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "audio/mpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---------- IndexedDB mínimo ----------
const DB = "pixeltify";
const STORE = "audio";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDel(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Guarda en segundo plano los bytes de un stream para que la próxima
// suene al instante desde caché (sin re-resolver la URL que expira).
export async function cacheStreamBytes(api, track, audioUrl) {
  const cid = track?.cacheId || (track?.ytId ? `cache:${track.ytId}` : null);
  if (!api?.fetchAudioBytes || !cid || !audioUrl) return;
  try {
    const r = await api.fetchAudioBytes(audioUrl);
    if (r?.ok && r.dataUrl) {
      await idbPut(cid, dataUrlToBlob(r.dataUrl));
    }
  } catch (_) {}
}

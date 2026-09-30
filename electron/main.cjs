// PIXELTIFY — proceso principal de Electron (Windows + Linux)
// CommonJS (.cjs) porque package.json usa "type": "module".
// yt-dlp + ffmpeg vienen INCLUIDOS en la app (resources/bin), el usuario no instala nada.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
let mainWindow = null;

function oldMusicDir() {
  return path.join(app.getPath("music"), "Pixeltify");
}

// Biblioteca: carpeta "playlist" junto al exe (AppImage/portable).
// Si ahi no se puede escribir, se usa la carpeta del usuario.
// Adentro: una subcarpeta por playlist con su MP3 + cover + datos.
function getLibraryDir() {
  let base = null;
  if (app.isPackaged) {
    try {
      const exeDir = path.dirname(app.getPath("exe"));
      const cand = path.join(exeDir, "playlist");
      fs.mkdirSync(cand, { recursive: true });
      fs.accessSync(cand, fs.constants.W_OK);
      base = cand;
    } catch (_) {
      base = null;
    }
  }
  if (!base) {
    base = path.join(app.getPath("userData"), "playlist");
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch (_) {}
  }
  // migrar mp3 de la ubicacion vieja (mismo nombre = mismos ids)
  try {
    const old = oldMusicDir();
    if (fs.existsSync(old)) {
      for (const f of fs.readdirSync(old)) {
        if (!/\.mp3$/i.test(f)) continue;
        const src = path.join(old, f);
        const dst = path.join(base, f);
        try {
          if (fs.statSync(src).isFile() && !fs.existsSync(dst)) fs.renameSync(src, dst);
        } catch (_) {}
      }
    }
  } catch (_) {}
  return base;
}

function getMusicDir() {
  return getLibraryDir();
}

function safeFolder(name) {
  let s = String(name || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").replace(/^[.\s-]+/, "").slice(0, 60).trim();
  if (!s || /^\.+$/.test(s)) s = "playlist";
  return s;
}

function safeFile(name) {
  let s = String(name || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").slice(0, 120).trim();
  if (!s || /^\.+$/.test(s)) s = "cancion";
  return s;
}

function relPosix(base, abs) {
  return path.relative(base, abs).split(path.sep).join("/");
}

function inLibrary(base, p) {
  try {
    const abs = path.resolve(p);
    const root = path.resolve(base) + path.sep;
    if (abs.startsWith(root)) return abs;
  } catch (_) {}
  return null;
}

async function fetchBytes(url, maxBytes) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Pixeltify)" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    return { buf, type: res.headers.get("content-type") || "" };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(to);
  }
}

// por cada MP3: .json con sus datos + cover con su portada
async function writeSidecars(mp3Path, meta, cover) {
  const stem = mp3Path.replace(/\.mp3$/i, "");
  try {
    if (meta && (meta.title || meta.artist)) {
      fs.writeFileSync(stem + ".json", JSON.stringify({ ...meta, savedAt: new Date().toISOString() }, null, 1));
    }
  } catch (_) {}
  try {
    let got = null;
    if (cover && typeof cover.dataUrl === "string" && cover.dataUrl.startsWith("data:image/")) {
      const m = cover.dataUrl.match(/^data:(image\/\w+);base64,([\s\S]*)$/);
      if (m) got = { buf: Buffer.from(m[2], "base64"), type: m[1] };
    } else if (cover && typeof cover.url === "string" && /^https?:\/\//i.test(cover.url)) {
      got = await fetchBytes(cover.url, 2 * 1024 * 1024);
    }
    if (!got || !/image\//i.test(got.type)) return "";
    const ext = /png/i.test(got.type) ? ".png" : /webp/i.test(got.type) ? ".webp" : ".jpg";
    for (const e of [".jpg", ".jpeg", ".png", ".webp"]) {
      const cp = stem + e;
      if (e !== ext && fs.existsSync(cp)) {
        try { fs.unlinkSync(cp); } catch (_) {}
      }
    }
    fs.writeFileSync(stem + ext, got.buf);
    return stem + ext;
  } catch (_) {
    return "";
  }
}

// ---------- resolver de binarios incluidos ----------
function unpacked(p) {
  // los binarios no pueden ejecutarse desde dentro del asar
  return p.replace(/app\.asar([/\\])/g, "app.asar.unpacked$1");
}

function bundledBinDir() {
  // 1) packaged: process.resourcesPath/bin/{linux,win}
  // 2) dev: <root>/resources/bin/{linux,win}
  const plat = process.platform === "win32" ? "win" : "linux";
  const candidates = [
    path.join(process.resourcesPath || "", "bin", plat),
    path.join(__dirname, "..", "resources", "bin", plat),
  ];
  for (const d of candidates) {
    if (d && fs.existsSync(d)) return d;
  }
  return null;
}

function getYtDlpPath() {
  const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const dir = bundledBinDir();
  if (dir) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  // node_modules/yt-dlp-exec/bin (dev)
  const local = path.join(__dirname, "..", "node_modules", "yt-dlp-exec", "bin", exe);
  if (fs.existsSync(local)) return local;
  // asar unpacked (packaged fallback)
  try {
    const u = unpacked(local);
    if (fs.existsSync(u)) return u;
  } catch (_) {}
  return exe; // PATH como último recurso
}

function getFfmpegPath() {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const dir = bundledBinDir();
  if (dir) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  try {
    const local = require("ffmpeg-static");
    if (local && fs.existsSync(local)) return local;
    const u = unpacked(local);
    if (u && fs.existsSync(u)) return u;
  } catch (_) {}
  const local2 = path.join(__dirname, "..", "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (fs.existsSync(local2)) return local2;
  return exe; // PATH
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d0d1a",
    title: "PIXELTIFY",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => (mainWindow = null));
}

app.whenReady().then(() => {
  // permisos de ejecución en linux (por si el zip los perdió)
  try {
    if (process.platform !== "win32") {
      for (const b of [getYtDlpPath(), getFfmpegPath()]) {
        if (b && fs.existsSync(b) && !b.endsWith(".exe")) fs.chmodSync(b, 0o755);
      }
    }
  } catch (_) {}
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- auto-actualización (lee tus releases de GitHub) ----------
// Linux AppImage: descarga e instala sola. Windows portable: avisa y abre la descarga.
function sendUpdate(state) {
  try {
    mainWindow?.webContents.send("update-status", state);
  } catch (_) {}
}

if (!isDev) {
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => sendUpdate({ status: "checking" }));
    autoUpdater.on("update-available", (info) => sendUpdate({ status: "available", version: info?.version || "" }));
    autoUpdater.on("update-not-available", () => sendUpdate({ status: "none" }));
    autoUpdater.on("download-progress", (p) => sendUpdate({ status: "downloading", pct: Math.floor(p?.percent || 0) }));
    autoUpdater.on("update-downloaded", (info) => sendUpdate({ status: "ready", version: info?.version || "" }));
    autoUpdater.on("error", () => sendUpdate({ status: "none" }));
    app.whenReady().then(() => {
      // espera a que cargue la ventana antes de buscar
      setTimeout(() => {
        try {
          autoUpdater.checkForUpdatesAndNotify();
        } catch (_) {}
      }, 8000);
    });
    ipcMain.handle("quit-and-install", () => {
      try {
        autoUpdater.quitAndInstall();
      } catch (_) {}
      return false;
    });
  } catch (_) {
    ipcMain.handle("quit-and-install", () => false);
  }
} else {
  ipcMain.handle("quit-and-install", () => false);
}

// ---------- info ----------
ipcMain.handle("app-info", () => ({
  platform: process.platform,
  version: app.getVersion(),
  musicDir: getMusicDir(),
  isElectron: true,
  bundled: true,
}));

// ---------- elegir archivos de audio locales ----------
ipcMain.handle("select-audio-files", async () => {
  const res = await dialog.showOpenDialog({
    title: "Agregar música a Pixeltify",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Audio", extensions: ["mp3", "m4a", "ogg", "oga", "wav", "flac", "opus", "webm", "mp4"] },
      { name: "Todos", extensions: ["*"] },
    ],
  });
  if (res.canceled) return [];
  return res.filePaths || [];
});

// ---------- leer un archivo como data URL ----------
ipcMain.handle("read-audio-file", async (_e, filePath) => {
  const stat = fs.statSync(filePath);
  if (stat.size > 120 * 1024 * 1024) throw new Error("Archivo muy grande (máx 120 MB)");
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".mp3" ? "audio/mpeg"
    : ext === ".m4a" || ext === ".mp4" ? "audio/mp4"
    : ext === ".ogg" || ext === ".oga" || ext === ".opus" ? "audio/ogg"
    : ext === ".wav" ? "audio/wav"
    : ext === ".flac" ? "audio/flac"
    : ext === ".webm" ? "audio/webm"
    : "audio/mpeg";
  return { name: path.basename(filePath), mime, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
});

// ---------- BUSCAR canciones en YouTube (varias, sin duplicados) ----------
const YT_RE = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|embed)|youtu\.be\/)[\w\-?&=%.:/+#;@~]*$/i;

function pickThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return "";
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0].url || "";
}

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9áéíóúñü ]/gi, "")
    .trim();
}

function toResult(entry, fallback) {
  const id = entry.id || "";
  if (!id) return null;
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const best = thumbs.length
    ? [...thumbs].sort((x, y) => (y.width || 0) - (x.width || 0))[0].url
    : entry.thumbnail || "";
  const dur = entry.duration_string
    || (entry.duration
      ? `${Math.floor(entry.duration / 60)}:${String(Math.floor(entry.duration % 60)).padStart(2, "0")}`
      : "--:--");
  return {
    id,
    title: entry.title || fallback,
    artist: entry.uploader || entry.channel || "YouTube",
    duration: dur,
    thumbnail: best || "",
    url: entry.webpage_url || `https://www.youtube.com/watch?v=${id}`,
  };
}

ipcMain.handle("search-youtube", async (_e, { query }) => {
  const q = String(query || "").trim().slice(0, 200);
  if (!q) throw new Error("Escribe el nombre de la canción");
  const bin = getYtDlpPath();
  const isUrl = YT_RE.test(q);

  // URL directa: resultado único exacto
  if (isUrl) {
    return new Promise((resolve) => {
      const args = [q, "--dump-single-json", "--no-playlist", "--no-warnings", "--no-color", "--socket-timeout", "20"];
      let out = "";
      let child;
      try {
        child = spawn(bin, args);
      } catch (err) {
        return resolve({ ok: false, error: `No se pudo lanzar yt-dlp: ${err.message}` });
      }
      child.stdout.on("data", (d) => {
        out += d.toString();
        if (out.length > 4 * 1024 * 1024) { try { child.kill(); } catch (_) {} }
      });
      child.stderr.on("data", () => {});
      child.on("error", (err) => resolve({ ok: false, error: `yt-dlp: ${err.message}` }));
      child.on("close", (code) => {
        if (code !== 0 || !out.trim()) {
          return resolve({ ok: false, error: "No pude abrir esa URL." });
        }
        try {
          const json = JSON.parse(out);
          const r = toResult(json.entries?.[0] || json, q);
          if (!r) return resolve({ ok: false, error: "Sin resultados." });
          resolve({ ok: true, results: [r] });
        } catch (_) {
          resolve({ ok: false, error: "No pude leer el resultado." });
        }
      });
    });
  }

  // Texto: varios resultados sin duplicados
  // (mismo video una sola vez; mismo título de distinto artista sí sale)
  return new Promise((resolve) => {
    const args = [
      `ytsearch8:${q}`,
      "--flat-playlist",
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      "--no-color",
      "--socket-timeout", "20",
    ];
    let out = "";
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      return resolve({ ok: false, error: `No se pudo lanzar yt-dlp: ${err.message}` });
    }
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 4 * 1024 * 1024) { try { child.kill(); } catch (_) {} }
    });
    child.stderr.on("data", () => {});
    child.on("error", (err) => resolve({ ok: false, error: `yt-dlp: ${err.message}` }));
    child.on("close", (code) => {
      if (code !== 0 || !out.trim()) {
        return resolve({ ok: false, error: "No encontré nada. Prueba con 'artista - título'." });
      }
      try {
        const json = JSON.parse(out);
        const entries = Array.isArray(json.entries) ? json.entries : [];
        const seenId = new Set();
        const seenPerf = new Set();
        const results = [];
        for (const e of entries) {
          const r = toResult(e, q);
          if (!r || seenId.has(r.id)) continue;
          const perf = `${normKey(r.title)}@@${normKey(r.artist)}`;
          if (seenPerf.has(perf)) continue; // misma interpretación duplicada, fuera
          seenId.add(r.id);
          seenPerf.add(perf);
          results.push(r);
          if (results.length >= 8) break;
        }
        if (!results.length) return resolve({ ok: false, error: "Sin resultados." });
        resolve({ ok: true, results });
      } catch (_) {
        resolve({ ok: false, error: "No pude leer los resultados." });
      }
    });
  });
});

// ---------- STREAM sin descargar: URL directa de audio ----------
ipcMain.handle("stream-youtube", async (_e, { url }) => {
  const cleanUrl = assertYouTubeUrl(url);
  const bin = getYtDlpPath();
  return new Promise((resolve) => {
    const args = [
      "-g",
      "-f", "bestaudio[ext=m4a]/bestaudio/best",
      "--extractor-args", "youtube:player_client=android",
      "--no-playlist",
      "--no-warnings",
      "--no-color",
      "--socket-timeout", "20",
      cleanUrl,
    ];
    let out = "";
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      return resolve({ ok: false, error: `No se pudo lanzar yt-dlp: ${err.message}` });
    }
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", () => {});
    child.on("error", (err) => resolve({ ok: false, error: `yt-dlp: ${err.message}` }));
    child.on("close", async (code) => {
      const audioUrl = out.trim().split("\n")[0] || "";
      if (code !== 0 || !audioUrl.startsWith("http")) {
        return resolve({ ok: false, error: "No pude obtener el audio para reproducir." });
      }
      // prueba real: ¿tu red deja bajar bytes de ese audio?
      let probe = { status: 0, contentType: "" };
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(audioUrl, {
          signal: ctrl.signal,
          headers: { Range: "bytes=0-1023", "User-Agent": "Mozilla/5.0 (Pixeltify)" },
        });
        clearTimeout(to);
        probe = { status: res.status, contentType: res.headers.get("content-type") || "" };
        try {
          await res.arrayBuffer();
        } catch (_) {}
      } catch (_) {}
      resolve({ ok: true, audioUrl, probe });
    });
  });
});

// ---------- descargar audio (1 canción) con binarios incluidos ----------
function assertYouTubeUrl(url) {
  if (typeof url !== "string" || url.length > 500 || !YT_RE.test(url.trim())) {
    throw new Error("URL de YouTube no válida");
  }
  return url.trim();
}

ipcMain.handle("download-youtube", async (event, { url, quality, folder, meta, thumbnail, coverData }) => {
  const cleanUrl = assertYouTubeUrl(url);
  const q = quality === "alta" ? "0" : quality === "ligera" ? "9" : "5";
  const base = getLibraryDir();
  const sub = folder ? safeFolder(folder) : "";
  const dir = sub ? path.join(base, sub) : base;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  const id = Date.now().toString(36);
  const bin = getYtDlpPath();
  const ff = getFfmpegPath();

  const args = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", q,
    "--extractor-args", "youtube:player_client=android",
    "--no-playlist",
    "--no-warnings",
    "--progress",
    "--newline",
    "--no-color",
    "--ffmpeg-location", path.dirname(ff),
    "-o", path.join(dir, "%(title)s [%(id)s].%(ext)s"),
    cleanUrl,
  ];

  const sender = event.sender;
  const send = (payload) => {
    try {
      sender.send("yt-progress", { id, ...payload });
    } catch (_) {}
  };

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args);
    } catch (e) {
      return resolve({ ok: false, error: `No se pudo lanzar yt-dlp: ${e.message}` });
    }

    let out = "";
    let finalFile = "";

    child.stdout.on("data", (d) => {
      const text = d.toString();
      out += text;
      const m = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (m) send({ pct: parseFloat(m[1]), status: "downloading" });
      const dest = text.match(/Destination:\s*(.+\.mp3)/);
      if (dest) finalFile = dest[1].trim();
      if (text.includes("[ExtractAudio]")) send({ pct: 99, status: "converting" });
    });
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => {
      resolve({ ok: false, error: `Error al lanzar yt-dlp: ${e.message}` });
    });
    child.on("close", async (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `Falló la descarga (código ${code}). Revisa tu conexión.`,
          log: out.slice(-2000),
        });
        return;
      }
      if (!finalFile || !fs.existsSync(finalFile)) {
        try {
          const files = fs.readdirSync(dir)
            .filter((f) => f.endsWith(".mp3"))
            .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);
          if (files.length) finalFile = path.join(dir, files[0].f);
        } catch (_) {}
      }
      send({ pct: 100, status: "done" });
      let rel = "";
      try {
        rel = relPosix(base, finalFile);
        const cover = coverData ? { dataUrl: coverData } : thumbnail ? { url: thumbnail } : null;
        await writeSidecars(finalFile, meta || null, cover);
      } catch (_) {}
      resolve({ ok: true, filePath: finalFile, rel, folder: sub, fileName: path.basename(finalFile), dir: base });
    });
  });
});

ipcMain.handle("open-external", async (_e, url) => {
  try {
    const u = String(url || "");
    if (!/^https:\/\/(github\.com|hotcakes-py\.github\.io)\//.test(u)) return false;
    await shell.openExternal(u);
    return true;
  } catch (_) {
    return false;
  }
});

// ---------- listar la biblioteca (playlist/ + subcarpetas) con sus datos ----------
ipcMain.handle("list-music-dir", async () => {
  const base = getLibraryDir();
  const out = [];
  const scan = (dir, top) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!top) scan(abs, e.name);
        continue;
      }
      if (!/\.mp3$/i.test(e.name)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch (_) {}
      const stem = abs.replace(/\.mp3$/i, "");
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(stem + ".json", "utf8"));
      } catch (_) {}
      let cover = "";
      for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
        try {
          const st = fs.statSync(stem + ext);
          if (!st.isFile() || st.size <= 0 || st.size >= 400 * 1024) continue;
          const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
          cover = `data:${mime};base64,${fs.readFileSync(stem + ext).toString("base64")}`;
          break;
        } catch (_) {}
      }
      out.push({ filePath: abs, rel: relPosix(base, abs), fileName: e.name, folder: top || "", mtime, meta, cover });
    }
  };
  scan(base, "");
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
});

// ---------- borrar un MP3 del disco (con su cover y sus datos) ----------
ipcMain.handle("delete-file", async (_e, filePath) => {
  try {
    const base = getLibraryDir();
    const abs = inLibrary(base, filePath);
    if (!abs || !/\.mp3$/i.test(abs)) throw new Error("Ruta fuera de la biblioteca");
    const stem = abs.replace(/\.mp3$/i, "");
    for (const f of [abs, stem + ".json", stem + ".jpg", stem + ".jpeg", stem + ".png", stem + ".webp"]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (_) {}
    }
    return true;
  } catch (_) {
    return false;
  }
});

// ---------- carpeta de una playlist ----------
ipcMain.handle("ensure-playlist-dir", async (_e, name) => {
  const base = getLibraryDir();
  const folder = safeFolder(name);
  try {
    fs.mkdirSync(path.join(base, folder), { recursive: true });
  } catch (_) {}
  return { folder };
});

// ---------- abrir la carpeta de una playlist en el explorador ----------
ipcMain.handle("open-playlist-folder", async (_e, folder) => {
  try {
    const base = getLibraryDir();
    const sub = folder ? safeFolder(folder) : "";
    const dir = sub ? path.join(base, sub) : base;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  } catch (_) {
    return false;
  }
});

// ---------- mover una cancion a su playlist (con cover y datos) ----------
ipcMain.handle("move-to-playlist", async (_e, { filePath, folder }) => {
  const base = getLibraryDir();
  const abs = inLibrary(base, filePath);
  if (!abs || !/\.mp3$/i.test(abs) || !fs.existsSync(abs)) throw new Error("Archivo no valido");
  const sub = safeFolder(folder);
  const dir = path.join(base, sub);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  const fileName = path.basename(abs);
  const dest = path.join(dir, fileName);
  if (path.resolve(dest) !== path.resolve(abs)) {
    if (fs.existsSync(dest)) throw new Error("Ya existe esa cancion en la playlist");
    fs.renameSync(abs, dest);
    const stem = abs.replace(/\.mp3$/i, "");
    const dstem = dest.replace(/\.mp3$/i, "");
    for (const e of [".json", ".jpg", ".jpeg", ".png", ".webp"]) {
      try {
        if (fs.existsSync(stem + e)) fs.renameSync(stem + e, dstem + e);
      } catch (_) {}
    }
  }
  return { filePath: dest, rel: relPosix(base, dest), fileName, folder: sub };
});

// ---------- guardar un audio subido en su playlist ----------
ipcMain.handle("save-blob", async (_e, { folder, fileName, data, meta, coverData }) => {
  const base = getLibraryDir();
  const sub = folder ? safeFolder(folder) : "";
  const dir = sub ? path.join(base, sub) : base;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  let name = safeFile(fileName);
  if (!/\.mp3$/i.test(name)) name += ".mp3";
  let dest = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, name.replace(/\.mp3$/i, ` (${++i}).mp3`));
  }
  const buf = Buffer.from(data);
  if (!buf.length || buf.length > 120 * 1024 * 1024) throw new Error("Audio invalido");
  fs.writeFileSync(dest, buf);
  await writeSidecars(dest, meta || null, coverData ? { dataUrl: coverData } : null);
  return { filePath: dest, rel: relPosix(base, dest), fileName: path.basename(dest), folder: sub };
});

// ---------- TOP de un artista (varias canciones para explorar) ----------
ipcMain.handle("search-artist", async (_e, { artist }) => {
  const a = String(artist || "").trim().slice(0, 120);
  if (!a) return { ok: false, error: "Artista vacío" };
  const bin = getYtDlpPath();

  return new Promise((resolve) => {
    const args = [
      `ytsearch8:${a} canciones`,
      "--flat-playlist",
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      "--no-color",
      "--socket-timeout", "20",
    ];
    let out = "";
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      return resolve({ ok: false, error: `No se pudo lanzar yt-dlp: ${err.message}` });
    }
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 4 * 1024 * 1024) {
        try {
          child.kill();
        } catch (_) {}
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", (err) => resolve({ ok: false, error: `yt-dlp: ${err.message}` }));
    child.on("close", (code) => {
      if (code !== 0 || !out.trim()) {
        return resolve({ ok: false, error: "No encontré nada de ese artista." });
      }
      try {
        const json = JSON.parse(out);
        const entries = Array.isArray(json.entries) ? json.entries : [];
        const results = entries
          .filter((e) => e && e.id)
          .slice(0, 8)
          .map((e) => {
            const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : [];
            const best = thumbs.length
              ? [...thumbs].sort((x, y) => (y.width || 0) - (x.width || 0))[0].url
              : e.thumbnail || "";
            const dur = e.duration
              ? `${Math.floor(e.duration / 60)}:${String(Math.floor(e.duration % 60)).padStart(2, "0")}`
              : "--:--";
            return {
              id: e.id,
              title: e.title || "Sin título",
              artist: e.uploader || e.channel || a,
              duration: dur,
              thumbnail: best || "",
              url: e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
            };
          });
        if (!results.length) return resolve({ ok: false, error: "Sin resultados." });
        resolve({ ok: true, results });
      } catch (_) {
        resolve({ ok: false, error: "No pude leer el resultado." });
      }
    });
  });
});

// ---------- traer bytes de audio (para caché, sin CORS en Node) ----------
ipcMain.handle("fetch-audio-bytes", async (_e, { url }) => {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u) || u.length > 3000) {
    return { ok: false, error: "URL inválida" };
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 90000);
    const res = await fetch(u, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Pixeltify)" },
    });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > 40 * 1024 * 1024) throw new Error("Audio muy pesado para caché");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 40 * 1024 * 1024) throw new Error("Audio muy pesado para caché");
    return { ok: true, dataUrl: `data:audio/mp4;base64,${buf.toString("base64")}` };
  } catch (err) {
    return { ok: false, error: err.message || "No se pudo cachear" };
  }
});

// Convierte archivos de audio (File o rutas de Electron) en tracks reproducibles.
const COLORS = ["#1ed760", "#ff3366", "#33ccff", "#ffcc00", "#b388ff", "#ff8800", "#00ffcc"];

function pixelCover(seed) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1e1e38`;
}

export function parseName(fileName) {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").trim();
  // "Artista - Título" → separar; si no, todo es título
  const m = base.match(/^(.+?)\s*-\s*(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: "Mi PC", title: base || fileName };
}

export function filesToTracks(files, offset = 0) {
  const list = [...files].filter(
    (f) => f.type.startsWith("audio") || /\.(mp3|m4a|ogg|oga|wav|flac|opus|webm|mp4)$/i.test(f.name)
  );
  return list.map((f, i) => {
    const { artist, title } = parseName(f.name);
    return {
      id: `local-${Date.now()}-${offset + i}-${f.name}`,
      title,
      artist,
      album: "Mi PC",
      genre: "local",
      year: new Date().getFullYear(),
      duration: "--:--",
      plays: "LOCAL",
      src: URL.createObjectURL(f),
      cover: pixelCover(f.name),
      color: COLORS[(offset + i) % COLORS.length],
      local: true,
      source: "file",
      fileName: f.name,
    };
  });
}

export function pathToTrackMeta(filePath) {
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const { artist, title } = parseName(name);
  return { artist, title, fileName: name };
}

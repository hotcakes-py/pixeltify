// Descarga/copia los binarios yt-dlp + ffmpeg a resources/bin/{linux,win}
// para que vayan DENTRO del instalador de Electron (el usuario no instala nada).
// Uso: npm run binaries:fetch
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BIN = path.join(ROOT, "resources", "bin");
const LINUX_DIR = path.join(BIN, "linux");
const WIN_DIR = path.join(BIN, "win");

function mkdir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "pixeltify" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (e) => {
        try { fs.unlinkSync(dest); } catch (_) {}
        reject(e);
      });
  });
}

async function main() {
  mkdir(LINUX_DIR);
  mkdir(WIN_DIR);

  // 1) ffmpeg linux: copiar el que ya trae ffmpeg-static (static, funciona)
  try {
    const localFfmpeg = require("ffmpeg-static");
    const dest = path.join(LINUX_DIR, "ffmpeg");
    if (fs.existsSync(localFfmpeg) && process.platform === "linux") {
      fs.copyFileSync(localFfmpeg, dest);
      fs.chmodSync(dest, 0o755);
      console.log("OK ffmpeg linux copiado");
    }
  } catch (e) {
    console.log("Aviso ffmpeg linux:", e.message);
  }

  // 2) yt-dlp linux + win desde GitHub releases
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
  try {
    const dest = path.join(LINUX_DIR, "yt-dlp");
    if (!fs.existsSync(dest)) {
      console.log("Descargando yt-dlp linux...");
      await download(`${base}/yt-dlp`, dest);
      fs.chmodSync(dest, 0o755);
    }
    console.log("OK yt-dlp linux");
  } catch (e) {
    console.log("Aviso yt-dlp linux:", e.message);
  }

  try {
    const dest = path.join(WIN_DIR, "yt-dlp.exe");
    if (!fs.existsSync(dest)) {
      console.log("Descargando yt-dlp.exe windows...");
      await download(`${base}/yt-dlp.exe`, dest);
    }
    console.log("OK yt-dlp win");
  } catch (e) {
    console.log("Aviso yt-dlp win:", e.message);
  }

  // 3) ffmpeg windows: intentar con el paquete npm si está instalado,
  // si no, avisar (se descarga en una máquina Windows con npm run binaries:fetch-win)
  const winFfmpeg = path.join(WIN_DIR, "ffmpeg.exe");
  if (!fs.existsSync(winFfmpeg)) {
    console.log(
      "NOTA: ffmpeg.exe para Windows no está. En una PC Windows ejecuta:\n" +
      "  npm i @ffmpeg-installer/win32-x64\n" +
      "  npm run binaries:fetch\n" +
      "o descarga essentials de gyan.dev y pon bin/ffmpeg.exe en resources/bin/win/"
    );
    // intentar copiar desde @ffmpeg-installer si existe
    try {
      const p = require("@ffmpeg-installer/win32-x64");
      const src = p.path || p;
      if (src && fs.existsSync(src)) {
        fs.copyFileSync(src, winFfmpeg);
        console.log("OK ffmpeg win copiado desde @ffmpeg-installer");
      }
    } catch (_) {}
  } else {
    console.log("OK ffmpeg win");
  }

  // 4) En Windows host: copiar ffmpeg.exe local a resources/bin/win
  if (process.platform === "win32") {
    try {
      const localFfmpeg = require("ffmpeg-static");
      if (fs.existsSync(localFfmpeg)) {
        fs.copyFileSync(localFfmpeg, winFfmpeg);
        console.log("OK ffmpeg win copiado (host windows)");
      }
    } catch (_) {}
    try {
      const localYt = path.join(ROOT, "node_modules", "yt-dlp-exec", "bin", "yt-dlp.exe");
      if (fs.existsSync(localYt)) {
        fs.copyFileSync(localYt, path.join(WIN_DIR, "yt-dlp.exe"));
        console.log("OK yt-dlp win copiado (host windows)");
      }
    } catch (_) {}
  }

  console.log("Listo. Revisa resources/bin/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

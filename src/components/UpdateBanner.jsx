import { useEffect, useState } from "react";

function newerThan(latest, current) {
  const norm = (v) => String(v || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = norm(latest);
  const b = norm(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// Aviso de actualización: en Linux se descarga e instala sola,
// en Windows portable abre la descarga. Solo aparece si hay versión nueva.
export default function UpdateBanner() {
  const [up, setUp] = useState(null); // {status, version, pct}
  const [manual, setManual] = useState(null); // {version, url}
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    const off = window.electronAPI.onUpdateStatus?.((s) => setUp(s));
    let alive = true;
    (async () => {
      try {
        const info = await window.electronAPI.getAppInfo();
        const res = await fetch("https://api.github.com/repos/hotcakes-py/pixeltify/releases/latest");
        if (!res.ok || !alive) return;
        const json = await res.json();
        if (json?.tag_name && newerThan(json.tag_name, info?.version)) {
          setManual({ version: String(json.tag_name).replace(/^v/i, ""), url: json.html_url });
        }
      } catch (_) {}
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  if (hidden) return null;
  const st = up?.status;

  // updater activo manda
  if (st === "downloading") {
    return (
      <div className="update-bar">
        <span>DESCARGANDO ACTUALIZACIÓN {up.pct || 0}%</span>
        <button className="pixel-btn sm" onClick={() => setHidden(true)}>X</button>
      </div>
    );
  }
  if (st === "ready") {
    return (
      <div className="update-bar go">
        <span>LISTA LA VERSIÓN {up.version} — REINICIA PARA APLICARLA</span>
        <button className="pixel-btn sm green" onClick={() => window.electronAPI.quitAndInstall()}>
          REINICIAR
        </button>
      </div>
    );
  }
  if (st === "available") {
    return (
      <div className="update-bar">
        <span>BAJANDO LA VERSIÓN {up.version}...</span>
        <button className="pixel-btn sm" onClick={() => setHidden(true)}>X</button>
      </div>
    );
  }
  // respaldo manual (portable de Windows): abrir la descarga
  if (manual) {
    return (
      <div className="update-bar go">
        <span>HAY VERSIÓN NUEVA: {manual.version}</span>
        <button className="pixel-btn sm green" onClick={() => window.electronAPI.openExternal(manual.url)}>
          DESCARGAR
        </button>
        <button className="pixel-btn sm" onClick={() => setHidden(true)}>X</button>
      </div>
    );
  }
  return null;
}

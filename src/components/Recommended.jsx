import { useEffect, useMemo, useState } from "react";
import { usePlayer } from "../context/PlayerContext.jsx";
import { pixelate, pixelFallback } from "../services/coverArt.js";
import { cacheStreamBytes } from "../services/store.js";

const electron = () => window.electronAPI;

// gusto = reproducciones + likes por artista
function tasteArtists(queue, liked) {
  const score = {};
  for (const t of queue) {
    const a = String(t.artist || "").trim();
    if (!a || a === "Mi PC" || a === "YouTube") continue;
    score[a] = (score[a] || 0) + (t.playCount || 0) + (liked.includes(t.id) ? 2 : 0) + 0.2;
  }
  return Object.entries(score)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9áéíóúñü ]/gi, "")
    .trim();
}

async function streamAndPlay(item, playTrack, setBusy) {
  setBusy(item.id);
  try {
    const res = await electron().streamYouTube(item.url);
    if (!res.ok) throw new Error(res.error || "No se pudo reproducir");
    let cover = pixelFallback(item.title);
    try {
      if (item.thumbnail) cover = (await pixelate(item.thumbnail, 32)) || cover;
    } catch (_) {}
      playTrack({
        id: `stream-${item.id}-${Date.now()}`,
        title: item.title,
        artist: item.artist,
        album: "YouTube",
        genre: "local",
        year: new Date().getFullYear(),
        duration: item.duration || "--:--",
        plays: "STREAM",
        srcAt: Date.now(),
        src: res.audioUrl,
        cover,
        color: "#1ed760",
        local: false,
        source: "stream",
        fileName: item.title,
        url: item.url,
        ytId: item.id,
        cacheId: `cache:${item.id}`,
      });
      cacheStreamBytes(electron(), { cacheId: `cache:${item.id}` }, res.audioUrl);
  } catch (_) {}
  setBusy("");
}

// Recomendaciones en el inicio según lo que escuchas.
export default function Recommended() {
  const { queue, liked, playTrack } = usePlayer();
  const [items, setItems] = useState([]);
  const [from, setFrom] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [cycle, setCycle] = useState(0);

  const artists = useMemo(() => tasteArtists(queue, liked), [queue, liked]);
  const key = artists.join("|");

  // escritorio: top fresco de YouTube de tus artistas top
  useEffect(() => {
    if (!artists.length) {
      setItems([]);
      setFrom("");
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      const have = queue.map((t) => norm(t.title).slice(0, 18)).filter(Boolean);
      const rot = cycle % artists.length;
      const ordered = [...artists.slice(rot), ...artists.slice(0, rot)];
      let found = false;
      for (const a of ordered.slice(0, 3)) {
        try {
          const res = await electron().searchArtist(a);
          if (!alive || !res.ok) continue;
          const fresh = res.results
            .filter((r) => {
              const n = norm(r.title).slice(0, 18);
              return n && !have.some((h) => h.includes(n) || n.includes(h));
            })
            .slice(0, 6);
          if (fresh.length && alive) {
            setItems(fresh);
            setFrom(a);
            found = true;
            break;
          }
        } catch (_) {}
      }
      if (alive && !found) {
        setItems([]);
        setFrom("");
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cycle]);

  if (!artists.length && !loading) return null;

  return (
    <>
      <div className="rec-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          RECOMENDADO PARA TI{from ? ` · PORQUE ESCUCHAS ${from.toUpperCase().slice(0, 24)}` : ""}
        </h2>
        {items.length > 0 && (
          <button className="pixel-btn sm" onClick={() => setCycle((c) => c + 1)}>
            OTRAS
          </button>
        )}
      </div>
      {loading && <div className="empty">Buscando algo a tu gusto...</div>}
      <div className="cards">
        {items.map((item) => (
          <button
            key={item.id}
            className="card pixel-box-sm"
            onClick={() => streamAndPlay(item, playTrack, setBusyId)}
          >
            {item.thumbnail && (
              <img src={item.thumbnail} alt={item.title} className="card-cover pixelated" loading="lazy" />
            )}
            <div className="card-name">{busyId === item.id ? "CARGANDO..." : item.title}</div>
            <div className="card-artist">{item.artist}</div>
          </button>
        ))}
      </div>
    </>
  );
}

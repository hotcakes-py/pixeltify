import { useEffect, useState } from "react";
import { usePlayer } from "../context/PlayerContext.jsx";
import { pixelate, pixelFallback } from "../services/coverArt.js";
import { cacheStreamBytes } from "../services/store.js";
import SongRow from "./SongRow.jsx";
import AddToPlaylist from "./AddToPlaylist.jsx";

const electron = () => window.electronAPI;

// Perfil del artista: sus canciones en tu biblioteca + su top de YouTube.
export default function ArtistView({ name }) {
  const { queue, playTrack, removeTrack } = usePlayer();
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const q = String(name || "").toLowerCase();
  const mine = queue.filter(
    (t) => t.artist?.toLowerCase().includes(q) || q.includes(t.artist?.toLowerCase() || " ")
  );

  useEffect(() => {
    if (!name) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      setTop([]);
      try {
        const res = await electron().searchArtist(name);
        if (!alive) return;
        if (res.ok) setTop(res.results);
        else setError(res.error || "Sin resultados.");
      } catch (err) {
        if (alive) setError(err.message || "Falló la búsqueda.");
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [name]);

  const streamItem = async (item) => {
    if (busyId) return;
    setBusyId(item.id);
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
    setBusyId("");
  };

  return (
    <>
      <div className="artist-head pixel-box-sm">
        <div className="avatar pixelated">{String(name || "?").slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="hero-tag">ARTISTA</div>
          <h2 className="hero-title">{name}</h2>
          <div className="dim tiny">
            {mine.length} en tu biblioteca · {top.length} en el top
          </div>
        </div>
      </div>

      <h2 className="section-title">GUARDADAS [{mine.length}]</h2>
      <div className="tracks">
        {mine.length === 0 && <div className="empty">Nada de {name} guardado todavía.</div>}
        {mine.map((s, i) => (
          <SongRow key={s.id} song={s} index={i} showRemove onRemove={() => removeTrack(s.id)} />
        ))}
      </div>

      <h2 className="section-title">TOP EN YOUTUBE</h2>
      {loading && <div className="empty">Buscando lo mejor de {name}...</div>}
      {error && <div className="auth-error">{error}</div>}
      <div className="tracks">
        {top.map((item, i) => (
          <div
            key={item.id}
            className="track slim"
            onClick={() => streamItem(item)}
            style={{ cursor: busyId ? "wait" : "pointer" }}
          >
            <span className="t-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="t-main">
              {item.thumbnail && <img src={item.thumbnail} alt="" className="t-cover pixelated" loading="lazy" />}
              <span>
                <span className="t-title">{busyId === item.id ? "CARGANDO..." : item.title}</span>
                <span className="t-artist">{item.artist}</span>
              </span>
            </span>
            <span className="t-genre">youtube</span>
            <span className="t-plays">TOP</span>
            <span className="t-time">{item.duration}</span>
            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
              <AddToPlaylist
                songId={item.id}
                track={{
                  id: `stream-${item.id}`,
                  title: item.title,
                  artist: item.artist,
                  album: "YouTube",
                  genre: "local",
                  year: new Date().getFullYear(),
                  duration: item.duration || "--:--",
                  plays: "STREAM",
                  src: "",
                  cover: item.thumbnail || pixelFallback(item.title),
                  color: "#1ed760",
                  local: false,
                  source: "stream",
                  fileName: item.title,
                  url: item.url,
                  ytId: item.id,
                  cacheId: `cache:${item.id}`,
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

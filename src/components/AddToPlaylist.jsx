import { useState } from "react";
import { usePlayer } from "../context/PlayerContext.jsx";

// Botón + para guardar en playlist (junto al corazón).
// Si la canción es stream se descarga sola a su carpeta.
export default function AddToPlaylist({ songId, track, up }) {
  const { playlists, createPlaylist, addToPlaylist, pinningIds } = usePlayer();
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState("");
  const pinning = saving || (pinningIds || []).includes(songId);

  const add = async (pid) => {
    const pl = playlists.find((p) => p.id === pid);
    setSaving(pl ? pl.name : "...");
    try {
      await addToPlaylist(pid, songId, track);
    } finally {
      setSaving("");
      setMenu(false);
    }
  };

  const create = async (e) => {
    e?.preventDefault?.();
    setSaving(name || "...");
    try {
      const id = await createPlaylist(name);
      if (id) await addToPlaylist(id, songId, track);
    } finally {
      setSaving("");
      setName("");
      setMenu(false);
    }
  };

  return (
    <span className="add-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        className="t-add"
        onClick={() => setMenu((m) => !m)}
        title={pinning ? "descargando para guardar..." : "agregar a playlist (se descarga sola)"}
      >
        {pinning ? "…" : "+"}
      </button>
      {menu && (
        <div className={`menu pixel-box-sm${up ? " up" : ""}`}>
          <div className="menu-title">AGREGAR A...</div>
          {saving && <div className="dl-status">GUARDANDO EN {saving}...</div>}
          {playlists.length === 0 && <div className="dim tiny">No tienes playlists todavía.</div>}
          {playlists.map((p) => (
            <button key={p.id} className="menu-item" onClick={() => add(p.id)}>
              {p.name} [{p.trackIds.length}]
            </button>
          ))}
          <form onSubmit={create} className="dl-row" style={{ marginTop: 6 }}>
            <input
              className="pixel-input"
              placeholder="NUEVA..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="pixel-btn sm green">OK</button>
          </form>
        </div>
      )}
    </span>
  );
}

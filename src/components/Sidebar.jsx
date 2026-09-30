import { useState } from "react";
import { usePlayer } from "../context/PlayerContext.jsx";

export default function Sidebar() {
  const {
    activePlaylist, setActivePlaylist,
    liked, playlists, createPlaylist,
  } = usePlayer();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const items = [
    { id: "search", name: "BUSCAR" },
    { id: "liked", name: "ME GUSTA" },
  ];

  const submitPlaylist = async (e) => {
    e?.preventDefault?.();
    const id = await createPlaylist(name);
    if (id) {
      setName("");
      setNaming(false);
      setActivePlaylist(`pl:${id}`);
    }
  };

  return (
    <aside className="sidebar pixel-box">
      <div className="side-title">MENU</div>

      <nav className="side-nav">
        {items.map((p) => (
          <button
            key={p.id}
            onClick={() => setActivePlaylist(p.id)}
            className={`side-btn ${activePlaylist === p.id ? "active" : ""}`}
          >
            <span>{p.name}</span>
            {p.id === "liked" && <span className="count">{liked.length}</span>}
          </button>
        ))}
      </nav>

      <div className="side-title">PLAYLISTS</div>
      <nav className="side-nav">
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => setActivePlaylist(`pl:${p.id}`)}
            className={`side-btn ${activePlaylist === `pl:${p.id}` ? "active" : ""}`}
          >
            <span>{p.name}</span>
            <span className="count">{p.trackIds.length}</span>
          </button>
        ))}
        {playlists.length === 0 && <div className="dim tiny">Aún no tienes. Crea una abajo.</div>}
      </nav>
      {naming ? (
        <form onSubmit={submitPlaylist} className="dl-row">
          <input
            className="pixel-input"
            placeholder="NOMBRE..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="pixel-btn sm green">OK</button>
        </form>
      ) : (
        <button className="pixel-btn sm" onClick={() => setNaming(true)}>+ NUEVA PLAYLIST</button>
      )}
    </aside>
  );
}

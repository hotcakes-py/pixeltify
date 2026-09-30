import { useEffect, useState } from "react";
import { usePlayer } from "../context/PlayerContext.jsx";
import { filesToTracks, parseName, pathToTrackMeta } from "../services/localLibrary.js";
import { coverForSong, pixelate, pixelFallback } from "../services/coverArt.js";
import { idbPut, dataUrlToBlob, cacheStreamBytes } from "../services/store.js";
import SongRow from "./SongRow.jsx";
import AddToPlaylist from "./AddToPlaylist.jsx";
import ArtistView from "./ArtistView.jsx";
import Recommended from "./Recommended.jsx";

const electron = () => window.electronAPI;

// el error se muestra 6 segundos y se va solo
function PlayErrorNote({ text, clear }) {
  useEffect(() => {
    const to = setTimeout(clear, 6000);
    return () => clearTimeout(to);
  }, [text, clear]);
  return <div className="auth-error" style={{ marginTop: 10 }}>{text}</div>;
}

export default function MainView() {
  const {
    queue, localTracks, activePlaylist, liked,
    playTrack, addTracks, removeTrack, currentSong,
    playlists, history, pushHistory, artist, openArtist, playError, setPlayError,
    deletePlaylist, removeFromPlaylist,
  } = usePlayer();

  const [dragOver, setDragOver] = useState(false);

  // ---- búsqueda YouTube: varios resultados sin duplicados ----
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]); // [{id,title,artist,duration,thumbnail,url}]
  const [searchError, setSearchError] = useState("");
  const [quality, setQuality] = useState("media");
  const [job, setJob] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [dlError, setDlError] = useState("");

  useEffect(() => {
    const off = electron().onDownloadProgress((d) => setJob(d));
    return off;
  }, []);

  const runSearch = async (term) => {
    const q = String(term || "").trim();
    if (!q || searching || downloading || streaming) return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    setDlError("");
    try {
      const res = await electron().searchYouTube(q);
      if (res.ok) {
        setResults(res.results || []);
        pushHistory(q);
      } else setSearchError(res.error || "Sin resultados.");
    } catch (err) {
      setSearchError(err.message || "Falló la búsqueda.");
    }
    setSearching(false);
  };

  const doSearch = (e) => {
    e?.preventDefault?.();
    runSearch(query);
  };

  // track listo para guardar directo desde un resultado
  const itemTrack = (item) => ({
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
  });

  // REPRODUCIR sin descargar (stream directo)
  const streamItem = async (item) => {    if (!item || streaming || downloading) return;
    setStreaming(true);
    setBusyId(item.id);
    setDlError("");
    try {
      const res = await electron().streamYouTube(item.url);
      if (!res.ok) {
        setDlError(res.error || "No se pudo reproducir.");
        setStreaming(false);
        setBusyId("");
        return;
      }
      let cover = pixelFallback(item.title);
      try {
        if (item.thumbnail) cover = (await pixelate(item.thumbnail, 32)) || cover;
      } catch (_) {}
      const track = {
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
      };
      playTrack(track);
      // se guarda en caché en segundo plano para que la próxima suene al instante
      cacheStreamBytes(electron(), track, res.audioUrl);
    } catch (err) {
      setDlError(err.message);
    }
    setStreaming(false);
    setBusyId("");
  };

  const downloadItem = async (item) => {
    if (!item || downloading || streaming) return;
    setDownloading(true);
    setBusyId(item.id);
    setDlError("");
    setJob({ pct: 0, status: "starting" });
    try {
      const res = await electron().downloadYouTube({
        url: item.url,
        quality,
        folder: "",
        meta: { title: item.title, artist: item.artist, album: "YouTube", duration: item.duration, url: item.url, ytId: item.id },
        thumbnail: item.thumbnail,
      });
      if (!res.ok) {
        setDlError(res.error || "Falló la descarga.");
        setDownloading(false);
        setBusyId("");
        return;
      }
      // portada: thumbnail de YouTube pixelada
      let cover = pixelFallback(item.title);
      try {
        if (item.thumbnail) cover = (await pixelate(item.thumbnail, 32)) || cover;
      } catch (_) {}
      try {
        const file = await electron().readAudioFile(res.filePath);
        const meta = pathToTrackMeta(res.filePath);
        playTrack({
          id: `disk:${res.rel}`,
          title: item.title || meta.title,
          artist: item.artist || meta.artist,
          album: "YouTube",
          genre: "local",
          year: new Date().getFullYear(),
          duration: item.duration || "--:--",
          plays: "YT",
          src: file.dataUrl,
          cover,
          color: "#1ed760",
          local: true,
          source: "disk",
          fileName: res.fileName,
          filePath: res.filePath,
          folder: res.folder,
        });
      } catch (_) {
        setDlError("Se descargó pero no pude agregarlo al reproductor.");
      }
    } catch (err) {
      setDlError(err.message);
    }
    setDownloading(false);
    setBusyId("");
  };

  // ---- subir canciones: portada automática + se guardan en el equipo ----
  const enrichAndAdd = async (baseTracks, metas, blobs) => {
    const enriched = await Promise.all(
      baseTracks.map(async (t, i) => {
        try {
          const cover = await coverForSong(metas[i].title, metas[i].artist, t.fileName);
          return { ...t, cover };
        } catch (_) {
          return t;
        }
      })
    );
    // guardar el audio para que sobreviva al cerrar la app
    await Promise.all(
      enriched.map(async (t, i) => {
        if (!blobs[i]) return;
        try {
          await idbPut(t.id, blobs[i]);
          t.blobId = t.id;
        } catch (_) {}
      })
    );
    addTracks(enriched);
    if (enriched.length) playTrack(enriched[0]);
  };

  const importFromElectron = async () => {
    try {
      const paths = await electron().selectAudioFiles();
      if (!paths.length) return;
      const tracks = [];
      const metas = [];
      const blobs = [];
      for (let i = 0; i < paths.length; i++) {
        try {
          const f = await electron().readAudioFile(paths[i]);
          const meta = parseName(f.name);
          metas.push(meta);
          blobs.push(dataUrlToBlob(f.dataUrl));
          tracks.push({
            id: `up-${Date.now()}-${i}-${f.name}`,
            title: meta.title,
            artist: meta.artist,
            album: "Mi PC",
            genre: "local",
            year: new Date().getFullYear(),
            duration: "--:--",
            plays: "LOCAL",
            src: f.dataUrl,
            cover: pixelFallback(f.name),
            color: "#1ed760",
            local: true,
            source: "file",
            fileName: f.name,
          });
        } catch (_) {}
      }
      if (tracks.length) enrichAndAdd(tracks, metas, blobs);
    } catch (_) {}
  };

  const onFiles = (files) => {
    const arr = [...files];
    const base = filesToTracks(arr, localTracks.length);
    if (!base.length) return;
    const metas = base.map((t) => ({ title: t.title, artist: t.artist }));
    const blobs = arr
      .filter(
        (f) => f.type.startsWith("audio") || /\.(mp3|m4a|ogg|oga|wav|flac|opus|webm|mp4)$/i.test(f.name)
      )
      .map((f) => f);
    enrichAndAdd(base, metas, blobs);
  };

  const likedTracks = queue.filter((s) => liked.includes(s.id));
  const activePl = activePlaylist.startsWith("pl:")
    ? playlists.find((p) => `pl:${p.id}` === activePlaylist)
    : null;
  const view = activePlaylist === "liked"
    ? "liked"
    : activePlaylist === "artist"
      ? "artist"
      : activePl
        ? "playlist"
        : "search";

  return (
    <main
      className="main pixel-box"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
    >
      {currentSong && (
        <section className="hero" style={{ "--accent": currentSong.color }}>
          <img src={currentSong.cover} alt="cover" className="hero-cover pixelated" />
          <div className="hero-info">
            <div className="hero-tag">SONANDO AHORA</div>
            <h1 className="hero-title">{currentSong.title}</h1>
            <p
              className="hero-artist link"
              onClick={() => openArtist(currentSong.artist)}
              title="ver artista"
            >
              {currentSong.artist}
            </p>
          </div>
        </section>
      )}

      {dragOver && <div className="drop-hint">SUELTA TUS MP3 AQUI</div>}

      {view === "search" && (
        <>
          <h2 className="section-title">BUSCAR MUSICA</h2>
          <form onSubmit={doSearch} className="dl-row">
            <input
              className="pixel-input"
              placeholder="Buscar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="pixel-btn green" disabled={searching || downloading || streaming || !query.trim()}>
              {searching ? "..." : "BUSCAR"}
            </button>
          </form>

          {searchError && <div className="auth-error" style={{ marginTop: 10 }}>{searchError}</div>}
          {playError && <PlayErrorNote text={playError} clear={() => setPlayError("")} />}
          {history.length > 0 && (
            <div className="chips">
              {history.map((h) => (
                <button
                  key={h}
                  className="chip"
                  onClick={() => {
                    setQuery(h);
                    runSearch(h);
                  }}
                >
                  {h}
                </button>
              ))}
            </div>
          )}

          {results.length === 0 && !searching && <Recommended />}

          {results.length > 0 && (
            <>
              <div className="rec-head">
                <h2 className="section-title" style={{ margin: 0 }}>RESULTADOS [{results.length}]</h2>
                <select
                  className="pixel-input"
                  style={{ maxWidth: 170 }}
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  title="calidad de descarga"
                >
                  <option value="alta">ALTA</option>
                  <option value="media">MEDIA</option>
                  <option value="ligera">LIGERA</option>
                </select>
              </div>
              <div className="tracks">
                {results.map((item, i) => {
                  const busy = busyId === item.id && (downloading || streaming);
                  return (
                    <div
                      key={item.id}
                      className="track"
                      onClick={() => streamItem(item)}
                      style={{ cursor: busy ? "wait" : "pointer" }}
                      title="clic para reproducir"
                    >
                      <span className="t-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="t-main">
                        {item.thumbnail && (
                          <img src={item.thumbnail} alt="" className="t-cover pixelated" loading="lazy" />
                        )}
                        <span>
                          <span className="t-title">{busy ? "CARGANDO..." : item.title}</span>
                          <span
                            className="t-artist link"
                            onClick={() => openArtist(item.artist)}
                            title="ver artista"
                          >
                            {item.artist}
                          </span>
                        </span>
                      </span>
                      <span className="t-genre">youtube</span>
                      <span className="t-plays">YT</span>
                      <span className="t-time">{item.duration}</span>
                      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <AddToPlaylist songId={item.id} track={itemTrack(item)} />
                        <button
                          className="t-add"
                          onClick={() => streamItem(item)}
                          disabled={downloading || streaming}
                          title="reproducir sin descargar"
                        >
                          ▶
                        </button>
                        <button
                          className="t-del"
                          style={{ gridColumn: "auto" }}
                          onClick={() => downloadItem(item)}
                          disabled={downloading || streaming}
                          title="descargar y guardar"
                        >
                          ⬇
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {job && downloading && (
                <div className="dl-progress" style={{ marginTop: 10 }}>
                  <div className="dl-bar">
                    <div className="dl-fill" style={{ width: `${job.pct || 0}%` }}></div>
                  </div>
                  <div className="dl-status">
                    {job.status === "converting" ? "Convirtiendo a MP3..." : `Descargando ${Math.floor(job.pct || 0)}%`}
                  </div>
                </div>
              )}
              {dlError && <div className="auth-error" style={{ marginTop: 10 }}>{dlError}</div>}
            </>
          )}

          {queue.length > 0 && (
            <>
              <div className="rec-head">
                <h2 className="section-title" style={{ margin: 0 }}>TU MUSICA [{queue.length}]</h2>
                <button className="pixel-btn sm" onClick={importFromElectron}>
                  SUBIR MP3
                </button>
              </div>
              <div className="dim tiny" style={{ marginBottom: 8 }}>
                También puedes arrastrar tus MP3 a la ventana — la portada se busca sola y se pixela
              </div>
              <div className="tracks">
                {queue.map((s, i) => (
                  <SongRow key={s.id} song={s} index={i} showRemove onRemove={() => removeTrack(s.id)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {view === "liked" && (
        <>
          <h2 className="section-title">ME GUSTA [{likedTracks.length}]</h2>
          <div className="tracks">
            {likedTracks.length === 0 && <div className="empty">Aún no marcas nada. Dale al corazón en una canción.</div>}
            {likedTracks.map((s, i) => (
              <SongRow key={s.id} song={s} index={i} showRemove={!!s.local} onRemove={() => removeTrack(s.id)} />
            ))}
          </div>
        </>
      )}

      {view === "artist" && <ArtistView name={artist} />}

      {view === "playlist" && activePl && (
        <>
          <h2 className="section-title">{activePl.name} [{activePl.trackIds.length}]</h2>
          <div className="dl-row" style={{ marginBottom: 10 }}>
            {activePl.folder && (
              <button className="pixel-btn sm green" onClick={() => electron().openPlaylistFolder(activePl.folder)}>
                ABRIR CARPETA
              </button>
            )}
            <button className="pixel-btn sm" onClick={() => deletePlaylist(activePl.id)}>
              BORRAR PLAYLIST
            </button>
          </div>
          <div className="tracks">
            {activePl.trackIds.length === 0 && <div className="empty">Vacía. Usa el + de una canción para agregarla.</div>}
            {activePl.trackIds
              .map((id) => queue.find((t) => t.id === id))
              .filter(Boolean)
              .map((s, i) => (
                <SongRow
                  key={s.id}
                  song={s}
                  index={i}
                  showRemove
                  removeTitle="sacar de la playlist"
                  onRemove={() => removeFromPlaylist(activePl.id, s.id)}
                />
              ))}
          </div>
        </>
      )}
    </main>
  );
}

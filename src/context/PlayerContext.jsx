import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import {
  loadTracksMeta, saveTracksMeta,
  loadPlaylists, savePlaylists,
  loadHistory, saveHistory,
  loadLiked, saveLiked,
  idbGet, idbDel, idbPut, dataUrlToBlob,
} from "../services/store.js";
import { parseName } from "../services/localLibrary.js";
import { pixelFallback } from "../services/coverArt.js";

const PlayerContext = createContext(null);
const electron = () => window.electronAPI;
const isElectron = () => !!window.electronAPI?.isElectron;

function coverFor(cover) {
  if (typeof cover !== "string") return {};
  if (cover.startsWith("data:image/")) return { coverData: cover };
  if (/^https?:\/\//i.test(cover)) return { thumbnail: cover };
  return {};
}

function diskTrack(file, stored) {
  const meta = stored.find((t) => t.filePath === file.filePath || t.fileName === file.fileName);
  const side = file.meta || {};
  const parsed = parseName(file.fileName);
  return {
    id: `disk:${file.rel || file.fileName}`,
    title: side.title || meta?.title || parsed.title,
    artist: side.artist || meta?.artist || parsed.artist,
    album: side.album || meta?.album || "YouTube",
    genre: "local",
    year: new Date().getFullYear(),
    duration: side.duration || meta?.duration || "--:--",
    plays: "DISCO",
    src: "",
    cover: file.cover || meta?.cover || pixelFallback(file.fileName),
    color: "#1ed760",
    local: true,
    source: "disk",
    fileName: file.fileName,
    filePath: file.filePath,
    folder: file.folder || "",
  };
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [liked, setLiked] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [history, setHistory] = useState([]);
  const [artist, setArtist] = useState("");
  const [activePlaylist, setActivePlaylist] = useState("search");
  const [loaded, setLoaded] = useState(false);
  const [playError, setPlayError] = useState("");

  // ---------- arranque: biblioteca guardada + disco ----------
  useEffect(() => {
    (async () => {
      const stored = loadTracksMeta();
      setLiked(loadLiked().filter((id) => stored.some((t) => t.id === id) || id.startsWith("disk:")));
      const pls = loadPlaylists();
      setPlaylists(pls);
      setHistory(loadHistory());
      if (isElectron()) {
        try {
          let changed = false;
          for (const pl of pls) {
            if (pl.folder) continue;
            try {
              const r = await electron().ensurePlaylistDir(pl.name);
              pl.folder = r.folder;
              changed = true;
            } catch (_) {}
          }
          if (changed) setPlaylists([...pls]);
        } catch (_) {}
      }

      let tracks = [];
      if (isElectron()) {
        try {
          const files = await electron().listMusicDir();
          const disk = files.map((f) => diskTrack(f, stored));
          // lo que ya no está en disco se olvida; subidas y streams se conservan
          const rest = stored.filter(
            (t) => !t.filePath && t.source !== "disk" && !disk.some((d) => d.id === t.id)
          );
          tracks = [...disk, ...rest];
        } catch (_) {
          tracks = stored;
        }
      } else {
        tracks = stored;
        // subir blobs de la web a URLs reproducibles
        tracks = await Promise.all(
          tracks.map(async (t) => {
            if (t.src || !t.blobId) return t;
            try {
              const blob = await idbGet(t.blobId);
              if (blob) return { ...t, src: URL.createObjectURL(blob) };
            } catch (_) {}
            return t;
          })
        );
      }
      setQueue(tracks.map((t) => ({ ...t, src: t.src || "" })));
      setLiked((l) => l.filter((id) => tracks.some((t) => t.id === id)));
      setLoaded(true);
    })();
  }, []);

  // ---------- guardar cambios ----------
  useEffect(() => {
    if (loaded) saveTracksMeta(queue);
  }, [queue, loaded]);
  useEffect(() => {
    if (loaded) saveLiked(liked);
  }, [liked, loaded]);
  useEffect(() => {
    if (loaded) savePlaylists(playlists);
  }, [playlists, loaded]);
  useEffect(() => {
    if (loaded) saveHistory(history);
  }, [history, loaded]);

  const localTracks = queue.filter((t) => t.local);
  const currentSong = queue.find((s) => s.id === currentId) || null;

  // ---------- resolver src bajo demanda (caché primero) ----------
  const STREAM_TTL = 5 * 3600 * 1000; // las urls de stream expiran en ~6h
  const ensureSrc = useCallback(async (track) => {
    if (!track) return null;
    // un stream viejo se re-resuelve solo (si no, da error al sonar)
    const staleStream =
      track.source === "stream" && !!track.src && Date.now() - (track.srcAt || 0) > STREAM_TTL;
    if (track.src && !staleStream) return track.src;
    setPlayError("");
    try {
      // 1) caché de un stream escuchado antes: suena al instante
      const cid = track.cacheId || (track.ytId ? `cache:${track.ytId}` : null);
      if (cid) {
        try {
          const cached = await idbGet(cid);
          if (cached) {
            const url = URL.createObjectURL(cached);
            setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, src: url } : t)));
            return url;
          }
        } catch (_) {}
      }
      if (track.filePath && isElectron()) {
        const f = await electron().readAudioFile(track.filePath);
        setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, src: f.dataUrl } : t)));
        return f.dataUrl;
      }
      if (track.blobId) {
        const blob = await idbGet(track.blobId);
        if (!blob) throw new Error("audio perdido");
        const url = URL.createObjectURL(blob);
        setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, src: url } : t)));
        return url;
      }
      if (track.source === "stream" && track.url && isElectron()) {
        const res = await electron().streamYouTube(track.url);
        if (!res.ok) throw new Error("No se pudo reproducir");
        // si tu red bloquea el audio, se dice claro en vez de fallar en silencio
        const st = res.probe?.status || 0;
        if (st !== 0 && st !== 200 && st !== 206) {
          throw new Error(`YouTube bloqueó el audio en tu red (${st}). Prueba con otra red o descarga la canción.`);
        }
        const now = Date.now();
        setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, src: res.audioUrl, srcAt: now } : t)));
        // se guarda en caché en segundo plano para la próxima
        if (cid) {
          electron()
            .fetchAudioBytes(res.audioUrl)
            .then(async (r) => {
              if (r?.ok && r.dataUrl) {
                try {
                  await idbPut(cid, dataUrlToBlob(r.dataUrl));
                  setQueue((q) => q.map((t) => (t.id === track.id ? { ...t, cacheId: cid } : t)));
                } catch (_) {}
              }
            })
            .catch(() => {});
        }
        return res.audioUrl;
      }
      throw new Error("Sin audio");
    } catch (err) {
      setPlayError(err.message || "No se pudo reproducir");
      return null;
    }
  }, []);

  const playId = useCallback(
    async (id, trackObj) => {
      // trackObj evita leer la cola desactualizada cuando la canción es nueva
      const track = trackObj || queue.find((t) => t.id === id);
      setCurrentId(id);
      setProgress(0);
      setPlayError(""); // el error viejo no se queda pegado
      const src = await ensureSrc(track || { id });
      if (src) {
        // contar la reproducción: alimenta las recomendaciones
        setQueue((q) => q.map((t) => (t.id === id ? { ...t, playCount: (t.playCount || 0) + 1 } : t)));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    },
    [queue, ensureSrc]
  );

  const playSong = useCallback((id) => playId(id), [playId]);

  const playTrack = useCallback(
    (track) => {
      setQueue((q) => (q.some((t) => t.id === track.id) ? q : [...q, track]));
      playId(track.id, track);
    },
    [playId]
  );

  const addTracks = useCallback((tracks) => {
    if (!tracks.length) return 0;
    setQueue((q) => {
      const ids = new Set(q.map((t) => t.id));
      const fresh = tracks.filter((t) => !ids.has(t.id));
      return [...q, ...fresh];
    });
    return tracks.length;
  }, []);

  const removeTrack = useCallback(
    (id) => {
      const track = queue.find((t) => t.id === id);
      if (track?.blobId) idbDel(track.blobId).catch(() => {});
      if (track?.cacheId) idbDel(track.cacheId).catch(() => {});
      if (track?.filePath && isElectron()) {
        electron().deleteFile(track.filePath).catch(() => {});
      }
      setQueue((q) => q.filter((t) => t.id !== id));
      setLiked((l) => l.filter((x) => x !== id));
      setPlaylists((pls) => pls.map((p) => ({ ...p, trackIds: p.trackIds.filter((x) => x !== id) })));
      if (id === currentId) {
        setIsPlaying(false);
        setQueue((q) => {
          const rest = q.filter((t) => t.id !== id);
          setCurrentId(rest.length ? rest[0].id : null);
          return rest;
        });
      }
    },
    [currentId, queue]
  );

  const togglePlay = useCallback(async () => {
    if (!currentId && queue.length) {
      playId(queue[0].id);
      return;
    }
    if (!isPlaying && currentId) {
      const track = queue.find((t) => t.id === currentId);
      if (track && !track.src) {
        const src = await ensureSrc(track);
        setIsPlaying(!!src);
        return;
      }
    }
    setIsPlaying((p) => !p);
  }, [currentId, queue, isPlaying, playId, ensureSrc]);

  const next = useCallback(() => {
    if (!queue.length) return;
    const idx = queue.findIndex((s) => s.id === currentId);
    if (idx === -1) playId(queue[0].id);
    else if (shuffle) playId(queue[Math.floor(Math.random() * queue.length)].id);
    else playId(queue[(idx + 1) % queue.length].id);
  }, [currentId, shuffle, queue, playId]);

  const prev = useCallback(() => {
    if (!queue.length) return;
    const idx = queue.findIndex((s) => s.id === currentId);
    if (idx === -1) return;
    playId(queue[(idx - 1 + queue.length) % queue.length].id);
  }, [currentId, queue, playId]);

  // ---------- fijar en disco: lo guardado en playlist/likes se descarga solo ----------
  const pinningRef = useRef(new Set());
  const [pinningIds, setPinningIds] = useState([]);

  // cambia un track por otro en todos lados (cola, likes, playlists, actual)
  const replaceTrack = useCallback(
    (oldId, track) => {
      const nid = track.id;
      setQueue((q) => {
        const withoutOld = q.filter((x) => x.id !== oldId);
        if (withoutOld.some((x) => x.id === nid)) return withoutOld;
        return [...withoutOld, track];
      });
      setLiked((l) => {
        if (!l.includes(oldId)) return l;
        const rest = l.filter((x) => x !== oldId);
        return rest.includes(nid) ? rest : [...rest, nid];
      });
      setPlaylists((pls) =>
        pls.map((p) =>
          p.trackIds.includes(oldId)
            ? { ...p, trackIds: [...p.trackIds.filter((x) => x !== oldId), ...(p.trackIds.includes(nid) ? [] : [nid])] }
            : p
        )
      );
      if (currentId === oldId) setCurrentId(nid);
    },
    [currentId]
  );

  const addRef = useCallback((pid, trackId) => {
    setPlaylists((p) =>
      p.map((x) => (x.id === pid && !x.trackIds.includes(trackId) ? { ...x, trackIds: [...x.trackIds, trackId] } : x))
    );
  }, []);

  // lo que se marca con like se baja solo a su carpeta ME GUSTA
  const pinTrack = useCallback(
    async (id) => {
      const t = queue.find((x) => x.id === id);
      if (!t || !isElectron() || t.filePath || t.source === "disk" || !t.url) return id;
      if (pinningRef.current.has(id)) return id;
      pinningRef.current.add(id);
      setPinningIds([...pinningRef.current]);
      try {
        const res = await electron().downloadYouTube({
          url: t.url,
          quality: "media",
          folder: "ME GUSTA",
          meta: { title: t.title, artist: t.artist, album: t.album, duration: t.duration, url: t.url, ytId: t.ytId || "" },
          ...coverFor(t.cover),
        });
        if (!res.ok || !res.filePath) return id;
        const file = await electron().readAudioFile(res.filePath);
        const newId = `disk:${res.rel}`;
        replaceTrack(id, {
          ...t,
          id: newId,
          src: file.dataUrl,
          local: true,
          source: "disk",
          plays: "YT",
          fileName: res.fileName,
          filePath: res.filePath,
          folder: res.folder,
        });
        return newId;
      } catch (_) {
        return id;
      } finally {
        pinningRef.current.delete(id);
        setPinningIds([...pinningRef.current]);
      }
    },
    [queue, replaceTrack]
  );

  const toggleLike = useCallback(
    async (id) => {
      const isLiking = !liked.includes(id);
      const target = isLiking ? await pinTrack(id) : id;
      setLiked((prev) => (prev.includes(target) ? prev.filter((x) => x !== target) : [...prev, target]));
    },
    [liked, pinTrack]
  );

  // ---------- playlists (cada una vive en su carpeta) ----------
  const createPlaylist = useCallback(async (name) => {
    const clean = String(name || "").trim().slice(0, 40);
    if (!clean) return null;
    let folder = clean;
    if (isElectron()) {
      try {
        const r = await electron().ensurePlaylistDir(clean);
        folder = r.folder;
      } catch (_) {}
    }
    const pl = { id: `pl-${Date.now()}`, name: clean.toUpperCase(), folder, trackIds: [] };
    setPlaylists((p) => [...p, pl]);
    return pl.id;
  }, []);

  const deletePlaylist = useCallback((id) => {
    setPlaylists((p) => p.filter((x) => x.id !== id));
    setActivePlaylist((a) => (a === `pl:${id}` ? "search" : a));
  }, []);

  const addToPlaylist = useCallback(
    async (pid, trackId, trackObj) => {
      // si la canción aún no está en la biblioteca (resultado de búsqueda),
      // se agrega primero y de ahí se descarga a su carpeta
      if (trackObj) {
        setQueue((q) => (q.some((t) => t.id === trackObj.id) ? q : [...q, trackObj]));
      }
      const pl = playlists.find((x) => x.id === pid);
      if (!pl || !isElectron()) {
        if (pl) addRef(pid, trackId);
        return;
      }
      let folder = pl.folder;
      if (!folder) {
        try {
          const r = await electron().ensurePlaylistDir(pl.name);
          folder = r.folder;
          setPlaylists((p) => p.map((x) => (x.id === pid ? { ...x, folder } : x)));
        } catch (_) {
          addRef(pid, trackId);
          return;
        }
      }
      const t = trackObj || queue.find((x) => x.id === trackId);
      if (!t) return;
      // ya vive en esa carpeta: solo enlazar
      if (t.filePath && (t.folder || "") === folder) {
        addRef(pid, trackId);
        return;
      }
      try {
        // en disco en otro lado: moverla con su cover y datos
        if (t.filePath) {
          const r = await electron().moveToPlaylist(t.filePath, folder);
          const nid = `disk:${r.rel}`;
          replaceTrack(trackId, { ...t, id: nid, filePath: r.filePath, fileName: r.fileName, folder: r.folder });
          addRef(pid, nid);
          return;
        }
        // stream: descargar directo en su carpeta
        if (t.url) {
          const res = await electron().downloadYouTube({
            url: t.url,
            quality: "media",
            folder,
            meta: { title: t.title, artist: t.artist, album: t.album, duration: t.duration, url: t.url, ytId: t.ytId || "" },
            ...coverFor(t.cover),
          });
          if (!res.ok || !res.filePath) {
            addRef(pid, trackId);
            return;
          }
          const file = await electron().readAudioFile(res.filePath);
          const nid = `disk:${res.rel}`;
          replaceTrack(trackId, {
            ...t,
            id: nid,
            src: file.dataUrl,
            local: true,
            source: "disk",
            plays: "YT",
            fileName: res.fileName,
            filePath: res.filePath,
            folder: res.folder,
          });
          addRef(pid, nid);
          return;
        }
        // subida local: copiar sus bytes a su carpeta
        if (t.blobId) {
          const blob = await idbGet(t.blobId);
          if (!blob) {
            addRef(pid, trackId);
            return;
          }
          const buf = await blob.arrayBuffer();
          const r = await electron().saveBlob({
            folder,
            fileName: t.fileName,
            data: buf,
            meta: { title: t.title, artist: t.artist, album: t.album, duration: t.duration },
            coverData: typeof t.cover === "string" && t.cover.startsWith("data:image/") ? t.cover : undefined,
          });
          const nid = `disk:${r.rel}`;
          try {
            await idbDel(t.blobId);
          } catch (_) {}
          replaceTrack(trackId, {
            ...t,
            id: nid,
            src: URL.createObjectURL(blob),
            local: true,
            source: "disk",
            fileName: r.fileName,
            filePath: r.filePath,
            folder: r.folder,
            blobId: undefined,
          });
          addRef(pid, nid);
          return;
        }
      } catch (_) {}
      addRef(pid, trackId);
    },
    [playlists, queue, replaceTrack, addRef]
  );

  const removeFromPlaylist = useCallback((pid, trackId) => {
    setPlaylists((p) => p.map((x) => (x.id === pid ? { ...x, trackIds: x.trackIds.filter((t) => t !== trackId) } : x)));
  }, []);

  // ---------- historial ----------
  const pushHistory = useCallback((q) => {
    const clean = String(q || "").trim().slice(0, 80);
    if (!clean) return;
    setHistory((h) => [clean, ...h.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 8));
  }, []);

  const openArtist = useCallback((name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    setArtist(clean);
    setActivePlaylist("artist");
  }, []);

  const seek = useCallback((time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  }, []);

  // si un stream falla (url expirada o bloqueada), se pide una fresca en silencio
  const retryRef = useRef(null);
  useEffect(() => {
    retryRef.current = null;
  }, [currentId]);

  // si un stream falla, se pide una url fresca en silencio.
  // Devuelve "ok" | "blocked" (tu red no deja) | "fail".
  const silentRetry = useCallback(
    async (song) => {
      if (!song || song.source !== "stream" || !song.url || !isElectron()) return "fail";
      if (retryRef.current === song.id) return "fail";
      retryRef.current = song.id;
      try {
        const res = await electron().streamYouTube(song.url);
        if (!res.ok || !res.audioUrl) return "fail";
        const st = res.probe?.status || 0;
        if (st !== 0 && st !== 200 && st !== 206) return "blocked";
        setQueue((q) =>
          q.map((t) => (t.id === song.id ? { ...t, src: res.audioUrl, srcAt: Date.now() } : t))
        );
        setPlayError("");
        return "ok";
      } catch (_) {
        return "fail";
      }
    },
    []
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (!currentSong?.src) {
      audio.pause();
      return;
    }
    if (isPlaying) {
      audio.play().catch(() => {
        setPlayError("No se pudo reproducir");
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentId, volume, currentSong?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setProgress(0);
    setDuration(0);
  }, [currentId]);

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
      if (e.code === "ArrowRight") next();
      if (e.code === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, next, prev]);

  const value = {
    audioRef, queue, localTracks, currentSong, currentId, isPlaying,
    progress, duration, volume, shuffle, repeat,
    liked, activePlaylist, playlists, history, artist, playError, loaded, pinningIds,
    setVolume, setShuffle, setRepeat, setActivePlaylist,
    setProgress, setDuration, setPlayError,
    playSong, playTrack, addTracks, removeTrack,
    togglePlay, next, prev, toggleLike, seek,
    createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
    pushHistory, openArtist, ensureSrc,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        src={currentSong?.src || ""}
        onTimeUpdate={(e) => setProgress(e.target.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onError={() => {
          const song = currentSong;
          // reintento silencioso con url fresca antes de avisar
          silentRetry(song).then((how) => {
            if (how === "ok") {
              setIsPlaying(true);
              return;
            }
            if (how === "blocked") {
              setPlayError("Tu red bloquea el audio de YouTube. Prueba con otra red o descarga la canción.");
            } else {
              setPlayError("No se pudo reproducir");
            }
            setIsPlaying(false);
          });
        }}
        onEnded={() => {
          if (!audioRef.current) return;
          if (repeat) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
          } else {
            next();
          }
        }}
      />
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);

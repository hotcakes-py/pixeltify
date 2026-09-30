import { usePlayer } from "../context/PlayerContext.jsx";
import AddToPlaylist from "./AddToPlaylist.jsx";

function fmt(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Player() {
  const {
    currentSong, isPlaying, togglePlay, next, prev,
    progress, duration, seek, volume, setVolume,
    shuffle, setShuffle, repeat, setRepeat, liked, toggleLike,
  } = usePlayer();

  const isLiked = currentSong ? liked.includes(currentSong.id) : false;

  if (!currentSong) {
    return (
      <footer className="player pixel-box">
        <div className="p-song">
          <div>
            <div className="p-title">PIXELTIFY</div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="player pixel-box">
      {/* info */}
      <div className="p-song">
        <img src={currentSong.cover} alt="" className="p-cover pixelated" />
        <div>
          <div className="p-title">{currentSong.title}</div>
          <div className="p-artist">{currentSong.artist}</div>
        </div>
        <button className={`p-heart ${isLiked ? "liked" : ""}`} onClick={() => toggleLike(currentSong.id)}>
          {isLiked ? "♥" : "♡"}
        </button>
        <AddToPlaylist songId={currentSong.id} up />
      </div>

      {/* controles */}
      <div className="p-center">
        <div className="p-btns">
          <button className={`p-btn sm ${shuffle ? "on" : ""}`} onClick={() => setShuffle(!shuffle)} title="shuffle">⇄</button>
          <button className="p-btn" onClick={prev} title="anterior">◀◀</button>
          <button className="p-btn big" onClick={togglePlay} title="play/pausa">
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button className="p-btn" onClick={next} title="siguiente">▶▶</button>
          <button className={`p-btn sm ${repeat ? "on" : ""}`} onClick={() => setRepeat(!repeat)} title="repeat">↻</button>
        </div>
        <div className="p-progress">
          <span>{fmt(progress)}</span>
          <input
            type="range" min="0" max={duration || 0} value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="pixel-range"
          />
          <span>{fmt(duration)}</span>
        </div>
        {/* visualizador */}
        <div className={`visualizer ${isPlaying ? "playing" : ""}`}>
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} style={{ "--d": `${(i % 7) * 0.12}s`, "--h": `${8 + ((i * 13) % 22)}px` }} />
          ))}
        </div>
      </div>

      {/* volumen */}
      <div className="p-vol">
        <span>♪</span>
        <input
          type="range" min="0" max="1" step="0.05" value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="pixel-range vol"
        />
        <span className="p-vol-num">{Math.round(volume * 100)}</span>
      </div>
    </footer>
  );
}

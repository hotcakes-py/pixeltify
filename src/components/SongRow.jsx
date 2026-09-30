import { usePlayer } from "../context/PlayerContext.jsx";
import AddToPlaylist from "./AddToPlaylist.jsx";

export default function SongRow({ song, index, showRemove, onRemove, removeTitle = "quitar" }) {
  const { playSong, currentId, isPlaying, liked, toggleLike, openArtist } = usePlayer();
  const active = song.id === currentId;
  const isLiked = liked.includes(song.id);

  return (
    <div className={`track ${active ? "active" : ""}`} onClick={() => playSong(song.id)}>
      <span className="t-num">{active && isPlaying ? "♫" : String(index + 1).padStart(2, "0")}</span>
      <span className="t-main">
        <img src={song.cover} alt="" className="t-cover pixelated" loading="lazy" />
        <span>
          <span className="t-title" style={active ? { color: song.color } : {}}>{song.title}</span>
          <span
            className="t-artist link"
            onClick={(e) => { e.stopPropagation(); openArtist(song.artist); }}
            title="ver artista"
          >
            {song.artist}
          </span>
        </span>
      </span>
      <span className="t-genre">{song.genre}</span>
      <span className="t-plays">{song.plays}</span>
      <span className="t-actions">
        <button
          className={`t-like ${isLiked ? "liked" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleLike(song.id); }}
          title="like"
        >
          {isLiked ? "♥" : "♡"}
        </button>
        <AddToPlaylist songId={song.id} />
      </span>
      <span className="t-time">{song.duration}</span>
      {showRemove && (
        <span className="row-actions">
          <button
            className="t-del"
            onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
            title={removeTitle}
          >
            X
          </button>
        </span>
      )}
    </div>
  );
}

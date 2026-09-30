// PIXELTIFY — puente seguro entre Electron y React (contextIsolation).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getAppInfo: () => ipcRenderer.invoke("app-info"),
  selectAudioFiles: () => ipcRenderer.invoke("select-audio-files"),
  readAudioFile: (filePath) => ipcRenderer.invoke("read-audio-file", filePath),
  searchYouTube: (query) => ipcRenderer.invoke("search-youtube", { query }),
  searchArtist: (artist) => ipcRenderer.invoke("search-artist", { artist }),
  listMusicDir: () => ipcRenderer.invoke("list-music-dir"),
  deleteFile: (filePath) => ipcRenderer.invoke("delete-file", filePath),
  ensurePlaylistDir: (name) => ipcRenderer.invoke("ensure-playlist-dir", name),
  moveToPlaylist: (filePath, folder) => ipcRenderer.invoke("move-to-playlist", { filePath, folder }),
  saveBlob: (payload) => ipcRenderer.invoke("save-blob", payload),
  openPlaylistFolder: (folder) => ipcRenderer.invoke("open-playlist-folder", folder),
  streamYouTube: (url) => ipcRenderer.invoke("stream-youtube", { url }),
  fetchAudioBytes: (url) => ipcRenderer.invoke("fetch-audio-bytes", { url }),
  downloadYouTube: (payload) => ipcRenderer.invoke("download-youtube", payload),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onUpdateStatus: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("yt-progress", listener);
    return () => ipcRenderer.removeListener("yt-progress", listener);
  },
});

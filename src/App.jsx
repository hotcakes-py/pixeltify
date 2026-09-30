import { PlayerProvider } from "./context/PlayerContext.jsx";
import Sidebar from "./components/Sidebar.jsx";
import MainView from "./components/MainView.jsx";
import Player from "./components/Player.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";

function Shell() {
  return (
    <div className="app">
      <header className="topbar pixel-box">
        <div className="logo">
          <img src="icon.png" alt="PIXELTIFY" className="logo-img pixelated" />
          PIXELTIFY
        </div>
      </header>

      <UpdateBanner />

      <div className="layout">
        <Sidebar />
        <MainView />
      </div>

      <Player />
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <div className="crt-overlay"></div>
      <Shell />
    </PlayerProvider>
  );
}

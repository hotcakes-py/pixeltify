// Portada automática + filtro pixel-art.
// 1) searchCover(): busca la carátula en iTunes Search API (gratis, sin key).
// 2) pixelate(): convierte cualquier imagen a pixel-art con canvas.

export async function searchCover(title, artist) {
  try {
    const q = `${artist || ""} ${title || ""}`.trim().slice(0, 120);
    if (!q) return "";
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=1`
    );
    if (!res.ok) return "";
    const json = await res.json();
    const art = json?.results?.[0]?.artworkUrl100;
    if (!art) return "";
    // 100x100 -> 600x600
    return art.replace("100x100bb", "600x600bb");
  } catch (_) {
    return "";
  }
}

export function pixelFallback(seed) {
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1e1e38`;
}

// Convierte una imagen (URL) a pixel-art dataURL.
// size = resolución del mosaico (16 = muy pixel, 48 = suave). 32 es el punto Spotify-pixel.
export function pixelate(url, size = 32) {
  return new Promise((resolve) => {
    if (!url) return resolve("");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const small = document.createElement("canvas");
        small.width = size;
        small.height = size;
        const sctx = small.getContext("2d");
        sctx.imageSmoothingEnabled = false;
        // recorte cuadrado centrado
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        sctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

        const big = document.createElement("canvas");
        big.width = 256;
        big.height = 256;
        const bctx = big.getContext("2d");
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(small, 0, 0, 256, 256);
        resolve(big.toDataURL("image/png"));
      } catch (_) {
        resolve(url); // si falla el canvas (CORS), usar original
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

// Flujo completo: buscar carátula real y pixelarla. Si no hay, fallback pixel-art.
export async function coverForSong(title, artist, fileName = "") {
  const real = await searchCover(title, artist);
  if (real) {
    const px = await pixelate(real, 32);
    if (px) return px;
    return real;
  }
  return pixelFallback(fileName || `${artist}-${title}`);
}

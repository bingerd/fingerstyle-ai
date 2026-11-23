import type * as AlphaTabNS from "@coderline/alphatab";

type AlphaTab = typeof AlphaTabNS;
declare global {
  interface Window { alphaTab?: AlphaTab }
}

/** Load alphaTab's UMD bundle from /public once; its workers resolve from the same script URL. */
let loader: Promise<AlphaTab> | null = null;
export function loadAlphaTab(): Promise<AlphaTab> {
  if (window.alphaTab) return Promise.resolve(window.alphaTab);
  return (loader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/alphatab/alphaTab.min.js";
    s.onload = () => (window.alphaTab ? resolve(window.alphaTab) : reject(new Error("alphaTab failed to load")));
    s.onerror = () => reject(new Error("alphaTab failed to load"));
    document.head.appendChild(s);
  }));
}

/** Prefer the full MuseScore General soundfont (real nylon/steel/jazz guitars) when it's installed. */
let soundFont: Promise<string> | null = null;
export function pickSoundFont(): Promise<string> {
  return (soundFont ??= fetch("/alphatab/MuseScore_General.sf3", { method: "HEAD" })
    .then((r) => (r.ok && Number(r.headers.get("content-length")) > 30_000_000 ? "/alphatab/MuseScore_General.sf3" : "/alphatab/sonivox.sf2"))
    .catch(() => "/alphatab/sonivox.sf2"));
}

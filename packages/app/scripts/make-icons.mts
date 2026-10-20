#!/usr/bin/env node
// Regenerates every icon the desktop app and its launchers use, from the brand masters in brand/
// (리플이, brand/README.md). Run: npm --workspace @clauderipple/app run icons
//
//   assets/tray*Template{,@2x}.png   macOS menu bar, 22pt template images (black + alpha; macOS tints them)
//   assets/trayWin*{,@2x}.png        Windows tray, 32/64px, coloured (Windows does not tint)
//   assets/icon.png                  1024 app icon on the macOS grid (Linux .desktop, window icon)
//   assets/icon.icns                 the same, every iconset size (the `clauderipple app --install` launcher)
//   assets/icon.ico                  Windows grid, 16–256 (window icon, Start Menu / Desktop shortcut)
//   build/icon.icns, build/icon.png  what electron-builder reads (mac.icon; win.icon, Windows grid); not committed
//
// assets/ is committed and shipped in the npm package (scripts/build-npm.mjs), so publishing needs
// neither a browser nor iconutil. Rendering is headless Chrome screenshotting the SVGs (CHROME= to
// point at another Chromium; Chrome, Chromium and Edge are looked for). With no browser the
// committed renders are copied into build/ and nothing is redrawn. The .icns needs macOS iconutil;
// elsewhere the committed one is kept.
//
// Tray states (menu bar and Windows alike), all on the mono mark's 56 grid:
//   ok     : mark-mono.svg (ring, crest, ears, eyes)
//   warn   : the ring broken at the lower right, with "!" in the break
//   down   : the spec's sleeping face: thin ring, short crest, closed eyes, no ears
//   direct : no ears (no ripple) and an arrow at the lower right: Claude goes straight out
// Windows shows its tray at 16px, so it follows the 16px rules (no ears) and carries the state in
// colour as well.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.resolve(app, "..", "..", "brand");
const assets = path.join(app, "assets");
const build = path.join(app, "build");
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(build, { recursive: true });

function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((p): p is string => !!p && fs.existsSync(p)) ?? null;
}

const browser = findBrowser();
if (!browser) {
  for (const file of ["icon.png", "icon.icns"]) {
    const from = path.join(assets, file);
    if (!fs.existsSync(from)) throw new Error(`no Chrome/Chromium/Edge to render icons with (set CHROME=) and no committed assets/${file} to fall back on`);
    fs.copyFileSync(from, path.join(build, file));
  }
  console.log("no browser found: kept the committed icons in assets/ and copied the app icon into build/");
  process.exit(0);
}

// ---- rendering --------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-icons-"));
const run = promisify(execFile);
let seq = 0;
/** Screenshots `html` on a transparent `size`×`size` page into `out`. */
async function shoot(html: string, size: number, out: string): Promise<void> {
  const id = seq++;
  const page = path.join(tmp, `${id}.html`);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}.i>svg{display:block;width:100%;height:100%}</style>${html}`);
  // No --user-data-dir: headless makes a throwaway profile per run already, and with a fresh
  // explicit one Chrome for Testing 155 cut the 128px icon to its top half (a smaller first viewport).
  await run(browser!, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${page}`]);
}
const jobs: (() => Promise<void>)[] = [];
const queue = (html: string, size: number, out: string) => jobs.push(() => shoot(html, size, out));
async function drain(width = 6): Promise<void> {
  const next = async (): Promise<void> => {
    const job = jobs.shift();
    if (!job) return;
    await job();
    await next();
  };
  await Promise.all(Array.from({ length: width }, next));
}
// Inline, not <img src=data:…>, so nothing decodes after load. Each page holds one SVG, so its
// ids cannot collide.
const img = (svg: string, size: number, style = "") => `<div class="i" style="width:${size}px;height:${size}px;${style}">${svg}</div>`;

// ---- the mark, in pieces (brand/mark-mono.svg and the spec's state drawings, 56 grid) ---------

const C = "currentColor";
const CREST = `<path d="M24.7 12.29C24.2 6.2 29.2 2.4 35 2.6C39.6 2.8 42.6 6.2 41.6 9.8C40.6 8 38.6 7 36.8 7.6C35 8.2 35 11 36.33 13.92Z" fill="${C}"/>`;
const CREST_SHORT = `<path d="M24.7 12.29C25 8.4 28.4 6.4 32 6.6C34.8 6.8 36.8 8.4 36.8 10.2C36 9.6 35.2 9.8 34.9 10.6C34.7 11.6 35.4 12.8 36.33 13.92Z" fill="${C}"/>`;
const RING = `<circle cx="28" cy="31" r="16.5" fill="none" stroke="${C}" stroke-width="6.4"/>`;
const RING_THIN = `<circle cx="28" cy="31" r="17.7" fill="none" stroke="${C}" stroke-width="3.4"/>`;
const EARS = `<path d="M50.02 20.26A24.5 24.5 0 0 1 50.02 41.74M5.98 41.74A24.5 24.5 0 0 1 5.98 20.26" fill="none" stroke="${C}" stroke-width="4" stroke-linecap="round"/>`;
const EYES = `<rect x="19.9" y="25" width="5" height="8.4" rx="2.5" fill="${C}"/><rect x="31.1" y="25" width="5" height="8.4" rx="2.5" fill="${C}"/>`;
const EYES_CLOSED = `<path d="M18.6 30.4h7.4M30 30.4h7.4" fill="none" stroke="${C}" stroke-width="3.6" stroke-linecap="round"/>`;
/** A badge at the lower right: the mark is cut away around it so it reads as its own shape. */
function badge(body: string, glyph: string, id: string): string {
  return `<defs><mask id="${id}"><rect width="56" height="56" fill="#fff"/><circle cx="46" cy="46" r="11.5" fill="#000"/></mask></defs><g mask="url(#${id})">${body}</g>${glyph}`;
}
const BANG = `<path d="M46 38.6v6.2" stroke="${C}" stroke-width="4.6" stroke-linecap="round"/><circle cx="46" cy="51.6" r="2.6" fill="${C}"/>`;
const ARROW = `<path d="M37.5 46h13M45.5 40.5l5.5 5.5-5.5 5.5" fill="none" stroke="${C}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`;

type State = "ok" | "warn" | "down" | "direct";
const STATES: State[] = ["ok", "warn", "down", "direct"];
function trayMark(state: State, ears: boolean): string {
  const e = ears ? EARS : "";
  if (state === "ok") return CREST + RING + e + EYES;
  if (state === "warn") return badge(CREST + RING + e + EYES, BANG, "w");
  if (state === "down") return CREST_SHORT + RING_THIN + EYES_CLOSED;
  return badge(CREST + RING + EYES, ARROW, "d");
}
const svg56 = (body: string, color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" style="color:${color}">${body}</svg>`;

// macOS menu bar: 22pt template images.
const MAC_NAME: Record<State, string> = { ok: "trayTemplate", warn: "trayWarnTemplate", down: "trayDownTemplate", direct: "trayDirectTemplate" };
for (const s of STATES) {
  const svg = svg56(trayMark(s, true), "#000");
  queue(img(svg, 22), 22, path.join(assets, `${MAC_NAME[s]}.png`));
  queue(img(svg, 44), 44, path.join(assets, `${MAC_NAME[s]}@2x.png`));
}

// Windows tray: coloured, the 16px rules (no ears). Tones sit between the brand's light and dark
// tokens so they hold on both a light and a dark taskbar.
const WIN_NAME: Record<State, string> = { ok: "trayWin", warn: "trayWinWarn", down: "trayWinDown", direct: "trayWinDirect" };
const WIN_TONE: Record<State, string> = {
  ok: "#7c69ef", // accent, between #6a56d6 and #a594f5
  warn: "#d9a21c", // between warn #b5820a and #e0b436
  down: "#e04848", // between bad #c73434 and #ef5a5a
  direct: "#8a96a6", // slate: off on purpose, not an alarm
};
for (const s of STATES) {
  const svg = svg56(trayMark(s, false), WIN_TONE[s]);
  queue(img(svg, 32), 32, path.join(assets, `${WIN_NAME[s]}.png`));
  queue(img(svg, 64), 64, path.join(assets, `${WIN_NAME[s]}@2x.png`));
}

// ---- app icon (brand/app-icon.svg) ------------------------------------------------------------

const TILE = fs.readFileSync(path.join(brand, "app-icon.svg"), "utf8");
/**
 * The tile for a given pixel size. From 48px up it is app-icon.svg as drawn; below that the faint
 * ripples and the mouth vanish and the 2.4-wide ears go to mush, so the mark switches to the mono
 * weights (mark-mono.svg), and at 16–24px to the 16px rules (no ears), as favicon.svg does.
 */
function tile(px: number): string {
  if (px >= 48) return TILE;
  const mark = px > 24 ? CREST + RING + EARS + EYES : CREST + RING + EYES;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22.4" fill="#6a56d6"/><g transform="translate(15 14.2) scale(1.25)" style="color:#fff">${mark}</g></svg>`;
}
/** macOS grid: the tile is 824/1024 of the canvas, centred, with Apple's soft drop shadow. */
function macIcon(size: number): string {
  const t = Math.round((size * 824) / 1024);
  const shadow = size >= 64 ? `filter:drop-shadow(0 ${(size * 10) / 1024}px ${(size * 12) / 1024}px rgba(0,0,0,.3))` : "";
  return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${img(tile(t), t, shadow)}</div>`;
}
/** Windows grid: the tile nearly fills the canvas (Windows draws no shadow or plate of its own). */
function winIcon(size: number): string {
  const t = size - 2 * Math.max(1, Math.round(size / 32));
  return `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${img(tile(t), t)}</div>`;
}

const iconset = path.join(tmp, "icon.iconset");
fs.mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  queue(macIcon(base), base, path.join(iconset, `icon_${base}x${base}.png`));
  queue(macIcon(base * 2), base * 2, path.join(iconset, `icon_${base}x${base}@2x.png`));
}
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
for (const s of ICO_SIZES) queue(winIcon(s), s, path.join(tmp, `ico-${s}.png`));
queue(winIcon(1024), 1024, path.join(build, "icon.png"));

await drain();

fs.copyFileSync(path.join(iconset, "icon_512x512@2x.png"), path.join(assets, "icon.png"));
if (process.platform === "darwin") execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(assets, "icon.icns")]);
else console.log("not macOS: kept the committed assets/icon.icns (iconutil is macOS-only)");

/** PNG-compressed .ico (Windows Vista and later read PNG entries). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}
fs.writeFileSync(path.join(assets, "icon.ico"), ico(ICO_SIZES.map((size) => ({ size, data: fs.readFileSync(path.join(tmp, `ico-${size}.png`)) }))));

// electron-builder: mac.icon is build/icon.icns; win.icon is build/icon.png (rendered above on the
// Windows grid; electron-builder makes its .ico from it).
fs.copyFileSync(path.join(assets, "icon.icns"), path.join(build, "icon.icns"));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`icons written to ${assets} (tray, icon.png/.icns/.ico) and ${build} (icon.icns, icon.png)`);

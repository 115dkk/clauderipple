// Transcript/SDK boundary: only referenced local cache files and raster base64 images.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImagePart } from "./protocol.ts";

export type ImageSink = (base64: string) => string;
const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 32 * 1024 * 1024;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Both the lexical and real path must remain in the same cache root. */
export function imageCachePath(file: string, home = os.homedir()): string | null {
  if (!path.isAbsolute(file)) return null;
  const normalized = path.resolve(file);
  const claude = path.join(home, ".claude");
  const tempRoots = [...new Set(["/tmp", "/private/tmp", os.tmpdir()])];
  const tempRoot = tempRoots.find(root => normalized.startsWith(root + path.sep));
  const cache = tempRoot ? path.relative(tempRoot, normalized).split(path.sep) : [];
  const imageIndex = cache.lastIndexOf("images");
  const tmp = /^claude-[^/]+$/.test(cache[0] ?? "") && imageIndex >= 1
    ? path.join(tempRoot!, ...cache.slice(0, imageIndex + 1)) : undefined;
  const root = normalized.startsWith(claude + path.sep) ? claude : tmp;
  if (!root) return null;
  try {
    const realRoot = fs.realpathSync(root);
    // A symlinked cache directory itself must not authorize an arbitrary directory.
    const expectedRoot = root.startsWith("/tmp/") ? "/private" + root : root;
    const platformRoot = root === claude ? path.join(fs.realpathSync(home), ".claude")
      : tempRoot && tmp ? path.join(fs.realpathSync(tempRoot), ...cache.slice(0, imageIndex + 1)) : expectedRoot;
    if (realRoot !== platformRoot) return null;
    const real = fs.realpathSync(normalized);
    return real.startsWith(realRoot + path.sep) ? real : null;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

function fileImage(file: string, sink?: ImageSink): ImagePart {
  const mediaType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" } as Record<string, string>)[path.extname(file).toLowerCase()] ?? "image/png";
  const unavailable: ImagePart = { type: "image", mediaType };
  const real = imageCachePath(file);
  if (!real || !sink || !/\.(png|jpe?g|gif|webp)$/i.test(file)) return unavailable;
  let fd: number;
  try { fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) {
    if (["ENOENT", "ELOOP", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) return unavailable;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    const checked = imageCachePath(file);
    if (checked !== real) return unavailable;
    const current = fs.statSync(checked);
    if (current.dev !== stat.dev || current.ino !== stat.ino) return unavailable;
    if (!stat.isFile() || stat.size > MAX_BYTES || !MIME.has(mediaType)) return unavailable;
    return { ...unavailable, blob: sink(fs.readFileSync(fd).toString("base64")) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return unavailable;
    throw error;
  } finally { fs.closeSync(fd); }
}

/** Original bytes are retained; clients scale thumbnails (no platform-specific sips dependency). */
export function messageContent(content: unknown, sink?: ImageSink): { text: string; images: ImagePart[] } {
  const texts: string[] = [], images: ImagePart[] = [];
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  for (const value of blocks) {
    const block = object(value);
    if (block?.type === "text" && typeof block.text === "string") {
      const stripped = block.text.replace(/\[Image: source: ([^\]\r\n]+)\]/g, (_match, file: string) => {
        images.push(fileImage(file.trim(), sink));
        return "";
      });
      if (stripped) texts.push(stripped);
    }
    if (block?.type !== "image") continue;
    const source = object(block.source);
    const mediaType = typeof source?.media_type === "string" && MIME.has(source.media_type) ? source.media_type : "image/png";
    const part: ImagePart = { type: "image", mediaType };
    if (source?.type === "base64" && typeof source.data === "string" && MIME.has(String(source.media_type)) &&
        source.data.length <= Math.ceil(MAX_BYTES / 3) * 4 && source.data.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(source.data) && !/=/.test(source.data.slice(0, -2)) && /[A-Za-z0-9+/](?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]=|==)$/.test(source.data) && source.data && sink) {
      part.blob = sink(source.data);
    }
    images.push(part);
  }
  return { text: texts.join("\n\n"), images };
}

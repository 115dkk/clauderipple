// Transcript/SDK boundary: session-scoped file snapshots and inline raster images.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ATTACHMENT_CAP, ATTACHMENT_COUNT, SESSION_FILE_NAME, SESSION_FILE_TOTAL, type Attachment, type ImagePart, type SessionFile, type ToolCall } from "./protocol.ts";

export type InputBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } };

/** Validate everything before writing; generated filenames cannot escape or overwrite a user file. */
export function attachmentContent(cwd: string, text: string, attachments: Attachment[], read: (id: string) => string | null, store?: ImageSink): { content: string | InputBlock[]; images: ImagePart[] } {
  if (!Array.isArray(attachments) || attachments.length > ATTACHMENT_COUNT) throw new Error(`At most ${ATTACHMENT_COUNT} attachments.`);
  const items = attachments.map(a => {
    if (!a || typeof a.name !== "string" || typeof a.mediaType !== "string") throw new Error("Invalid attachment.");
    const data = read(a.blob);
    if (!data || data.length > Math.ceil(ATTACHMENT_CAP / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Attachment missing or too large (8 MB limit).");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > ATTACHMENT_CAP) throw new Error("Attachment exceeds 8 MB.");
    if (a.mediaType.startsWith("image/") && !MIME.has(a.mediaType)) throw new Error("Use PNG, JPEG, GIF or WebP images.");
    return { a, data, bytes };
  });
  const blocks: InputBlock[] = [], images: ImagePart[] = [];
  const mentions: string[] = [];
  for (const { a, data, bytes } of items) {
    if (a.mediaType === "image/png" || a.mediaType === "image/jpeg" || a.mediaType === "image/gif" || a.mediaType === "image/webp") {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data } });
      images.push({ type: "image", blob: store ? store(data) : a.blob, mediaType: a.mediaType });
      continue;
    }
    const root = path.join(cwd, ".ripple-attachments");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Attachment folder must not be a symlink.");
    const name = a.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-100) || "file";
    const file = path.join(root, `${a.blob}-${name}`);
    try {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (!fs.fstatSync(fd).isFile() || !fs.readFileSync(fd).equals(bytes)) throw new Error("Attachment filename collision.");
      } finally { fs.closeSync(fd); }
    }
    mentions.push(`Attached file: ${JSON.stringify(file)}`);
  }
  const prompt = [text, ...mentions].filter(Boolean).join("\n\n");
  return { content: blocks.length ? [{ type: "text", text: prompt || "Please inspect these images." }, ...blocks] : prompt, images };
}

export type ImageSink = (base64: string) => string;
/** Host-owned metadata only. Never construct roots from tool arguments, prompts or phone requests.
 * scratchpad is absent until the host has independently verified that exact session directory. */
export interface SessionFileScope { cwd: string; additionalDirectories?: readonly string[]; scratchpad?: string }
const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function secretPath(file: string): boolean {
  return file.split(/[\\/]/).some(name => /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.git|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|google-services\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i.test(name) ||
    /\.(?:p8|pem|key|jks|keystore|p12|pfx|mobileprovision)$/i.test(name) ||
    /(?:^|[._ -])(?:secrets?|tokens?|passwords?|keys?|api[-_]?keys?|service[-_]?account|auth|oauth)(?:[._ -]|$)/i.test(name));
}
function secretBytes(bytes: Buffer): boolean {
  const text = bytes.toString("utf8");
  return /-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/.test(text) ||
    /["'](?:private_key|client_secret|access_token|refresh_token|api_key|apiKey)["']\s*[:=]\s*["'][^"']+/i.test(text) ||
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*\S+/i.test(text) ||
    /\b(?:AKIA[0-9A-Z]{16}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(text);
}
/** Extensions may refine validated UTF-8 text, but never authorize binary bytes as an active format. */
function sniff(bytes: Buffer, name: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return "application/octet-stream"; }
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) return "application/octet-stream";
  if (/<(?:!doctype\s+html|html|head|body|script|style|div|p|h[1-6])(?:\s|>)/i.test(text)) return "text/html";
  return /\.(?:md|markdown)$/i.test(name) ? "text/markdown" : "text/plain";
}
type Identity = { file: string; stat: fs.BigIntStats };
function sameIdentity(a: fs.BigIntStats, b: fs.BigIntStats): boolean {
  // Windows path stats sometimes report dev=0; inode and birth time still have to agree.
  return (a.dev === b.dev || a.dev === 0n || b.dev === 0n) && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameVersion(a: fs.BigIntStats, b: fs.BigIntStats): boolean {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** Record every component beneath the trusted root, not just the final realpath. */
function pathChain(root: string, file: string): Identity[] {
  const chain: Identity[] = [];
  let current = root;
  for (const segment of ["", ...path.relative(root, file).split(path.sep)]) {
    if (segment) current = path.join(current, segment);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || (current !== file && !stat.isDirectory())) throw new Error("blocked");
    chain.push({ file: current, stat });
  }
  return chain;
}
function checkedPath(file: string, scope: SessionFileScope): { real: string; root: string; originalRoot: string; chain: Identity[] } {
  if (!file || file.includes("\0") || file.split(/[\\/]/).includes("..") || !path.isAbsolute(scope.cwd)) throw new Error("blocked");
  const absolute = path.resolve(scope.cwd, file);
  if (secretPath(absolute)) throw new Error("blocked");
  const roots = [scope.cwd, ...(scope.additionalDirectories ?? []), ...(scope.scratchpad ? [scope.scratchpad] : [])];
  const forbidden = new Set([path.parse(absolute).root, os.homedir(), path.join(os.homedir(), ".claude"), "/tmp", "/private/tmp", os.tmpdir()].map(p => path.resolve(p)));
  for (const root of [...forbidden]) {
    try { forbidden.add(fs.realpathSync(root)); }
    catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  const originalRoot = roots.find(root => path.isAbsolute(root) && !forbidden.has(path.resolve(root)) && inside(path.resolve(root), absolute));
  if (!originalRoot || fs.lstatSync(originalRoot).isSymbolicLink()) throw new Error("blocked");
  const root = fs.realpathSync(originalRoot);
  if (forbidden.has(root)) throw new Error("blocked");
  const real = path.join(root, path.relative(path.resolve(originalRoot), absolute));
  const chain = pathChain(root, real);
  if (!inside(root, fs.realpathSync(absolute)) || fs.realpathSync(absolute) !== real) throw new Error("blocked");
  return { real, root, originalRoot, chain };
}
function unchanged(checked: ReturnType<typeof checkedPath>): boolean {
  return fs.realpathSync(checked.originalRoot) === checked.root && fs.realpathSync(checked.real) === checked.real &&
    checked.chain.every(({ file, stat }) => { const current = fs.lstatSync(file, { bigint: true }); return !current.isSymbolicLink() && sameIdentity(stat, current); });
}
/** Bounded read from one verified handle. Growth cannot allocate past the per-file cap. */
function snapshot(checked: ReturnType<typeof checkedPath>, remaining: number): Buffer | "too_large" {
  const initial = checked.chain.at(-1)!.stat;
  if (!initial.isFile() || initial.nlink !== 1n) throw new Error("blocked");
  if (initial.size > BigInt(Math.min(ATTACHMENT_CAP, remaining))) return "too_large";
  const fd = fs.openSync(checked.real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || !sameVersion(initial, before) || !unchanged(checked)) throw new Error("blocked");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    if (BigInt(size) !== before.size || !sameVersion(before, fs.fstatSync(fd, { bigint: true })) ||
        !sameVersion(before, fs.lstatSync(checked.real, { bigint: true })) || !unchanged(checked)) throw new Error("blocked");
    return bytes.subarray(0, size);
  } finally { fs.closeSync(fd); }
}
/** One boundary owns all expected file failures; a refusal is visible and never drops a conversation. */
export function sessionFiles(paths: unknown, scope: SessionFileScope, sink?: ImageSink): SessionFile[] {
  if (!Array.isArray(paths)) return [];
  let remaining = SESSION_FILE_TOTAL;
  return paths.slice(0, ATTACHMENT_COUNT).map((value): SessionFile => {
    const file = typeof value === "string" ? value : "";
    const name = Array.from(path.basename(file.replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f‪-‮⁦-⁩]/g, "_")).slice(0, SESSION_FILE_NAME).join("") || "파일";
    const part: SessionFile = { id: randomUUID(), name, mediaType: "application/octet-stream", bytes: 0, status: "blocked" };
    try {
      const checked = checkedPath(file, scope);
      const data = snapshot(checked, remaining);
      if (data === "too_large") return { ...part, bytes: Number(checked.chain.at(-1)!.stat.size), status: "too_large" };
      if (!sink || secretBytes(data)) return part;
      const blob = sink(data.toString("base64"));
      remaining -= data.length;
      return { ...part, id: blob, blob, bytes: data.length, mediaType: sniff(data, name), status: "ready" };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { ...part, status: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "blocked" };
    }
  });
}
/** Redact source paths even from the tool's display input. Roots never come from this input. */
export function sessionFileTool(name: string, input: Record<string, unknown>, scope: SessionFileScope, sink?: ImageSink): Partial<Pick<ToolCall, "files" | "summary" | "input">> {
  if (name !== "SendUserFile") return {};
  const files = sessionFiles(input.files, scope, sink);
  const caption = typeof input.caption === "string" ? input.caption.slice(0, 400) : "";
  return { files, summary: [...files.map(file => file.name), caption].filter(Boolean).join(", "), input: JSON.stringify({ files: files.map(file => file.name), ...(caption ? { caption } : {}) }, null, 2) };
}
export function fileImages(files: readonly SessionFile[]): ImagePart[] {
  return files.filter(file => file.status === "ready" && MIME.has(file.mediaType)).map(file => ({ type: "image", mediaType: file.mediaType, blob: file.blob! }));
}

/** Original inline image bytes are retained; referenced files use the same session boundary. */
export function messageContent(content: unknown, sink?: ImageSink, scope?: SessionFileScope): { text: string; images: ImagePart[]; files: SessionFile[] } {
  const texts: string[] = [], images: ImagePart[] = [], references: string[] = [];
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  for (const value of blocks) {
    const block = object(value);
    if (block?.type === "text" && typeof block.text === "string") {
      const stripped = block.text.replace(/\[Image: source: ([^\]\r\n]+)\]/g, (_match, file: string) => {
        if (references.length < ATTACHMENT_COUNT) references.push(file.trim());
        return "";
      });
      if (stripped) texts.push(stripped);
    }
    if (block?.type !== "image") continue;
    const source = object(block.source);
    const mediaType = typeof source?.media_type === "string" && MIME.has(source.media_type) ? source.media_type : "image/png";
    const part: ImagePart = { type: "image", mediaType };
    if (source?.type === "base64" && typeof source.data === "string" && MIME.has(String(source.media_type)) &&
        source.data.length <= Math.ceil(ATTACHMENT_CAP / 3) * 4 && source.data.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(source.data) && !/=/.test(source.data.slice(0, -2)) && /[A-Za-z0-9+/](?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]=|==)$/.test(source.data) && source.data && sink) {
      part.blob = sink(source.data);
    }
    images.push(part);
  }
  const files = sessionFiles(references, scope ?? { cwd: "" }, sink);
  images.push(...fileImages(files));
  return { text: texts.join("\n\n"), images, files };
}

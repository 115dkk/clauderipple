import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventLog } from "../src/eventlog.ts";
import { attachmentContent, messageContent, sessionFiles, sessionFileTool } from "../src/images.ts";
import { transcriptEvents } from "../src/desktop.ts";
import { summarize } from "../src/sessions.ts";
import { ATTACHMENT_CAP, ATTACHMENT_COUNT, SESSION_FILE_NAME, SESSION_FILE_TOTAL } from "../src/protocol.ts";
import { reduce, timelineItems } from "../web/timeline.ts";
import { fileSymlinks, needsPosixModes } from "../../../test/capabilities.ts";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const data = png.toString("base64");
const image = { type: "image", source: { type: "base64", media_type: "image/png", data } };
function directory(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-files-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return fs.realpathSync(dir);
}
function fixture(t: TestContext) {
  const cwd = directory(t), dir = directory(t);
  const log = EventLog.open({ dir });
  t.after(() => log.close());
  const sink = (value: string) => log.image(value);
  return { cwd, dir, log, sink };
}

test("desktop image-only user, assistant and tool results become blob-backed image parts", t => {
  const { cwd, log, sink } = fixture(t);
  for (const type of ["user", "assistant"]) {
    const result = transcriptEvents(JSON.stringify({ type, uuid: type, message: { content: [image] } }), cwd, () => "", sink);
    assert.equal(result.bodies.length, 1);
    const event = log.append(result.bodies[0]!);
    assert.ok(event.kind === "user" || event.kind === "assistant");
    assert.equal(event.text, "");
    assert.equal(event.images?.[0]?.mediaType, "image/png");
    assert.equal(log.blob(event.images![0]!.blob!), data);
    assert.equal(timelineItems(reduce([event])).length, 1);
  }
  const result = transcriptEvents(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read", content: [image] }] } }), cwd, () => "", sink);
  assert.equal(result.bodies[0]?.kind, "tool_result");
  assert.equal(log.blob(result.bodies[0]!.images![0]!.blob!), data);
  assert.deepEqual(messageContent([null, { type: "image", source: { type: "url", url: "https://invalid" } }]).images, [{ type: "image", mediaType: "image/png" }]);
});

test("session files reject outside roots, traversal, broad roots, directories and symlinks", t => {
  const { cwd, sink } = fixture(t), outside = directory(t);
  fs.writeFileSync(path.join(cwd, "safe.png"), png);
  fs.writeFileSync(path.join(outside, "outside.png"), png);
  fs.mkdirSync(path.join(cwd, "folder"));
  const list = [path.join(outside, "outside.png"), "../outside.png", "folder/../safe.png", "folder", "missing.png", 7];
  const files = sessionFiles(list, { cwd }, sink);
  assert.deepEqual(files.map(file => file.status), ["blocked", "blocked", "blocked", "blocked", "missing", "blocked"]);
  assert.ok(files.every(file => !file.blob));
  for (const root of [os.tmpdir(), fs.realpathSync(os.tmpdir()), os.homedir(), path.parse(cwd).root]) {
    assert.equal(sessionFiles([path.join(cwd, "safe.png")], { cwd: root }, sink)[0]?.status, "blocked");
  }
  if (!fileSymlinks) return;
  fs.symlinkSync(path.join(cwd, "safe.png"), path.join(cwd, "link.png"));
  fs.symlinkSync(outside, path.join(cwd, "linked"));
  assert.deepEqual(sessionFiles(["link.png", "linked/outside.png"], { cwd }, sink).map(file => file.status), ["blocked", "blocked"]);
});

test("only host metadata can authorize an additional folder or an exact scratchpad", t => {
  const { cwd, sink } = fixture(t), additional = directory(t), scratchpad = directory(t);
  const a = path.join(additional, "추가.txt"), s = path.join(scratchpad, "결과.txt");
  fs.writeFileSync(a, "추가 작업 폴더"); fs.writeFileSync(s, "확인된 세션 scratchpad");
  assert.deepEqual(sessionFiles([a, s], { cwd }, sink).map(file => file.status), ["blocked", "blocked"]);
  assert.deepEqual(sessionFiles([a, s], { cwd, additionalDirectories: [additional], scratchpad }, sink).map(file => file.status), ["ready", "ready"]);
  const forged = sessionFileTool("SendUserFile", { files: [s], cwd: scratchpad, additionalDirectories: [scratchpad], scratchpad_dir: scratchpad }, { cwd }, sink);
  assert.equal(forged.files?.[0]?.status, "blocked");
  assert.ok(typeof forged.input === "string" && !forged.input.includes(scratchpad));
});

test("image references use the same session boundary, never all of .claude or a temp cache", t => {
  const { cwd, log, sink } = fixture(t), outside = directory(t);
  fs.writeFileSync(path.join(cwd, "안녕.png"), png);
  fs.writeFileSync(path.join(outside, "outside.png"), png);
  const converted = messageContent(`Before [Image: source: ${cwd}/안녕.png] after [Image: source: ${outside}/outside.png]`, sink, { cwd });
  assert.equal(converted.text, "Before  after ");
  assert.deepEqual(converted.files.map(file => file.status), ["ready", "blocked"]);
  assert.equal(converted.files[0]?.name, "안녕.png");
  assert.equal(log.blob(converted.images[0]!.blob!), data);
  assert.equal(converted.images.length, 1);
  assert.equal(messageContent(`[Image: source: ${cwd}/안녕.png]`, sink).files[0]?.status, "blocked");
});

test("secret names, credentials content and hard links are refused even when explicitly sent", t => {
  const { cwd, sink } = fixture(t);
  const names = [".env", ".env.production", "AuthKey.p8", "cert.pem", "release.jks", "key.key", "keys.p12", "token.json", "service-account.json", "google-services.json", "credentials", ".npmrc", "id_ed25519"];
  for (const name of names) fs.writeFileSync(path.join(cwd, name), "secret");
  for (const name of names) assert.equal(sessionFiles([name], { cwd }, sink)[0]?.status, "blocked", name);
  fs.writeFileSync(path.join(cwd, "innocent.txt"), '-----BEGIN PRIVATE KEY-----\nsecret');
  fs.writeFileSync(path.join(cwd, "config.json"), '{"access_token":"not-for-the-phone"}');
  assert.deepEqual(sessionFiles(["innocent.txt", "config.json"], { cwd }, sink).map(file => file.status), ["blocked", "blocked"]);
  fs.linkSync(path.join(cwd, ".env"), path.join(cwd, "copy.txt"));
  assert.equal(sessionFiles(["copy.txt"], { cwd }, sink)[0]?.status, "blocked");
});

test("per-file 8 MiB, per-call eight files and total 32 MiB bounds are inclusive", t => {
  const { cwd, log, sink } = fixture(t);
  fs.writeFileSync(path.join(cwd, "full.bin"), Buffer.alloc(ATTACHMENT_CAP));
  fs.writeFileSync(path.join(cwd, "large.bin"), Buffer.alloc(ATTACHMENT_CAP + 1));
  const files = sessionFiles(Array.from({ length: ATTACHMENT_COUNT + 1 }, () => "full.bin"), { cwd }, sink);
  assert.equal(files.length, ATTACHMENT_COUNT);
  assert.equal(files.filter(file => file.status === "ready").reduce((sum, file) => sum + file.bytes, 0), SESSION_FILE_TOTAL);
  assert.deepEqual(files.map(file => file.status), ["ready", "ready", "ready", "ready", "too_large", "too_large", "too_large", "too_large"]);
  assert.equal(Buffer.from(log.blob(files[0]!.blob!)!, "base64").length, ATTACHMENT_CAP);
  assert.equal(sessionFiles(["large.bin"], { cwd }, sink)[0]?.status, "too_large");
});

test("file MIME is sniffed, Korean names survive and source changes never change a published snapshot", t => {
  const { cwd, log, sink } = fixture(t);
  const samples = [
    { name: "그림.txt", data: png, mime: "image/png" },
    { name: "가짜.png", data: Buffer.from("텍스트입니다"), mime: "text/plain" },
    { name: "보고서.bin", data: Buffer.from("%PDF-1.7\n"), mime: "application/pdf" },
    { name: "화면.txt", data: Buffer.from("<!doctype html><html><body>안녕</body></html>"), mime: "text/html" },
    { name: "안내.md", data: Buffer.from("# 안내\n\n내용"), mime: "text/markdown" },
  ];
  for (const item of samples) {
    fs.writeFileSync(path.join(cwd, item.name), item.data);
    const [file] = sessionFiles([item.name], { cwd }, sink);
    assert.equal(file?.name, item.name); assert.equal(file?.mediaType, item.mime); assert.equal(file?.status, "ready");
    fs.writeFileSync(path.join(cwd, item.name), "changed");
    assert.deepEqual(Buffer.from(log.blob(file!.blob!)!, "base64"), item.data);
    assert.ok(!JSON.stringify(file).includes(cwd));
  }
  const long = sessionFiles(["가".repeat(1000)], { cwd }, sink)[0]!;
  assert.ok(Array.from(long.name).length <= SESSION_FILE_NAME);
  assert.deepEqual(sessionFiles(null, { cwd }, sink), []);
});

test("replacement between path validation and open is blocked", { skip: !fileSymlinks }, t => {
  const { cwd, sink } = fixture(t), outside = directory(t);
  const folder = path.join(cwd, "out"); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "file.txt"), "safe");
  fs.writeFileSync(path.join(outside, "file.txt"), "outside");
  const open = fs.openSync;
  const mock = t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    if (String(args[0]) !== path.join(folder, "file.txt")) return open(...args);
    fs.renameSync(folder, folder + "-saved"); fs.symlinkSync(outside, folder);
    try { return open(...args); }
    finally { fs.unlinkSync(folder); fs.renameSync(folder + "-saved", folder); }
  });
  assert.equal(sessionFiles(["out/file.txt"], { cwd }, sink)[0]?.status, "blocked");
  mock.mock.restore();
});

test("same-handle writes during snapshot are blocked without losing the next file", t => {
  const { cwd, sink } = fixture(t);
  fs.writeFileSync(path.join(cwd, "race.txt"), "before"); fs.writeFileSync(path.join(cwd, "safe.txt"), "safe");
  const read = fs.readSync;
  let changed = false;
  const mock = t.mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    const n = read(...args);
    if (!changed) { changed = true; fs.writeFileSync(path.join(cwd, "race.txt"), "after!"); }
    return n;
  });
  assert.deepEqual(sessionFiles(["race.txt", "safe.txt"], { cwd }, sink).map(file => file.status), ["blocked", "ready"]);
  mock.mock.restore();
});

test("desktop SendUserFile cards keep safe files, blocked statuses and the rest of the event", t => {
  const { cwd, log, sink } = fixture(t), outside = directory(t);
  fs.writeFileSync(path.join(cwd, "안내.txt"), "안내"); fs.writeFileSync(path.join(cwd, "shot.png"), png);
  const content = [
    { type: "text", text: "파일을 확인해 주세요." },
    { type: "tool_use", id: "files", name: "SendUserFile", input: { files: ["안내.txt", "shot.png", path.join(outside, "private.txt")], caption: "결과" } },
    { type: "tool_use", id: "other", name: "Read", input: { file_path: "README.md" } },
  ];
  const parsed = transcriptEvents(JSON.stringify({ type: "assistant", uuid: "a1", message: { content } }), cwd, summarize, sink);
  assert.equal(parsed.bodies.length, 1);
  const event = log.append(parsed.bodies[0]!);
  assert.ok(event.kind === "assistant");
  assert.equal(event.text, "파일을 확인해 주세요."); assert.equal(event.tools.length, 2);
  assert.deepEqual(event.tools[0]?.files?.map(file => file.status), ["ready", "ready", "blocked"]);
  assert.equal(event.tools[0]?.summary, "안내.txt, shot.png, private.txt, 결과");
  assert.ok(!event.tools[0]?.input?.toString().includes(outside));
  assert.equal(log.blob(event.images![0]!.blob!), data);
  const failed = transcriptEvents(JSON.stringify({ type: "assistant", message: { content } }), cwd, summarize, () => { throw new Error("disk unavailable"); });
  assert.ok(failed.bodies[0]?.kind === "assistant");
  assert.equal(failed.bodies[0].text, "파일을 확인해 주세요.");
  assert.deepEqual(failed.bodies[0].tools[0]?.files?.map(file => file.status), ["blocked", "blocked", "blocked"]);
});

test("an attachment-only refused assistant record still reaches the timeline", t => {
  const { cwd, sink } = fixture(t);
  const parsed = transcriptEvents(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "[Image: source: /outside/no.png]" }] } }), cwd, summarize, sink);
  assert.equal(parsed.bodies.length, 1);
  assert.equal(parsed.bodies[0]?.files?.[0]?.status, "blocked");
  assert.equal(parsed.bodies[0]?.kind, "assistant");
});

test("shared timeline preserves files on users, answers and tool results through final snapshots", t => {
  const { cwd, log, sink } = fixture(t);
  fs.writeFileSync(path.join(cwd, "파일.txt"), "파일");
  const files = sessionFiles(["파일.txt"], { cwd }, sink);
  const events = [
    log.append({ kind: "user", text: "", clientMsgId: "user", files }),
    log.append({ kind: "assistant", msg: "answer", model: "test", text: "", files, tools: [{ id: "tool", name: "SendUserFile", summary: "파일.txt", files }] }),
    log.append({ kind: "tool_result", toolUseId: "tool", ok: true, text: "", files }),
    log.append({ kind: "assistant", msg: "answer", model: "test", text: "", files, tools: [{ id: "tool", name: "SendUserFile", summary: "파일.txt", files }] }),
  ];
  const view = reduce(events);
  const user = view.items.find(item => item.type === "user");
  const assistant = view.items.find(item => item.type === "assistant");
  assert.ok(user?.type === "user" && assistant?.type === "assistant");
  assert.deepEqual(user.files, files); assert.deepEqual(assistant.files, files);
  assert.deepEqual(assistant.tools[0]?.files, files); assert.deepEqual(assistant.tools[0]?.result?.files, files);
  assert.ok(timelineItems(view).some(item => item.type === "assistant" && item.files?.length === 1));
  const withWidget = reduce([...events, log.append({ kind: "assistant", msg: "widget", model: "test", text: "", files, tools: [{ id: "w", name: "show_widget", summary: "widget" }] })]);
  const rows = timelineItems(withWidget).filter(item => item.type === "assistant" && item.key.startsWith("awidget"));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(item => item.type === "assistant" && item.files?.length).length, 1, "widget clones must not duplicate file cards");
});

test("the attachment folder is created 0700, not 0755", { skip: needsPosixModes }, t => {
  const cwd = directory(t);
  attachmentContent(cwd, "see attached", [{ blob: "b1", name: "note.txt", mediaType: "text/plain" }], () => Buffer.from("hello").toString("base64"));
  assert.equal(fs.statSync(path.join(cwd, ".ripple-attachments")).mode & 0o777, 0o700);
});

test("summarize names a SendUserFile's files and caption without a caption, and blank input is empty", t => {
  const cwd = directory(t);
  assert.equal(summarize("SendUserFile", { files: ["a.png", path.join(cwd, "b.jpg")], caption: "before vs after" }, cwd), "a.png, b.jpg, before vs after");
  assert.equal(summarize("SendUserFile", { files: ["only.gif"], status: "proactive" }, cwd), "only.gif");
  assert.equal(summarize("SendUserFile", {}, cwd), "");
});

// The router owns persistence, not the mod's schema. normalizeSettings stays in
// packages/mod; unknown non-secret fields survive a round trip unchanged.
import fs from "node:fs";
import path from "node:path";
import { homeDir } from "./config.ts";
import { withFileLock, writeJsonAtomic } from "./locked-file.ts";

export const MAX_MOD_SETTINGS_BYTES = 64 * 1024;
export type ModSettingsSnapshot = { settings: Record<string, unknown> | null; revision: number };

export class ModSettingsInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A field that holds a credential: its last word is key, token, secret, password or the like
 * (`apiKey`, `access_token`, `typesafeKey`). The last word decides, so a count such as
 * `keepWarmMinTokens` — a setting the mod has — is not mistaken for one.
 */
function isSecretName(key: string): boolean {
  const last = key.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).at(-1)?.toLowerCase() ?? "";
  return ["key", "apikey", "token", "secret", "password", "passwd", "authorization", "credential", "credentials", "bearer"].includes(last);
}

/** Iterative traversal also checks objects nested in arrays, without a recursion limit. */
function hasSecretKey(settings: Record<string, unknown>): boolean {
  const pending: unknown[] = [settings];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) pending.push(...value);
    else if (object(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (isSecretName(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

function validateSettings(settings: unknown): asserts settings is Record<string, unknown> {
  if (!object(settings)) throw new ModSettingsInputError("settings must be a JSON object");
  if (Buffer.byteLength(JSON.stringify(settings), "utf8") > MAX_MOD_SETTINGS_BYTES) throw new ModSettingsInputError("settings exceeds 64 KiB", 413);
  if (hasSecretKey(settings)) throw new ModSettingsInputError("settings must not contain credential fields (key, token, secret, password)");
}

export function readModSettings(home = homeDir()): ModSettingsSnapshot {
  let text: string;
  try { text = fs.readFileSync(path.join(home, "mod-settings.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: null, revision: 0 };
    throw error;
  }
  // Corruption is not an empty store: fail rather than silently overwrite it.
  const stored: unknown = JSON.parse(text);
  if (!object(stored) || !revision(stored.revision) || stored.revision < 1) throw new Error("invalid mod settings store");
  validateSettings(stored.settings);
  return { settings: stored.settings, revision: stored.revision };
}

export type ModSettingsWrite = { stale: boolean; current: ModSettingsSnapshot };

/** Compare-and-swap and revision increment share the account stores' cross-process lock. */
export function writeModSettings(body: unknown, home = homeDir()): ModSettingsWrite {
  if (!object(body)) throw new ModSettingsInputError("body must be a JSON object");
  validateSettings(body.settings);
  if (body.revision !== undefined && !revision(body.revision)) throw new ModSettingsInputError("revision must be a non-negative safe integer");
  const settings = body.settings;
  const expected = body.revision;
  const file = path.join(home, "mod-settings.json");
  return withFileLock(file, () => {
    const current = readModSettings(home);
    if (expected !== undefined && expected !== current.revision) return { stale: true, current };
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("mod settings revision exhausted");
    const next = { settings, revision: current.revision + 1 };
    writeJsonAtomic(file, next);
    return { stale: false, current: next };
  });
}

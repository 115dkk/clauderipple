// The client settings ClaudeRipple writes outside its home directory: the Claude Desktop proxy and
// picker flag, the Codex CLI provider, and the CA trust. Uninstall removes them before --purge
// takes the CA and config.json they are found by.

import fs from "node:fs";
import path from "node:path";
import { configPath } from "../../router/src/config.ts";
import { certPaths } from "./certs.ts";
import { codexOff } from "./codex.ts";
import { removeAppProxy, untrustCa } from "./picker.ts";
import { defaultAgentDir, removeGeneratedAgentFiles } from "../../router/src/agents.ts";
import { setAgentTitleHook, setStatusMod } from "./settings.ts";
import { runtime } from "./runtime.ts";

export function setPickerEnabled(enabled: boolean, file = configPath()): void {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  raw.picker = { ...((raw.picker as Record<string, unknown> | undefined) ?? {}), enabled };
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
}

/** Best effort: one step that fails (a declined trust-removal dialog, say) does not stop the rest. */
export function removeClientIntegrations(home: string, removeTrust: (caPem: string) => boolean = untrustCa, opts: { modDir?: string; agentDir?: string } = {}): boolean {
  const rt = runtime();
  const steps: [string, () => unknown][] = [
    ["the status mod", () => {
      setStatusMod(false, opts.modDir ?? rt.modDir);
      setStatusMod(false, path.join(home, "mod"));
    }],
    ["the agent-title hook", () => setAgentTitleHook(false, { node: rt.node, script: rt.hookScript })],
    ["generated worker files", () => removeGeneratedAgentFiles(opts.agentDir ?? defaultAgentDir(), path.join(home, "generated-agents.json"))],
    ["the Claude Desktop proxy", removeAppProxy],
    ["the picker setting", () => {
      const file = path.join(home, "config.json");
      if (fs.existsSync(file)) setPickerEnabled(false, file);
    }],
    ["the Codex CLI provider", () => codexOff()],
    ["the CA trust", () => removeTrust(certPaths(home).caPem)],
  ];
  let ok = true;
  for (const [name, remove] of steps) {
    try {
      remove();
    } catch (e) {
      ok = false;
      console.log(`  could not remove ${name}: ${(e as Error).message}`);
    }
  }
  return ok;
}

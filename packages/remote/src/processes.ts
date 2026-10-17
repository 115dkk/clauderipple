// One OS process snapshot for transcript liveness. Desktop registry identity remains macOS-only.
import { execFileSync } from "node:child_process";
import { windowsPowerShellEnv } from "../../cli/src/windows-powershell.ts";
export interface ProcessInfo { pid: number; command: string; started?: string }
export type ProcessExec = (file: string, args: string[]) => string;
export function listProcesses(platform = process.platform, exec: ProcessExec = (file, args) => execFileSync(file, args, {
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 5000, windowsHide: true, env: windowsPowerShellEnv(), stdio: ["ignore", "pipe", "pipe"],
})): ProcessInfo[] {
  if (platform === "win32") {
    const raw: unknown = JSON.parse(exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine,@{Name='CreationDate';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')}}})"]));
    if (!Array.isArray(raw)) throw new Error("invalid Windows process snapshot");
    return raw.flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const p = value as Record<string, unknown>;
      return typeof p.ProcessId === "number" && typeof p.CommandLine === "string"
        ? [{ pid: p.ProcessId, command: p.CommandLine, ...(typeof p.CreationDate === "string" ? { started: p.CreationDate } : {}) }] : [];
    });
  }
  return exec("ps", ["-axo", "pid,command"]).split(/\r?\n/).flatMap(line => {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    return m ? [{ pid: Number(m[1]), command: m[2]! }] : [];
  });
}
export function processCommands(): string { return listProcesses().map(p => `${p.pid} ${p.command}`).join("\n"); }

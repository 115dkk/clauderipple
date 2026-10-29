import os from "node:os";

export type ProcessPriorityDeps = {
  platform?: NodeJS.Platform;
  getPriority?: () => number;
  setPriority?: (priority: number) => void;
  log?: (line: string) => void;
};

/**
 * A scheduled task registered without a priority runs at Task Scheduler's default 7, which is
 * BELOW_NORMAL, and the launcher's children inherit it. On 2026-10-29, with cargo and rustc holding
 * every core at Normal, the router took 1-3 s to answer /api/status and refused new connections
 * (a full accept queue), so an update's final probe failed. The task and the launcher now ask for
 * Normal; this covers a router started from an older registration or launcher. Never above Normal,
 * and only on Windows: raising a priority elsewhere needs privileges.
 */
export function raiseWindowsProcessPriority(deps: ProcessPriorityDeps = {}): void {
  if ((deps.platform ?? process.platform) !== "win32") return;
  const log = deps.log ?? (() => {});
  try {
    const priority = (deps.getPriority ?? (() => os.getPriority()))();
    if (priority <= os.constants.priority.PRIORITY_NORMAL) return;
    (deps.setPriority ?? ((value) => os.setPriority(value)))(os.constants.priority.PRIORITY_NORMAL);
    log(`process priority: raised itself from below normal (${priority}) to normal`);
  } catch (error) {
    log(`process priority: failed to raise itself to normal: ${error instanceof Error ? error.message : String(error)}`);
  }
}

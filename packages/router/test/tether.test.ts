import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type os from "node:os";
import {
  classifyJoin, classifyNetwork, DISASSOCIATE_JS, isHotspotAddress, nextReturnPoint, parseWifiDevice, ProbeWindow, probeRound,
  RETURN_DRAIN_WAIT_MS, RETURN_FORCE_AFTER_MS, TetherController, wifiIPv4, type ProbeGet,
} from "../src/tether.ts";
import type { Activity, RunResult } from "../src/awake.ts";
import { HoldGate } from "../src/hold.ts";
import { ConfigStore, DEFAULTS, TETHER_DEFAULTS, tetherSettings, validate, type TetherSettings } from "../src/config.ts";

// `networksetup -listallhardwareports` measured on this project's Mac (2026-10-20), shortened.
const PORTS = `
Hardware Port: Ethernet Adapter (en3)
Device: en3
Ethernet Address: 76:96:15:5c:73:5c

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: 36:1c:58:21:90:80

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: c0:c7:db:32:f6:de

Hardware Port: Thunderbolt 1
Device: en1
Ethernet Address: 36:1c:58:21:90:80

VLAN Configurations
===================
`;

test("the Wi-Fi device is read from the hardware ports", () => {
  assert.equal(parseWifiDevice(PORTS), "en0");
  assert.equal(parseWifiDevice(PORTS.replace("Device: en0", "Device: en1").replace("Hardware Port: Thunderbolt 1\nDevice: en1", "Hardware Port: Thunderbolt 1\nDevice: en9")), "en1");
  assert.equal(parseWifiDevice("Hardware Port: Ethernet\nDevice: en0\n"), null);
});

test("hotspot subnet: 172.20.10.0/28 only", () => {
  for (const ip of ["172.20.10.2", "172.20.10.14", "172.20.10.15", "172.20.10.0"]) assert.equal(isHotspotAddress(ip), true, ip);
  for (const ip of ["172.20.10.16", "172.20.100.2", "192.168.219.51", "10.0.0.2"]) assert.equal(isHotspotAddress(ip), false, ip);
  assert.equal(isHotspotAddress(null), false);
  assert.equal(classifyNetwork(null), "none");
  assert.equal(classifyNetwork("172.20.10.3"), "hotspot");
  assert.equal(classifyNetwork("192.168.1.4"), "wifi");
});

const iface = (address: string, family: "IPv4" | "IPv6" = "IPv4"): os.NetworkInterfaceInfo =>
  ({ address, family, internal: false, netmask: "", mac: "", cidr: null, ...(family === "IPv6" ? { scopeid: 0 } : {}) }) as os.NetworkInterfaceInfo;

test("the Wi-Fi IPv4 ignores IPv6 and other interfaces", () => {
  assert.equal(wifiIPv4({ en0: [iface("fe80::1", "IPv6"), iface("192.168.1.4")], en3: [iface("10.0.0.2")] }, "en0"), "192.168.1.4");
  assert.equal(wifiIPv4({ en0: [iface("fe80::1", "IPv6")] }, "en0"), null);
  assert.equal(wifiIPv4({}, "en0"), null);
});

test("probe window: blips are ignored, 3 failures of the last 5 is an outage", () => {
  const w = new ProbeWindow();
  for (const ok of [false, true, true, false, true]) w.push(ok);
  assert.equal(w.outage(), false);
  w.push(false); // window: T T F T F → 2 failures
  assert.equal(w.outage(), false);
  w.push(false); // T F T F F → 3
  assert.equal(w.outage(), true);
  w.reset();
  assert.equal(w.outage(), false);
});

test("a probe round needs either endpoint's exact answer, bound to the given address", async () => {
  const seen: string[] = [];
  const get = (apple: { status: number; body: string } | Error, google: { status: number; body: string } | Error): ProbeGet => async (url, local, timeout) => {
    seen.push(`${local} ${timeout}`);
    const r = url.includes("apple") ? apple : google;
    if (r instanceof Error) throw r;
    return r;
  };
  const down = new Error("ETIMEDOUT");
  assert.equal(await probeRound("192.168.1.4", get({ status: 200, body: "<HTML>Success</HTML>" }, down)), true);
  assert.equal(await probeRound("192.168.1.4", get(down, { status: 204, body: "" })), true);
  assert.equal(await probeRound("192.168.1.4", get(down, down)), false);
  // A captive portal answers 200 with its own page, and rewrites the 204 into one.
  assert.equal(await probeRound("192.168.1.4", get({ status: 200, body: "<html>Log in</html>" }, { status: 200, body: "login" })), false);
  assert.ok(seen.every((s) => s === "192.168.1.4 4000"));
});

test("networksetup's join output decides the outcome, whatever its exit code", () => {
  assert.equal(classifyJoin({ code: 0, stdout: "", stderr: "" }), null);
  assert.equal(classifyJoin({ code: 0, stdout: "Could not find network PBJ.\n", stderr: "" }), "hotspot-not-visible");
  assert.equal(classifyJoin({ code: 0, stdout: "Failed to join network PBJ.\nError: -3900  The operation couldn’t be completed.\n", stderr: "" }), "join-failed");
  assert.equal(classifyJoin({ code: 1, stdout: "", stderr: "sudo: a password is required\n" }), "needs-setup");
  assert.equal(classifyJoin({ code: 1, stdout: "", stderr: "Sorry, user pbj is not allowed to execute '/usr/sbin/networksetup -setairportnetwork en0 Other' as root\n" }), "needs-setup");
});

test("the disassociate call is wifihop's exact JXA", () => {
  assert.equal(DISASSOCIATE_JS, 'ObjC.import("CoreWLAN"); $.CWWiFiClient.sharedWiFiClient.interface.disassociate; "ok";');
});

test("a config that still carries tether.returnEverySec loads without error and the key is ignored", () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cr-tether-cfg-"));
  try {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, JSON.stringify({ tether: { enabled: true, hotspotSsid: "PBJ", probeEverySec: 10, returnEverySec: 180 } }));
    let errors: string[] = ["not called"];
    const cfg = new ConfigStore(file, (_c, e) => { errors = e; }).get();
    assert.deepEqual(errors, [], "an extra key is not refused");
    assert.equal(cfg.tether?.enabled, true);
    const s = tetherSettings(cfg);
    assert.deepEqual(s, { enabled: true, hotspotSsid: "PBJ", probeEverySec: 10 });
    assert.equal("returnEverySec" in s, false, "the key is dropped, not carried");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Controller with a fake Mac and a fake network ----------------------------------------------

type Net = { ip: string | null; probeOk: (ip: string) => boolean; joinOutput: { code: number; stdout: string; stderr: string }; joinLandsOn: string | null; disassociateLandsOn: string | null };

function rig(o: { settings?: Partial<TetherSettings>; net?: Partial<Net>; activity?: () => Activity; platform?: NodeJS.Platform; hold?: HoldGate; onLeave?: () => void } = {}) {
  const clock = { t: 1_000_000 };
  const calls: string[] = [];
  const lines: string[] = [];
  const net: Net = {
    ip: "192.168.1.4",
    probeOk: () => true,
    joinOutput: { code: 0, stdout: "", stderr: "" },
    joinLandsOn: "172.20.10.2",
    disassociateLandsOn: "172.20.10.2",
    ...o.net,
  };
  let settings: TetherSettings = { ...TETHER_DEFAULTS, enabled: true, hotspotSsid: "PBJ", ...o.settings };
  const run = async (file: string, args: string[]): Promise<RunResult> => {
    const line = [file, ...args].join(" ");
    calls.push(line);
    if (line === "/usr/sbin/networksetup -listallhardwareports") return { code: 0, stdout: PORTS, stderr: "" };
    if (line.startsWith("/usr/bin/sudo -n /usr/sbin/networksetup -setairportnetwork en0 ")) {
      if (!classifyJoin(net.joinOutput)) net.ip = net.joinLandsOn;
      return net.joinOutput;
    }
    if (line.startsWith("/usr/bin/osascript -l JavaScript -e ")) {
      o.onLeave?.();
      net.ip = net.disassociateLandsOn;
      return { code: 0, stdout: "ok\n", stderr: "" };
    }
    throw new Error(`unexpected command: ${line}`);
  };
  const c = new TetherController({
    platform: o.platform ?? "darwin",
    run,
    settings: () => settings,
    activity: o.activity ?? (() => ({ inFlight: 0 })),
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`) },
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    interfaces: () => (net.ip ? { en0: [iface(net.ip)] } : {}),
    probe: async (ip) => net.probeOk(ip),
    schedule: () => () => {},
    ...(o.hold ? { hold: o.hold } : {}),
  });
  /** One tick every probeEverySec, like the real loop. */
  const ticks = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await c.tick();
      clock.t += settings.probeEverySec * 1000;
    }
  };
  const joins = () => calls.filter((l) => l.includes("-setairportnetwork")).length;
  const returns = () => calls.filter((l) => l.startsWith("/usr/bin/osascript")).length;
  return { c, clock, calls, lines, net, ticks, joins, returns, set: (s: Partial<TetherSettings>) => (settings = { ...settings, ...s }) };
}

test("on Linux, or disabled: no command and no probe", async () => {
  const a = rig({ platform: "linux" });
  a.c.start();
  await a.ticks(5);
  assert.deepEqual(a.calls, []);
  assert.equal(a.c.status().state, "unsupported");
  const b = rig({ settings: { enabled: false } });
  await b.ticks(5);
  assert.deepEqual(b.calls, []);
  assert.equal(b.c.status().state, "off");
});

test("blips never switch: two failures in any five rounds", async () => {
  const pattern = [false, true, true, false, true, true, false, true, true, false, true, true];
  let i = 0;
  const r = rig({ net: { probeOk: () => pattern[i++ % pattern.length]! } });
  await r.ticks(pattern.length);
  assert.equal(r.joins(), 0);
  assert.equal(r.c.status().state, "watching");
});

test("Wi-Fi up without internet: the third failure joins the hotspot by name through sudo -n", async () => {
  const r = rig({ net: { probeOk: (ip) => isHotspotAddress(ip) } });
  await r.ticks(2);
  assert.equal(r.joins(), 0);
  await r.ticks(1);
  assert.equal(r.joins(), 1);
  assert.ok(r.calls.includes("/usr/bin/sudo -n /usr/sbin/networksetup -setairportnetwork en0 PBJ"));
  const s = r.c.status();
  assert.equal(s.state, "on-hotspot");
  assert.equal(s.network, "hotspot");
  assert.equal(s.lastSwitch?.to, "hotspot");
  assert.equal(s.lastSwitch?.ok, true);
  assert.ok(r.lines.some((l) => /no internet .*joining hotspot "PBJ"/.test(l)), "the decision is logged with its reason");
});

test("a hotspot that is not broadcasting says so, with the hint, and retries at most once a minute", async () => {
  const r = rig({ net: { probeOk: () => false, joinOutput: { code: 0, stdout: "Could not find network PBJ.\n", stderr: "" } } });
  await r.ticks(3);
  assert.equal(r.joins(), 1);
  let s = r.c.status();
  assert.equal(s.state, "hotspot-not-visible");
  assert.match(s.hint ?? "", /Personal Hotspot on the iPhone/);
  await r.ticks(5); // 50s more: still inside the minute
  assert.equal(r.joins(), 1);
  s = r.c.status();
  assert.equal(s.state, "hotspot-not-visible", "the reason and hint stay until the next attempt");
  await r.ticks(2);
  assert.equal(r.joins(), 2);
});

test("sudo refusing the join reads as needs-setup", async () => {
  const r = rig({ net: { probeOk: () => false, joinOutput: { code: 1, stdout: "", stderr: "sudo: a password is required\n" } } });
  await r.ticks(3);
  assert.equal(r.c.status().state, "needs-setup");
  assert.match(r.c.status().hint ?? "", /awake setup --ssid/);
});

test("no hotspot name: an outage is reported, nothing is run", async () => {
  const r = rig({ settings: { hotspotSsid: "" }, net: { probeOk: () => false } });
  await r.ticks(4);
  assert.equal(r.joins(), 0);
  assert.equal(r.c.status().state, "no-hotspot-ssid");
});

test("failover waits for a running call, but at most 30s", async () => {
  const r = rig({ net: { probeOk: (ip) => isHotspotAddress(ip) }, activity: () => ({ inFlight: 1, lastStartedAt: 0 }) });
  await r.ticks(2);
  const before = r.clock.t;
  await r.c.tick();
  assert.equal(r.joins(), 1);
  assert.ok(r.clock.t - before >= 30_000 && r.clock.t - before < 32_000, `waited ${r.clock.t - before}ms`);
});

test("the schedule is 5, 10, 20, 30, 40, 50 and 60 minutes after landing, then every 10", () => {
  const landed = 1_000_000;
  const at = (minutes: number) => landed + minutes * 60_000;
  const gap = 60_000;
  assert.equal(nextReturnPoint(landed, landed, gap), at(5));
  assert.equal(nextReturnPoint(landed, at(5), gap), at(10));
  assert.equal(nextReturnPoint(landed, at(10), gap), at(20));
  assert.equal(nextReturnPoint(landed, at(20), gap), at(30));
  assert.equal(nextReturnPoint(landed, at(30), gap), at(40));
  assert.equal(nextReturnPoint(landed, at(50), gap), at(60));
  assert.equal(nextReturnPoint(landed, at(60), gap), at(70));
  assert.equal(nextReturnPoint(landed, at(70), gap), at(80));
  assert.equal(nextReturnPoint(landed, at(600), gap), at(610));
  // A point at or past `now` is skipped: the next one, at least MIN_SWITCH_INTERVAL_MS out.
  assert.equal(nextReturnPoint(landed, at(5) + 1, 0), at(10));
  assert.equal(nextReturnPoint(landed, at(9) + 59_000, 60_000), at(20), "a 60s floor pushes past the 10 min point");
});

test("the way back: 5 minutes after landing, idle, disassociate and keep the Wi-Fi macOS joins if it works", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4" } });
  await r.ticks(1);
  assert.equal(r.c.status().state, "on-hotspot");
  await r.ticks(29); // 290s: not yet
  assert.equal(r.returns(), 0);
  await r.ticks(1);
  assert.equal(r.returns(), 1);
  assert.ok(r.calls.includes(`/usr/bin/osascript -l JavaScript -e ${DISASSOCIATE_JS}`));
  const s = r.c.status();
  assert.equal(s.network, "wifi");
  assert.equal(s.state, "watching");
  assert.equal(s.lastSwitch?.to, "wifi");
  assert.equal(s.lastSwitch?.ok, true);
  assert.equal(r.joins(), 0);
});

test("the way back waits while a model call runs or one started in the last 20s", async () => {
  let activity: Activity = { inFlight: 1 };
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4" }, activity: () => activity });
  await r.ticks(31); // 300s: due, but a call is running
  assert.equal(r.returns(), 0);
  activity = { inFlight: 0, lastStartedAt: r.clock.t - 5_000 };
  await r.ticks(1);
  assert.equal(r.returns(), 0);
  activity = { inFlight: 0, lastStartedAt: r.clock.t - 25_000 };
  await r.ticks(1);
  assert.equal(r.returns(), 1);
});

test("no better network: stay on the hotspot and try at the fixed points 5, 10, 20, 30, 40, 50 and 60 min, then every 10", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "172.20.10.2" } });
  await r.ticks(1);
  const attempted = () => r.calls.filter((l) => l.startsWith("/usr/bin/osascript")).length;
  const attemptsAt: number[] = [];
  for (let i = 0; i < 1000 && attemptsAt.length < 9; i++) {
    const n = r.returns();
    await r.ticks(1);
    if (r.returns() > n) attemptsAt.push(r.clock.t);
  }
  assert.equal(attemptsAt.length, 9, `attempts ${attemptsAt.length}, returns ${attempted()}`);
  const landed = 1_000_000;
  // Each attempt lands on a tick at the scheduled point (or up to one tick after), plus the ~20s
  // spent probing and the 10s tick step before the clock is read again.
  const points = [5, 10, 20, 30, 40, 50, 60, 70, 80].map((m) => m * 60_000);
  attemptsAt.forEach((t, i) => {
    const late = t - landed - points[i]!;
    assert.ok(late >= 0 && late < 31_000, `attempt ${i + 1} at +${(t - landed) / 1000}s, expected +${points[i]! / 1000}s (+0..30s)`);
  });
  assert.equal(r.joins(), 0, "macOS put us back on the hotspot itself");
  assert.equal(r.c.status().state, "on-hotspot");
});

test("a failed try does not double: each failure moves to the next scheduled point", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "172.20.10.2" } });
  await r.ticks(1);
  // 5 min point: attempt fails, next is the 10 min point (300s away), not 600s.
  await r.ticks(30);
  assert.equal(r.returns(), 1);
  assert.ok(r.lines.some((l) => /staying on the hotspot .*; next try in 2[0-9][0-9]s/.test(l)), r.lines.join("\n"));
});

test("leaving the hotspot for Wi-Fi resets the schedule: landing again starts at 5 min", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4" } });
  await r.ticks(31); // first return at the 5 min point
  assert.equal(r.returns(), 1);
  assert.equal(r.c.status().network, "wifi");
  // By hand (or another failover) back on the hotspot: the 5 min wait starts over.
  await r.ticks(60); // 10 more minutes on Wi-Fi
  assert.equal(r.returns(), 1);
  r.net.ip = "172.20.10.2";
  r.net.disassociateLandsOn = "192.168.1.4";
  await r.ticks(29);
  assert.equal(r.returns(), 1, "not yet: the schedule was reset by the landing");
  await r.ticks(2);
  assert.equal(r.returns(), 2);
});

test("the Wi-Fi macOS picks has no internet: rejoin the hotspot", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.50.7", probeOk: (ip) => isHotspotAddress(ip) } });
  await r.ticks(31);
  assert.equal(r.returns(), 1);
  assert.equal(r.joins(), 1);
  assert.equal(r.c.status().network, "hotspot");
  assert.equal(r.c.status().lastSwitch?.ok, false);
  assert.match(r.c.status().lastSwitch?.reason ?? "", /no internet/);
});

test("never more than one switch per minute: a fresh return is not followed by an instant failover", async () => {
  let wifiDead = false;
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4", probeOk: (ip) => isHotspotAddress(ip) || !wifiDead } });
  await r.ticks(31);
  assert.equal(r.returns(), 1);
  const back = r.clock.t;
  wifiDead = true;
  await r.ticks(3);
  assert.equal(r.joins(), 0, `still within a minute of the return (${(r.clock.t - back) / 1000}s)`);
  await r.ticks(4);
  assert.equal(r.joins(), 1);
});

test("a pinned network is never switched", async () => {
  const r = rig({ net: { probeOk: () => false } });
  r.c.setPin(true);
  await r.ticks(10);
  assert.equal(r.joins(), 0);
  assert.equal(r.c.status().state, "pinned");
  r.c.setPin(false);
  await r.ticks(3);
  assert.equal(r.joins(), 1);
});

// ---- Making a gap when calls never stop (2026-10-20: postponed from 19:22:54 until the hotspot went) ----

/** Calls run back-to-back until `quietAfterMs` after the gate engages; one new call arrives at the gate as it engages. */
function gapRig(o: { quietAfterMs: number; onLeave?: () => void; net?: Partial<Net>; onEngagedTick?: (sinceMs: number, r: ReturnType<typeof rig>) => void }) {
  const hold = new HoldGate();
  const events: string[] = [];
  let engagedAt: number | null = null;
  let held: Promise<unknown> = Promise.resolve();
  const r: ReturnType<typeof rig> = rig({
    hold,
    net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4", ...o.net },
    activity: () => {
      if (hold.engaged && engagedAt === null) {
        engagedAt = r.clock.t;
        events.push("engaged");
        held = hold.wait().then((h) => events.push(`held call goes ahead after ${h.timedOut ? "the longest hold" : "release"}`));
      }
      if (engagedAt !== null) o.onEngagedTick?.(r.clock.t - engagedAt, r);
      const busy = engagedAt === null || r.clock.t - engagedAt < o.quietAfterMs;
      return busy ? { inFlight: 1, lastStartedAt: r.clock.t } : { inFlight: 0, lastStartedAt: engagedAt! };
    },
    onLeave: () => {
      events.push(`leave (holding ${hold.waiting})`);
      o.onLeave?.();
    },
  });
  return { ...r, hold, events, held: () => held, engagedAt: () => engagedAt };
}

test("calls never stop: 2 min past due new calls are held, the running ones finish, the return runs, the hold is released", async () => {
  const r = gapRig({ quietAfterMs: 7_000 });
  // First tick plans the return at the 5 min point; 120s past that is 420s in.
  await r.ticks(42); // ticks at 0..410s
  assert.equal(r.events.length, 0, "inside the grace period nothing is held");
  assert.equal(r.returns(), 0);
  assert.ok(r.lines.some((l) => /Wi-Fi return postponed: a model call is running/.test(l)));
  await r.ticks(1); // 420s: 120s past due
  await r.held();
  assert.deepEqual(r.events, ["engaged", "leave (holding 1)", "held call goes ahead after release"]);
  assert.equal(r.engagedAt()! - 1_000_000, 300_000 + RETURN_FORCE_AFTER_MS);
  assert.equal(r.returns(), 1);
  assert.equal(r.hold.engaged, false);
  assert.equal(r.hold.waiting, 0);
  const s = r.c.status();
  assert.equal(s.network, "wifi");
  assert.equal(s.lastSwitch?.ok, true);
  const log = r.lines.join("\n");
  assert.match(log, /tether: Wi-Fi return postponed 120s past due while model calls keep running: holding new model calls to make a gap \(waiting up to 60s for 1 running\)/);
  assert.match(log, /tether: running model calls finished after 7s; 1 held/);
  assert.match(log, /tether: back on Wi-Fi with internet/);
  assert.match(log, /tether: hold released; 1 held model call going ahead/);
  assert.ok(log.indexOf("back on Wi-Fi") < log.indexOf("hold released"), "released after the return, not before");
});

test("calls that do not finish within the drain wait: release, back off to the next point, no switch", async () => {
  const r = gapRig({ quietAfterMs: Infinity });
  await r.ticks(42); // the 5 min point is due at 300s; 120s past it at 420s
  const before = r.clock.t;
  await r.c.tick();
  await r.held();
  const waited = r.clock.t - before;
  assert.ok(waited >= RETURN_DRAIN_WAIT_MS && waited < RETURN_DRAIN_WAIT_MS + 2_000, `waited ${waited}ms`);
  assert.deepEqual(r.events, ["engaged", "held call goes ahead after release"]);
  assert.equal(r.returns(), 0, "the hotspot was not left");
  assert.equal(r.hold.engaged, false);
  assert.equal(r.c.status().state, "on-hotspot");
  const log = r.lines.join("\n");
  // The drain ends at 480s, past the 5 min point, so the next is the 10 min point: 120s away.
  assert.match(log, /staying on the hotspot \(1 model call still running after 60s; held calls released\); next try in 120s/);
  assert.match(log, /hold released; 1 held model call going ahead/);
});

test("an error in the middle of the return still releases the hold", async () => {
  const r = gapRig({ quietAfterMs: 3_000, onLeave: () => { throw new Error("osascript exploded"); } });
  await r.ticks(43);
  await r.held();
  assert.deepEqual(r.events, ["engaged", "leave (holding 1)", "held call goes ahead after release"]);
  assert.equal(r.hold.engaged, false);
  assert.equal(r.hold.waiting, 0);
  assert.ok(r.lines.includes("WARN tether: osascript exploded"), r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /hold released; 1 held model call going ahead/.test(l)));
});

test("stop() while waiting for running calls releases the hold at once and gives the return up", async () => {
  let stopped = false;
  const r = gapRig({
    quietAfterMs: Infinity,
    onEngagedTick: (since, rr) => {
      if (since >= 5_000 && !stopped) {
        stopped = true;
        rr.c.stop();
      }
    },
  });
  await r.ticks(43);
  await r.held();
  assert.equal(r.hold.engaged, false);
  assert.deepEqual(r.events, ["engaged", "held call goes ahead after release"]);
  assert.equal(r.returns(), 0);
  assert.ok(r.lines.some((l) => /hold released \(the controller stopped\); 1 held model call going ahead/.test(l)), r.lines.join("\n"));
});

test("a draining router (closed gate) holds nothing: the return just stays postponed", async () => {
  const r = gapRig({ quietAfterMs: Infinity });
  r.hold.close();
  await r.ticks(60);
  assert.deepEqual(r.events, []);
  assert.equal(r.returns(), 0);
  assert.equal(r.c.status().state, "on-hotspot");
});

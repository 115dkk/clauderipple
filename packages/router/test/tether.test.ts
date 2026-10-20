import { test } from "node:test";
import assert from "node:assert/strict";
import type os from "node:os";
import {
  classifyJoin, classifyNetwork, DISASSOCIATE_JS, isHotspotAddress, MAX_RETURN_INTERVAL_MS, parseWifiDevice, ProbeWindow, probeRound,
  TetherController, wifiIPv4, type ProbeGet,
} from "../src/tether.ts";
import type { Activity, RunResult } from "../src/awake.ts";
import { TETHER_DEFAULTS, type TetherSettings } from "../src/config.ts";

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

// ---- Controller with a fake Mac and a fake network ----------------------------------------------

type Net = { ip: string | null; probeOk: (ip: string) => boolean; joinOutput: { code: number; stdout: string; stderr: string }; joinLandsOn: string | null; disassociateLandsOn: string | null };

function rig(o: { settings?: Partial<TetherSettings>; net?: Partial<Net>; activity?: () => Activity; platform?: NodeJS.Platform } = {}) {
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

test("off this Mac, or disabled: no command and no probe", async () => {
  const a = rig({ platform: "win32" });
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

test("the way back: after returnEverySec, idle, disassociate and keep the Wi-Fi macOS joins if it works", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4" } });
  await r.ticks(1);
  assert.equal(r.c.status().state, "on-hotspot");
  await r.ticks(17); // 170s: not yet
  assert.equal(r.returns(), 0);
  await r.ticks(2);
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
  await r.ticks(25);
  assert.equal(r.returns(), 0);
  activity = { inFlight: 0, lastStartedAt: r.clock.t - 5_000 };
  await r.ticks(1);
  assert.equal(r.returns(), 0);
  activity = { inFlight: 0, lastStartedAt: r.clock.t - 25_000 };
  await r.ticks(1);
  assert.equal(r.returns(), 1);
});

test("no better network: stay on the hotspot and back off 180s → 360s → 720s → 900s cap", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "172.20.10.2" } });
  await r.ticks(1);
  const attemptsAt: number[] = [];
  for (let i = 0; i < 400 && attemptsAt.length < 5; i++) {
    const n = r.returns();
    await r.ticks(1);
    if (r.returns() > n) attemptsAt.push(r.clock.t);
  }
  const gaps = attemptsAt.slice(1).map((t, i) => Math.round((t - attemptsAt[i]!) / 1000));
  // Each gap is the interval plus the 20s spent probing and the 10s tick granularity.
  assert.ok(gaps[0]! >= 360 && gaps[0]! < 400, `gaps ${gaps}`);
  assert.ok(gaps[1]! >= 720 && gaps[1]! < 760, `gaps ${gaps}`);
  assert.ok(gaps[2]! >= MAX_RETURN_INTERVAL_MS / 1000 && gaps[2]! < 940, `gaps ${gaps}`);
  assert.ok(gaps[3]! >= MAX_RETURN_INTERVAL_MS / 1000 && gaps[3]! < 940, `capped: ${gaps}`);
  assert.equal(r.joins(), 0, "macOS put us back on the hotspot itself");
  assert.equal(r.c.status().state, "on-hotspot");
});

test("the Wi-Fi macOS picks has no internet: rejoin the hotspot", async () => {
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.50.7", probeOk: (ip) => isHotspotAddress(ip) } });
  await r.ticks(20);
  assert.equal(r.returns(), 1);
  assert.equal(r.joins(), 1);
  assert.equal(r.c.status().network, "hotspot");
  assert.equal(r.c.status().lastSwitch?.ok, false);
  assert.match(r.c.status().lastSwitch?.reason ?? "", /no internet/);
});

test("never more than one switch per minute: a fresh return is not followed by an instant failover", async () => {
  let wifiDead = false;
  const r = rig({ net: { ip: "172.20.10.2", disassociateLandsOn: "192.168.1.4", probeOk: (ip) => isHotspotAddress(ip) || !wifiDead } });
  await r.ticks(20);
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

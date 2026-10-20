import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type os from "node:os";
import path from "node:path";
import {
  FIND_WIFI_PS, WIN_HINTS, autoProfiles, classifyNetshConnect, hotspotProfile, listWifiProfiles, needsLocation, parseAdapterName, parseProfileNames,
  parseProfileXml, quotable,
} from "../src/tether-win.ts";
import { TetherController, isHotspotAddress } from "../src/tether.ts";
import type { Activity, RunOptions, RunResult } from "../src/awake.ts";
import { TETHER_DEFAULTS, type TetherSettings } from "../src/config.ts";

// netsh's documented layout (English). Not measured on Windows for this change — see ARCHITECTURE §8.
const SHOW_PROFILES = `
Profiles on interface Wi-Fi:

Group policy profiles (read only)
---------------------------------
    <None>

User profiles
-------------
    All User Profile     : Home
    All User Profile     : PBJ’s iPhone
    All User Profile     : Cafe
`;
// Translated labels: the names after " : " are what is read.
const SHOW_PROFILES_KO = `
Wi-Fi 인터페이스의 프로필:

그룹 정책 프로필(읽기 전용)
---------------------------------
    <없음>

사용자 프로필
-------------
    모든 사용자 프로필     : Home
    모든 사용자 프로필     : PBJ’s iPhone
`;
const LOCATION = "Network shell commands need location permission to access WLAN information. Turn on Location services on the Location page in Privacy & security settings.\n\nHere is the URI for the Location page in the Settings app:\nms-settings:privacy-location\n";

const profileXml = (name: string, ssid: string, mode: "auto" | "manual") => `﻿<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>${name}</name>
	<SSIDConfig>
		<SSID>
			<hex>00</hex>
			<name>${ssid}</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>${mode}</connectionMode>
	<MSM><security><authEncryption><authentication>WPA2PSK</authentication></authEncryption></security></MSM>
</WLANProfile>
`;

test("adapter name, location refusal, and what netsh can quote", () => {
  assert.equal(parseAdapterName("﻿Wi-Fi\r\n"), "Wi-Fi");
  assert.equal(parseAdapterName("\r\n"), null);
  assert.equal(parseAdapterName('Wi"Fi\r\n'), null);
  assert.match(FIND_WIFI_PS, /NdisPhysicalMedium -eq 9 -or \$_\.NdisPhysicalMedium -eq 1/);
  assert.doesNotMatch(FIND_WIFI_PS, /netsh|show interfaces/, "the Location-gated query is not used");
  assert.equal(needsLocation({ code: 1, stdout: LOCATION, stderr: "" }), true);
  assert.equal(needsLocation({ code: 1, stdout: "There is no profile assigned", stderr: "" }), false);
  assert.equal(quotable("PBJ’s iPhone"), true);
  assert.equal(quotable('a" & calc'), false);
});

test("profile names in preference order, whatever the display language", () => {
  assert.deepEqual(parseProfileNames(SHOW_PROFILES), ["Home", "PBJ’s iPhone", "Cafe"]);
  assert.deepEqual(parseProfileNames(SHOW_PROFILES_KO), ["Home", "PBJ’s iPhone"]);
});

test("profile XML: name, SSID and auto-connect, entities decoded", () => {
  assert.deepEqual(parseProfileXml(profileXml("Home", "Home", "auto")), { name: "Home", ssid: "Home", auto: true });
  assert.deepEqual(parseProfileXml(profileXml("Hotspot", "PBJ&apos;s iPhone", "manual")), { name: "Hotspot", ssid: "PBJ's iPhone", auto: false });
  assert.equal(parseProfileXml("<nothing/>"), null);
});

test("netsh connect: exit code and location decide; the address decides after", () => {
  assert.equal(classifyNetshConnect({ code: 0, stdout: "Connection request was completed successfully.\n", stderr: "" }), null);
  assert.equal(classifyNetshConnect({ code: 1, stdout: LOCATION, stderr: "" }), "needs-location");
  assert.equal(classifyNetshConnect({ code: 1, stdout: 'The network specified by profile "X" is not available to connect.\n', stderr: "" }), "hotspot-not-visible");
  assert.equal(classifyNetshConnect({ code: 1, stdout: 'There is no profile "X" assigned to the specified interface.\n', stderr: "" }), "no-hotspot-profile");
  assert.equal(classifyNetshConnect({ code: 1, stdout: "알 수 없는 오류\n", stderr: "" }), "join-failed");
});

// ---- A fake Windows: netsh, Get-NetAdapter, and a Wi-Fi interface ------------------------------

type Profile = { name: string; ssid: string; mode: "auto" | "manual" };
type Net = {
  ip: string | null;
  profiles: Profile[];
  location: boolean;
  probeOk: (ip: string) => boolean;
  /** Where `netsh wlan connect name=<profile>` lands, per profile name; undefined = nothing. */
  lands: Record<string, string | undefined>;
  /** Where Windows auto-joins after a disconnect (null = nothing). */
  autoJoin: string | null;
  connectCode: number;
};

function rig(o: { net?: Partial<Net>; settings?: Partial<TetherSettings>; activity?: () => Activity } = {}) {
  const clock = { t: 1_000_000 };
  const calls: { line: string; opts?: RunOptions }[] = [];
  const lines: string[] = [];
  const net: Net = {
    ip: "192.168.1.4",
    profiles: [
      { name: "Home", ssid: "Home", mode: "auto" },
      { name: "PBJ’s iPhone", ssid: "PBJ’s iPhone", mode: "manual" },
    ],
    location: false,
    probeOk: () => true,
    lands: { "PBJ’s iPhone": "172.20.10.3", Home: "192.168.1.4" },
    autoJoin: "192.168.1.4",
    connectCode: 0,
    ...o.net,
  };
  let settings: TetherSettings = { ...TETHER_DEFAULTS, enabled: true, hotspotSsid: "PBJ’s iPhone", ...o.settings };
  const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
  const run = async (file: string, args: string[], opts?: RunOptions): Promise<RunResult> => {
    const exe = path.win32.basename(file).toLowerCase();
    const line = `${exe} ${exe === "powershell.exe" ? "<script>" : args.join(" ")}`;
    calls.push({ line, ...(opts ? { opts } : {}) });
    if (exe === "powershell.exe") {
      assert.ok(opts?.env && !Object.keys(opts.env).some((k) => k.toLowerCase() === "psmodulepath"), "PSModulePath removed");
      return ok("Wi-Fi\r\n");
    }
    assert.equal(exe, "netsh.exe");
    if (net.location) return { code: 1, stdout: LOCATION, stderr: "" };
    if (line === "netsh.exe wlan show profiles") return ok(`\nUser profiles\n-------------\n${net.profiles.map((p) => `    All User Profile     : ${p.name}`).join("\n")}\n`);
    if (line.startsWith("netsh.exe wlan export profile folder=")) {
      assert.equal(opts?.verbatim, true);
      const dir = /folder="([^"]+)"/.exec(line)![1]!;
      // Files are listed alphabetically by the file system, not in preference order.
      for (const p of [...net.profiles].reverse()) fs.writeFileSync(path.join(dir, `Wi-Fi-${p.name}.xml`), profileXml(p.name, p.ssid, p.mode));
      return ok("Interface profile \"Home\" is saved in file ...\n");
    }
    const connect = /^netsh\.exe wlan connect name="([^"]+)" interface="Wi-Fi"$/.exec(line);
    if (connect) {
      assert.equal(opts?.verbatim, true, "quotes reach netsh as written");
      if (net.connectCode !== 0) return { code: net.connectCode, stdout: "There is no profile assigned\n", stderr: "" };
      const to = net.lands[connect[1]!];
      if (to !== undefined) net.ip = to;
      return ok("Connection request was completed successfully.\n");
    }
    if (line === 'netsh.exe wlan disconnect interface="Wi-Fi"') {
      net.ip = net.autoJoin;
      return ok('Disconnection request was completed successfully for interface "Wi-Fi".\n');
    }
    throw new Error(`unexpected command: ${line}`);
  };
  const iface = (address: string): os.NetworkInterfaceInfo => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;
  const c = new TetherController({
    platform: "win32",
    run,
    settings: () => settings,
    activity: o.activity ?? (() => ({ inFlight: 0 })),
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`) },
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    interfaces: () => (net.ip ? { "Wi-Fi": [iface(net.ip)], Ethernet: [iface("10.0.0.9")] } : { Ethernet: [iface("10.0.0.9")] }),
    probe: async (ip) => net.probeOk(ip),
    schedule: () => () => {},
  });
  const ticks = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await c.tick();
      clock.t += settings.probeEverySec * 1000;
    }
  };
  const count = (re: RegExp) => calls.filter((x) => re.test(x.line)).length;
  return { c, run, clock, calls, lines, net, ticks, count, set: (s: Partial<TetherSettings>) => (settings = { ...settings, ...s }) };
}

test("listWifiProfiles: preference order from show profiles, SSID and mode from the XML; the temp folder is removed", async () => {
  const r = rig({ net: { profiles: [{ name: "Home", ssid: "Home", mode: "auto" }, { name: "Hot", ssid: "PBJ’s iPhone", mode: "manual" }, { name: "Cafe", ssid: "Cafe", mode: "auto" }] } });
  const run = r.run;
  const list = await listWifiProfiles(run);
  assert.deepEqual(list.profiles.map((p) => p.name), ["Home", "Hot", "Cafe"]);
  assert.equal(hotspotProfile(list.profiles, "PBJ’s iPhone")?.name, "Hot", "matched by SSID");
  assert.deepEqual(autoProfiles(list.profiles, "PBJ’s iPhone").map((p) => p.name), ["Home", "Cafe"]);
  const dir = /folder="([^"]+)"/.exec(r.calls.find((c) => c.line.includes("export"))!.line)![1]!;
  assert.equal(fs.existsSync(dir), false);
  r.net.location = true;
  assert.deepEqual(await listWifiProfiles(run), { profiles: [], location: true });
});

test("Windows failover: the third failed round joins the saved hotspot profile by name on the Wi-Fi adapter", async () => {
  const r = rig({ net: { probeOk: (ip) => isHotspotAddress(ip) } });
  await r.ticks(2);
  assert.equal(r.count(/wlan connect/), 0);
  await r.ticks(1);
  assert.ok(r.calls.some((x) => x.line === 'netsh.exe wlan connect name="PBJ’s iPhone" interface="Wi-Fi"'));
  const s = r.c.status();
  assert.equal(s.state, "on-hotspot");
  assert.equal(s.network, "hotspot");
  assert.equal(r.count(/powershell/), 1, "the adapter is looked up once");
});

test("Windows failover without a saved hotspot profile, or without Location: the reason and its hint, no connect", async () => {
  const a = rig({ net: { probeOk: () => false, profiles: [{ name: "Home", ssid: "Home", mode: "auto" }] } });
  await a.ticks(3);
  assert.equal(a.count(/wlan connect/), 0);
  assert.equal(a.c.status().state, "no-hotspot-profile");
  assert.equal(a.c.status().hint, WIN_HINTS["no-hotspot-profile"]);
  const b = rig({ net: { probeOk: () => false, location: true } });
  await b.ticks(3);
  assert.equal(b.c.status().state, "needs-location");
  assert.match(b.c.status().hint ?? "", /Privacy & security → Location/);
});

test("Windows failover: connect accepted but no hotspot address reads as not broadcasting, retried after a minute", async () => {
  const r = rig({ net: { probeOk: () => false, lands: {} } });
  await r.ticks(3);
  assert.equal(r.c.status().state, "hotspot-not-visible");
  assert.match(r.c.status().hint ?? "", /Personal Hotspot on the iPhone/);
  const n = r.count(/wlan connect/);
  await r.ticks(4);
  assert.equal(r.count(/wlan connect/), n);
  await r.ticks(3);
  assert.equal(r.count(/wlan connect/), n + 1);
});

test("Windows return: disconnect, and Windows' own auto-connect brings Wi-Fi back", async () => {
  const r = rig({ net: { ip: "172.20.10.3" } });
  await r.ticks(20);
  assert.equal(r.count(/wlan disconnect/), 1);
  assert.equal(r.count(/wlan connect/), 0);
  assert.equal(r.c.status().state, "watching");
  assert.equal(r.c.status().lastSwitch?.ok, true);
  assert.ok(r.lines.some((l) => /so Windows joins the best known network/.test(l)));
});

test("Windows return: nothing auto-joins after the disconnect, so the first automatic profile is asked for by name", async () => {
  const r = rig({ net: { ip: "172.20.10.3", autoJoin: null } });
  await r.ticks(20);
  assert.equal(r.count(/wlan disconnect/), 1);
  assert.ok(r.calls.some((x) => x.line === 'netsh.exe wlan connect name="Home" interface="Wi-Fi"'));
  assert.equal(r.c.status().network, "wifi");
  assert.equal(r.c.status().state, "watching");
});

test("Windows return: no other automatic Wi-Fi means no attempt at all, and the interval still backs off", async () => {
  const r = rig({ net: { ip: "172.20.10.3", profiles: [{ name: "PBJ’s iPhone", ssid: "PBJ’s iPhone", mode: "auto" }, { name: "Old", ssid: "Old", mode: "manual" }] } });
  await r.ticks(20);
  assert.equal(r.count(/wlan disconnect/), 0);
  assert.equal(r.c.status().state, "on-hotspot");
  assert.ok(r.lines.some((l) => /staying on the hotspot \(no other Wi-Fi on this PC is set to connect automatically\); next try in 360s/.test(l)), r.lines.join("\n"));
});

test("Windows return: Windows rejoins the hotspot by itself → stay, back off", async () => {
  const r = rig({ net: { ip: "172.20.10.3", autoJoin: "172.20.10.3" } });
  await r.ticks(20);
  assert.equal(r.count(/wlan disconnect/), 1);
  assert.equal(r.c.status().state, "on-hotspot");
  assert.match(r.c.status().lastSwitch?.reason ?? "", /Windows rejoined the hotspot/);
});

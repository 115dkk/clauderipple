// The Antigravity quota lookup: the `retrieveUserQuotaSummary` parse and its window mapping, and
// the per-account cache. The response shape is the measured one (2026-10-15); the values are fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleUsage, googleWindowsFromGroups, parseQuotaSummary } from "../src/providers/google/usage.ts";

const measured = {
  groups: [
    { displayName: "Gemini Models", buckets: [
      { bucketId: "gemini-weekly", displayName: "Weekly", window: "weekly", resetTime: "2026-10-19T00:00:00Z", remainingFraction: 0.98 },
      { bucketId: "gemini-5h", displayName: "5h", window: "5h", resetTime: "2026-10-15T05:39:48Z", remainingFraction: 1 },
    ] },
    { displayName: "Claude and GPT models", buckets: [
      { bucketId: "3p-weekly", displayName: "Weekly", window: "weekly", resetTime: "2026-10-19T00:00:00Z", remainingFraction: 0.9 },
      { bucketId: "3p-5h", displayName: "5h", window: "5h", resetTime: "2026-10-15T05:39:48Z", remainingFraction: 1 },
    ] },
  ],
};

test("the quota summary parses into groups; a body of the wrong shape gives null", () => {
  const groups = parseQuotaSummary(measured);
  assert.equal(groups?.length, 2);
  assert.equal(groups?.[0]?.displayName, "Gemini Models");
  assert.equal(groups?.[0]?.buckets[0]?.remainingFraction, 0.98);
  // A bucket without a readable fraction is dropped; a group left empty goes too.
  assert.deepEqual(parseQuotaSummary({ groups: [{ displayName: "X", buckets: [{ window: "5h" }] }] }), []);
  assert.equal(parseQuotaSummary({}), null);
  assert.equal(parseQuotaSummary(null), null);
  assert.equal(parseQuotaSummary([1, 2]), null);
});

test("windows map Gemini's own to five-hour/weekly and every other group to a scoped 3P", () => {
  const groups = parseQuotaSummary(measured)!;
  const windows = googleWindowsFromGroups(groups);
  assert.deepEqual(windows, [
    { kind: "five_hour", used_percent: 0, window_minutes: 300, reset_at: Math.round(Date.parse("2026-10-15T05:39:48Z") / 1000) },
    { kind: "seven_day", used_percent: 2, window_minutes: 10080, reset_at: Math.round(Date.parse("2026-10-19T00:00:00Z") / 1000) },
    { kind: "scoped", label: "3P", used_percent: 10, window_minutes: 10080, reset_at: Math.round(Date.parse("2026-10-19T00:00:00Z") / 1000) },
    { kind: "scoped", label: "3P", used_percent: 0, window_minutes: 300, reset_at: Math.round(Date.parse("2026-10-15T05:39:48Z") / 1000) },
  ]);
});

test("usage is cached per account and a failed lookup keeps the last good groups", async () => {
  const seen: string[] = [];
  let fail = false;
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    if (fail) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(measured), { status: 200 });
  }) as unknown as typeof fetch;
  let now = 1_000_000;
  const source = { credentials: async () => [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj" }] } as never;
  const instance = new GoogleUsage(source, { fetch: fetchImpl, now: () => now, ttlMs: 300_000, warn: () => {} });
  const first = await instance.snapshot();
  assert.equal(first["acct-1"]?.length, 2);
  assert.equal(seen.length, 1);
  // Within the TTL the answer is served from the cache, and no new request is made.
  await instance.snapshot();
  assert.equal(seen.length, 1);
  // Past the TTL a failed lookup keeps the last good groups.
  now += 300_001;
  fail = true;
  const third = await instance.snapshot();
  assert.equal(third["acct-1"]?.length, 2);
  assert.equal(seen.length, 2);
});

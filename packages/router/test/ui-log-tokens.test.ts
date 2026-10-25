// A request in the log's recent list is read as the Agents card reads an agent (mod stats.ts
// `agentTokens`, mod view.ts `cachePercent`): its whole prompt — uncached, cache write and cache
// read — plus its output, then the share the cache served of that prompt. The dashboard's counters
// are plain functions in a classic script, so the test evaluates them straight from the source
// text, as the picker test does. What is fixed here: a cache write is not a hit, and a fully cached
// Anthropic turn (`input: 2`) is not a two-token request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Usage = { input: number; cached: number; cacheWrite?: number; output: number };

type TokenBlock = {
  totalInputOf: (usage: Usage) => number;
  tokensOf: (usage: Usage) => number;
  cacheShareOf: (usage: Usage) => number | undefined;
};

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../ui");

function loadTokenBlock(): TokenBlock {
  const source = fs.readFileSync(path.join(uiDir, "app.js"), "utf8");
  const start = source.indexOf("function totalInputOf");
  const end = source.indexOf("function requestDetail");
  assert.ok(start > 0 && end > start, "app.js no longer contains the token-counting block");
  return new Function(`${source.slice(start, end)}; return { totalInputOf, tokensOf, cacheShareOf };`)() as TokenBlock;
}

test("a prompt is read whole: uncached, cache write and cache read", () => {
  const { totalInputOf, tokensOf } = loadTokenBlock();
  assert.equal(totalInputOf({ input: 2, cached: 45_000, cacheWrite: 1_200, output: 900 }), 46_202);
  assert.equal(tokensOf({ input: 2, cached: 45_000, cacheWrite: 1_200, output: 900 }), 47_102);
});

test("a record that reports no cache write still counts all it read", () => {
  const { totalInputOf, tokensOf } = loadTokenBlock();
  assert.equal(totalInputOf({ input: 100, cached: 900, output: 10 }), 1_000);
  assert.equal(tokensOf({ input: 100, cached: 900, output: 10 }), 1_010);
});

test("the cache's share is of the whole prompt, so a cache write is not a hit", () => {
  const { cacheShareOf } = loadTokenBlock();
  assert.equal(cacheShareOf({ input: 2, cached: 45_000, cacheWrite: 1_200, output: 900 }), 97);
  assert.equal(cacheShareOf({ input: 2, cached: 0, cacheWrite: 2_218, output: 400 }), 0);
  assert.equal(cacheShareOf({ input: 100, cached: 100, output: 10 }), 50);
});

test("a request whose prompt says nothing has no share to show", () => {
  const { cacheShareOf, tokensOf } = loadTokenBlock();
  assert.equal(cacheShareOf({ input: 0, cached: 0, output: 0 }), undefined);
  assert.equal(tokensOf({ input: 0, cached: 0, output: 0 }), 0);
});

// The summary leads a period with the same figure a request and an agent are counted by, and keeps
// the prompt's own total and the output on their own beside it.
test("the summary reads a period's tokens, then its input and output", () => {
  const app = fs.readFileSync(path.join(uiDir, "app.js"), "utf8");
  const start = app.indexOf("function renderSummary(");
  const end = app.indexOf("function fitSummaryValues(");
  const body = start > 0 && end > start ? app.slice(start, end) : "";
  assert.ok(body, "app.js no longer contains renderSummary");
  const tokens = body.indexOf('summaryChip(t("logs.th.tokens"), formatNumber(tokensOf(total)))');
  const input = body.indexOf('summaryChip(t("logs.summary.input")');
  const output = body.indexOf('summaryChip(t("logs.summary.output")');
  assert.ok(tokens > 0, "the summary no longer shows the period's tokens");
  assert.ok(input > tokens && output > input, "the summary no longer reads tokens, then input, then output");
});

// The order is the card's: the tokens, then the cache's share. A column added ahead of another
// would read the two figures in the other order.
test("the recent requests table shows the tokens, then the cache", () => {
  const html = fs.readFileSync(path.join(uiDir, "index.html"), "utf8");
  const row = /<table id="requests-table"><thead><tr>([\s\S]*?)<\/tr>/.exec(html)?.[1];
  assert.ok(row, "index.html no longer has the requests table's head");
  const tokens = row.indexOf('data-i18n="logs.th.tokens"');
  const cache = row.indexOf('data-i18n="logs.th.cache"');
  assert.ok(tokens > 0 && cache > tokens, "the requests table no longer reads tokens then cache");
  assert.equal(row.includes('data-i18n="logs.th.input"'), false, "the requests table shows the input on its own again");
  assert.equal(row.includes('data-i18n="logs.th.output"'), false, "the requests table shows the output on its own again");
});

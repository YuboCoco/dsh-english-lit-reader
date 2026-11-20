import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { apply } from "../index.js";

function referenceHost(answer) {
  const routes = new Map();
  const llm = {
    async *stream(call) {
      const result = answer(call.messages[1].content[0].text, call);
      yield { type: "text-delta", text: typeof result === "string" ? result : JSON.stringify(result) };
    },
  };
  const webServer = { register(route) { routes.set(route.path, route.handler); return () => {}; } };
  apply({ inject(_services, register) { register({ llm, webServer, effect: (setup) => setup() }); } });
  return async (path, body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = "POST";
    req.headers = {};
    let response;
    await routes.get("/plugins/english-lit-reader/references/" + path)(req, {
      writeHead(status) { assert.equal(status, 200); },
      end(payload) { response = JSON.parse(payload); },
    });
    return response;
  };
}

test("model examines numbered entries before a long appendix and verifies printed fields and links", async () => {
  const source = [
    "References",
    "[1] A. Silva. A useful transfor-",
    "mer. 2024. DOI: 10.5555/paper.v1",
    "[2] B. Lee. A second title. 2021. https://example.org/Article_(edition)",
    "[3] C. Jones. Another title. 2022.",
    "[4] K. Wong. A preprint. arXiv: 2210.01234v2",
    "Appendix A",
    ...Array.from({ length: 500 }, (_, index) => `${index + 1}. Rearrange the terms of the proof.`),
  ].join("\n");
  const post = referenceHost((prompt, call) => {
    assert.equal(call.provider, "selected-provider");
    assert.equal(call.model, "selected-model");
    assert.match(prompt, /1\| References/);
    assert.doesNotMatch(prompt, /500\. Rearrange/);
    return {
      headingLine: 1,
      endLine: 7,
      entries: [
        { startLine: 2, endLine: 3, number: "[1]", title: "A useful transformer", firstAuthor: "A. Silva", year: "2024", printedAddress: "10.5555/paper.v1" },
        { startLine: 4, endLine: 4, title: "A second title", printedAddress: "https://example.org/Article_(edition)" },
        { startLine: 5, endLine: 5, title: "A fabricated title", printedAddress: "https://doi.org/10.5555/invented" },
        { startLine: 6, endLine: 6, title: "A preprint", printedAddress: "2210.01234v2" },
      ],
    };
  });
  const batch = await post("segment", { text: source, pageLineCounts: [2, 505], windowed: true, provider: "selected-provider", model: "selected-model" });
  assert.equal(batch.ok, true);
  assert.equal(batch.headingLine, 1);
  assert.equal(batch.endLine, 7);
  assert.equal(batch.entries.length, 4);
  assert.deepEqual(batch.entries.map(({ url }) => url), [
    "https://doi.org/10.5555/paper.v1", "https://example.org/Article_(edition)", "", "https://arxiv.org/abs/2210.01234v2",
  ]);
  assert.equal(batch.entries[0].pages, "1–2");
  assert.equal(batch.entries[0].number, "1");
  assert.equal(batch.entries[0].title, "A useful transformer");
  assert.equal(batch.entries[2].title, "");
  assert.equal(batch.entries[2].status, "pending");
});

test("windowed model scanning preserves a headingless bibliography with more than 80 entries", async () => {
  const text = Array.from({ length: 92 }, (_, index) => `A. Scholar. Paper ${index + 1}. 2024.`).join("\n");
  const post = referenceHost((prompt) => {
    const [, start, end] = /Requested line range: (\d+)–(\d+)/.exec(prompt);
    const entries = [];
    for (let line = Number(start); line <= Number(end); line++) {
      entries.push({ startLine: line, endLine: line, title: `Paper ${line}` });
    }
    return { entries };
  });
  const received = [];
  let cursor = 0;
  while (cursor !== null) {
    const outcome = await post("segment", { text, windowed: true, cursor });
    assert.equal(outcome.partial, false);
    received.push(...outcome.entries);
    cursor = outcome.nextCursor;
  }
  assert.equal(received.length, 92);
  assert.equal(new Set(received.map((entry) => entry.id)).size, 92);
});

test("truncated model output is retried in smaller windows and foreign ranges are rejected", async () => {
  const text = Array.from({ length: 70 }, (_, index) => `A. Scholar. Paper ${index + 1}. 2024.`).join("\n");
  let calls = 0;
  const post = referenceHost((prompt) => {
    const [, start, end] = /Requested line range: (\d+)–(\d+)/.exec(prompt).map(Number);
    calls++;
    if (calls === 1) return '{"entries": [';
    assert.ok(end - start < 22);
    return { entries: [{ startLine: 1, endLine: 1 }, { startLine: start, endLine: start, title: `Paper ${start}` }] };
  });
  const failed = await post("segment", { text, windowed: true });
  assert.equal(failed.partial, true);
  assert.equal(failed.nextCursor, 1);
  const retry = await post("segment", { text, windowed: true, cursor: failed.cursor, retryWindow: true });
  assert.equal(calls, 3);
  assert.equal(retry.partial, true);
  assert.deepEqual(retry.entries.map((item) => item.startLine), [45, 58]);
});

test("field repair does not create a searchable title or translation from missing evidence", async () => {
  const post = referenceHost(() => [
    { id: "line-1", title: "Invented", zh: "虚构", authors: "Invented", year: "2021" },
    { id: "line-2", title: "Known title", zh: "已知标题", authors: "A. Yin", year: "2022" },
  ]);
  const result = await post("fields", { entries: [
    { id: "line-1", raw: "P. Wang. Research memo. 2023." },
    { id: "line-2", raw: "A. Yin. Known title. 2022.", title: "Known title" },
  ] });
  assert.equal(result.fields[0].title, "");
  assert.equal(result.fields[0].zh, "");
  assert.equal(result.fields[0].year, "");
  assert.equal(result.fields[1].zh, "已知标题");
});

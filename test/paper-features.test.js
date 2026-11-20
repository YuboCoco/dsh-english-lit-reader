import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { apply } from "../index.js";
import { planReferenceScan, referenceScanWindow } from "../paper-planning.js";

function host(answer, { attachments, modelInfo, models } = {}) {
  const routes = new Map();
  let calls = 0;
  const llm = {
    resolveModelInfo: modelInfo,
    listModels: models,
    async *stream(call) {
      calls++;
      const result = answer(call.messages[1].content[0].text, call);
      const text = result?.finishReason ? result.text : typeof result === "string" ? result : JSON.stringify(result);
      yield { type: "text-delta", text };
      if (result?.finishReason) yield { type: "finish", reason: { kind: result.finishReason } };
    },
  };
  const webServer = { register(route) { routes.set(route.path, route.handler); return () => {}; } };
  apply({ get: (key) => key === "attachments" ? attachments : undefined,
    inject(_services, mount) { mount({ llm, webServer, effect: (setup) => setup() }); } });
  return {
    get calls() { return calls; },
    get summaryRoutes() { return [...routes.keys()].filter((path) => path.startsWith("/plugins/english-lit-reader/summary")); },
    async request(path, body) {
      const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
      req.method = body ? "POST" : "GET";
      req.headers = {};
      let headers;
      let response;
      await routes.get("/plugins/english-lit-reader/" + path)(req, {
        writeHead(status, values) { assert.equal(status, 200); headers = values; },
        end(payload) { response = payload; },
      });
      return headers["Content-Type"].startsWith("application/json") ? JSON.parse(response) : response.toString("utf8");
    },
  };
}

test("a numbered reference window reproduces the legacy result without sending the full document", async () => {
  const text = [
    ...Array.from({ length: 190 }, (_, index) => `${index} ${"body prose ".repeat(30)}`),
    "References",
    "[1] Wang. A title. 2023. 10.1234/sample",
    "Appendix A",
    ...Array.from({ length: 200 }, (_, index) => `${index} ${"appendix details ".repeat(30)}`),
  ].join("\n");
  const plan = planReferenceScan(text, [100, 93, 200]);
  const window = referenceScanWindow(plan, 0, false);
  assert.ok(Buffer.byteLength(JSON.stringify(window)) < Buffer.byteLength(text) / 3);
  const mock = host((prompt) => {
    assert.match(prompt, /191\| References\n192\| \[1\]/u);
    assert.doesNotMatch(prompt, /^1\| 0 body prose/mu);
    return { headingLine: 191, endLine: 193, entries: [{
      startLine: 192, endLine: 192, title: "A title", year: "2023", printedAddress: "10.1234/sample",
    }] };
  });
  const old = await mock.request("references/segment", { text, windowed: true, pageLineCounts: [100, 93, 200] });
  const batch = await mock.request("references/segment", { referenceWindow: window });
  assert.equal(batch.partial, false, batch.error);
  assert.deepEqual(batch, old);
  assert.equal(batch.entries[0].pages, "2");
  assert.equal(batch.entries[0].url, "https://doi.org/10.1234/sample");
  const invalid = await mock.request("references/segment", { referenceWindow: { ...window, offset: 0 } });
  assert.equal(invalid.ok, false);
  assert.equal(mock.calls, 2);
});

test("the browser planner is served as a packaged JavaScript module", async () => {
  const mock = host(() => assert.fail("asset loading called the model"));
  assert.match(await mock.request("paper-planning.js"), /export function planReferenceScan/u);
});

const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=";

test("figure extraction sends the selected raster as a Harness attachment with local caption context", async () => {
  const attachment = { id: "attachment-from-harness" };
  const mock = host((prompt, call) => {
    assert.equal(call.provider, "deepseek-official");
    assert.equal(call.model, "deepseek-flash");
    assert.match(prompt, /第 8 页/u);
    assert.match(prompt, /Figure 3\. Validation loss/u);
    assert.match(prompt, /training runs/u);
    assert.doesNotMatch(prompt, /entire-document-marker/u);
    assert.deepEqual(call.messages[1].content[1], { type: "image", attachment });
    return "图解";
  }, {
    modelInfo: async () => ({ name: "DeepSeek Flash", inputModalities: ["text", "image"], reasoning: { defaultEffort: "high" } }),
    attachments: { async saveImage(input) {
      assert.equal(input.mediaType, "image/png");
      assert.deepEqual(input.data, Buffer.from(IMAGE.split(",")[1], "base64"));
      return attachment;
    } },
  });
  const response = await mock.request("figure", {
    page: 8, image: IMAGE, provider: "deepseek-official", model: "deepseek-flash",
    caption: "Figure 3. Validation loss", context: "training runs", text: "entire-document-marker",
  });
  const { generatedAt, ...result } = response;
  assert.equal(new Date(generatedAt).toISOString(), generatedAt);
  assert.deepEqual(result, {
    ok: true, text: "图解", page: 8, model: "deepseek-flash", provider: "deepseek-official",
    modelName: "DeepSeek-V4.1-Flash", reasoningEffort: "high",
  });
});

test("text-only models and invalid rasters do not reach the image store or the model", async () => {
  const mock = host(() => assert.fail("model dispatch should not run"), {
    modelInfo: async () => ({ inputModalities: ["text"] }),
    attachments: { saveImage() { assert.fail("image should not be stored"); } },
  });
  assert.equal((await mock.request("figure", { page: 1, image: IMAGE })).code, "figure-model");
  assert.equal((await mock.request("figure", { page: 1, image: "data:image/png;base64,AQID" })).code, "figure-image");
  const oldProfile = host(() => assert.fail("model dispatch should not run"));
  assert.equal((await oldProfile.request("figure", { page: 1, image: IMAGE })).code, "figure-attachments");
});

test("automatic figure selection keeps the configured provider and checks its image route", async () => {
  const mock = host((_prompt, call) => {
    assert.equal(call.model, "vision");
    assert.equal(call.provider, "configured");
    assert.equal(call.reasoningEffort, undefined);
    return "Figure";
  }, {
    models: async (provider) => {
      assert.equal(provider, "configured");
      return [{ id: "stale", inputModalities: ["image"] }, { id: "vision", inputModalities: ["text", "image"] }];
    },
    modelInfo: async (_provider, model) => model === "vision"
      ? { name: "Vision 2.1", inputModalities: ["image"], reasoning: { defaultEffort: "low" } }
      : { inputModalities: ["text"], reasoning: { defaultEffort: "max" } },
    attachments: { saveImage: async () => ({ id: "vision-ref" }) },
  });
  const response = await mock.request("figure", { page: 1, image: IMAGE, provider: "configured", model: "text", reasoningEffort: "high", fastModel: true });
  assert.equal(response.ok, true);
  assert.equal(response.model, "vision");
  assert.equal(response.provider, "configured");
  assert.equal(response.modelName, "Vision 2.1");
  assert.equal(response.reasoningEffort, "low");
});

test("figure history sorts both ways by document position and by analysis time", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const helperStart = source.indexOf("    function figurePagePosition(");
  const helperEnd = source.indexOf("    function readGenerationMetadata(", helperStart);
  const constants = source.slice(source.indexOf("    const FIGURE_LABEL_RE = "), source.indexOf("    // (v13 #1)"));
  assert.ok(helperStart >= 0 && helperEnd > helperStart && constants.includes("figureNumberOrder"));
  const { orderFigureEntries, figurePagePosition } = new Function(
    constants + source.slice(helperStart, helperEnd) + "return { orderFigureEntries, figurePagePosition };",
  )();
  const original = { rotation: 0, width: 100, height: 200, convertToViewportPoint: (x, y) => [x, 200 - y] };
  const rotated = { rotation: 90, width: 200, height: 100, convertToPdfPoint: (x, y) => [y, x] };
  const crop = { x: 0.5, y: 0.25, w: 0.25, h: 0.25 };
  const position = figurePagePosition({ getViewport: () => original }, rotated, crop);
  assert.deepEqual(position, { x: 0.25, y: 0.25 });

  const entries = Object.freeze([
    { id: "late-page", page: 10, generatedAt: "2026-01-03" },
    { id: "bottom", page: 2, position: { x: 0.1, y: 0.7 }, generatedAt: "2026-01-02" },
    { id: "missing", generatedAt: "invalid" },
    { id: "right", page: 2, position: { x: 0.7, y: 0.25 }, generatedAt: "2026-01-01" },
    { id: "left", page: 2, position, generatedAt: "2026-01-04" },
  ]);
  const ids = (list, order) => orderFigureEntries(list, order).map((entry) => entry.id);
  assert.deepEqual(ids(entries, "document-asc"), ["left", "right", "bottom", "late-page", "missing"]);
  assert.deepEqual(ids(entries, "document-desc"), ["late-page", "bottom", "right", "left", "missing"]);
  assert.deepEqual(ids(entries, "time-asc"), ["right", "bottom", "late-page", "left", "missing"]);
  assert.deepEqual(ids(entries, "time-desc"), ["left", "late-page", "bottom", "right", "missing"]);

  const legacy = [
    { id: "ten", page: 5, caption: "Figure 10. Details", position: { x: 0.1, y: 0.1 } },
    { id: "four", page: 5, caption: "Figure IV. Results" },
    { id: "two", page: 5, caption: "Fig. 2. Model" },
  ];
  assert.deepEqual(ids(legacy, "document-asc"), ["two", "four", "ten"]);
  assert.deepEqual(ids(legacy, "document-desc"), ["ten", "four", "two"]);
});

test("floating cards stay inside the viewport and term bubbles choose a side with enough room", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const start = source.indexOf("    const clampPopup = ");
  const end = source.indexOf("    function placePopupNearRect(", start);
  assert.ok(start >= 0 && end > start);
  const { placeFunctionCard, termPopoverSpace } = new Function(
    "CARD_HEADER_HEIGHT", source.slice(start, end) + "return { placeFunctionCard, termPopoverSpace };",
  )(40);
  const viewport = { left: 8, top: 30, right: 352, bottom: 610 };
  const saved = { x: 1200, y: 1200, w: 440, h: 430 };
  assert.deepEqual(placeFunctionCard(saved, true, viewport), { x: 8, y: 180, w: 344, h: 430 });
  assert.deepEqual(placeFunctionCard(saved, false, viewport), { x: 8, y: 570, w: 344, h: 40 });
  assert.equal(saved.x, 1200);

  const bottomRow = { left: 42, right: 320, top: 510, bottom: 540 };
  const narrow = termPopoverSpace(bottomRow, viewport);
  assert.equal(narrow.side, "above");
  assert.equal(narrow.edgeY, 501);
  assert.equal(narrow.width, 344);
  const rightRow = { left: 900, right: 1160, top: 210, bottom: 240 };
  const wide = termPopoverSpace(rightRow, { ...viewport, right: 1192 });
  assert.equal(wide.side, "left");
  assert.equal(wide.x + wide.width, 891);
  assert.equal(wide.centerY, 225);

  const card = { left: 650, right: 1180, top: 410, bottom: 600 };
  const bottom = termPopoverSpace({ left: 700, right: 900, top: 510, bottom: 540, anchorX: 732 },
    { ...viewport, right: 1192 }, card, "bottom");
  assert.equal(bottom.side, "above");
  assert.equal(bottom.edgeY, 401);
  assert.equal(bottom.centerX, 732);
});

test("Shift append keeps edits and separates the latest native range from the translation draft", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const match = source.match(/    function selectionDraft\(current, fragment, intent\) \{[\s\S]*?\n    \}/u);
  assert.ok(match);
  const stage = new Function("MAX_SELECTION", match[0] + "return selectionDraft;")(6000);
  const edited = { selection: "Original.", selectionEdit: "Edited original.", selectionResult: "Previous translation" };
  assert.equal(stage(edited, "Original.", "replace"), null);
  const combined = stage(edited, "Third passage.", "append");
  assert.deepEqual(combined, {
    selection: "Third passage.", selectionEdit: "Edited original.\n\nThird passage.",
    selectionPrefix: "Edited original.", selectionResult: "",
  });
  assert.equal(stage(combined, "Third passage and next line.", "extend").selectionEdit,
    "Edited original.\n\nThird passage and next line.");
  assert.equal(stage(combined, "Third passage.", "replace").selectionEdit, "Third passage.");
  assert.deepEqual(stage({ ...edited, selectionEdit: "x".repeat(5998) }, "Too long.", "append"), { overflow: true });
});

test("resizing a floating card anchors the opposite edge and respects viewport limits", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const start = source.indexOf("    function resizePanelBox(");
  const end = source.indexOf("    function resizeHandles(", start);
  assert.ok(start >= 0 && end > start);
  const resize = new Function("clampPopup", source.slice(start, end) + "return resizePanelBox;")(
    (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max)),
  );
  const origin = { x: 120, y: 90, w: 300, h: 210 };
  const viewport = { left: 8, top: 30, right: 650, bottom: 420 };
  assert.deepEqual(resize(origin, "nw", -300, -200, viewport, 220, 130), { x: 8, y: 30, w: 412, h: 270 });
  assert.deepEqual(resize(origin, "se", 900, 900, viewport, 220, 130), { x: 120, y: 90, w: 530, h: 330 });
  assert.deepEqual(resize(origin, "w", 900, 0, viewport, 220, 130), { x: 200, y: 90, w: 220, h: 210 });
});

test("the detailed pipeline reads a long paper in one call when the model can fit it", async () => {
  const pages = ["Abstract\n" + "Complete source text.\n".repeat(3200), "", "Results\nThe model achieved 93.5% accuracy."];
  const text = pages.filter(Boolean).join("\n\n");
  const markdown = "## 4. 实验设置与结果\n\n模型准确率为 93.5%。";
  assert.ok(text.length > 60000);
  const mock = host((input, call) => {
    assert.equal(call.provider, "deepseek-account");
    assert.equal(call.model, "deepseek-flash");
    assert.equal(call.reasoningEffort, "max");
    assert.equal(call.maxTokens, 24576);
    assert.ok(input.includes(pages[0]));
    assert.match(input, /\[Page 3\]\nResults/u);
    assert.doesNotMatch(input, /\[Page 2\]/u);
    const prompt = call.messages[0].content[0].text;
    for (const [i, heading] of ["论文概览", "研究问题与已有方法", "技术方案", "实验设置与结果", "局限与适用范围", "复现与可借鉴之处"].entries()) {
      assert.ok(prompt.includes("## " + (i + 1) + ". " + heading));
    }
    return "\x60\x60\x60markdown\n" + markdown + "\n\x60\x60\x60";
  }, {
    modelInfo: async () => ({ name: "DeepSeek-V4.1-Flash-1017", context: { contextWindow: 1048576 } }),
  });
  const result = await mock.request("summary", {
    text, pageTextLengths: pages.map((p) => p.length), provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "max",
  });
  assert.equal((await mock.request("meta")).summaryFormat, "detailed-markdown");
  assert.deepEqual(mock.summaryRoutes, ["/plugins/english-lit-reader/summary", "/plugins/english-lit-reader/summary/analyze"]);
  assert.equal(mock.calls, 1);
  assert.equal(result.mode, "direct");
  assert.equal(result.format, "detailed-markdown");
  assert.equal(result.text, markdown);
  assert.equal(result.coverage.analyzedChars, text.length);
  assert.deepEqual(result.coverage.pages, [[1, 1], [3, 3]]);
  assert.equal(result.modelName, "DeepSeek-V4.1-Flash-1017");
  assert.equal(result.reasoningEffort, "max");
  assert.equal(new Date(result.generatedAt).toISOString(), result.generatedAt);
});

test("truncated direct analysis falls back to complete excerpts and failed synthesis can be retried", async () => {
  const pages = Array.from({ length: 5 }, (_, i) => "PAGE-MARKER-" + (i + 1) + "\n" + "The comparison uses the same public dataset.\n".repeat(460));
  const text = pages.join("\n\n");
  const markdown = "## 4. 实验设置与结果\n\n对照实验共用同一数据集。";
  let mapCalls = 0;
  let synthesisCalls = 0;
  const seen = new Set();
  const mock = host((input, call) => {
    const system = call.messages[0].content[0].text;
    if (system.startsWith("Analyze the supplied")) {
      return { finishReason: "max-tokens", text: "Unfinished direct analysis" };
    }
    if (system.startsWith("Synthesize")) {
      assert.match(input, /PAGE-MARKER-5/u);
      if (synthesisCalls++ === 0) throw new Error("synthesis timed out");
      return markdown;
    }
    mapCalls++;
    const markers = [...input.matchAll(/PAGE-MARKER-(\d)/gu)];
    for (const [, page] of markers) seen.add(page);
    return "Notes " + markers.map(([tag]) => tag).join(" ");
  }, { modelInfo: async () => ({ context: { contextWindow: 120000 } }) });
  const request = { text, pageTextLengths: pages.map((p) => p.length) };
  const fallback = await mock.request("summary/analyze", request);
  assert.equal(fallback.mode, "notes");
  assert.match(fallback.synthesisError, /synthesis timed out/u);
  assert.match(fallback.text, /Notes PAGE-MARKER-5/u);
  assert.deepEqual([...seen].sort(), ["1", "2", "3", "4", "5"]);
  assert.equal(fallback.coverage.analyzedChars, text.length);
  assert.ok(mapCalls > 1);
  const callsBeforeRetry = mock.calls;
  const retry = await mock.request("summary/analyze", { ...request, summaryDraft: fallback.summaryDraft });
  assert.equal(mock.calls, callsBeforeRetry + 1);
  assert.equal(retry.mode, "map-reduce");
  assert.equal(retry.text, markdown);
  const wrongPaper = await mock.request("summary/analyze", {
    text: text + "changed", summaryDraft: fallback.summaryDraft,
  });
  assert.equal(wrongPaper.ok, false);
  assert.match(wrongPaper.error, /notes do not match this paper/u);
  assert.equal(mock.calls, callsBeforeRetry + 1);
});

test("a small model skips direct analysis and reports incomplete coverage if an excerpt fails", async () => {
  const text = "Introduction\n" + "Complete context for the model.\n".repeat(400) + "FAILED-TAIL publication details.";
  const markdown = "## 1. 论文概览\n\n成功分析的内容。";
  const mock = host((input, call) => {
    const system = call.messages[0].content[0].text;
    assert.ok(!system.startsWith("Analyze the supplied"));
    if (system.startsWith("Synthesize")) {
      assert.match(system, /incomplete source material/u);
      assert.doesNotMatch(input, /publication details/u);
      return markdown;
    }
    if (input.includes("FAILED-TAIL")) throw new Error("excerpt failed");
    return "Notes.";
  }, { modelInfo: async () => ({ context: { contextWindow: 4096 } }) });
  const result = await mock.request("summary/analyze", { text, pageTextLengths: [text.length] });
  assert.equal(result.mode, "map-reduce");
  assert.equal(result.failedChunks, 1);
  assert.ok(result.coverage.analyzedChars < text.length);
  assert.equal(result.text, markdown);
});

test("the reader checks Host compatibility, preserves results on error, and retries with saved notes", async () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const start = source.indexOf("const doSummary = ");
  const end = source.indexOf("// (#6) Explicit re-analysis", start);
  assert.ok(start >= 0 && end > start);
  const loadSummary = new Function("env", "with (env) {" + source.slice(start, end) + "return doSummary;}");
  const draft = { fingerprint: "same-paper", notes: [{ start: 0, end: 20, text: "Paper notes" }] };
  let state = { paperId: "paper", text: "Original paper text.", summary: "Cached analysis" };
  let meta = { ok: true };
  let response = new Error("Request failed");
  let issue;
  const saves = [];
  const requests = [];
  const run = loadSummary({
    BASE: "/plugins/english-lit-reader",
    fetch: async (path) => {
      assert.equal(path, "/plugins/english-lit-reader/meta");
      return { ok: true, json: async () => meta };
    },
    readShared: () => state,
    writeShared: (patch) => { state = { ...state, ...patch }; },
    summaryRunRef: { current: null }, pdfReferenceSourceRef: { current: null },
    bodyRef: { current: () => ({ model: "mock" }) },
    describeModelSelection: (request) => request, readGenerationMetadata: () => ({}),
    t: (key) => key, setSummaryBusy() {}, notify() {},
    setSummaryIssue: (value) => { issue = value; }, saveResult: (paper, result) => { saves.push({ paper, ...result }); },
    post: async (route, payload) => {
      assert.equal(route, "/summary");
      assert.equal(payload.text, state.text);
      requests.push(payload);
      if (response instanceof Error) throw response;
      return response;
    },
  });
  await run();
  assert.equal(issue, "summary.hostUnavailable");
  assert.equal(requests.length, 0);
  meta = { ok: true, summaryFormat: "detailed-markdown" };
  await run();
  assert.equal(issue, response.message);
  assert.equal(state.summary, "Cached analysis");
  assert.equal(saves.length, 0);
  response = Object.assign(new Error("HTTP 405"), { status: 405 });
  await run();
  assert.equal(issue, "summary.hostUnavailable");
  assert.equal(state.summary, "Cached analysis");
  assert.equal(saves.length, 0);
  response = { ok: true, format: "detailed-markdown", text: "Paper notes", mode: "notes", summaryDraft: draft, coverage: {} };
  await run();
  assert.equal(issue, "");
  assert.equal(state.summary, response.text);
  assert.equal(saves[0].summaryDetail.format, "detailed-markdown");
  assert.equal(saves[0].summaryDetail.draft, draft);
  response = { ok: true, format: "detailed-markdown", text: "## 技术方案\n\n详细报告", mode: "map-reduce", coverage: {} };
  await run(true);
  assert.equal(requests[3].summaryDraft, draft);
  assert.equal(state.summary, response.text);
  assert.equal(saves[1].summaryDetail.draft, null);
});

test("the reader renders report headings, ordered methods, equations and result tables", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const start = source.indexOf("    const isTableSeparator = ");
  const end = source.indexOf("    function renderFigureMarkdown", start);
  assert.ok(start >= 0 && end > start);
  const render = new Function("h", "renderInline", "renderMath", source.slice(start, end) + "return renderMarkdown;")(
    (tag, props, ...children) => ({ tag, props, children }), (text) => text, (tex, display) => ({ tex, display }),
  );
  const content = ["## 技术方案", "1. 输入", "2. 训练", "$$x^2$$", "| 模型 | 准确率 |", "| --- | --- |", "| 本文 | 93.5% |"].join("\n");
  const [heading, methods, equation, comparison] = render(content);
  assert.equal(heading.tag, "h2");
  assert.equal(methods.tag, "ol");
  assert.deepEqual(methods.children[0].map((item) => item.children[0]), ["输入", "训练"]);
  assert.deepEqual(equation.children[0], { tex: "x^2", display: true });
  assert.equal(comparison.children[0].tag, "table");
});

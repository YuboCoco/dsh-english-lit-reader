import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
// (v21 #1) The reference column resolves each bibliography entry to a real
// article address. Crossref is the only resolver that answered reliably during
// testing (Semantic Scholar returns HTTP 429 without an API key), so it is
// queried over the Node built-in client — no extra dependency is vendored.
import { get as httpsGet } from "node:https";

const BASE = "/plugins/english-lit-reader";
const MAX_SUMMARY_CHARS = 60000;
const SUMMARY_DIRECT_CHARS = 9000;
const SUMMARY_CHUNK_CHARS = 6000;
const MAX_TRANSLATE_CHARS = 60000;
// (v13 #4) A two-paragraph selection is longer than the old 4000-char cap; the
// Host must accept the same budget the Client sends (MAX_SELECTION = 6000) or
// the tail would still be dropped server-side.
const MAX_SELECTION_CHARS = 6000;
// (v12) A 1200-char chunk on a reasoning model can exceed the 120s per-call
// timeout; 700 keeps every chunk comfortably inside it. Full-text translation
// also runs four chunks in parallel (flash-class models do not throttle), which
// turns a whole paper from hours into roughly a minute.
const TRANSLATE_CHUNK_CHARS = 700;
const TRANSLATE_CONCURRENCY = 4;
// (v14 #1) A selected passage must NOT be cut every 700 chars: that slices
// sentences in half, and joining the independently translated pieces with blank
// lines is exactly the "断层/缺失" the user reported. Selections are translated
// as whole, sentence-aligned units under this generous cap (a 1250-char abstract
// becomes ONE unit -> one continuous Chinese passage).
const SELECTION_UNIT_CHARS = 2400;
// (v8 #3) A selected formula is short; the paper text sent with it is what needs
// bounding, because it is replayed to the model on every explanation.
const MAX_FORMULA_CHARS = 4000;
const MAX_FORMULA_CONTEXT_CHARS = 40000;
// (v35 #1) A selected term is a word or a short phrase. The paper text is what
// needs bounding: it is replayed to the model on every explanation and is what
// makes the explanation domain-grounded instead of a dictionary definition.
const MAX_TERM_CHARS = 200;
const MAX_TERM_CONTEXT_CHARS = 40000;
const MODEL_TIMEOUT_MS = 120000;
// Summary map-reduce stays serial: on a reasoning provider parallel calls are
// throttled and produce "Stream ended without finish_reason" failures.
const CONCURRENCY = 1;
// Used only when an adapter cannot describe its own reasoning tiers.
const FALLBACK_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORT_TIMEOUT_MS = 8000;

export const inject = ["llm", "webServer"];

const MAP_SYSTEM = [
  "You are a research assistant analyzing one section of an English academic paper.",
  "This is one chunk of a longer paper; extract ONLY what is explicitly stated in THIS chunk.",
  "Write concise Simplified Chinese notes in Markdown under exactly these four headings:",
  "## 研究背景与问题",
  "## 核心创新点",
  "## 技术方案",
  "## 实验与结论",
  "Use bullet points. If a section is not covered, write \"本段未提及\". Do not guess. Output ONLY the Markdown.",
].join(" ");

const REDUCE_SYSTEM = [
  "You are a research assistant synthesizing notes from the chunks of an English academic paper.",
  "Combine the provided per-chunk notes into ONE structured analysis in Simplified Chinese, written as Markdown.",
  "Use exactly these five level-2 headings, in this order:",
  "## 一、研究背景与问题",
  "## 二、核心创新点",
  "## 三、技术方案",
  "## 四、实验与结论",
  "## 五、局限与可借鉴之处",
  "For 二, give a numbered list of concrete, specific innovations and state what is new relative to prior work.",
  "For 三, describe the overall architecture or pipeline, key modules, data flow, algorithms or loss functions, and implementation details; use bullet points or a short numbered step list where helpful.",
  "For 四, list datasets, baselines, the main quantitative results and the authors' conclusions.",
  "Rules: base every claim ONLY on the provided notes; if something is not stated, write \"文中未明确说明\" instead of guessing; be concise and technical; output ONLY the Markdown with no preamble.",
].join(" ");

const TRANSLATE_SYSTEM = [
  "You are a professional academic translator specializing in English scientific papers.",
  "Translate the given English text into accurate, fluent Simplified Chinese.",
  "Requirements:",
  "(1) be faithful to the original meaning;",
  "(2) use standard Chinese academic terminology;",
  "(3) preserve formulas, symbols, numbers, units, citations, URLs and proper nouns unchanged;",
  "(4) write each paragraph as ONE continuous block of prose: never start a new line between sentences or clauses of the same paragraph, because the line breaks in the source are typesetting artifacts and not real paragraph breaks;",
  "(5) separate paragraphs with a single blank line, and only where the source has a real paragraph break;",
  "(6) output ONLY the translated text - no explanation, no notes, no preamble, no quotation marks around it.",
].join(" ");

const SUMMARY_SYSTEM = [
  "You are a research assistant analyzing an English academic paper.",
  "Read the paper text and produce a structured analysis written in Simplified Chinese, formatted as Markdown.",
  "Use exactly these five level-2 headings, in this order:",
  "## 一、研究背景与问题",
  "## 二、核心创新点",
  "## 三、技术方案",
  "## 四、实验与结论",
  "## 五、局限与可借鉴之处",
  "For 二, give a numbered list of concrete, specific innovations and state what is new relative to prior work.",
  "For 三, describe the overall architecture or pipeline, key modules, data flow, algorithms or loss functions, and implementation details; use bullet points or a short numbered step list where helpful.",
  "For 四, list datasets, baselines, the main quantitative results and the authors' conclusions.",
  "Rules: base every claim ONLY on the provided text; if something is not stated in the text, write \"文中未明确说明\" instead of guessing; be concise and technical; output ONLY the Markdown with no preamble.",
].join(" ");

// (v8 #3) Formula explanation. The paper text is supplied as context so symbols
// can be resolved from the authors' own definitions instead of being guessed.
const FORMULA_SYSTEM = [
  "You are a research assistant explaining a mathematical formula from an English academic paper to a Chinese-speaking reader.",
  "You are given the selected formula and, as context, the text of the paper it comes from.",
  "Write the explanation in Simplified Chinese, as Markdown, using exactly these level-2 headings in this order:",
  "## 公式含义",
  "## 符号说明",
  "## 在论文中的作用",
  "## 计算与实现要点",
  "Rules:",
  "(1) In 公式含义, restate the formula in LaTeX inline math and say in one or two sentences what quantity it computes or optimizes;",
  "(2) In 符号说明, use a Markdown table with columns 符号 / 含义 / 取值或范围, covering EVERY symbol that appears in the formula;",
  "(3) In 在论文中的作用, explain where this formula is used in the authors' method (which module, which step, what it is combined with), citing the context when it is available;",
  "(4) In 计算与实现要点, note the computational cost, numerical stability concerns, hyperparameters and any implementation detail the paper states;",
  "(5) base every claim ONLY on the formula and the provided context; if something is not stated, write \"文中未明确说明\" instead of guessing;",
  "(6) output ONLY the Markdown, with no preamble and no closing remarks.",
].join(" ");

// (v35 #1) Professional-term explanation. This is NOT a dictionary lookup: the
// paper text is always supplied so the term can be pinned to the sense the
// authors actually use, in the discipline the paper belongs to.
const TERM_SYSTEM = [
  "You are a research assistant explaining a professional term from an English academic paper to a Chinese-speaking reader who is not a specialist in this exact subfield.",
  "You are given the term the reader selected and, as context, the text of the paper it was selected from.",
  "Write the explanation in Simplified Chinese, as Markdown, using exactly these level-2 headings in this order:",
  "## 术语含义",
  "## 在本论文中的含义",
  "## 所属领域与相关概念",
  "## 理解要点",
  "Rules:",
  "(1) In 术语含义, give the precise technical meaning in one or two sentences, plus the English full form and the standard Chinese translation; if the term is an abbreviation, expand it first;",
  "(2) In 在本论文中的含义, state what the term specifically refers to in THIS paper (which component, quantity, task or dataset), quoting or paraphrasing the context; if the paper does not define it explicitly, write \"本文未明确说明\" and describe the sense implied by the surrounding text;",
  "(3) In 所属领域与相关概念, name the research field or subfield the term belongs to, and list the two to four closely related concepts the reader is likely to confuse it with, saying briefly how they differ;",
  "(4) In 理解要点, give the intuition in plain language and note what the reader should watch for when this term reappears;",
  "(5) base every claim ONLY on the term and the provided context; never invent a definition, a citation or a number; if something is not stated, write \"文中未明确说明\" instead of guessing;",
  "(6) be concrete and technical, never pad with generic filler;",
  "(7) output ONLY the Markdown, with no preamble and no closing remarks.",
].join(" ");

// (v21 #1) Bibliography extraction. The model only parses and translates - it is
// explicitly forbidden from inventing an address, because the Host resolves the
// address itself and the UI prints 未找到 when that resolution fails.
// (v52) Field extraction, batched. The old prompt asked for the WHOLE list as one
// JSON array, which is exactly what made 81 entries come back as 80 (or as zero
// when a closing bracket was lost). Each call now receives a small batch that
// already carries stable ids, and every answer is validated per id, so one bad
// batch can never take the whole column down with it.
const REFERENCE_FIELDS_SYSTEM = [
  "You are a research assistant extracting citation metadata from a bibliography.",
  "You receive a JSON array of batches. Each element has an id, the verbatim entry text, and optional context.",
  "Output ONLY a JSON array - no prose, no explanation, no code fences.",
  "Return one object per INPUT id, in the same order, with exactly these keys:",
  '{"id": "...", "title": "...", "zh": "...", "authors": "...", "venue": "...", "year": "..."}',
  "Rules:",
  "(1) title is the ARTICLE TITLE only - never the authors, never the venue, never the year, never the page numbers;",
  "(2) keep formulas, symbols, numbers, acronyms and proper nouns unchanged inside title;",
  "(3) zh is a natural Chinese translation of title - translate the meaning, never transliterate;",
  "(4) authors is the author list as printed, or an empty string when absent;",
  "(5) venue is the journal or conference name; year is the four-digit year; use empty strings when the entry does not state them;",
  "(6) if an entry has no discernible title, put the most title-like phrase in title and your best translation in zh;",
  "(7) NEVER invent a value and NEVER output a URL; leave a field empty instead of guessing;",
  "(8) never merge two ids, never drop an id, never add an id you were not given;",
  "(9) output ONLY the JSON array.",
].join(" ");

// (v52) Used only when segmentation could not split a section. The model names
// line ranges; the PROGRAM then builds the entries from those ranges, so the
// original text is never rewritten by the model.
const REFERENCE_LINES_SYSTEM = [
  "You are a research assistant segmenting the bibliography of an academic paper.",
  "You receive numbered source lines, one per line, formatted as `N| text`.",
  "Identify the line ranges that belong to one bibliographic reference each.",
  "Output ONLY a JSON array - no prose, no code fences.",
  'Each element is {"from": <first line number>, "to": <last line number>} using the SAME numbers you were given.',
  "Rules:",
  "(1) ranges must be in ascending order, must not overlap, and must stay inside the given numbering;",
  "(2) a reference may span several lines - include its continuation lines in the same range;",
  "(3) ignore running headers, page numbers, and prose that is clearly not a reference;",
  "(4) never invent line numbers, never rewrite the text, never output anything but the array.",
].join(" ");

// (v52) Reference budgets. `MAX_REFERENCE_CHARS` is now only a safety ceiling on
// the slice we hand to the model — the section locator itself is line based and
// stops at the next section heading, so a long appendix after the bibliography
// can no longer push real entries out of the window.
const MAX_REFERENCE_CHARS = 200000;
// A hard ceiling that is REPORTED rather than applied silently: when a document
// exceeds it the response carries `pendingFrom`/`pendingTo` so the caller can
// continue instead of wondering where 81 entries went.
const MAX_REFERENCE_ENTRIES = 400;
const REFERENCES_PER_BATCH = 10;
const REFERENCE_BATCH_CHARS = 12000;
const MAX_REFERENCE_CONTEXT_CHARS = 4000;
const REFERENCE_TIMEOUT_MS = 60000;
const REFERENCE_CONCURRENCY = 3;
// Address resolution. Crossref advertises `x-rate-limit-limit: 3` per second to
// anonymous callers and answers 429 far below that once a paper is opened twice;
// OpenAlex throttles harder. One global queue spaces every outbound lookup, and
// a 429 is retried with backoff instead of being reported as 「未找到」.
const RESOLVER_MIN_INTERVAL_MS = 620;
const RESOLVER_TIMEOUT_MS = 12000;
const RESOLVER_MAX_ATTEMPTS = 3;
const RESOLVER_BACKOFF_MS = [1400, 3200, 6400];
// Auto-link needs strong evidence; the middle band still shows a link but marks
// it 「待确认」 so a wrong DOI can never masquerade as a verified one.
const TITLE_MATCH_MIN = 0.9;
const TITLE_CONFIRM_MIN = 0.72;
// A generic qualifier in a candidate title means "same topic, different work".
const TITLE_QUALIFIERS = new Set([
  "survey", "surveys", "review", "reviews", "overview", "tutorial", "tutorials",
  "reprint", "reprinted", "erratum", "corrigendum", "correction", "retraction",
  "comment", "comments", "reply", "discussion", "abstract", "extended", "poster",
  "demo", "editorial", "preface", "introduction", "handbook", "encyclopedia",
]);
// Both services ask clients to identify themselves. A real mailto puts us in the
// polite pool, which is the difference between steady 200s and a wall of 429s.
const RESOLVER_MAILTO = "584628900@qq.com";
const CROSSREF_AGENT = "dsh-english-lit-reader/1.0.52 (https://github.com/YuboCoco/dsh-english-lit-reader; mailto:" + RESOLVER_MAILTO + ")";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function safeMessage(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  try {
    return String(error.message || error.code || error);
  } catch (_) {
    return "unknown error";
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("request body too large"));
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const value = raw ? JSON.parse(raw) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("request body must be a JSON object");
        }
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function originOk(req) {
  try {
    const headers = req.headers || {};
    const origin = headers.origin;
    if (!origin || typeof origin !== "string") return true;
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
    const host = String(headers.host || "").toLowerCase();
    if (host && (host.indexOf(hostname) !== -1 || origin.toLowerCase().indexOf(host) !== -1)) return true;
    return false;
  } catch (_) {
    return true;
  }
}

function resolveModel(ctx, body) {
  let provider = "workbuddy";
  let model = "hy4free";
  let reasoningEffort = "";
  try {
    const service = ctx.get && ctx.get("agentDefaultModel");
    const selection = service && typeof service.currentSelection === "function" ? service.currentSelection() : null;
    if (selection) {
      if (typeof selection.provider === "string" && selection.provider) provider = selection.provider;
      else if (typeof selection.providerId === "string" && selection.providerId) provider = selection.providerId;
      if (typeof selection.model === "string" && selection.model) model = selection.model;
      else if (typeof selection.modelId === "string" && selection.modelId) model = selection.modelId;
      if (typeof selection.reasoningEffort === "string" && selection.reasoningEffort) reasoningEffort = selection.reasoningEffort;
    }
  } catch (_) {}
  if (body && typeof body.provider === "string" && body.provider.trim()) provider = body.provider.trim();
  if (body && typeof body.model === "string" && body.model.trim()) model = body.model.trim();
  // An empty value means "follow the model's default" (omit the field entirely).
  if (body && typeof body.reasoningEffort === "string") reasoningEffort = body.reasoningEffort.trim();
  return { provider, model, reasoningEffort };
}

function makeMessages(system, user) {
  return [
    {
      id: randomUUID(),
      role: "system",
      content: [{ type: "text", text: system }],
      source: { kind: "system-prompt" },
    },
    {
      id: randomUUID(),
      role: "user",
      content: [{ type: "text", text: user }],
      source: { kind: "external", form: "english-lit-reader" },
    },
  ];
}

function splitIntoChunks(text, maxChars) {
  const chunks = [];
  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    let piece = paragraph.trim();
    while (piece.length > maxChars) {
      flush();
      let cut = piece.lastIndexOf(" ", maxChars);
      if (cut < Math.floor(maxChars / 2)) cut = maxChars;
      chunks.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trimStart();
    }
    if (!piece) continue;
    if (current && current.length + piece.length + 2 > maxChars) flush();
    current = current ? current + "\n\n" + piece : piece;
  }
  flush();
  return chunks;
}

// (v14 #1) Build translation units for a SELECTED passage. Unlike full-text
// chunking this NEVER slices at an arbitrary character offset: each unit groups
// whole sentences, so a sentence is never cut in half. `sep` is the OUTPUT
// separator owed before that unit's translation: "" for a continuation (Chinese
// sentences run together) and "\n\n" only at a genuine paragraph break. A
// single continuous abstract <= maxChars becomes exactly ONE unit -> one model
// call -> one unbroken Chinese passage, which is the reported bug fixed.
function planSelection(text, maxChars) {
  const units = [];
  const paragraphs = text.split(/\n{2,}/);
  let buf = "";
  let pendingSep = "";
  let isFirst = true;
  const flush = () => {
    const t = buf.trim();
    if (!t) { buf = ""; return; }
    units.push({ text: t, sep: isFirst ? "" : pendingSep });
    isFirst = false;
    buf = "";
    pendingSep = "";
  };
  for (let p = 0; p < paragraphs.length; p++) {
    const para = (paragraphs[p] || "").trim();
    if (!para) continue;
    if (p > 0) { flush(); pendingSep = "\n\n"; }
    // Sentence boundary: end punctuation + whitespace + a capital / digit /
    // opening quote. "e.g., local weather" is followed by lower case, so it
    // is not mistaken for a sentence end.
    const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/);
    for (let i = 0; i < sentences.length; i++) {
      const s = (sentences[i] || "").trim();
      if (!s) continue;
      const candidate = buf ? buf + " " + s : s;
      if (buf && candidate.length > maxChars) {
        flush();               // a continuation unit: separator stays ""
        buf = s;
      } else {
        buf = candidate;
      }
    }
  }
  flush();
  // Last resort for one sentence longer than the cap: hard-split at a space but
  // keep the pieces adjacent (sep "") so no fake blank line is introduced.
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.text.length <= maxChars) { out.push(u); continue; }
    let rest = u.text;
    let first = true;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < Math.floor(maxChars / 2)) cut = maxChars;
      out.push({ text: rest.slice(0, cut).trim(), sep: first ? u.sep : "" });
      first = false;
      rest = rest.slice(cut).trimStart();
    }
    if (rest.trim()) out.push({ text: rest.trim(), sep: first ? u.sep : "" });
  }
  return out;
}

// (v16) Models routinely mirror the SOURCE line breaks, so a translation comes
// back with a newline after almost every clause ("在训练过程中，\n训练轮数…").
// That is typography, not structure: the reported bug was exactly these extra
// newlines. Every translated piece is therefore re-flowed here - a paragraph is
// joined back into ONE continuous line (no space when the boundary is between
// two CJK characters, one space when Latin words would otherwise collide), and
// only a genuine blank line survives as a paragraph break.
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
function joinTranslatedLines(value) {
  const text = String(value == null ? "" : value).replace(/\r\n?/g, "\n");
  if (!text) return "";
  const paragraphs = text.split(/\n{2,}/);
  const out = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const lines = paragraphs[p].split("\n");
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) kept.push(line);
    }
    if (!kept.length) continue;
    let merged = kept[0];
    for (let i = 1; i < kept.length; i++) {
      const prev = merged.charAt(merged.length - 1);
      const next = kept[i].charAt(0);
      const glue = CJK_RE.test(prev) || CJK_RE.test(next) ? "" : " ";
      merged += glue + kept[i];
    }
    out.push(merged);
  }
  return out.join("\n\n");
}

async function runModel(llm, options) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : MODEL_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let out = "";
  try {
    const call = {
      provider: options.provider,
      model: options.model,
      messages: makeMessages(options.system, options.user),
      signal: controller.signal,
    };
    // Only set reasoningEffort when the user picked an explicit tier; an
    // omitted field lets the Host materialize the model's defaultEffort.
    if (options.reasoningEffort) call.reasoningEffort = options.reasoningEffort;
    const stream = llm.stream(call);
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== "object") continue;
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        out += chunk.text;
      } else if (chunk.type === "finish") {
        const reason = chunk.reason;
        if (reason && reason.kind === "error") {
          const failure = reason.failure;
          const message = failure && (failure.message || failure.code) ? failure.message || failure.code : "model error";
          throw new Error(String(message));
        }
        if (reason && reason.kind === "aborted") throw new Error("model call aborted (timeout)");
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return out.trim();
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = [];
  const count = Math.max(1, Math.min(limit, items.length || 1));
  for (let i = 0; i < count; i++) {
    runners.push((async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = { ok: true, value: await worker(items[index], index) };
        } catch (error) {
          results[index] = { ok: false, error: safeMessage(error) };
        }
      }
    })());
  }
  await Promise.all(runners);
  return results;
}

function caption(title, index, total) {
  return title + "（第 " + (index + 1) + (total ? " / " + total : "") + " 段）：";
}

// ---------------------------------------------------------------------------
// Model catalog. listProviders() is synchronous; listModels()/resolveModelInfo()
// are Host-only async helpers (NOT @Remote), so the browser reaches them through
// these HTTP routes. Each adapter lookup is time-boxed so one slow/unreachable
// provider cannot stall the whole catalog.
// ---------------------------------------------------------------------------
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("catalog lookup timed out")), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function catalogProviders(llm) {
  let listed = [];
  try {
    if (typeof llm.listProviders === "function") listed = llm.listProviders() || [];
  } catch (_) {}
  if (!Array.isArray(listed)) listed = [];
  const providers = [];
  for (const raw of listed) {
    const id = (raw && (typeof raw.id === "string" ? raw.id : (typeof raw.provider === "string" ? raw.provider : ""))) || "";
    if (!id) continue;
    const name = (raw && (typeof raw.name === "string" && raw.name ? raw.name : (typeof raw.displayName === "string" && raw.displayName ? raw.displayName : ""))) || id;
    let models = [];
    try {
      const found = typeof llm.listModels === "function"
        ? await withTimeout(llm.listModels(id), EFFORT_TIMEOUT_MS)
        : [];
      if (Array.isArray(found)) {
        models = found
          .filter((m) => m && typeof m.id === "string" && m.id)
          .map((m) => ({ id: m.id, name: (typeof m.name === "string" && m.name) ? m.name : m.id }));
      }
    } catch (_) {}
    providers.push({ id, name, models });
  }
  return providers;
}

async function modelEfforts(llm, provider, model) {
  let info = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EFFORT_TIMEOUT_MS);
    try {
      info = await withTimeout(llm.resolveModelInfo(provider, model, controller.signal), EFFORT_TIMEOUT_MS);
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    info = null;
  }
  const reasoning = info && info.reasoning;
  if (reasoning && Array.isArray(reasoning.efforts) && reasoning.efforts.length) {
    return {
      efforts: reasoning.efforts
        .filter((e) => e && typeof e.id === "string" && e.id)
        .map((e) => ({ id: e.id, name: (typeof e.name === "string" && e.name) ? e.name : e.id })),
      defaultEffort: typeof reasoning.defaultEffort === "string" ? reasoning.defaultEffort : "",
      fallback: false,
    };
  }
  return {
    efforts: FALLBACK_EFFORTS.map((id) => ({ id, name: id })),
    defaultEffort: "",
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// (v52) Reference engine, stage 1 — locating and segmenting the bibliography.
//
// The old path trimmed the last 40,000 characters of the document and let the
// model invent the entry boundaries. Both halves of that were wrong: a long
// appendix after the bibliography pushed real entries out of the window, and a
// single JSON array of 81 items came back truncated with no way to tell. The
// pipeline is now staged so the ORIGINAL entries are on screen before any model
// call happens, and every later stage fills fields in by a stable id:
//
//   extract  -> section lines -> entries {id, number, pages, raw}   (no model)
//   fields   -> title / zh / venue / year for a batch of ids        (model)
//   resolve  -> a link for each entry that has no identifier yet    (HTTP)
//
// Nothing here is allowed to drop an entry silently: a section we fail to split
// comes back as one `unsplit` block so the UI can show the original and offer to
// retry, which is far more useful than an empty column.
// ---------------------------------------------------------------------------
const REFERENCE_HEADING_RE = /^\s*(?:(?:\d+|[IVXLC]+)[.)]?\s*)?(references|bibliography|works\s+cited|literature\s+cited|参考文献|引用文献)\s*[:：]?\s*$/i;
const REFERENCE_END_RE = /^\s*(?:(?:\d+|[IVXLC]+)[.)]?\s*)?(appendix|appendices|supplementary|supplemental|supporting\s+information|acknowledge?ments?\b|author\s+biograph|about\s+the\s+authors|附录|致谢|补充材料)/i;
// A caption line never opens a bibliography entry, so its presence proves we have
// left the reference section — this is what catches the very common layout whose
// appendix heading is a bare letter ("E Experimental Details") that no word list
// can recognise.
const REFERENCE_CAPTION_RE = /^\s*(?:table|figure|fig\.)\s*[A-Z]?\d+[.:)]/i;
// Page renders in the appendix often start with a bare folio number. A line that
// is ONLY a number is not an entry body, but folios also appear INSIDE a long
// bibliography, so this is used as a boundary only together with a caption.
const PAGE_FOLIO_RE = /^\s*\d{1,4}\s*$/;
// How much text one entry may accumulate before the region is judged to have run
// past the bibliography. Real entries are a handful of lines; the appendix being
// welded onto the last entry is what this catches, and the cut is reported.
const MAX_ENTRY_CHARS = 2000;
const MAX_ENTRY_LINES = 14;
// Leading numbers: "[12]", "12.", "12)", "(12)". The bracket form is the one that
// actually survives PDF extraction with a stable shape, so it is tried first.
const REFERENCE_NUMBER_RES = [
  /^\s*\[(\d{1,3})\]\s*/,
  /^\s*\((\d{1,3})\)\s*/,
  /^\s*(\d{1,3})[.)]\s+/,
];
// Author-year fallback: "Surname, A." / "Surname, A., Surname, B." at line start.
const AUTHOR_YEAR_START_RE = /^[A-Z][A-Za-z\u00c0-\u024f'’\-]{1,30},\s*(?:[A-Z]\.|[A-Z][a-z]+|&)/;
// (v52) What makes a numbered line a CITATION rather than a numbered paragraph.
// An appendix step ("1. We read in O(BLD+DN) bytes of memory …") carries none of
// these, and the bibliography never resumes after prose, so the first numbered
// block without any signal marks the end of the section.
const CITATION_YEAR_RE = /\b(19|20)\d{2}\b/;
const CITATION_VENUE_RE = /\b(proceedings|journal|conference|transactions|symposium|workshop|arxiv|doi|vol\.?|pp\.?|eds?\.|press|springer|ieee|acm|neurips|nips|cvpr|iccv|icml|iclr|aaai|acl|emnlp|naacl|ijcai|kdd|sigir|corl|preprint|et al\.)/i;
const CITATION_AUTHOR_RE = /\b[A-Z][a-z]+,\s*(?:[A-Z]\.|[A-Z][a-z]+)|^\s*[A-Z]\.\s+[A-Z][a-z]+/;

// (v52) "Prose" = a full sentence, not a citation fragment. Twelve words plus a
// closing period is the shape of running text; a bibliography line is either much
// shorter ("Mamba codebase.") or carries a marker (a year, a venue, initials).
// This is what stops an appendix paragraph from being absorbed by the last entry.
function isProseLine(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return false;
  if (text.length < 40) return false;
  if (!/[.!?]["'”’)]?$/.test(text)) return false;
  if (CITATION_YEAR_RE.test(text) || CITATION_VENUE_RE.test(text)) return false;
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return words.length >= 12;
}

function looksLikeCitation(raw) {
  const text = String(raw == null ? "" : raw);
  if (CITATION_YEAR_RE.test(text) || CITATION_VENUE_RE.test(text) || CITATION_AUTHOR_RE.test(text)) return true;
  return Boolean(findPrintedIdentifier(text));
}

function splitLines(text) {
  const source = String(text == null ? "" : text);
  const raw = source.split(/\r\n?|\n/);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i].replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    if (value) out.push({ t: value, page: 0, line: out.length });
  }
  return out;
}

/**
 * Find the bibliography inside an ordered line list.
 *
 * Preference order matters: a standalone heading is the strongest signal, but
 * many PDFs render the heading as a running head or lose it entirely, so a
 * numbering run in the last third of the document is accepted as a fallback.
 * The section ENDS at the next real section heading — that single rule is what
 * keeps a 60-page appendix from shadowing the entries.
 */
function locateReferenceLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return { lines: [], found: false, reason: "empty" };
  let start = -1;
  // Scan from the END: a mid-document "References" in a table of contents or in
  // the phrase "see References" must not win over the real bibliography.
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].t;
    if (text.length > 60) continue;
    if (!REFERENCE_HEADING_RE.test(text)) continue;
    // A heading is followed by reference-like lines, not by prose. A short tail
    // (fewer than 6 lines left) settles for 2 confirmations — otherwise a real but
    // small bibliography was rejected outright; a mid-document "References" in a
    // table of contents always has a long tail, so the 3-hit guard still holds there.
    const need = lines.length - (i + 1) < 6 ? 2 : 3;
    if (looksLikeReferenceRun(lines, i + 1, need) || i >= lines.length - 3) { start = i + 1; break; }
  }
  let found = start !== -1;
  if (!found) {
    // Fallback: the longest run of numbered entries anywhere after the halfway
    // point. Short documents are skipped — numbering in a table of contents is
    // the usual false positive there.
    let best = { from: -1, count: 0 };
    let from = -1;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const numbered = Boolean(matchReferenceNumber(lines[i].t));
      if (numbered) {
        if (from === -1) from = i;
        count += 1;
      } else if (from !== -1 && lines[i].t.length > 0) {
        if (count > best.count) best = { from, count };
        if (count >= 3 && i < lines.length - 40) { from = -1; count = 0; }
        else { from = -1; count = 0; }
      }
    }
    if (count > best.count) best = { from, count };
    if (best.count >= 3) { start = best.from; found = true; }
  }
  if (start === -1) return { lines: [], found: false, reason: "no-heading" };
  let end = lines.length;
  let endReason = "document-end";
  for (let i = start; i < lines.length; i++) {
    const text = lines[i].t;
    if (text.length > 80) continue;
    // (v52) The word list alone is not enough. Most papers put the appendix AFTER
    // the bibliography under a heading that is just a letter and a title
    // ("E Experimental Details and Additional Results"), which no keyword list
    // recognises — so the tail of the document silently became part of the last
    // entry, and its numbered procedure lines were then read as citations. Any
    // table/figure caption is proof that we are past the bibliography.
    if (REFERENCE_END_RE.test(text)) { end = i; endReason = "heading"; break; }
    if (REFERENCE_CAPTION_RE.test(text)) { end = i; endReason = "caption"; break; }
  }
  const slice = lines.slice(start, end);
  let chars = 0;
  const capped = [];
  for (const line of slice) {
    chars += line.t.length + 1;
    if (chars > MAX_REFERENCE_CHARS) return { lines: capped, found, reason: "capped", start, end, fullLength: slice.length };
    capped.push(line);
  }
  return { lines: capped, found, reason: found ? "heading" : "numbering", start, end, endReason };
}

function looksLikeReferenceRun(lines, from, need) {
  let hits = 0;
  const limit = Math.min(lines.length, from + need + 4);
  for (let i = from; i < limit && hits < need; i++) {
    const text = lines[i].t;
    if (matchReferenceNumber(text)) { hits += 1; continue; }
    // An author–year citation ("LeCun, Y. Deep learning. Nature 521 (2015).") has no
    // leading number, so a numbered-only test would reject a perfectly good heading
    // above it. Accept the author-start shape together with a year.
    if (AUTHOR_YEAR_START_RE.test(text) && /\b(19|20)\d{2}\b/.test(text)) { hits += 1; continue; }
    if (/\b(19|20)\d{2}\b/.test(text) && /\b(doi|vol|pp|proceedings|journal|transactions|conference)\b/i.test(text)) hits += 1;
  }
  return hits >= need;
}

function matchReferenceNumber(text) {
  for (const re of REFERENCE_NUMBER_RES) {
    const m = re.exec(text);
    if (m) return { number: m[1], rest: text.slice(m[0].length) };
  }
  return null;
}

/**
 * Group reference lines into entries while keeping the original text intact.
 *
 * `raw` is the verbatim concatenation of the entry's lines, so the reader can
 * always check us against the page even when a title or venue was parsed badly.
 */
function segmentReferenceEntries(lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return { entries: [], mode: "none" };
  const numbered = list.filter((line) => matchReferenceNumber(line.t)).length;
  const authorYear = list.filter((line) => AUTHOR_YEAR_START_RE.test(line.t) && !matchReferenceNumber(line.t)).length;
  // Numbering must be the dominant shape, otherwise a stray "[1]" citation in a
  // sentence would split the section at the wrong place.
  const useNumbering = numbered >= 2 && numbered * 2 >= authorYear;
  const useAuthorYear = !useNumbering && authorYear >= 3;
  if (!useNumbering && !useAuthorYear) {
    // Nothing reliable to split on. Return the section as ONE block: the caller
    // shows the original text and offers to re-run with the model.
    return {
      entries: [{
        index: 0,
        number: "",
        pages: pageRange(list),
        raw: list.map((line) => line.t).join("\n").slice(0, 20000),
        lineFrom: 0,
        lineTo: list.length - 1,
        split: false,
      }],
      mode: "unsplit",
    };
  }
  const entries = [];
  let current = null;
  const push = () => {
    if (current && current.parts.length) {
      const raw = current.parts.join("\n");
      if (raw.trim()) {
        entries.push({
          index: entries.length,
          number: current.number,
          pages: current.pages,
          raw: raw.slice(0, 20000),
          lineFrom: current.lineFrom,
          lineTo: current.lineTo,
          split: true,
        });
      }
    }
    current = null;
  };
  // (v52) An entry cannot grow without bound. When the bibliography is followed by
  // prose that no heading marks (an appendix, a long caption block), every line
  // used to be appended to the LAST entry — which is exactly how four numbered
  // steps of an appendix came to be read as four extra citations. A run that
  // exceeds the shape of a real entry now ends the section instead, and the
  // caller reports how much was left unread so the reader can see why.
  let cutAt = -1;
  const tooLong = (parts) => {
    if (parts.length > MAX_ENTRY_LINES) return true;
    let size = 0;
    for (const part of parts) size += part.length + 1;
    return size > MAX_ENTRY_CHARS;
  };
  for (let i = 0; i < list.length; i++) {
    const line = list[i];
    const text = line.t;
    if (useNumbering) {
      const num = matchReferenceNumber(text);
      if (num) {
        push();
        current = { number: num.number, parts: [num.rest || text], pages: pageRange([line]), lineFrom: i, lineTo: i };
        continue;
      }
    } else if (AUTHOR_YEAR_START_RE.test(text) && current && /\b(19|20)\d{2}\b/.test(current.parts.join(" "))) {
      push();
      current = { number: "", parts: [text], pages: pageRange([line]), lineFrom: i, lineTo: i };
      continue;
    }
    if (!current) {
      current = { number: "", parts: [text], pages: pageRange([line]), lineFrom: i, lineTo: i };
    } else {
      if (tooLong(current.parts.concat([text]))) { cutAt = i; break; }
      // Prose after a citation ends the section. This is the appendix case that a
      // heading word list cannot catch: the last entry keeps absorbing paragraphs
      // of running text and its numbered steps then read as citations.
      if (isProseLine(text) && current.parts.length >= 1 && looksLikeCitation(current.parts.join(" "))) { cutAt = i; break; }
      current.parts.push(text);
      current.lineTo = i;
      const p = current.pages;
      const q = pageRange([line]);
      if (q) current.pages = p && q !== p ? p + "–" + q : (p || q);
    }
  }
  push();
  // (v52) A numbered line is not automatically a citation. Appendices very often
  // contain a numbered procedure ("1. We read in O(BLD+DN) bytes of memory …"),
  // and in a paper whose appendix follows the bibliography those steps land in the
  // same region and each becomes a fake entry. A real citation carries at least one
  // of: a year, a venue/publisher keyword, an author-with-initials, a DOI/arXiv id.
  // Trailing entries with none of those are cut — but only after an entry that DOES
  // carry a signal, so a bibliography of undated standards is never emptied.
  const signal = (entry) => {
    const raw = entry.raw || "";
    if (CITATION_YEAR_RE.test(raw) || CITATION_VENUE_RE.test(raw) || CITATION_AUTHOR_RE.test(raw)) return true;
    return Boolean(findPrintedIdentifier(raw));
  };
  let last = entries.length - 1;
  while (last >= 0 && !signal(entries[last])) last -= 1;
  if (last >= 0 && last < entries.length - 1 && signal(entries[last])) {
    const dropped = entries.length - 1 - last;
    entries.length = last + 1;
    return {
      entries,
      mode: useNumbering ? "numbering" : "author-year",
      cutAt: cutAt >= 0 ? cutAt : -1,
      tailLines: cutAt >= 0 ? list.length - cutAt : 0,
      droppedTail: dropped,
      // (v53) These dropped entries came from numbered lines after the bibliography
      // (an appendix procedure), not from lines we failed to read — report the count
      // so the UI never says "skipped 0 lines".
      endReason: "non-citation-tail",
    };
  }
  return { entries, mode: useNumbering ? "numbering" : "author-year", cutAt, cutFrom: cutAt >= 0 ? cutAt : -1, tailLines: cutAt >= 0 ? list.length - cutAt : 0 };
}

function pageRange(lines) {
  const pages = lines.map((line) => Number(line.page) || 0).filter((page) => page > 0);
  if (!pages.length) return "";
  const min = Math.min.apply(null, pages);
  const max = Math.max.apply(null, pages);
  return min === max ? String(min) : min + "–" + max;
}

// The highest-confidence identifier is the one printed in the entry itself.
// Line wrapping splits DOIs after "/" all the time, so the compact variant with
// every space removed is searched as well — a DOI never contains a space.
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>,;]+)/i;
const ARXIV_RE = /\barxiv[:\s]*(\d{4}\.\d{4,5})(?:v\d+)?/i;

function findPrintedIdentifier(raw) {
  const text = String(raw == null ? "" : raw);
  if (!text) return null;
  const compact = text.replace(/\s+/g, "");
  for (const haystack of [text, compact]) {
    const doi = DOI_RE.exec(haystack);
    if (doi) {
      const value = stripTrailingPunctuation(doi[1]);
      if (value && value.indexOf("/") > 0) return { kind: "doi", id: value, url: "https://doi.org/" + value };
    }
    const arxiv = ARXIV_RE.exec(haystack);
    if (arxiv) return { kind: "arxiv", id: arxiv[1], url: "https://arxiv.org/abs/" + arxiv[1] };
  }
  return null;
}

function stripTrailingPunctuation(value) {
  return String(value || "").replace(/[.,;:)\]}>'\u2019\u201d]+$/, "");
}

/** Full stage-1 pipeline: raw document text -> stable, ordered entries. */
function segmentText(text) {
  const lines = splitLines(text);
  const located = locateReferenceLines(lines);
  const segmented = segmentReferenceEntries(located.lines);
  return finishSegment(segmented, located);
}

function finishSegment(segmented, located) {
  const entries = segmented.entries.map((entry, index) => {
    // The id is derived from position, not from time or randomness: a re-run on
    // the same document must produce the same ids so already-fetched fields and
    // links can be merged instead of re-queried.
    const printed = findPrintedIdentifier(entry.raw);
    return {
      id: "r" + (index + 1),
      index,
      number: entry.number || "",
      pages: entry.pages || "",
      raw: entry.raw,
      split: entry.split !== false,
      title: "",
      zh: "",
      authors: "",
      venue: "",
      year: "",
      status: printed ? "provided" : "pending",
      url: printed ? printed.url : "",
      doi: printed && printed.kind === "doi" ? printed.id : "",
      identifier: printed ? printed.kind : "",
    };
  });
  return {
    entries: entries.slice(0, MAX_REFERENCE_ENTRIES),
    mode: segmented.mode,
    reason: located.reason,
    // (v52) Report a shortened region rather than hiding it: `tailLines` is how
    // many lines after the cut were NOT read, so the UI can say so and offer the
    // retry instead of pretending the bibliography simply ended there.
    truncated: entries.length > MAX_REFERENCE_ENTRIES || Boolean(located.fullLength) || Boolean(segmented.cutAt >= 0) || Boolean(segmented.droppedTail > 0),
    fullLength: located.fullLength || 0,
    tailLines: segmented.tailLines || 0,
    // (v53) Entries dropped because they were not citations at all — an appendix's
    // numbered procedure. Counted separately from unread lines, and reported to the
    // UI so the hint can name the real reason.
    droppedTail: segmented.droppedTail || 0,
    endReason: segmented.endReason || located.endReason || "",
  };
}

/**
 * P2 fallback for a section that could not be split mechanically.
 *
 * The model never rewrites the text: it only returns line RANGES against a
 * numbering we generated, and the program builds the entries from those ranges.
 * Every range is validated (ascending, non-overlapping, inside bounds) before it
 * is used, so a hallucinated number cannot corrupt the list.
 */
async function segmentByLineRanges(llm, model, lines) {
  const numbered = lines.slice(0, 400).map((line, index) => (index + 1) + "| " + line.t).join("\n");
  const raw = await runModel(llm, {
    provider: model.provider,
    model: model.model,
    reasoningEffort: model.reasoningEffort,
    system: REFERENCE_LINES_SYSTEM,
    user: "编号源文本如下：\n\n" + numbered.slice(0, MAX_REFERENCE_CHARS),
  });
  const ranges = parseObjectArray(raw, ["from", "to"]);
  const entries = [];
  let last = 0;
  for (const item of ranges) {
    const from = Number(item.from);
    const to = Number(item.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const start = Math.max(1, Math.min(lines.length, Math.floor(from)));
    const stop = Math.max(start, Math.min(lines.length, Math.floor(to)));
    // Ascending and non-overlapping: a range that walks backwards or repeats the
    // previous one is discarded rather than silently reordering the bibliography.
    if (start <= last) continue;
    last = stop;
    const slice = lines.slice(start - 1, stop);
    entries.push({
      index: entries.length,
      number: (matchReferenceNumber(slice[0] ? slice[0].t : "") || {}).number || "",
      pages: pageRange(slice),
      raw: slice.map((line) => line.t).join("\n").slice(0, 20000),
      split: true,
    });
  }
  return entries;
}

/** Parse a JSON array of flat objects, tolerating fences and a truncated tail. */
function parseObjectArray(raw, keys) {
  let text = String(raw == null ? "" : raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    // A truncated array (one missing closing bracket) used to zero the column.
    // Salvage the complete objects instead of discarding everything.
    parsed = salvageObjectArray(text, keys);
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const normalized = {};
    for (const key of keys) normalized[key] = typeof item[key] === "string" ? item[key] : (item[key] == null ? "" : String(item[key]));
    if (keys.some((key) => normalized[key])) out.push(normalized);
  }
  return out;
}

function salvageObjectArray(text, keys) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") { if (depth === 0) start = i; depth += 1; }
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const slice = text.slice(start, i + 1);
        try {
          const item = JSON.parse(slice);
          if (item && typeof item === "object" && !Array.isArray(item)) out.push(item);
        } catch (_) {}
        start = -1;
      }
    }
  }
  return out.length ? out : [];
}

/**
 * Stage 2: fill title/zh/authors/venue/year for entries that need it.
 *
 * Entries whose answer is missing are returned untouched rather than dropped —
 * the caller shows the original text and can retry just those ids.
 */
async function fillReferenceFields(llm, model, entries) {
  if (!entries.length) return entries;
  const batches = [];
  let batch = [];
  let chars = 0;
  for (const entry of entries) {
    const length = String(entry.raw || "").length + 40;
    if (batch.length && (batch.length >= REFERENCES_PER_BATCH || chars + length > REFERENCE_BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(entry);
    chars += length;
  }
  if (batch.length) batches.push(batch);
  const byId = new Map();
  for (const group of batches) {
    const payload = group.map((entry) => ({ id: entry.id, entry: String(entry.raw || "").slice(0, 2000), context: "" }));
    let raw = "";
    try {
      raw = await runModel(llm, {
        provider: model.provider,
        model: model.model,
        reasoningEffort: model.reasoningEffort,
        system: REFERENCE_FIELDS_SYSTEM,
        user: "批次的条目如下（JSON）：\n\n" + JSON.stringify(payload, null, 0),
      });
    } catch (_) {
      continue;
    }
    for (const item of parseObjectArray(raw, ["id", "title", "zh", "authors", "venue", "year"])) {
      const id = String(item.id || "");
      if (id && !byId.has(id)) byId.set(id, item);
    }
  }
  return entries.map((entry) => {
    const item = byId.get(entry.id);
    if (!item) return entry;
    return Object.assign({}, entry, {
      title: String(item.title || "").trim().slice(0, 400),
      zh: String(item.zh || "").trim().slice(0, 400),
      authors: String(item.authors || "").trim().slice(0, 400),
      venue: String(item.venue || "").trim().slice(0, 200),
      year: String(item.year || "").trim().slice(0, 12),
    });
  });
}

// ---------------------------------------------------------------------------
// (v52) Reference engine, stage 3 — address resolution.
//
// Two things were measurably broken. First, matching was one-directional: the
// shorter title's vocabulary was looked up inside the longer one, so
// "Generative Adversarial Networks" vs a printed "Generative Adversarial Nets"
// scored 0.67 (same work, rejected) while "Deep Learning" vs "A Survey of Deep
// Learning" scored 1.00 (different works, accepted). Coverage is now required in
// BOTH directions, checked against the query we sent (never the printed raw
// entry, which carries authors and page numbers), and a generic qualifier on
// either side (survey/review/erratum…) can only reduce confidence.
//
// Second, every non-200 was reported as "no match". A burst of 429s therefore
// painted the whole column 未找到 even though the paper has a perfectly good
// DOI. Statuses are now distinct: `provided` (printed in the entry itself),
// `matched`, `none`, `confirm` (link shown but flagged) and `retry` (transient
// failure). Only `retry` entries are re-queried by 「重试失败项」.
//
// A single global queue serialises outbound lookups and spaces them by
// RESOLVER_MIN_INTERVAL_MS, which is what makes 429s rare in the first place;
// the ones that still happen are retried with backoff instead of being lost.
// ---------------------------------------------------------------------------
let resolverChain = Promise.resolve();
let resolverLastAt = 0;

function resolverPace() {
  // Chained through ONE promise so concurrent callers cannot all read the same
  // "last request" timestamp and fire simultaneously.
  const wait = Math.max(0, RESOLVER_MIN_INTERVAL_MS - (Date.now() - resolverLastAt));
  resolverChain = resolverChain.then(() => new Promise((resolve) => {
    const timer = setTimeout(resolve, wait);
    if (timer && typeof timer.unref === "function") timer.unref();
  })).then(() => { resolverLastAt = Date.now(); });
  return resolverChain;
}

function httpGetJson(url, headers, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let request;
    try {
      request = httpsGet(url, { headers }, (response) => {
        const status = Number(response.statusCode) || 0;
        if (status !== 200) {
          // 429/5xx are TRANSIENT and must stay distinguishable from "no match".
          response.resume();
          done({ ok: false, status, transient: status === 429 || status === 408 || status >= 500, retryAfter: Number(response.headers && response.headers["retry-after"]) || 0 });
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size <= 512 * 1024) chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            done({ ok: true, status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), limit: Number(response.headers && response.headers["x-rate-limit-limit"]) || 0 });
          } catch (_) {
            done({ ok: false, status, transient: true, body: null });
          }
        });
        response.on("error", () => done({ ok: false, status, transient: true }));
      });
    } catch (_) {
      return done({ ok: false, status: 0, transient: true });
    }
    request.setTimeout(timeoutMs || RESOLVER_TIMEOUT_MS, () => {
      try { request.destroy(); } catch (_) {}
      done({ ok: false, status: 0, transient: true });
    });
    request.on("error", () => done({ ok: false, status: 0, transient: true }));
  });
}

/** Run an outbound lookup through the shared queue, retrying transient errors. */
async function resolverFetch(url, headers) {
  let last = null;
  for (let attempt = 0; attempt < RESOLVER_MAX_ATTEMPTS; attempt++) {
    await resolverPace();
    last = await httpGetJson(url, headers, RESOLVER_TIMEOUT_MS);
    if (last.ok) return last;
    if (!last.transient) return last;
    const hinted = last.retryAfter > 0 ? Math.min(last.retryAfter * 1000, 8000) : 0;
    const backoff = hinted || RESOLVER_BACKOFF_MS[Math.min(attempt, RESOLVER_BACKOFF_MS.length - 1)];
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, backoff);
      if (timer && typeof timer.unref === "function") timer.unref();
    });
  }
  return last;
}

// Word-level comparison used for BOTH directions. Digits and short tokens are
// kept: "GPT-4" vs "GPT-3" and "ResNet-50" vs "ResNet-101" differ only there.
function titleWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 1 || /\d/.test(word));
}

function wordCoverage(from, into) {
  if (!from.length) return 0;
  const target = new Set(into);
  let hit = 0;
  for (const word of from) {
    if (target.has(word)) { hit += 1; continue; }
    // Inflection allowance, but only between words long enough to be a stem match:
    // "forecasting"/"forecast" and "nets"/"networks" pair up (a 4+ character word
    // sharing all but its last letter with a longer one), while "net" must NOT
    // match "network" — three letters is a different word, not an inflection.
    if (word.length >= 4) {
      let found = false;
      for (const other of into) {
        if (other.length < 4) continue;
        if (other.indexOf(word) === 0 || word.indexOf(other) === 0) { found = true; break; }
        let shared = 0;
        const limit = Math.min(word.length, other.length);
        while (shared < limit && word[shared] === other[shared]) shared += 1;
        if (shared >= Math.min(word.length, other.length) - 1) { found = true; break; }
      }
      if (found) hit += 1;
    }
  }
  return hit / from.length;
}

/**
 * Confidence that two titles name the same work, in [0, 1].
 *
 * Symmetric minimum coverage means a title that only covers one direction can
 * never score high: "Deep Learning" is fully contained in "A Survey of Deep
 * Learning", but the survey is not contained in "Deep Learning".
 */
function titleScore(a, b) {
  const left = titleWords(a);
  const right = titleWords(b);
  if (!left.length || !right.length) return 0;
  if (left.join(" ") === right.join(" ")) return 1;
  const forward = wordCoverage(left, right);
  const backward = wordCoverage(right, left);
  const base = Math.min(forward, backward);
  // A qualifier on one side only ("survey"/"review"/"erratum") means the two
  // titles differ by more than wording — cap it below the confirm threshold.
  const qualifier = left.some((w) => TITLE_QUALIFIERS.has(w)) !== right.some((w) => TITLE_QUALIFIERS.has(w));
  return qualifier ? Math.min(base, 0.7) : base;
}

function titleMatches(a, b) {
  return titleScore(a, b) >= TITLE_CONFIRM_MIN;
}

function parseIssuedYear(item) {
  const parts = item && item.issued && item.issued["date-parts"];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0]) return String(parts[0][0]);
  const created = item && item.created && item.created["date-parts"];
  if (Array.isArray(created) && Array.isArray(created[0]) && created[0][0]) return String(created[0][0]);
  return "";
}

function firstString(value) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

// Query shaping matters more than any scoring tweak:
//  - Crossref's `query.bibliographic` is a TITLE field. Stuffing authors and the
//    year into it makes the ranking worse, so authors go to their own parameter.
//  - OpenAlex's `search=` is fuzzy full-text and returns near-miss titles; the
//    `title.search` filter is exact-ish and orders the real paper first.
function firstAuthorSurname(authors) {
  const value = String(authors == null ? "" : authors);
  const first = value.split(/[;,]|\band\b/)[0] || "";
  const cleaned = first.replace(/[^A-Za-z\u00c0-\u024f'’\-\s]/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  // "Ashish Vaswani" → Vaswani; "Vaswani A." → Vaswani; a lone token is kept.
  const word = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return word.length >= 2 ? word.slice(0, 40) : "";
}

function crossrefUrl(title, author) {
  let url = "https://api.crossref.org/works?rows=5"
    + "&select=title,DOI,URL,container-title,issued,author,type"
    + "&query.bibliographic=" + encodeURIComponent(String(title || "").slice(0, 240));
  const surname = firstAuthorSurname(author);
  if (surname) url += "&query.author=" + encodeURIComponent(surname);
  return url;
}

function openAlexUrl(title) {
  return "https://api.openalex.org/works?per-page=5&mailto=" + encodeURIComponent(RESOLVER_MAILTO)
    + "&filter=title.search:" + encodeURIComponent(String(title || "").slice(0, 240));
}

/**
 * Ask both resolvers and pick the best evidence.
 *
 * Crossref is the primary source because its DOI is the article's own; OpenAlex
 * is the fallback that also carries arXiv preprints (`10.48550/arxiv.…`) and
 * conference papers Crossref often lacks. Two strong candidates that disagree
 * are reported as `confirm`, never auto-linked.
 */
async function resolveAddress(entry, signal) {
  const title = String(entry.title == null ? "" : entry.title).trim().slice(0, 240);
  if (!title) return { status: "none", url: "", doi: "", candidates: 0 };
  const wantedYear = /^(19|20)\d{2}$/.test(String(entry.year || "").trim()) ? Number(String(entry.year).trim()) : 0;
  const headers = { "User-Agent": CROSSREF_AGENT, Accept: "application/json" };
  const collected = [];
  let transient = false;

  const crossref = await resolverFetch(crossrefUrl(title, entry.authors), headers);
  if (signal && signal.aborted) return { status: "retry", transient: true, candidates: 0 };
  if (!crossref.ok) {
    if (crossref.transient) transient = true;
  } else {
    const items = (crossref.body && crossref.body.message && crossref.body.message.items) || [];
    for (const item of items) {
      const candidateTitle = firstString(item.title);
      if (!candidateTitle) continue;
      const score = titleScore(candidateTitle, title);
      if (!score) continue;
      const candidateYear = parseIssuedYear(item);
      if (wantedYear && candidateYear && Math.abs(Number(candidateYear) - wantedYear) > 1) continue;
      const doi = typeof item.DOI === "string" ? item.DOI : "";
      collected.push({
        score,
        source: "crossref",
        title: candidateTitle,
        doi,
        url: doi ? "https://doi.org/" + doi : firstString(item.URL),
        venue: firstString(item["container-title"]),
        year: candidateYear,
        // Deposits carry a type: a `posted-content` record with the paper's title
        // (and often its real author list) is a PREPRINT MIRROR, not the article.
        // It must not outrank the published version, so it is scored down and can
        // never reach "matched" on its own.
        preprint: String(item.type || "").toLowerCase() === "posted-content",
      });
    }
  }

  // Only reach for the second service when the first found nothing convincing —
  // every extra request eats into the shared rate budget.
  const bestSoFar = collected.reduce((acc, item) => (item.preprint ? acc : Math.max(acc, item.score)), 0);
  if (bestSoFar < TITLE_MATCH_MIN) {
    const openalex = await resolverFetch(openAlexUrl(title), { "User-Agent": CROSSREF_AGENT, Accept: "application/json" });
    if (signal && signal.aborted) return { status: "retry", transient: true, candidates: 0 };
    if (!openalex.ok) {
      if (openalex.transient) transient = true;
    } else {
      const results = (openalex.body && openalex.body.results) || [];
      for (const item of results) {
        const candidateTitle = firstString(item.title) || firstString(item.display_name);
        if (!candidateTitle) continue;
        const score = titleScore(candidateTitle, title);
        if (!score) continue;
        const candidateYear = String(item.publication_year || "");
        if (wantedYear && candidateYear && Math.abs(Number(candidateYear) - wantedYear) > 1) continue;
        const doi = String(item.doi || "").replace(/^https?:\/\/doi\.org\//i, "");
        const venue = (item.primary_location && item.primary_location.source && item.primary_location.source.display_name) || "";
        collected.push({
          score,
          source: "openalex",
          title: candidateTitle,
          doi,
          url: doi ? "https://doi.org/" + doi : String(item.id || ""),
          venue,
          year: candidateYear,
          // An arXiv DOI is a legitimate citation target, not a downgrade.
          preprint: /^10\.48550\/arxiv\./i.test(doi) ? false : item.type === "preprint",
        });
      }
    }
  }

  collected.sort((a, b) => b.score - a.score);
  const best = collected[0];
  if (!best || best.score < TITLE_CONFIRM_MIN) {
    if (transient) return { status: "retry", transient: true, candidates: collected.length };
    return { status: "none", url: "", doi: "", candidates: collected.length };
  }
  // A near-tie between two different DOIs is exactly the survey-vs-paper case:
  // show the top one but make the reader confirm.
  const rival = collected.find((item) => item !== best && item.doi && item.doi !== best.doi && best.score - item.score < 0.12);
  // A mirror can be shown but never auto-accepted: the reader must confirm that
  // this really is the address of the paper they are reading.
  const confident = best.score >= TITLE_MATCH_MIN && !rival && !best.preprint;
  return {
    status: confident ? "matched" : "confirm",
    url: best.url,
    doi: best.doi,
    title: best.title,
    venue: best.venue,
    year: best.year,
    score: Math.round(best.score * 100) / 100,
    candidates: collected.length,
  };
}

// ---------------------------------------------------------------------------
// (v12) Fast default model for whole-document work.
//
// The profile's agent default can be a slow reasoning model (e.g. workbuddy /
// hy4free, which only offers the "high" tier). On such a model a 1200-char
// translation chunk exceeds the 120s per-call timeout, so full-text translation
// returned "[本段翻译失败: model call aborted (timeout)]" for whole papers.
// When the user has NOT explicitly picked a model in the dropdown, the Client
// sends fastModel:true and we pick a catalog-verified flash-class model instead.
// An explicit user selection is always honoured.
// ---------------------------------------------------------------------------
const FAST_MODEL_CANDIDATES = [
  { provider: "workbuddy", model: "deepseek-v4.1-flash" },
  { provider: "deepseek-account", model: "deepseek-flash" },
  { provider: "workbuddy", model: "minimax-m3.1-flash" },
  { provider: "workbuddy", model: "glm-5.3-flash" },
  { provider: "deepseek-account", model: "deepseek-v4-pro" },
  { provider: "workbuddy", model: "deepseek-v4-pro" },
];
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
let fastModelCache = { at: 0, value: null };

async function pickFastModel(llm) {
  const now = Date.now();
  if (fastModelCache.value && now - fastModelCache.at < MODEL_CACHE_TTL_MS) return fastModelCache.value;
  const providers = Array.from(new Set(FAST_MODEL_CANDIDATES.map((c) => c.provider)));
  const lists = await Promise.all(providers.map(async (provider) => {
    const ids = new Set();
    try {
      const found = typeof llm.listModels === "function"
        ? await withTimeout(llm.listModels(provider), 4000)
        : [];
      if (Array.isArray(found)) {
        for (const m of found) if (m && typeof m.id === "string" && m.id) ids.add(m.id);
      }
    } catch (_) {}
    return ids;
  }));
  const byProvider = new Map();
  providers.forEach((p, i) => byProvider.set(p, lists[i]));
  let value = null;
  for (const candidate of FAST_MODEL_CANDIDATES) {
    const ids = byProvider.get(candidate.provider);
    if (ids && ids.has(candidate.model)) {
      value = { provider: candidate.provider, model: candidate.model };
      break;
    }
  }
  if (value) fastModelCache = { at: now, value };
  return value;
}

async function resolveEffectiveModel(ctx, llm, body) {
  const resolved = resolveModel(ctx, body);
  if (!body || !body.fastModel) return { ...resolved, fast: false };
  try {
    const fast = await pickFastModel(llm);
    // Reset the effort: the profile tier (e.g. "high"/"max") belongs to the
    // slow model and is often unsupported on the flash model.
    if (fast) return { provider: fast.provider, model: fast.model, reasoningEffort: "", fast: true };
  } catch (_) {}
  return { ...resolved, fast: false };
}

// ---------------------------------------------------------------------------
// Vendored pdf.js assets. The Web GUI loads them as same-origin classic
// scripts / stylesheets from BASE + "/vendor/...". A single prefix route owns
// the whole directory; only the whitelisted files are ever read from disk.
// ---------------------------------------------------------------------------
const VENDOR_PREFIX = BASE + "/vendor/";
const VENDOR_DIR = new URL("./vendor/", import.meta.url);
const VENDOR_TYPES = {
  "pdf.min.js": "application/javascript; charset=utf-8",
  "pdf.worker.min.js": "application/javascript; charset=utf-8",
  "pdf_viewer.js": "application/javascript; charset=utf-8",
  "pdf_viewer.css": "text/css; charset=utf-8",
  "PDFJS-LICENSE": "text/plain; charset=utf-8",
  "katex/katex.min.js": "application/javascript; charset=utf-8",
  "katex/katex.min.css": "text/css; charset=utf-8",
  "katex/KATEX-LICENSE": "text/plain; charset=utf-8",
};
// KaTeX ships ~20 woff2 font files. They live under vendor/katex/fonts/ and are
// served by extension so new fonts do not need a registry entry.
const VENDOR_EXT_TYPES = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};
// pdf_viewer.css references a few decorative icons under images/. Serve a
// 1x1 transparent GIF for those paths so the console stays clean.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

async function vendorHandler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname = "";
  try { pathname = new URL(req.url || "/", "http://x").pathname; } catch (_) {}
  let rel = pathname.startsWith(VENDOR_PREFIX) ? pathname.slice(VENDOR_PREFIX.length) : "";
  try { rel = decodeURIComponent(rel); } catch (_) {}
  rel = rel.replace(/\\/g, "/");

  let body;
  let type;
  if (Object.prototype.hasOwnProperty.call(VENDOR_TYPES, rel)) {
    type = VENDOR_TYPES[rel];
    try {
      body = await readFile(new URL(rel, VENDOR_DIR));
    } catch (error) {
      res.writeHead(404);
      res.end();
      return;
    }
  } else if (/^katex\/fonts\/[A-Za-z0-9._-]+\.(woff2|woff|ttf)$/.test(rel)) {
    type = VENDOR_EXT_TYPES["." + rel.slice(rel.lastIndexOf(".") + 1)];
    try {
      body = await readFile(new URL(rel, VENDOR_DIR));
    } catch (error) {
      res.writeHead(404);
      res.end();
      return;
    }
  } else if (/^images\/[A-Za-z0-9._-]+$/.test(rel)) {
    body = TRANSPARENT_GIF;
    type = "image/gif";
  } else {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "public, max-age=600",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function buildRoutes(ctx, llm) {
  const routes = [];

  routes.push({
    kind: "prefix",
    path: BASE + "/vendor",
    handler: vendorHandler,
  });

  routes.push({
    path: BASE + "/meta",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
      const { provider, model, reasoningEffort } = resolveModel(ctx, null);
      json(res, 200, { ok: true, provider, model, reasoningEffort, maxSummaryChars: MAX_SUMMARY_CHARS });
    },
  });

  routes.push({
    path: BASE + "/models",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
      try {
        const providers = await catalogProviders(llm);
        const { provider, model, reasoningEffort } = resolveModel(ctx, null);
        json(res, 200, { ok: true, providers, current: { provider, model, reasoningEffort } });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  // Lazy reasoning-tier lookup: resolving model info may hit a provider endpoint,
  // so it is fetched only for the single model the user actually selected.
  routes.push({
    path: BASE + "/efforts",
    handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
      let query = {};
      try { query = new URL(req.url || "/", "http://x").searchParams; } catch (_) {}
      const provider = String(query.get("provider") || "").trim();
      const model = String(query.get("model") || "").trim();
      if (!provider || !model) return json(res, 200, { ok: false, error: "provider and model are required" });
      try {
        const result = await modelEfforts(llm, provider, model);
        json(res, 200, { ok: true, provider, model, ...result });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  routes.push({
    path: BASE + "/translate",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(res, 200, { ok: false, error: "text must be a non-empty string" });
      const wholeText = Boolean(body.full);
      const limit = wholeText ? MAX_TRANSLATE_CHARS : MAX_SELECTION_CHARS;
      const clipped = text.slice(0, limit);
      // (v14 #1) A SELECTED passage is translated by sentence-aligned units and
      // reassembled with the real separators, NOT cut into 700-char slices that
      // would break sentences in half. Full-text keeps the proven v12 chunker.
      const planned = wholeText
        ? splitIntoChunks(clipped, TRANSLATE_CHUNK_CHARS).map((c) => ({ text: c, sep: "\n\n" }))
        : planSelection(clipped, SELECTION_UNIT_CHARS);
      const chunks = planned.map((p) => p.text);
      // (v12) Honour an explicit dropdown pick; otherwise fastModel:true asks
      // for a catalog-verified flash-class model so a slow reasoning default
      // cannot stall translation. A failing chunk is retried as smaller halves
      // before it is reported. Concurrency stays at 1 on a slow model because
      // those providers throttle parallel calls.
      const selection = await resolveEffectiveModel(ctx, llm, body);
      const { provider, model, reasoningEffort } = selection;
      const timeoutMs = wholeText ? 90000 : MODEL_TIMEOUT_MS;
      // (v13 #4) A multi-paragraph selection is now several chunks too. On a
      // flash model those are safe to run in parallel, so a long selection does
      // not degrade into a serial wait of one call per paragraph.
      const concurrency = selection.fast ? TRANSLATE_CONCURRENCY : 1;
      const base = {
        provider,
        model,
        reasoningEffort,
        system: TRANSLATE_SYSTEM,
        timeoutMs,
      };
      const translateChunk = async (chunk) => {
        const first = await runModel(llm, { ...base, user: chunk });
        // (v16) Re-flow the model output so intra-paragraph line breaks cannot
        // reach the reader: one paragraph -> one continuous line.
        const cleaned = joinTranslatedLines(first);
        if (cleaned) return cleaned;
        throw new Error("empty translation");
      };
      // (v14 #1) On a selection the retry halves must be rejoined with NO blank
      // line, otherwise a timeout would reintroduce the very break we removed.
      const retrySep = wholeText ? "\n\n" : "";
      const worker = async (chunk) => {
        try {
          return await translateChunk(chunk);
        } catch (error) {
          // Split once and retry the halves serially; this recovers from both
          // per-call timeouts and truncated streams without losing the chunk.
          const halves = splitIntoChunks(chunk, Math.max(180, Math.floor(chunk.length / 2) + 20));
          if (halves.length > 1) {
            const pieces = [];
            for (const half of halves) pieces.push(await translateChunk(half));
            const joined = pieces.join(retrySep).trim();
            if (joined) return joined;
          }
          throw error;
        }
      };
      const results = await mapConcurrent(chunks, concurrency, worker);
      // (v14 #1) Reassemble with the separators recorded at planning time. A
      // single continuous selection has sep "" everywhere -> one unbroken
      // Chinese passage; only real paragraph breaks produce "\n\n".
      let out = "";
      let failedChunks = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const piece = result.ok && result.value
          ? String(result.value).trim()
          : (failedChunks++, "[本段翻译失败: " + result.error + "]");
        out += (planned[i] && planned[i].sep ? planned[i].sep : "") + piece;
      }
      json(res, 200, {
        ok: true,
        text: out.trim(),
        chunks: results.length,
        failedChunks,
        truncated: text.length > limit,
        provider,
        model,
        fast: selection.fast,
      });
    },
  });

  routes.push({
    path: BASE + "/summary",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) return json(res, 200, { ok: false, error: "text must be a non-empty string" });
      const { provider, model, reasoningEffort } = resolveModel(ctx, body);
      const clipped = text.slice(0, MAX_SUMMARY_CHARS);
      try {
        let out;
        let mode;
        let failedChunks = 0;
        if (clipped.length <= SUMMARY_DIRECT_CHARS) {
          out = await runModel(llm, {
            provider,
            model,
            reasoningEffort,
            system: SUMMARY_SYSTEM,
            user: "以下是需要分析的英文论文全文：\n\n" + clipped,
          });
          mode = "direct";
        } else {
          const chunks = splitIntoChunks(clipped, SUMMARY_CHUNK_CHARS);
          const notes = await mapConcurrent(chunks, CONCURRENCY, (chunk, index) => runModel(llm, {
            provider,
            model,
            reasoningEffort,
            system: MAP_SYSTEM,
            user: caption("论文片段", index, chunks.length) + "\n\n" + chunk,
          }));
          const collected = [];
          for (let i = 0; i < notes.length; i++) {
            if (notes[i].ok && notes[i].value) collected.push(caption("第 " + (i + 1) + " 段笔记", i, notes.length) + "\n" + notes[i].value);
            else failedChunks++;
          }
          if (!collected.length) throw new Error("all paper chunks failed: " + safeMessage(notes[0] && notes[0].error));
          out = await runModel(llm, {
            provider,
            model,
            reasoningEffort,
            system: REDUCE_SYSTEM,
            user: "以下是对同一篇论文各片段分别提取的笔记，请据此综合成完整分析：\n\n" + collected.join("\n\n"),
          });
          mode = "map-reduce";
        }
        json(res, 200, {
          ok: true,
          text: out,
          mode,
          failedChunks,
          truncated: text.length > MAX_SUMMARY_CHARS,
        });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  // (v52) Bibliography pipeline, three routes instead of one blocking call.
  //
  //   POST /references/segment  text            -> entries (no model, instant)
  //   POST /references/fields   entries[, ids]   -> title/zh/authors/venue/year
  //   POST /references/resolve  entries          -> address per entry
  //
  // Splitting them is what lets the column show the ORIGINAL entries before any
  // model or network work finishes, and lets a retry touch only the entries that
  // actually failed. /references is kept as a one-shot compatibility shim.
  routes.push({
    path: BASE + "/references/segment",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) return json(res, 200, { ok: false, error: "text must be a non-empty string" });
      if (!/[A-Za-z]/.test(text)) {
        return json(res, 200, { ok: false, error: "no text layer", reason: "no-text" });
      }
      try {
        const lines = splitLines(text);
        const located = locateReferenceLines(lines);
        let segmented = segmentReferenceEntries(located.lines);
        // (v52 P2) A section we cannot split mechanically is handed to the model
        // ONLY when the caller asks for it: the mechanical pass must stay instant
        // so the original text is on screen before any network work starts.
        let modelUsed = false;
        if (segmented.mode === "unsplit" && body.useModel === true && located.lines.length > 1) {
          const { provider, model, reasoningEffort } = await resolveEffectiveModel(ctx, llm, body);
          try {
            const ranges = await segmentByLineRanges(llm, { provider, model, reasoningEffort }, located.lines);
            if (ranges.length > 1) { segmented = { entries: ranges, mode: "line-ranges" }; modelUsed = true; }
          } catch (_) {}
        }
        const outcome = finishSegment(segmented, located);
        json(res, 200, {
          ok: true,
          entries: outcome.entries,
          mode: outcome.mode,
          reason: outcome.reason,
          total: outcome.entries.length,
          truncated: Boolean(outcome.truncated),
          fullLength: outcome.fullLength || 0,
          // (v53) How much of the tail was left unread and why it stopped: the UI
          // says "cut after the last citation, N lines skipped" instead of letting a
          // truncated list look complete.
          tailLines: outcome.tailLines || 0,
          droppedTail: outcome.droppedTail || 0,
          endReason: outcome.endReason || "",
          modelUsed,
        });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  routes.push({
    path: BASE + "/references/fields",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const incoming = Array.isArray(body.entries) ? body.entries : [];
      if (!incoming.length) return json(res, 200, { ok: false, error: "entries must be a non-empty array" });
      const wanted = new Set(Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : []);
      const work = incoming
        .filter((entry) => entry && typeof entry === "object")
        .filter((entry) => !wanted.size || wanted.has(String(entry.id || "")))
        .slice(0, MAX_REFERENCE_ENTRIES);
      if (!work.length) return json(res, 200, { ok: false, error: "no entries to fill" });
      const { provider, model, reasoningEffort } = await resolveEffectiveModel(ctx, llm, body);
      const out = [];
      const failed = [];
      // Batched by COUNT and by CHARACTERS: a batch of ten 2000-char entries
      // would otherwise blow the prompt budget and come back truncated.
      const batches = [];
      let batch = [];
      let chars = 0;
      for (const entry of work) {
        const length = String(entry.raw || "").length + 40;
        if (batch.length && (batch.length >= REFERENCES_PER_BATCH || chars + length > REFERENCE_BATCH_CHARS)) {
          batches.push(batch);
          batch = [];
          chars = 0;
        }
        batch.push(entry);
        chars += length;
      }
      if (batch.length) batches.push(batch);
      for (const group of batches) {
        const payload = group.map((entry) => ({
          id: String(entry.id || ""),
          entry: String(entry.raw || "").slice(0, 2000),
          context: "",
        }));
        let raw = "";
        try {
          raw = await runModel(llm, {
            provider,
            model,
            reasoningEffort,
            system: REFERENCE_FIELDS_SYSTEM,
            user: "批次的条目如下（JSON）：\n\n" + JSON.stringify(payload, null, 0),
          });
        } catch (error) {
          for (const entry of group) failed.push({ id: String(entry.id || ""), error: safeMessage(error) });
          continue;
        }
        const parsed = parseObjectArray(raw, ["id", "title", "zh", "authors", "venue", "year"]);
        const byId = new Map();
        for (const item of parsed) {
          const id = String(item.id || "");
          if (id && !byId.has(id)) byId.set(id, item);
        }
        for (const entry of group) {
          const id = String(entry.id || "");
          const item = byId.get(id);
          if (!item) { failed.push({ id, error: "missing-in-answer" }); continue; }
          out.push({
            id,
            title: String(item.title || "").trim().slice(0, 400),
            zh: String(item.zh || "").trim().slice(0, 400),
            authors: String(item.authors || "").trim().slice(0, 400),
            venue: String(item.venue || "").trim().slice(0, 200),
            year: String(item.year || "").trim().slice(0, 12),
          });
        }
      }
      json(res, 200, { ok: true, fields: out, failed, total: work.length });
    },
  });

  routes.push({
    path: BASE + "/references/resolve",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const incoming = Array.isArray(body.entries) ? body.entries : [];
      if (!incoming.length) return json(res, 200, { ok: false, error: "entries must be a non-empty array" });
      const wanted = new Set(Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : []);
      const work = incoming
        .filter((entry) => entry && typeof entry === "object")
        .filter((entry) => !wanted.size || wanted.has(String(entry.id || "")))
        .slice(0, MAX_REFERENCE_ENTRIES);
      const listed = await mapConcurrent(work, REFERENCE_CONCURRENCY, async (entry) => {
        // (v52) An identifier PRINTED in the entry outranks any lookup: it is the
        // publisher's own DOI, and querying for it can only introduce error.
        const printed = findPrintedIdentifier(entry.raw);
        if (printed) {
          return { id: String(entry.id || ""), status: "provided", url: printed.url, doi: printed.kind === "doi" ? printed.id : "", kind: printed.kind, source: "entry" };
        }
        if (!entry.title) {
          // No title yet means the field stage has not run for this entry; the
          // caller retries it on the next batch instead of recording 未找到.
          return { id: String(entry.id || ""), status: "retry", reason: "no-title" };
        }
        const hit = await resolveAddress(entry, null);
        return { id: String(entry.id || ""), ...hit };
      });
      const results = listed.map((r, index) => (r.ok ? r.value : { id: String((work[index] && work[index].id) || ""), status: "retry", reason: "error" }));
      const counts = { provided: 0, matched: 0, confirm: 0, none: 0, retry: 0 };
      for (const item of results) counts[item.status] = (counts[item.status] || 0) + 1;
      json(res, 200, { ok: true, results, counts, total: results.length });
    },
  });

  // Compatibility shim: the old blocking call still works, but now it runs the
  // same three stages so an existing caller gets the improved data model.
  routes.push({
    path: BASE + "/references",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) return json(res, 200, { ok: false, error: "text must be a non-empty string" });
      try {
        const outcome = segmentText(text);
        if (!outcome.entries.length) {
          return json(res, 200, { ok: false, error: "no reference entries found", entries: [], resolved: 0, reason: outcome.reason, mode: outcome.mode });
        }
        const { provider, model, reasoningEffort } = await resolveEffectiveModel(ctx, llm, body);
        const entries = await fillReferenceFields(llm, { provider, model, reasoningEffort }, outcome.entries);
        const listed = await mapConcurrent(entries, REFERENCE_CONCURRENCY, async (entry) => {
          const printed = findPrintedIdentifier(entry.raw);
          if (printed) return { id: entry.id, status: "provided", url: printed.url, doi: printed.kind === "doi" ? printed.id : "" };
          if (!entry.title) return { id: entry.id, status: "retry", reason: "no-title" };
          return { id: entry.id, ...(await resolveAddress(entry, null)) };
        });
        const byId = new Map();
        for (const item of listed) if (item.ok && item.value) byId.set(item.value.id, item.value);
        const items = entries.map((entry) => {
          const hit = byId.get(entry.id) || { status: "retry" };
          return {
            id: entry.id,
            number: entry.number,
            pages: entry.pages,
            raw: entry.raw,
            en: entry.title,
            zh: entry.zh,
            authors: entry.authors,
            venue: entry.venue,
            year: entry.year,
            status: hit.status,
            found: hit.status === "provided" || hit.status === "matched" || hit.status === "confirm",
            url: hit.url || "",
            doi: hit.doi || "",
            matchedTitle: hit.title || "",
            matchedYear: hit.year || "",
          };
        });
        const resolved = items.filter((item) => item.found).length;
        json(res, 200, {
          ok: true,
          entries: items,
          total: items.length,
          resolved,
          missing: items.length - resolved,
          mode: outcome.mode,
          reason: outcome.reason,
          truncated: Boolean(outcome.truncated),
        });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  // (v8 #3) Selected-formula explanation, grounded in the paper text.
  routes.push({
    path: BASE + "/formula",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const formula = typeof body.formula === "string" ? body.formula.trim() : "";
      if (!formula) return json(res, 200, { ok: false, error: "formula must be a non-empty string" });
      const context = typeof body.context === "string" ? body.context.slice(0, MAX_FORMULA_CONTEXT_CHARS) : "";
      const { provider, model, reasoningEffort } = resolveModel(ctx, body);
      const user = context
        ? "选中的公式：\n\n" + formula.slice(0, MAX_FORMULA_CHARS) + "\n\n论文正文（用于结合上下文解释）：\n\n" + context
        : "选中的公式：\n\n" + formula.slice(0, MAX_FORMULA_CHARS) + "\n\n（未提供论文正文，请仅根据公式本身解释。）";
      try {
        const out = await runModel(llm, {
          provider,
          model,
          reasoningEffort,
          system: FORMULA_SYSTEM,
          user,
        });
        json(res, 200, {
          ok: true,
          text: out,
          formula: formula.slice(0, MAX_FORMULA_CHARS),
          contextChars: context.length,
        });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  // (v35 #1) Selected-term explanation, grounded in the paper's own wording and
  // its field. Same shape as /formula: the paper text is the grounding, not the
  // term alone, which is what separates this from a dictionary.
  routes.push({
    path: BASE + "/term",
    handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });
      if (!originOk(req)) return json(res, 403, { ok: false, error: "origin not trusted" });
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return json(res, 200, { ok: false, error: safeMessage(error) });
      }
      const term = typeof body.term === "string" ? body.term.trim() : "";
      if (!term) return json(res, 200, { ok: false, error: "term must be a non-empty string" });
      const context = typeof body.context === "string" ? body.context.slice(0, MAX_TERM_CONTEXT_CHARS) : "";
      const surrounding = typeof body.surrounding === "string" ? body.surrounding.trim().slice(0, 2000) : "";
      const { provider, model, reasoningEffort } = resolveModel(ctx, body);
      const clipped = term.slice(0, MAX_TERM_CHARS);
      let user = "选中的专业名词：\n\n" + clipped;
      if (surrounding) user += "\n\n该名词所在的原句：\n\n" + surrounding;
      user += context
        ? "\n\n论文正文（用于结合上下文与专业领域解释）：\n\n" + context
        : "\n\n（未提供论文正文，请仅根据该名词本身解释。）";
      try {
        const out = await runModel(llm, {
          provider,
          model,
          reasoningEffort,
          system: TERM_SYSTEM,
          user,
        });
        json(res, 200, {
          ok: true,
          text: out,
          term: clipped,
          contextChars: context.length,
        });
      } catch (error) {
        json(res, 200, { ok: false, error: safeMessage(error) });
      }
    },
  });

  return routes;
}

export function apply(ctx) {
  ctx.inject(["llm", "webServer"], (dep) => {
    const llm = (dep.get && dep.get("llm")) || dep.llm;
    const webServer = (dep.get && dep.get("webServer")) || dep.webServer;
    if (!llm || !webServer) return;
    dep.effect(() => {
      const routes = buildRoutes(ctx, llm);
      const disposers = [];
      for (const route of routes) {
        disposers.push(webServer.register({ kind: route.kind || "exact", path: route.path, handler: route.handler }));
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (_) {}
        }
      };
    }, "english-lit-reader: HTTP routes");
  });
}

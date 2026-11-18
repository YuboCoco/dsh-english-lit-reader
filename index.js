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
const REFERENCES_SYSTEM = [
  "You are a research assistant extracting the bibliography of an English academic paper.",
  "You are given the reference-section text of the paper. Extract EVERY reference entry, in the order it appears.",
  "Output ONLY a JSON array - no prose, no explanation, no code fences.",
  "Each element must be an object with exactly these four string keys:",
  '{"en": "...", "zh": "...", "venue": "...", "year": "..."}',
  "Rules:",
  "(1) en must be the ARTICLE TITLE only - never the authors, never the venue, never the year;",
  "(2) keep formulas, symbols, numbers, acronyms and proper nouns unchanged inside en;",
  "(3) translate en into natural Chinese academic wording for zh - translate the meaning, never transliterate;",
  "(4) for venue use the journal or conference name, and for year the four-digit year; use an empty string when the entry does not state them;",
  "(5) if an entry has no discernible title, put the whole entry in en and your best translation in zh;",
  "(6) never invent an entry, never merge two entries into one, and never output a URL you were not given;",
  "(7) output ONLY the JSON array.",
].join(" ");

const MAX_REFERENCE_CHARS = 40000;
const MAX_REFERENCE_ENTRIES = 80;
const REFERENCE_CONCURRENCY = 3;
const REFERENCE_TIMEOUT_MS = 15000;
// How much of a parsed title's vocabulary a Crossref candidate must reproduce
// before its DOI is accepted. Deliberately strict — a wrong link is worse than
// 未找到, and topic-similar papers routinely differ by a single noun.
const TITLE_MATCH_MIN = 0.85;
// Crossref asks every client to identify itself; the mailto slot is optional.
const CROSSREF_AGENT = "english-lit-reader/1.0.20 (https://localhost; mailto:noreply@example.com)";

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
// (v21 #1) Reference bibliography resolution.
//
// The model is only asked to PARSE the reference list (title + Chinese title +
// venue + year). Address resolution is done here, by Crossref, because a model
// will happily fabricate a DOI. Anything Crossref does not confirm is reported
// with found:false so the UI can print 未找到 instead of a wrong link.
// ---------------------------------------------------------------------------
const REFERENCE_HEADING_RE = /(?:^|\n)\s*(?:\d+\.?\s*)?(references|bibliography|works cited|参考文献|引用文献)\s*(?:\n|$)/i;

function referenceTail(text) {
  const source = String(text == null ? "" : text);
  if (source.length <= MAX_REFERENCE_CHARS) return source;
  // References live at the END of a paper, so a long document is trimmed from the
  // front. Prefer to start right after the last "References" heading.
  const tail = source.slice(source.length - MAX_REFERENCE_CHARS);
  const match = REFERENCE_HEADING_RE.exec(tail);
  if (match) return tail.slice(match.index).slice(0, MAX_REFERENCE_CHARS);
  return tail;
}

function parseReferenceArray(raw) {
  let text = String(raw == null ? "" : raw).trim();
  // The model sometimes wraps the array in a Markdown fence despite the prompt.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const en = typeof item.en === "string" ? item.en.trim() : "";
    if (!en) continue;
    out.push({
      en: en.slice(0, 400),
      zh: typeof item.zh === "string" ? item.zh.trim().slice(0, 400) : "",
      venue: typeof item.venue === "string" ? item.venue.trim().slice(0, 200) : "",
      year: typeof item.year === "string" ? item.year.trim().slice(0, 12) : "",
    });
    if (out.length >= MAX_REFERENCE_ENTRIES) break;
  }
  return out;
}

function crossrefRequest(title, hint, year, signal) {
  return new Promise((resolve) => {
    const wanted = String(title == null ? "" : title).trim();
    if (!wanted) return resolve(null);
    const wantedYear = /^(19|20)\d{2}$/.test(String(year == null ? "" : year).trim())
      ? Number(String(year).trim())
      : 0;
    // The venue is a search HINT only; matching is done against the parsed title
    // alone, otherwise two different papers that merely share a topic ("general
    // time series analysis") score as the same one.
    const query = [wanted, String(hint == null ? "" : hint).trim()].filter(Boolean).join(" ");
    // rows=5: the top hit is often a survey that merely mentions the paper, so
    // every candidate is scored and the best title match wins instead of blindly
    // trusting rank 1.
    const url = "https://api.crossref.org/works?rows=5&select=title,DOI,URL,container-title,issued"
      + "&query.bibliographic=" + encodeURIComponent(query.slice(0, 300));
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request;
    try {
      request = httpsGet(url, {
        headers: {
          "User-Agent": CROSSREF_AGENT,
          Accept: "application/json",
        },
      }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          done(null);
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
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const items = (payload && payload.message && payload.message.items) || [];
            let best = null;
            let bestScore = 0;
            for (const item of items) {
              if (!item) continue;
              const candidate = Array.isArray(item.title) ? (item.title[0] || "") : String(item.title || "");
              if (!candidate) continue;
              let score = titleScore(candidate, wanted);
              // A year mismatch is decisive: conference papers often have no DOI,
              // and Crossref happily returns a same-titled BOOK CHAPTER or a
              // reprint decades later. Trusting it would attach a wrong link.
              if (wantedYear) {
                const parts = item.issued && item.issued["date-parts"];
                const candidateYear = Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0]
                  ? Number(parts[0][0])
                  : 0;
                if (candidateYear && Math.abs(candidateYear - wantedYear) > 1) score = 0;
              }
              if (score > bestScore) { bestScore = score; best = item; }
            }
            // A high bar on purpose: a wrong DOI is worse than 未找到. The score
            // must cover nearly every distinctive word of the parsed title.
            if (!best || bestScore < TITLE_MATCH_MIN) { done(null); return; }
            const matched = Array.isArray(best.title) ? (best.title[0] || "") : String(best.title || "");
            const doi = typeof best.DOI === "string" ? best.DOI : "";
            const venue = Array.isArray(best["container-title"]) ? (best["container-title"][0] || "") : "";
            const parts = best.issued && best.issued["date-parts"];
            const year = Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0] ? String(parts[0][0]) : "";
            done({
              url: doi ? "https://doi.org/" + doi : (typeof best.URL === "string" ? best.URL : ""),
              doi,
              title: matched,
              venue,
              year,
              score: bestScore,
            });
          } catch (_) {
            done(null);
          }
        });
        response.on("error", () => done(null));
      });
    } catch (_) {
      return done(null);
    }
    request.setTimeout(REFERENCE_TIMEOUT_MS, () => {
      try { request.destroy(); } catch (_) {}
      done(null);
    });
    request.on("error", () => done(null));
    if (signal) {
      if (signal.aborted) {
        try { request.destroy(); } catch (_) {}
        return done(null);
      }
      signal.addEventListener("abort", () => {
        try { request.destroy(); } catch (_) {}
        done(null);
      }, { once: true });
    }
  });
}

// Loose title comparison. Normalise case/punctuation, then measure how much of
// the SHORTER title's significant vocabulary appears in the longer one, with a
// prefix allowance so "forecasting" still matches "forecast".
function titleScore(a, b) {
  const norm = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const words = (value) => value.split(/\s+/).filter((w) => w.length > 2);
  const la = words(left);
  const lb = words(right);
  if (!la.length || !lb.length) return 0;
  const small = la.length <= lb.length ? la : lb;
  const big = la.length <= lb.length ? lb : la;
  const bigSet = new Set(big);
  let hit = 0;
  for (const word of small) {
    if (bigSet.has(word)) { hit += 1; continue; }
    // Allow inflection/suffix differences ("forecasting" vs "forecast").
    const stem = word.slice(0, Math.max(4, word.length - 3));
    for (const other of big) {
      if (other.indexOf(stem) === 0) { hit += 1; break; }
    }
  }
  return hit / small.length;
}

function titleMatches(a, b) {
  return titleScore(a, b) >= 0.6;
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

  // (v21 #1) Bibliography extraction + address resolution.
  //
  // Two stages, deliberately separated: the model only parses the reference list
  // into {en, zh, venue, year}; the Host then asks Crossref for an address and
  // keeps it ONLY when the returned title actually resembles the parsed one. An
  // unresolved entry comes back with found:false so the column can print 未找到
  // rather than a plausible-looking but wrong DOI.
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
      const { provider, model, reasoningEffort } = resolveModel(ctx, body);
      const source = referenceTail(text);
      let entries = [];
      let parseError = "";
      try {
        const raw = await runModel(llm, {
          provider,
          model,
          reasoningEffort,
          system: REFERENCES_SYSTEM,
          user: "以下是论文的参考文献部分：\n\n" + source,
        });
        entries = parseReferenceArray(raw);
        if (!entries.length) parseError = "未能从参考文献部分解析出条目";
      } catch (error) {
        parseError = safeMessage(error);
      }
      if (!entries.length) {
        return json(res, 200, { ok: false, error: parseError || "no reference entries found", entries: [], resolved: 0 });
      }
      const listed = await mapConcurrent(entries, REFERENCE_CONCURRENCY, async (entry) => {
        // Resolve by TITLE; the venue only widens the Crossref search.
        const hit = await crossrefRequest(entry.en, entry.venue, entry.year, null);
        return {
          en: entry.en,
          zh: entry.zh,
          venue: (hit && hit.venue) || entry.venue,
          year: (hit && hit.year) || entry.year,
          found: Boolean(hit && hit.url),
          url: hit && hit.url ? hit.url : "",
          doi: hit && hit.doi ? hit.doi : "",
          matchedTitle: hit && hit.title ? hit.title : "",
          matchedYear: hit && hit.year ? hit.year : "",
        };
      });
      const items = listed.map((r, index) => (r.ok ? r.value : {
        en: entries[index] ? entries[index].en : "",
        zh: entries[index] ? entries[index].zh : "",
        venue: entries[index] ? entries[index].venue : "",
        year: entries[index] ? entries[index].year : "",
        found: false,
        url: "",
        doi: "",
        matchedTitle: "",
        matchedYear: "",
      }));
      const resolved = items.filter((item) => item.found).length;
      json(res, 200, {
        ok: true,
        entries: items,
        total: items.length,
        resolved,
        missing: items.length - resolved,
        truncated: text.length > MAX_REFERENCE_CHARS,
      });
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

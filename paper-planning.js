export const REFERENCE_HEADING_RE = /^\s*(?:(?:\d+|[IVXLC]+)[.)]?\s*)?(references|bibliography|works\s+cited|literature\s+cited|参考文献|引用文献)\s*[:：]?\s*$/i;
export const REFERENCE_WINDOW_LINES = 44;
export const REFERENCE_CONTEXT_LINES = 14;
const REFERENCE_WINDOW_CHARS = 6000;

function referenceLines(text, pageLineCounts) {
  const lines = text.split(/\r\n?|\n/).map((line) => line.replace(/[\u00a0\t ]+/g, " ").trim()).filter(Boolean);
  const mapped = Array.isArray(pageLineCounts) && pageLineCounts.every((n) => Number.isSafeInteger(n) && n >= 0)
    && pageLineCounts.reduce((sum, n) => sum + n, 0) === lines.length;
  let page = mapped ? 1 : 0;
  let nextPage = mapped ? pageLineCounts[0] : Infinity;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    while (i >= nextPage) nextPage += pageLineCounts[page++];
    let remaining = lines[i];
    while (remaining.length > 1000) {
      const space = remaining.lastIndexOf(" ", 800);
      const end = space > 400 ? space : 800;
      out.push({ t: remaining.slice(0, end), page });
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) out.push({ t: remaining, page });
  }
  return out;
}

export function planReferenceScan(text, pageLineCounts) {
  const lines = referenceLines(text, pageLineCounts);
  const heading = lines.findIndex((line) => REFERENCE_HEADING_RE.test(line.t));
  // Headings prioritize one window. Every line remains reachable when a
  // heading belongs to the table of contents or the bibliography has no title.
  const pivot = Math.max(0, heading - 3);
  const windows = [];
  let first = 0;
  for (let start = 0; start < lines.length;) {
    if (start === pivot) first = windows.length;
    let end = start;
    let chars = 0;
    const limit = start < pivot ? pivot : lines.length;
    while (end < limit && end - start < REFERENCE_WINDOW_LINES) {
      const length = lines[end].t.length + 16;
      if (end > start && chars + length > REFERENCE_WINDOW_CHARS) break;
      chars += length;
      end++;
    }
    windows.push({ start, end });
    start = end;
  }
  return {
    lines,
    headingLine: heading < 0 ? null : heading + 1,
    windows: heading < 0 ? windows.reverse() : windows.slice(first).concat(windows.slice(0, first).reverse()),
  };
}

export function referenceScanWindow(plan, cursor, retry) {
  const range = Number.isSafeInteger(cursor) && plan.windows[cursor];
  if (!range) return null;
  const context = REFERENCE_CONTEXT_LINES * (retry ? 2 : 1);
  const offset = Math.max(0, range.start - context);
  return {
    cursor,
    windows: plan.windows.length,
    totalLines: plan.lines.length,
    headingLine: plan.headingLine,
    start: range.start,
    end: range.end,
    offset,
    lines: plan.lines.slice(offset, range.end + context),
  };
}

const SUMMARY_HEADINGS = [
  "abstract|introduction|background|related work|preliminaries",
  "methodology|methods?|materials and methods|proposed (?:method|approach)|model architecture",
  "experimental (?:setup|evaluation)|experiments?(?: and (?:analysis|results|evaluation))?|evaluation",
  "(?:main |experimental )?results(?: and discussion)?|ablation(?: study| studies)?|discussion|limitations?",
  "(?:conclusions?|concluding remarks)(?: and (?:future work|outlook))?",
  "references|bibliography|appendix(?: [A-Z0-9]+)?",
].join("|");
const SUMMARY_HEADING_RE = new RegExp("^\\s*(?:(?:\\d+(?:\\.\\d+)*[.)]?|[IVXLCDM]+[.)])\\s+)?("
  + SUMMARY_HEADINGS + ")\\s*[:.]?\\s*$", "i");

export function sectionEnds(text) {
  const boundaries = [];
  // [^\r\n] keeps heading recognition local to one source line.
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    if (match[0].length > 100) continue;
    if (match.index > 0 && SUMMARY_HEADING_RE.test(match[0])) boundaries.push(match.index);
  }
  boundaries.push(text.length);
  return boundaries;
}

export function pageOffsets(text, lengths) {
  if (!Array.isArray(lengths) || lengths.length > 20000) return [];
  let at = 0;
  const pages = [];
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (!Number.isSafeInteger(length) || length < 0) return [];
    if (!length) continue;
    if (pages.length) {
      if (text.slice(at, at + 2) !== "\n\n") return [];
      at += 2;
    }
    pages.push({ start: at, end: at + length, page: i + 1 });
    at += length;
  }
  return at === text.length ? pages : [];
}

export function mergePageRanges(ranges) {
  const merged = [];
  for (const [first, last] of ranges.slice().sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else merged.push([first, last]);
  }
  return merged;
}

export function splitBefore(text, end, minimum) {
  const line = text.lastIndexOf("\n", end - 1);
  if (line >= minimum) return line + 1;
  const space = text.lastIndexOf(" ", end - 1);
  return space >= minimum ? space + 1 : end;
}

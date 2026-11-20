window.__ModuleLoader__.load({
  id: 'dsh-english-lit-reader',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;

    const NS = 'english-lit-reader';
    const BASE = '/plugins/english-lit-reader';
    const VENDOR = BASE + '/vendor/';
    // (v13 #4) A two-paragraph selection easily exceeds 1500 characters; the old
    // hard clip silently dropped the whole latter part before it ever reached the
    // model. Selection text is now allowed to be much longer (the Host guards the
    // upper bound too), and every range of a multi-range selection is captured.
    const MAX_SELECTION = 6000;
    const PAGE_THEMES = ['default', 'paper', 'eye', 'ivory', 'mist', 'sage', 'linen'];
    const UI_TONES = {
      light: ['blue', 'green', 'amber', 'pink'],
      dark: ['navy', 'ink', 'forest', 'plum', 'ember'],
    };
    const FIGURE_LABEL_RE = /^(?:figure|fig\.?|图)\s*([a-z]?\d+|[IVX]+)\b/i;
    const FIGURE_SORT_ORDERS = ['document-asc', 'document-desc', 'time-asc', 'time-desc'];
    const figureNumberOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    // (v13 #1) One coalesced decoration pass per burst of pdf.js page events.
    const DECORATE_DEBOUNCE_MS = 160;
    const SELECTION_DEBOUNCE_MS = 350;
    const CSS_ID = 'english-lit-reader-css';
    const PDFCSS_ID = 'english-lit-reader-pdfcss';
    const KATEXCSS_ID = 'english-lit-reader-katexcss';
    // Cache-buster: a stale browser bundle may still point at the old asset set.
    const ASSET_V = '?v=1.0.53';
    const asset = (name) => VENDOR + name + ASSET_V;
    let planningPromise = null;
    const loadPaperPlanning = () => {
      planningPromise ||= import(BASE + '/paper-planning.js' + ASSET_V).catch((error) => {
        planningPromise = null;
        throw error;
      });
      return planningPromise;
    };

    const SIDE_DEFAULT = 380;
    const SIDE_MIN = 260;
    const SIDE_H_DEFAULT = 320;
    const SIDE_H_MIN = 140;
    const CARD_KEYS = ['selection', 'recent', 'terms', 'marks'];
    const CARD_HEADER_HEIGHT = 40;
    const SELECTION_CARD_MIN_W = 304;
    const SELECTION_CARD_MIN_H = 176;
    const SELECTION_PANE_MIN_W = 102;
    const SELECTION_PANE_MIN_H = 66;
    const SELECTION_SPLITTER_SIZE = 12;
    const MARKS_CARD_MIN_W = 232;
    const MARKS_CARD_MIN_H = 140;
    // (v8 #6) Smallest allowed height of the upper side block (selection card +
    // movable sections) when the user drags the inner splitter.
    const SIDE_TOP_MIN = 90;
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 6;
    // (v20 #3) Presets offered by the zoom dropdown; the free-form number input
    // accepts anything inside ZOOM_MIN..ZOOM_MAX.
    const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];
    const RECENT_MAX = 8;
    const RECENT_TEXT_CAP = 60000;
    const STORE_PREFIX = 'elr.';
    const MODEL_KEY = 'model';
    // (v12) Set when the user actually picks a model in the dropdown. Auto-filled
    // defaults must not count as an explicit choice, otherwise a slow profile
    // default would keep breaking full-text translation.
    const MODEL_PICKED_KEY = 'modelPicked';
    // (v14 #2) Explicit popup font size (px), adjustable with the A−/A+ buttons.
    const POPUP_FONT_KEY = 'popupFont';
    const POPUP_FONT_DEFAULT = 13;
    const POPUP_FONT_MIN = 10;
    const POPUP_FONT_MAX = 24;
    const RECENT_KEY = 'recent';
    // (v24 #2) Which records the "highlights & notes" list shows: 'all' | 'hl' | 'note'.
    const MARK_FILTER_KEY = 'markFilter';
    const SNAP_KEY = 'snapshot';
    const TEXT_SNAP_KEY = 'reader-text';
    const SELECTION_SNAP_KEY = 'reader-selection';
    const DRAFT_RESULT_KEY = 'reader-draft-result';
    const RESULT_PREFIX = 'result.';
    const FIGURES_PREFIX = 'figures.';
    const MARKS_PREFIX = 'marks.';
    // (v35 #1) Per-paper glossary of explained professional terms.
    const TERMS_PREFIX = 'terms.';

    const readStore = (key, fallback) => {
      try {
        const raw = window.localStorage && window.localStorage.getItem(STORE_PREFIX + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) { return fallback; }
    };
    const writeStore = (key, value) => {
      try {
        const store = window.localStorage;
        if (!store) return false;
        store.setItem(STORE_PREFIX + key, JSON.stringify(value));
        return true;
      } catch (_) { return false; }
    };
    // File bytes cannot go into localStorage, but keeping them in memory lets a
    // recent PDF be reopened for as long as this page stays loaded.
    const fileCache = new Map();

    // (v24 #1) Memory alone is not enough: after a reload every recent PDF was
    // gone, so double-clicking an entry could only fall back to the file picker —
    // which is exactly what the user reported as "双击还是让我自己选文件".
    // IndexedDB is the only browser store that accepts a Blob, so the PDF bytes
    // are kept there, keyed by the same id the recent list uses.
    const FILE_DB_NAME = 'english-lit-reader';
    const FILE_DB_STORE = 'files';
    const FILE_DB_MAX_BYTES = 60 * 1024 * 1024;
    const openFileDb = () => new Promise((resolve) => {
      try {
        const idb = window.indexedDB;
        if (!idb) { resolve(null); return; }
        const request = idb.open(FILE_DB_NAME, 1);
        request.onupgradeneeded = () => {
          try { request.result.createObjectStore(FILE_DB_STORE); } catch (_) {}
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    const fileDbTask = (mode, run) => openFileDb().then((db) => new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      let tx;
      try { tx = db.transaction(FILE_DB_STORE, mode); } catch (_) { resolve(null); return; }
      let request;
      try { request = run(tx.objectStore(FILE_DB_STORE)); } catch (_) { resolve(null); return; }
      request.onsuccess = () => resolve(request.result === undefined ? true : request.result);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => { try { db.close(); } catch (_) {} };
    }));
    // A stored record keeps the ORIGINAL name/size/lastModified, because the
    // recent list's `identity` is derived from them: rebuilding a file with a
    // fresh timestamp would create a duplicate entry on every reopen.
    const putStoredFile = (id, file, meta) => {
      if (!id || !file || (Number(file.size) || 0) > FILE_DB_MAX_BYTES) return Promise.resolve(false);
      return fileDbTask('readwrite', (store) => store.put({
        id,
        blob: file,
        name: (meta && meta.name) || file.name || 'paper.pdf',
        size: (meta && meta.size) || file.size || 0,
        lastModified: (meta && meta.lastModified) || file.lastModified || Date.now(),
        type: file.type || 'application/pdf',
        storedAt: Date.now(),
      }, id)).then((ok) => Boolean(ok));
    };
    const getStoredFile = (id) => (id ? fileDbTask('readonly', (store) => store.get(id)) : Promise.resolve(null));
    const deleteStoredFile = (id) => (id ? fileDbTask('readwrite', (store) => store.delete(id)) : Promise.resolve(null));
    const reviveStoredFile = (record) => {
      if (!record || !record.blob) return null;
      const name = record.name || 'paper.pdf';
      const lastModified = Number(record.lastModified) || Date.now();
      const type = record.type || 'application/pdf';
      try {
        return new File([record.blob], name, { type, lastModified });
      } catch (_) {
        // Very old engines have no File constructor; the loader only needs
        // `name`/`size`/`lastModified`/`arrayBuffer()`, so a shim is enough.
        const blob = record.blob;
        return {
          name,
          size: Number(record.size) || blob.size || 0,
          lastModified,
          type,
          arrayBuffer: () => blob.arrayBuffer(),
          slice: (a, b) => blob.slice(a, b),
        };
      }
    };

    const resultKey = (id) => RESULT_PREFIX + id;
    const loadResult = (id) => (id ? readStore(resultKey(id), null) : null);
    const saveResult = (id, patch) => {
      return !!id && writeStore(resultKey(id), Object.assign({}, loadResult(id) || {}, patch));
    };
    const unsavedFigureHistory = new Map();
    function loadFigureHistory(id, legacy) {
      if (!id) return [];
      const saved = unsavedFigureHistory.get(id) || readStore(FIGURES_PREFIX + id, null);
      if (Array.isArray(saved)) return saved;
      const previous = legacy === undefined ? loadResult(id)?.figure : legacy;
      return typeof previous?.text === 'string' && previous.text.trim() ? [{ ...previous, id: 'legacy' }] : [];
    }
    function appendFigureHistory(id, figure) {
      const entries = [figure, ...loadFigureHistory(id)];
      const saved = writeStore(FIGURES_PREFIX + id, entries);
      if (saved) unsavedFigureHistory.delete(id);
      else unsavedFigureHistory.set(id, entries);
      return { entries, saved };
    }
    function figurePagePosition(page, viewport, crop) {
      const original = page.getViewport({ scale: 1 });
      if (original.rotation === viewport.rotation) return { x: crop.x, y: crop.y };
      const toOriginal = (x, y) => original.convertToViewportPoint(
        ...viewport.convertToPdfPoint(x * viewport.width, y * viewport.height),
      );
      const start = toOriginal(crop.x, crop.y);
      const end = toOriginal(crop.x + crop.w, crop.y + crop.h);
      return { x: Math.min(start[0], end[0]) / original.width, y: Math.min(start[1], end[1]) / original.height };
    }
    function figureOrderLabel(caption) {
      const label = typeof caption === 'string' ? caption.match(FIGURE_LABEL_RE)?.[1] : null;
      if (!label || /\d/.test(label)) return label ?? null;
      const roman = { I: 1, V: 5, X: 10 };
      const values = Array.from(label.toUpperCase(), (letter) => roman[letter]);
      return String(values.reduce((total, value, i) => total + (value < values[i + 1] ? -value : value), 0));
    }
    function orderFigureEntries(entries, order) {
      const direction = order.endsWith('-asc') ? 1 : -1;
      const compareKnown = (a, b, compare) => {
        if (a == null || b == null) return Number(a == null) - Number(b == null);
        return direction * compare(a, b);
      };
      const byNumber = (a, b) => a - b;
      if (order.startsWith('time-')) {
        return entries.map((entry) => {
          const time = Date.parse(entry.generatedAt);
          return { entry, time: Number.isFinite(time) ? time : null };
        }).sort((a, b) => compareKnown(a.time, b.time, byNumber)).map(({ entry }) => entry);
      }
      const items = entries.map((entry) => {
        const page = Number(entry.page);
        const position = entry.position;
        return {
          entry, page: Number.isInteger(page) && page > 0 ? page : null,
          position: Number.isFinite(position?.x) && Number.isFinite(position.y) ? position : null,
          label: figureOrderLabel(entry.caption),
        };
      });
      // Older entries only have a page and caption. Use figure numbers on pages
      // where positions are missing and every entry has a numbered caption.
      const pagesWithMissingPositions = new Set(items.filter((item) => !item.position).map((item) => item.page));
      const pagesWithMissingLabels = new Set(items.filter((item) => !item.label).map((item) => item.page));
      const byPosition = (a, b) => (a.y - b.y) || (a.x - b.x);
      return items.sort((a, b) => {
        const byPage = compareKnown(a.page, b.page, byNumber);
        if (byPage || a.page == null) return byPage;
        if (pagesWithMissingPositions.has(a.page) && !pagesWithMissingLabels.has(a.page)) {
          const byLabel = compareKnown(a.label, b.label, figureNumberOrder.compare);
          if (byLabel) return byLabel;
        }
        return compareKnown(a.position, b.position, byPosition)
          || compareKnown(a.label, b.label, figureNumberOrder.compare);
      }).map(({ entry }) => entry);
    }
    function readGenerationMetadata(response, selection) {
      const { provider = selection.provider, model = selection.model, generatedAt } = response;
      const sameRoute = provider === selection.provider && model === selection.model;
      const modelName = response.modelName && response.modelName !== model ? response.modelName
        : (sameRoute && selection.modelName) || model;
      const reasoningEffort = response.reasoningEffort || (sameRoute ? selection.reasoningEffort : null);
      return {
        provider, model, modelName, reasoningEffort,
        reasoningEffortName: sameRoute && reasoningEffort === selection.reasoningEffort ? selection.reasoningEffortName : '',
        followDefault: !reasoningEffort && (!sameRoute || selection.followDefault),
        generatedAt: generatedAt || new Date().toISOString(),
      };
    }
    const marksKey = (id) => MARKS_PREFIX + id;
    // (v35 #1) Professional-term explanations, one list per paper. Kept apart from
    // `marks` on purpose: a term is a GLOSSARY entry keyed by the term itself, not
    // a passage marker, so it must neither appear in the highlight list nor be
    // matched against PDF text.
    const termsKey = (id) => TERMS_PREFIX + id;
    const normalizeTerm = (t) => ({
      id: t && t.id ? t.id : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
      term: String((t && t.term) || ''),
      body: String((t && t.body) || ''),
      surrounding: String((t && t.surrounding) || ''),
      at: Number(t && t.at) || Date.now(),
    });
    const loadTerms = (id) => {
      const v = id ? readStore(termsKey(id), []) : [];
      return Array.isArray(v) ? v.map(normalizeTerm).filter((t) => t.term) : [];
    };
    const saveTerms = (id, list) => { if (id) writeStore(termsKey(id), list); };

    // (v23 #1) Highlight and annotation are two SEPARATE features that share one
    // storage list only for convenience. Every record has an explicit `kind`:
    //   'hl'   → yellow band   (`hl: true`,  `note: ''`)
    //   'note' → annotation    (`hl: false`, `note: <text>`)
    // Selecting "高亮" creates/updates the 'hl' record for that sentence; selecting
    // "批注" creates/updates the 'note' record. They never share a record, so
    // removing one can never remove the other, and the same sentence may hold both
    // as two independent entries.
    //
    // Legacy records (before v23) carry only `hl` / `note`; `kind` is derived from
    // those, then rewritten on the next save.
    const normalizeMark = (m) => {
      const note = String((m && m.note) || '');
      const trimmed = note.trim();
      const wanted = m && m.kind === 'hl' ? 'hl' : (m && m.kind === 'note' ? 'note' : '');
      const kind = wanted || (trimmed ? 'note' : 'hl');
      return {
        id: m && m.id ? m.id : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
        text: String((m && m.text) || ''),
        kind,
        note: kind === 'note' ? trimmed : '',
        hl: kind === 'hl',
      };
    };
    const loadMarks = (id) => {
      const v = id ? readStore(marksKey(id), []) : [];
      return Array.isArray(v) ? v.map(normalizeMark) : [];
    };
    const saveMarks = (id, list) => { if (id) writeStore(marksKey(id), list); };

    // ------------------------------------------------------------------
    // Shared live state. Persisted to localStorage and mirrored between the
    // conversation-view Reader and the overlay Reader, so closing/reopening
    // the window (or switching tabs) keeps the paper and all results.
    // ------------------------------------------------------------------
    const DEFAULT_SHARED = {
      mode: 'pdf', text: '', summary: '', summaryCoverage: null, summaryMeta: null, summaryDetail: null,
      selection: '', selectionResult: '', pdfName: '', pageNum: 1,
      // (v18 #4/#5) The English box is editable in BOTH places (the inline card and
      // the side column). The edited value lives here, in the shared layer, so the
      // two boxes are literally the same state: typing in one updates the other
      // without any event plumbing. `selection` keeps the RAW selection, because
      // highlights and notes must still match the PDF text.
      selectionEdit: '', selectionPrefix: '',
      selectionSplit: 96 / (96 + 150),
      selectionWidthSplit: 0.5,
      selectionCardOpen: true,
      sideWidth: SIDE_DEFAULT, sideHeight: 320, dock: 'right',
      panMode: false,
      // (v19 #4) Pages across: 0 = one page, 1 = two pages, 2 = three pages. It used
      // to be a boolean; a number keeps the old value readable (see the migration
      // below) and gives the toolbar a real three-way choice.
      spreadMode: 0,
      theme: 'default',
      // (v40) Overall UI tone. `theme` above only recolours the PAPER (the page
      // itself), which is a reading preference; this one tints the reader's own
      // chrome — toolbar, cards, side panel, floating cards — so the whole
      // surface reads as one blue / green interface. `default` keeps the host
      // tokens untouched, so an old snapshot looks exactly as before.
      uiTone: 'default',
      popupOn: false, paperId: '',
      // (v21 #1) The reference column. `references` holds the parsed bibliography
      // enriched with resolved addresses, so it survives a tab switch together with
      // the analysis it belongs to. `referencesBusy` is transient and only guards
      // the button; it is not persisted between sessions on purpose.
      references: [],
      // (v28 #2, revised) 论文分析 and 参考文献 are two VIEWS of the same column,
      // switched by a segmented control, not two panes side by side. Only one of
      // them is mounted at a time, so each gets the full column width.
      analysisTab: 'summary',
      figureSort: 'time-desc',
      // (v8 #6) Height of the upper half of the side pane (selection card plus the
      // movable sections), and (v8 #7) their order.
      sideTopHeight: 220, sectionOrder: ['selection', 'recent', 'terms', 'marks'],
      // (v27) Which of the three function cards are ENABLED. Closing a card removes
      // it from this list; the card manager (the ⚙ in the card column's header) adds
      // it back. A separate list from `sectionOrder` on purpose: order must survive a
      // card being closed and reopened, otherwise reopening would silently move it to
      // the end of the column.
      cards: ['selection', 'recent', 'terms', 'marks'],
      floatingCards: {},
      // (v25 #3) Horizontal size of that block when the side panel is docked at the
      // bottom (the two halves sit side by side there).
      sideTopWidth: 380,
      // (v32 #1) Per-card widths, only meaningful in the bottom dock where the three
      // function cards sit side by side. A missing key means "share the row evenly",
      // which is the old behaviour, so an untouched column looks exactly as before.
      cardWidths: {},
      // (v38) Per-card heights, only meaningful in the RIGHT dock, where the cards
      // are stacked and share the column's height (v37). A missing key means "take an
      // even share", which is the v37 behaviour, so an untouched column looks exactly
      // as before; a stored value pins that one card and the rest divide what is left.
      cardHeights: {},
    };
    const TEXT_KEYS = ['text'];
    const SELECTION_KEYS = ['selection', 'selectionEdit', 'selectionPrefix', 'selectionResult'];
    const ANALYSIS_KEYS = ['summary', 'summaryCoverage', 'summaryMeta', 'summaryDetail', 'references'];
    const contentKeys = new Set([...TEXT_KEYS, ...SELECTION_KEYS, ...ANALYSIS_KEYS]);
    const savedView = readStore(SNAP_KEY, null) || {};
    const oldSnapshot = Object.keys(savedView).some((key) => contentKeys.has(key));
    let shared = Object.assign({}, DEFAULT_SHARED, savedView);
    if (!(savedView.selectionSplit > 0 && savedView.selectionSplit < 1 && Number.isFinite(savedView.selectionSplit))) {
      const originalHeight = Number(savedView.selEditH);
      const translatedHeight = Number(savedView.selResultH);
      shared.selectionSplit = Number.isFinite(originalHeight) && Number.isFinite(translatedHeight) && originalHeight > 0 && translatedHeight > 0
        ? originalHeight / (originalHeight + translatedHeight) : DEFAULT_SHARED.selectionSplit;
    }
    if (!Number.isFinite(shared.selectionWidthSplit) || shared.selectionWidthSplit <= 0 || shared.selectionWidthSplit >= 1) {
      shared.selectionWidthSplit = DEFAULT_SHARED.selectionWidthSplit;
    }
    shared.floatingCards = Object.fromEntries(CARD_KEYS.flatMap((key) => {
      const box = shared.floatingCards?.[key];
      return box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0
        ? [[key, box]] : [];
    }));
    if (!FIGURE_SORT_ORDERS.includes(shared.figureSort)) shared.figureSort = DEFAULT_SHARED.figureSort;
    const storedForPaper = (key) => {
      const saved = readStore(key, null);
      return saved && saved.paperId === shared.paperId ? saved : {};
    };
    if (!oldSnapshot) {
      Object.assign(shared, storedForPaper(TEXT_SNAP_KEY), storedForPaper(SELECTION_SNAP_KEY));
      if (!shared.paperId) Object.assign(shared, storedForPaper(DRAFT_RESULT_KEY));
    }
    delete shared.darkMode;
    if (!PAGE_THEMES.includes(shared.theme)) shared.theme = 'default';
    // (v19 #4) `spreadMode` was a boolean (false = one page, true = two pages) and is
    // now a page count minus one. Translate any stored boolean once, here.
    if (shared.spreadMode === true) shared.spreadMode = 1;
    else if (shared.spreadMode === false || shared.spreadMode == null) shared.spreadMode = 0;
    else if (!Number.isFinite(Number(shared.spreadMode))) shared.spreadMode = 0;
    else shared.spreadMode = Math.max(0, Math.min(2, Math.trunc(Number(shared.spreadMode))));
    // (v20) The full-text translation column and the three-column layout and the
    // translation overlay were removed at the user's request. Drop their stored
    // flags so an old snapshot cannot resurrect a feature that no longer exists.
    delete shared.threeCol;
    delete shared.overlayMode;
    delete shared.translation;
    delete shared.tab;
    // (v27) `cards` holds the enabled function cards. An old snapshot has no such
    // field, and an empty array is a legal choice (all cards closed), so only a
    // missing/ malformed value falls back to "all three enabled".
    {
      const known = ['selection', 'recent', 'terms', 'marks'];
      const saved = Array.isArray(shared.cards) ? shared.cards : null;
      if (!saved) shared.cards = known.slice();
      else {
        const kept = known.filter((k) => saved.indexOf(k) !== -1);
        shared.cards = kept;
      }
      if (!Array.isArray(shared.sectionOrder)) shared.sectionOrder = known.slice();
    }
    // (v28) The analysis column shows either the paper analysis or the reference
    // list, never both. Anything unrecognised falls back to the analysis.
    if (!['summary', 'references', 'figure'].includes(shared.analysisTab)) shared.analysisTab = 'summary';
    // (v32 #1) Sanitise the per-card widths once: only known cards, only finite
    // positive pixel values. Anything else is dropped so the column falls back to
    // the even split instead of rendering a zero-width card.
    {
      const widths = {};
      const raw = shared.cardWidths && typeof shared.cardWidths === 'object' ? shared.cardWidths : null;
      if (raw) {
        const known = ['selection', 'recent', 'terms', 'marks'];
        for (let i = 0; i < known.length; i++) {
          const px = Number(raw[known[i]]);
          if (Number.isFinite(px) && px >= 140) widths[known[i]] = Math.round(px);
        }
      }
      shared.cardWidths = widths;
    }
    // (v38) Same sanitiser for the per-card heights. 84px is the floor the CSS
    // already enforces (`.elr-side-body > .elr-sec { min-height: 84px }`), so a
    // stored value below it would silently be overridden by the stylesheet — clamp
    // here instead of pretending it took effect.
    {
      const heights = {};
      const rawH = shared.cardHeights && typeof shared.cardHeights === 'object' ? shared.cardHeights : null;
      if (rawH) {
        const knownH = ['selection', 'recent', 'terms', 'marks'];
        for (let i = 0; i < knownH.length; i++) {
          const px = Number(rawH[knownH[i]]);
          if (Number.isFinite(px) && px >= 84) heights[knownH[i]] = Math.round(px);
        }
      }
      shared.cardHeights = heights;
    }
    if (shared.uiTone !== 'default' && !Object.values(UI_TONES).some((tones) => tones.includes(shared.uiTone))) shared.uiTone = 'default';
    const sharedListeners = new Set();
    const readShared = () => shared;
    const viewKeys = Object.keys(DEFAULT_SHARED).filter((key) => !contentKeys.has(key));
    const pickSnapshot = (keys) => Object.fromEntries(keys.map((key) => [key, shared[key]]));
    const writeDocumentSnapshot = (key, fields) => writeStore(key, { paperId: shared.paperId, ...pickSnapshot(fields) });
    let keepLegacySnapshot = false;
    if (oldSnapshot) {
      const textSaved = writeDocumentSnapshot(TEXT_SNAP_KEY, TEXT_KEYS);
      const selectionSaved = writeDocumentSnapshot(SELECTION_SNAP_KEY, SELECTION_KEYS);
      let analysisSaved;
      if (shared.paperId) {
        const previous = loadResult(shared.paperId) || {};
        const missing = ANALYSIS_KEYS.filter((key) => previous[key] == null && Object.hasOwn(savedView, key));
        analysisSaved = !missing.length || saveResult(shared.paperId, pickSnapshot(missing));
      } else {
        analysisSaved = writeDocumentSnapshot(DRAFT_RESULT_KEY, ANALYSIS_KEYS);
      }
      // Keep the original record if the storage quota interrupts the upgrade.
      keepLegacySnapshot = !(textSaved && selectionSaved && analysisSaved);
    }
    const legacyPaperId = savedView.paperId;
    const legacyAnalysis = keepLegacySnapshot ? pickSnapshot(ANALYSIS_KEYS) : null;
    const dirtySnapshot = new Set(oldSnapshot ? [SNAP_KEY] : []);
    let snapshotTimer = null;
    const flushSnapshot = () => {
      if (snapshotTimer !== null) clearTimeout(snapshotTimer);
      snapshotTimer = null;
      if (dirtySnapshot.has(TEXT_SNAP_KEY)) writeDocumentSnapshot(TEXT_SNAP_KEY, TEXT_KEYS);
      if (dirtySnapshot.has(SELECTION_SNAP_KEY)) writeDocumentSnapshot(SELECTION_SNAP_KEY, SELECTION_KEYS);
      if (dirtySnapshot.has(DRAFT_RESULT_KEY) && !shared.paperId) writeDocumentSnapshot(DRAFT_RESULT_KEY, ANALYSIS_KEYS);
      if (dirtySnapshot.has(SNAP_KEY) && !keepLegacySnapshot) writeStore(SNAP_KEY, pickSnapshot(viewKeys));
      dirtySnapshot.clear();
    };
    const scheduleSnapshot = () => {
      if (dirtySnapshot.size && snapshotTimer === null) snapshotTimer = setTimeout(flushSnapshot, 150);
    };
    const writeShared = (patch) => {
      for (const key of Object.keys(patch)) {
        if (TEXT_KEYS.includes(key)) dirtySnapshot.add(TEXT_SNAP_KEY);
        else if (SELECTION_KEYS.includes(key)) dirtySnapshot.add(SELECTION_SNAP_KEY);
        else if (ANALYSIS_KEYS.includes(key)) dirtySnapshot.add(DRAFT_RESULT_KEY);
        else dirtySnapshot.add(SNAP_KEY);
      }
      if (Object.hasOwn(patch, 'paperId')) {
        dirtySnapshot.add(TEXT_SNAP_KEY);
        dirtySnapshot.add(SELECTION_SNAP_KEY);
      }
      shared = Object.assign({}, shared, patch);
      scheduleSnapshot();
      sharedListeners.forEach((fn) => { try { fn(); } catch (_) {} });
    };
    scheduleSnapshot();
    function useShared(key) {
      const [, force] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => {
        sharedListeners.add(force);
        return () => { sharedListeners.delete(force); };
      }, [force]);
      const setValue = React.useCallback((next) => {
        const prev = readShared()[key];
        const v = typeof next === 'function' ? next(prev) : next;
        if (v === prev) return;
        const patch = {};
        patch[key] = v;
        writeShared(patch);
      }, [key]);
      return [readShared()[key], setValue];
    }

    // -------------------------------------------------------------------------
    // (v23 #5) The HOST colour scheme.
    //
    // The reader's own `theme` field only styles the PDF page (default / paper /
    // eye) and never described the app's light/dark mode. The floating cards are
    // rendered through `createPortal` into <body>, i.e. OUTSIDE the reader's DOM
    // subtree, so a container class could never reach them — the scheme has to be
    // a module-level value the portals can read.
    //
    // Two independent sources, because neither is guaranteed:
    //   1. the `theme` client service (`getTheme().active.colorScheme`) when the
    //      host exposes it;
    //   2. otherwise the resolved `--dsw-alias-bg-base` value, which is what the
    //      host actually paints with, sampled on every root attribute change.
    // -------------------------------------------------------------------------
    let hostScheme = 'light';
    const schemeListeners = new Set();
    const setHostScheme = (next) => {
      const v = next === 'dark' ? 'dark' : 'light';
      if (v === hostScheme) return;
      hostScheme = v;
      schemeListeners.forEach((fn) => { try { fn(); } catch (_) {} });
    };
    const readSchemeFromCss = () => {
      try {
        const raw = String(getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base') || '').trim();
        const m = raw.match(/(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/);
        if (!m) return 'light';
        const lum = Number(m[1]) * 0.299 + Number(m[2]) * 0.587 + Number(m[3]) * 0.114;
        return lum < 128 ? 'dark' : 'light';
      } catch (_) {
        return 'light';
      }
    };
    function useHostScheme() {
      const [, force] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => {
        schemeListeners.add(force);
        return () => { schemeListeners.delete(force); };
      }, [force]);
      return hostScheme;
    }

    const CSS = [
      // (v44 #1) The floating bottom-right launcher and the full-screen overlay it
      // opened are GONE: the reader is reached through the conversation tab, the
      // sidebar palette and the right-sidebar guide tab only. The status dot below
      // is still used by the reader's own header, so its rule stays.
      '.elr-launcher-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }',
      // (v44 #1) The `.elr-overlay*` family went with the launcher — the full-screen
      // overlay was the launcher's destination and nothing else rendered it.
      // (v11 #2) The sidebar-tool destination: the host `main` panel is a flex
      // column with a definite height, so the reader only has to opt into it.
      '.elr-panel { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; overflow: hidden; background: var(--dsw-alias-bg-base); }',
      '.elr-panel .elr-view { min-height: 0; height: 100%; }',
      // The icon seat in `sidebar.panellist` hands the component an owner prop with
      // the host's resolved size; the glyph must not add its own box.
      '.elr-nav-icon { display: inline-flex; align-items: center; justify-content: center; color: currentColor; line-height: 0; }',
      // (v15 #4) The whole view is a NON-scrolling box. Without overflow:hidden a
      // PDF that is taller than the pane used to make an ancestor scroll, which
      // dragged the right-hand analysis column along with the paper.
      '.elr-view { flex: 1 1 auto; height: 100%; min-height: 360px; width: 100%; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }',
      '.elr-view:fullscreen { width: 100%; height: 100%; min-height: 0; max-width: none; max-height: none; }',
      '.elr-floating-host { display: contents; }',
      '.elr-head { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 12px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }',
      '.elr-head-identity { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 7px; min-width: 0; max-width: 100%; }',
      '.elr-head-identity .elr-launcher-dot { flex: 0 0 9px; }',
      '.elr-head-identity .elr-seg { padding-inline: 10px; }',
      '.elr-head-models { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; flex: 1 1 455px; min-width: 0; }',
      '.elr-head-model { display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }',
      '.elr-head-model .elr-select { min-width: 0; max-width: 142px; padding: 4px 6px; text-overflow: ellipsis; }',
      '.elr-head-model .elr-select-provider { max-width: 104px; }',
      '.elr-head-model .elr-select-effort { max-width: 78px; }',
      '.elr-head-model .elr-select-label { flex: 0 0 auto; white-space: nowrap; }',
      '.elr-head-models > .elr-btn { padding: 4px 6px; }',
      '.elr-head-actions { display: flex; align-items: center; gap: 6px; margin-inline-start: auto; }',
      '.elr-head-actions .elr-fullscreen-btn { display: grid; place-items: center; box-sizing: border-box; flex: none; width: 30px; height: 30px; padding: 0; }',
      '.elr-fullscreen-icon { position: relative; display: block; width: 16px; height: 16px; }',
      '.elr-fullscreen-icon > span { position: absolute; box-sizing: border-box; width: 5px; height: 5px; border-top: 1.5px solid currentColor; border-left: 1.5px solid currentColor; transform: rotate(var(--elr-corner-angle)); }',
      '.elr-fullscreen-icon > :nth-child(1) { --elr-corner-angle: 0deg; top: 0; left: 0; }',
      '.elr-fullscreen-icon > :nth-child(2) { --elr-corner-angle: 90deg; top: 0; right: 0; }',
      '.elr-fullscreen-icon > :nth-child(3) { --elr-corner-angle: -90deg; bottom: 0; left: 0; }',
      '.elr-fullscreen-icon > :nth-child(4) { --elr-corner-angle: 180deg; bottom: 0; right: 0; }',
      '.elr-fullscreen-icon.is-active > span { transform: rotate(calc(var(--elr-corner-angle) + 180deg)); }',
      '.elr-head :is(.elr-icon-btn, .elr-select, .elr-btn):focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.elr-title { font-weight: 600; font-size: 14px; }',
      '.elr-spacer { flex: 1; }',
      '.elr-model { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.elr-icon-btn { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 4px 10px; cursor: pointer; font-size: 12px; }',
      '.elr-icon-btn:hover { border-color: var(--dsw-alias-brand-primary); }',
      // (v14 #2) Compact A−/A+ buttons in the popup title bar.
      '.elr-font-btn { padding: 2px 7px; font-size: 12px; font-weight: 600; line-height: 1.2; }',
      '.elr-font-btn:disabled { opacity: .45; cursor: default; }',
      '.elr-segment { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }',
      '.elr-seg { border: none; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); padding: 5px 12px; cursor: pointer; font-size: 12px; }',
      '.elr-seg + .elr-seg { border-left: 1px solid var(--dsw-alias-border-l1); }',
      // Active buttons use a brand tint + brand text: readable in both themes,
      // unlike a solid brand fill with hard-coded white text.
      '.elr-seg.active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      '.elr-field { box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 8px; font-size: 12px; width: 150px; max-width: 100%; }',
      '.elr-body { flex: 1; min-height: 0; display: flex; overflow: hidden; }',
      // (v15 #4) Both columns are independent scroll roots. `min-height: 0` +
      // `overflow: hidden` on the flex parent lets each column own its scrollbar.
      '.elr-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }',
      '.elr-side { display: flex; flex-direction: column; box-sizing: border-box; min-width: 260px; max-width: 70%; min-height: 0; overflow: hidden; overscroll-behavior: contain; }',
      // (v25 #3) The analysis column always stacks its tabs header above its body,
      // including in the horizontal bottom dock where `side` itself is a row.
      '.elr-side-col { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; }',
      // (v28 #2, revised) 论文分析 and 参考文献 are two VIEWS of this one column,
      // switched by the segmented control in `.elr-tabs`, so there is no side-by-side
      // wrapper any more — whichever view is selected owns the full width.
      // `.elr-out` below sets its own padding with the same specificity, so the
      // override has to be qualified by both classes.
      '.elr-out.elr-refs-out { padding: 10px 12px; }',
      // (v8 #6) The upper block (selection card + movable sections) now has an
      // explicit height the user drags, so it must not shrink below it.
      // (v31 #1) A flex column with `gap` turns the stack into separate cards
      // instead of one continuous bordered list.
      '.elr-side-top { flex: 0 0 auto; min-height: 80px; display: flex; flex-direction: column; padding: 0; overflow: hidden; }',
      '.elr-side-top > .elr-col-head { flex: 0 0 auto; }',
      // (v43 #1) The card column's header is a solid strip on the panel background,
      // with NO rule under it: that underline was the "stray horizontal line" the user
      // boxed. The 6px margin is the separation the line used to provide, and the
      // background keeps cards from showing through when the body scrolls.
      '.elr-col-head.elr-card-head { background: var(--dsw-alias-bg-base); border-bottom: none; margin-bottom: 6px; }',
      // (v32b #1) The cards live in their own scroller so the 「功能栏」 header row
      // (title + ⚙) and the card manager stay pinned at the top. Previously the
      // header was the first child of the scrolling column, so it scrolled away
      // with the cards whenever the column overflowed.
      '.elr-side-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 9px; padding: 0 10px 10px; overflow: auto; overscroll-behavior: contain; }',
      '.elr-side-body, .elr-side-body * { scrollbar-width: thin; scrollbar-color: transparent transparent; }',
      '.elr-side-body.elr-scrolling, .elr-side-body .elr-scrolling { scrollbar-color: var(--dsw-alias-label-secondary) transparent; }',
      // Both dividers use the same grip and flip with the resize axis.
      '.elr-divider { flex: 0 0 8px; position: relative; display: grid; place-items: center; cursor: col-resize; touch-action: none; user-select: none; background: var(--dsw-alias-bg-layer-2); border-inline: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-divider::before { content: ""; position: absolute; inset: 0 -5px; }',
      '.elr-divider::after { content: ""; width: 4px; height: 44px; max-height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); opacity: .45; transition: width .12s ease, height .12s ease, opacity .12s ease; }',
      '.elr-divider:hover, .elr-divider.active, .elr-divider:focus-visible { border-color: var(--dsw-alias-brand-primary); }',
      '.elr-divider:hover::after, .elr-divider.active::after, .elr-divider:focus-visible::after { height: 68px; opacity: 1; }',
      '.elr-divider.axis-row { cursor: row-resize; border-inline: 0; border-block: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-divider.axis-row::before { inset: -5px 0; }',
      '.elr-divider.axis-row::after { width: 44px; height: 4px; max-width: 100%; }',
      '.elr-divider.axis-row:hover::after, .elr-divider.axis-row.active::after, .elr-divider.axis-row:focus-visible::after { width: 68px; height: 4px; }',
      '.elr-divider:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-resizer { z-index: 6; }',
      // (v8 #7) Reorderable side sections (recent reading, notes, selection).
      // (v31 #1) Each section is a self-contained CARD now: its own border,
      // radius and surface, so three of them read as three blocks instead of one
      // striped list. `overflow: hidden` keeps the children's square corners from
      // poking through the rounded ones.
      // (v37) A card is a flex COLUMN and its inner list carries the growth. Before
      // this, every list had a hard `max-height` (168 / 200 / 320px), so enlarging the
      // 功能栏 only added empty space under a stuck list, and shrinking it left the
      // list clipped with no scrollbar. Now the card hands its own height down to the
      // list, which scrolls inside whatever room it is given.
      '.elr-sec { position: relative; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; transition: border-color .12s ease, box-shadow .12s ease; }',
      '.elr-body:not(.dock-bottom) .elr-sec:hover:not(.over) { border-color: var(--dsw-alias-border-l2); }',
      // (v37) In the right dock the cards SHARE the column height instead of each
      // sitting at its natural height: `flex: 1 1 auto` lets them grow into a taller
      // 功能栏 and shrink into a shorter one, and `min-height: 84px` stops a card from
      // collapsing into a bare header. Inner lists then scroll inside that height.
      '.elr-side-body > .elr-sec { flex: 1 1 auto; min-height: 84px; }',
      '.elr-body:not(.dock-bottom) .elr-side-body > .elr-sec[data-elr-docked-card="selection"]:not(.is-collapsed) { min-height: ' + SELECTION_CARD_MIN_H + 'px; }',
      '.elr-body:not(.dock-bottom) .elr-side-body > .elr-sec[data-elr-docked-card="marks"]:not(.is-collapsed) { min-height: ' + MARKS_CARD_MIN_H + 'px; }',
      // A collapsed card is just its header, so it must not claim a share of the
      // column height.
      '.elr-side-body > .elr-sec.is-collapsed { flex: 0 0 auto; min-height: 0; }',
      // (v37) Whatever a card holds (`.elr-recent` / `.elr-marks` / `.elr-terms` /
      // `.elr-sel-card`) is the box that receives the height, so the inner list can
      // turn it into a scroll region. Without this the inner roots kept their natural
      // height and the extra room showed up as a blank strip under the content.
      '.elr-side-body > .elr-sec > * { flex: 1 1 auto; min-height: 0; }',
      // The dragged card itself fades so the pointer clearly "carries" a copy
      // (the full-size ghost is rendered separately).
      '.elr-sec.dragging { opacity: .35; border-style: dashed; }',
      // (v31 #2) The drop target lights up: brand-tinted surface, a brand ring,
      // and a solid bar on the edge the card would land against.
      '.elr-sec.over { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent), 0 6px 18px rgba(0, 0, 0, .10); }',
      '.elr-sec.over-above::before, .elr-sec.over-below::after { content: ""; position: absolute; left: 8px; right: 8px; height: 3px; border-radius: 2px; background: var(--dsw-alias-brand-primary); z-index: 2; }',
      '.elr-sec.over-above::before { top: 0; }',
      '.elr-sec.over-below::after { bottom: 0; }',
      // (v36 fix) In the bottom dock the cards sit in one ROW, so "before/after the
      // target" is horizontal: the bar moves to the left or right edge, where the
      // card will actually land. The stacked layout keeps top/bottom.
      '.elr-body.dock-bottom .elr-sec.over-above::before, .elr-body.dock-bottom .elr-sec.over-below::after { top: 8px; bottom: 8px; left: auto; right: auto; width: 3px; height: auto; }',
      '.elr-body.dock-bottom .elr-sec.over-above::before { top: 8px; bottom: 8px; left: 0; }',
      '.elr-body.dock-bottom .elr-sec.over-below::after { top: 8px; bottom: 8px; right: 0; }',
      '.elr-grip { flex: 0 0 auto; border: 0; background: transparent; cursor: grab; color: var(--dsw-alias-label-secondary); padding: 2px 3px; font-size: 15px; line-height: 1; user-select: none; touch-action: none; }',
      '.elr-grip:active { cursor: grabbing; }',
      '.elr-grip:hover, .elr-grip:focus-visible { color: var(--dsw-alias-brand-primary); }',
      '.elr-grip:focus-visible { outline: 1px solid currentColor; border-radius: 3px; }',
      '.elr-card-dock-target > .elr-card-head { box-shadow: inset 0 -2px var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }',
      '.elr-card-dock-target > .elr-side-body { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-base)); }',
      // (v31 #2) The floating clone that follows the pointer while reordering.
      // It is portalled to <body>, positioned fixed, and never receives events.
      '.elr-drag-ghost { position: fixed; inset: 0 auto auto 0; z-index: 200; pointer-events: none; box-sizing: border-box; opacity: .92; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 8px 24px rgba(0,0,0,.22); overflow: hidden; }',
      '.elr-drag-ghost-head { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-drag-ghost-body { padding: 8px 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      // While a card is in flight the other cards offer themselves as targets.
      '.elr-side-top.drag-active .elr-sec:not(.dragging):not(.over) { border-style: dashed; }',
      // (v17 #2) `min-height: 0` instead of a hard 120px: a fixed minimum made the
      // analysis/translation column overflow the side panel (which clips) instead
      // of letting `.elr-out` scroll on its own. `flex-basis: 0` is what makes the
      // column take exactly the space left under the tabs, so the analysis pane
      // scrolls inside itself and never drags the PDF or the selection card.
      '.elr-col { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow: hidden; }',
      '.elr-col-head { display: flex; align-items: center; gap: 8px; padding: 7px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      // The manager is portalled above the card column so it cannot shrink the scroll area.
      '.elr-card-head { position: relative; }',
      '.elr-card-head .elr-icon-btn.active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }',
      '.elr-card-menu { position: fixed; z-index: 131; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 8px 24px rgba(0,0,0,.22); display: flex; flex-direction: column; gap: 4px; overflow: auto; overscroll-behavior: contain; }',
      '.elr-card-menu > * { flex: 0 0 auto; }',
      '.elr-card-menu-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 2px; }',
      '.elr-card-menu-row { display: flex; align-items: center; gap: 7px; padding: 3px 2px; border-radius: 6px; cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-primary); }',
      '.elr-card-menu-row:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-card-menu-row input { margin: 0; cursor: pointer; }',
      '.elr-card-menu-row.on { color: var(--dsw-alias-label-primary); }',
      '.elr-card-menu-actions { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-card-none { padding: 14px 12px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; text-align: center; }',
      // A closed card's × never inherits the card header's click-to-collapse.
      '.elr-card-control { flex: 0 0 auto; display: grid; place-items: center; position: relative; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.elr-card-control:hover, .elr-card-control:focus-visible { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
      '.elr-card-control:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-card-x:hover { color: var(--dsw-alias-state-error-primary); }',
      '.elr-card-x::before, .elr-card-x::after { content: ""; position: absolute; width: 10px; height: 1.5px; border-radius: 1px; background: currentColor; transform: rotate(45deg); }',
      '.elr-card-x::after { transform: rotate(-45deg); }',
      '.elr-floating-card { position: fixed; z-index: 114; box-sizing: border-box; box-shadow: 0 10px 32px rgba(0,0,0,.24); color: var(--dsw-alias-label-primary); font-size: 13px; }',
      '.elr-floating-card.is-front { z-index: 115; }',
      '.elr-floating-card .elr-card-content { overflow: auto; }',
      '.elr-floating-card .elr-rz:is(:hover, :active) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 23%, transparent); }',
      '.elr-floating-card .elr-rz-se::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 8px; height: 8px; color: var(--dsw-alias-label-secondary); background: repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 3px); clip-path: polygon(100% 0, 100% 100%, 0 100%); pointer-events: none; }',
      '.elr-float-dock-icon { box-sizing: border-box; width: 14px; height: 12px; border: 1px solid currentColor; border-radius: 2px; position: relative; }',
      '.elr-float-dock-icon::after { content: ""; position: absolute; inset: 0 0 0 auto; width: 4px; border-inline-start: 1px solid currentColor; background: color-mix(in srgb, currentColor 22%, transparent); }',
      '.elr-dock-icon { position: relative; width: 15px; height: 12px; box-sizing: border-box; border: 1px solid currentColor; border-radius: 2px; overflow: hidden; }',
      '.elr-dock-icon::after { content: ""; position: absolute; inset: 0 0 0 auto; width: 4px; background: currentColor; }',
      '.elr-dock-icon.to-bottom::after { inset: auto 0 0; width: auto; height: 3px; }',
      '.elr-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-btn { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 6px 12px; cursor: pointer; font-size: 12px; }',
      '.elr-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }',
      '.elr-btn:disabled { opacity: .55; cursor: not-allowed; }',
      '.elr-btn.active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      '.elr-btn.primary { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      '.elr-input, .elr-out { flex: 1 1 auto; min-height: 0; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; padding: 14px 16px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.7; }',
      '.elr-out { white-space: pre-wrap; overflow: auto; overscroll-behavior: contain; }',
      '.elr-out-empty { color: var(--dsw-alias-label-secondary); }',
      '.elr-status { padding: 6px 12px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; min-height: 26px; }',
      '.elr-status.error { color: var(--dsw-alias-state-error-primary); }',
      '.elr-status.ok { color: var(--dsw-alias-state-success-primary); }',
      // (v31 #1) The card FRAME is `.elr-sec` now, so the inner roots drop their
      // own bottom rule and surface — otherwise a card would show a double border
      // and a slightly different shade from its frame.
      '.elr-sel-card { background: transparent; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }',
      // Headers are the main "this is a card" cue: tinted strip, divider below,
      // and a per-card accent bar on the left edge.
      '.elr-function-head { flex: 0 0 38px; height: 38px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600; }',
      '.elr-card-toggle { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px; padding: 2px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer; }',
      '.elr-card-toggle:hover { background: var(--dsw-alias-bg-layer-1); }',
      '.elr-card-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.elr-card-content { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }',
      '.elr-selection-content { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; padding: 7px 9px 10px; overflow: hidden auto; }',
      '.elr-floating-card .elr-selection-content { overscroll-behavior: contain; }',
      '.elr-sel-actions { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 7px; }',
      '.elr-sel-actions .elr-btn, .elr-selection-copy { padding: 3px 7px; font-size: 11px; white-space: nowrap; }',
      '.elr-selection-hint { flex: 0 0 auto; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }',
      '.elr-sel-working { color: var(--dsw-alias-brand-primary); }',
      '.elr-selection-panes { --elr-selection-pane-min: ' + SELECTION_PANE_MIN_H + 'px; --elr-selection-splitter: ' + SELECTION_SPLITTER_SIZE + 'px; --elr-selection-tracks: clamp(var(--elr-selection-pane-min), var(--elr-selection-source), calc(100% - var(--elr-selection-splitter) - var(--elr-selection-pane-min))) var(--elr-selection-splitter) minmax(var(--elr-selection-pane-min), 1fr); display: grid; flex: 1 0 0; grid-template-rows: var(--elr-selection-tracks); min-height: calc(2 * var(--elr-selection-pane-min) + var(--elr-selection-splitter) + 40px); min-width: 0; }',
      '.elr-selection-panes.is-side-by-side { --elr-selection-pane-min: ' + SELECTION_PANE_MIN_W + 'px; grid-template-columns: var(--elr-selection-tracks); grid-template-rows: auto minmax(0, 1fr); min-height: 108px; }',
      '.elr-selection-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }',
      '.elr-selection-panes.is-side-by-side > .elr-selection-pane { display: grid; grid-row: 1 / -1; grid-template-rows: subgrid; grid-template-columns: minmax(0, 1fr); }',
      '.elr-selection-pane-head { flex: none; min-height: 18px; margin-bottom: 3px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }',
      '.elr-selection-pane-head > :first-child { font-weight: 600; }',
      '.elr-selection-copy { margin-inline-start: auto; }',
      '.elr-selection-split { display: grid; place-items: center; border-radius: 4px; cursor: ns-resize; touch-action: none; }',
      '.elr-selection-split::after { content: ""; width: 28px; height: 3px; border-radius: 3px; background: var(--dsw-alias-border-l2); }',
      '.elr-selection-panes.is-side-by-side > .elr-selection-split { grid-row: 1 / -1; cursor: ew-resize; background: linear-gradient(var(--dsw-alias-border-l1), var(--dsw-alias-border-l1)) center / 1px calc(100% - 6px) no-repeat; }',
      '.elr-selection-panes.is-side-by-side > .elr-selection-split::after { width: 3px; height: 28px; }',
      '.elr-selection-split:is(:hover,:active,:focus-visible)::after { background: var(--dsw-alias-brand-primary); }',
      '.elr-selection-split:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-sel-edit, .elr-sel-text { flex: 1 1 0; min-height: 0; min-width: 0; width: 100%; box-sizing: border-box; overflow: auto; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }',
      '.elr-sel-edit { display: block; resize: none; }',
      '.elr-selection-panes.is-side-by-side :is(.elr-sel-edit,.elr-sel-text) { align-self: stretch; }',
      '.elr-sel-text { white-space: pre-wrap; }',
      '.elr-sel-text.elr-out-empty { color: var(--dsw-alias-label-secondary); }',
      '.elr-selection-pane :is(textarea,.elr-sel-text):focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      // (v30 #1) `padding-bottom: 0` glued the segmented pill onto this row's own
      // 1px bottom rule: the pill's rounded border and the rule overlapped into a
      // double line. Equal vertical padding lets the pill float clear of the rule.
      '.elr-tabs { display: flex; align-items: center; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-tab { border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 7px 14px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 12px; }',
      '.elr-tab.active { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }',
      '.elr-hint { padding: 6px 12px; color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      // (v44 #2) Kept for the TEXT mode hint under the textarea only. The PDF-mode
      // bottom-left tip that used to overlay the page is gone — it floated over the
      // paper and the user asked for it to be cancelled.
      '.elr-markdown :is(h2,h3,h4,h5,h6) { font-size: 14px; margin: 14px 0 6px; color: var(--dsw-alias-brand-primary); }',
      '.elr-markdown :is(h4,h5,h6) { font-size: 13px; }',
      '.elr-figure-out { display: flex; flex-direction: column; gap: 8px; }',
      '.elr-figure-sort { display: flex; align-items: center; gap: 8px; max-width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.elr-figure-sort > span { flex: none; }',
      '.elr-figure-sort > .elr-select { min-width: 0; }',
      '.elr-figure-entry { flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }',
      '.elr-figure-entry-head { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px 2px; }',
      '.elr-figure-entry-toggle { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 3px; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-weight: 600; text-align: left; cursor: pointer; overflow-wrap: anywhere; }',
      '.elr-figure-entry-toggle::before { content: ""; flex: 0 0 6px; height: 6px; box-sizing: border-box; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(-45deg); }',
      '.elr-figure-entry-toggle[aria-expanded="true"]::before { transform: rotate(45deg); }',
      '.elr-figure-entry-toggle:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-figure-entry-page { flex: 0 0 auto; }',
      '.elr-generation-meta { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }',
      '.elr-figure-entry .elr-generation-meta { padding: 2px 10px 8px; }',
      '.elr-summary-meta { padding: 6px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-summary-error { overflow-wrap: anywhere; }',
      '.elr-figure-entry-body { padding: 6px 10px 10px; border-top: 1px solid var(--dsw-alias-border-l1); overflow-wrap: anywhere; }',
      '.elr-figure-entry-body blockquote { margin: 4px 0 8px; padding-inline-start: 8px; border-inline-start: 2px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: pre-line; }',
      '.elr-figure-activity { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.elr-markdown p, .elr-markdown li { line-height: 1.7; }',
      '.elr-markdown ol { list-style: decimal; margin-block: 6px; padding-inline-start: 24px; }',
      '.elr-markdown code { background: var(--dsw-alias-bg-layer-2); padding: 1px 4px; border-radius: 4px; }',
      // ---- v9 #2: rendered math and tables ----
      '.elr-math-block { margin: 8px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }',
      '.elr-math-inline { padding: 0 1px; }',
      '.elr-katex-err { color: var(--dsw-alias-state-error-primary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; }',
      '.elr-table-wrap { margin: 8px 0; overflow-x: auto; }',
      '.elr-md-table { border-collapse: collapse; width: 100%; font-size: 12px; }',
      '.elr-md-table th, .elr-md-table td { border: 1px solid var(--dsw-alias-border-l1); padding: 5px 8px; text-align: left; vertical-align: top; line-height: 1.6; }',
      '.elr-md-table th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }',
      '.elr-md-table tr:nth-child(even) td { background: var(--dsw-alias-bg-layer-1); }',
      // KaTeX ships its own font metrics; only the text colour needs to follow
      // the host theme, otherwise formulas stay black on a dark background.
      '.elr-katex .katex { font-size: 1.05em; color: var(--dsw-alias-label-primary); }',
      '.elr-katex .katex-display { margin: 0; }',
      '.elr-pdf-wrap { position: relative; flex: 1 1 auto; min-height: 240px; background: var(--dsw-alias-bg-layer-2); }',
      // (v15 #4) `contain` stops wheel/touch scroll chaining: once this element
      // reaches its own edge the gesture is consumed instead of scrolling the
      // frame (and therefore the right analysis column) as well.
      // (v34 #2) `contain: layout paint style` keeps the viewport's inner layout
      // from invalidating anything above it while the side pane is being dragged.
      // It deliberately does NOT include SIZE containment (`strict` would imply it
      // and collapse this absolutely-positioned box to zero height).
      '.elr-pdf-container { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; contain: layout paint style; }',
      '.elr-pdf-container.elr-picking-figure { touch-action: none; user-select: none; cursor: crosshair; }',
      '.elr-pdf-container.elr-picking-figure .pdfViewer, .elr-pdf-container.elr-picking-figure .textLayer { cursor: crosshair; user-select: none; }',
      '.elr-figure-outline { position: absolute; top: 0; left: 0; z-index: 9; display: none; box-sizing: border-box; pointer-events: none; border: 2px solid #1760bd; box-shadow: 0 0 0 1px #fff; }',
      '.elr-pdf-wrap.is-start { min-height: 0; background: var(--dsw-alias-bg-base); }',
      '.elr-pdf-wrap.is-start > .elr-pdf-container { visibility: hidden; }',
      '.elr-toolbar.elr-start-toolbar { justify-content: flex-end; background: var(--dsw-alias-bg-layer-1); }',
      '.elr-drop { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; overflow: auto; overscroll-behavior: contain; padding: clamp(12px, 3vw, 32px); background: radial-gradient(ellipse at 12% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent), transparent 65%), var(--dsw-alias-bg-base); }',
      '.elr-drop-col { display: grid; gap: 14px; width: 100%; max-width: 680px; margin: auto; }',
      '.elr-drop-card, .elr-drop-recent { min-width: 0; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; box-sizing: border-box; }',
      '.elr-drop-card { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; padding: clamp(14px, 2.6vw, 24px); }',
      '.elr-drop-icon { flex: 0 0 44px; height: 44px; display: grid; place-items: center; border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-brand-primary); }',
      '.elr-drop-icon::before { content: ""; width: 17px; height: 22px; box-sizing: border-box; border: 1.5px solid currentColor; border-radius: 3px; background: linear-gradient(currentColor, currentColor) center 7px / 8px 1px no-repeat, linear-gradient(currentColor, currentColor) center 11px / 8px 1px no-repeat, linear-gradient(currentColor, currentColor) center 15px / 5px 1px no-repeat; }',
      '.elr-drop-copy { flex: 1 1 170px; min-width: 0; }',
      '.elr-drop-title { margin: 0 0 4px; font-size: 18px; line-height: 1.3; font-weight: 650; color: var(--dsw-alias-label-primary); }',
      '.elr-drop-sub { margin: 0; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }',
      '.elr-drop-open { flex: 0 0 auto; margin-inline-start: auto; white-space: nowrap; }',
      '.elr-drag-mask { position: absolute; inset: 10px; z-index: 5; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--dsw-alias-brand-primary); border-radius: 14px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-brand-primary); font-size: 15px; font-weight: 600; pointer-events: none; }',
      '.elr-pdf-iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; z-index: 2; background: var(--dsw-alias-bg-base); }',
      '.elr-drop-error { flex: 1 1 100%; margin: 0; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }',
      '.elr-drop-recent { overflow: hidden; }',
      '.elr-drop-recent-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-drop-recent-head h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }',
      '.elr-drop-recent-list { list-style: none; margin: 0; padding: 0; }',
      '.elr-drop-recent-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding-inline-end: 8px; }',
      '.elr-drop-recent-row + .elr-drop-recent-row { border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 65%, transparent); }',
      '.elr-drop-recent-row:hover, .elr-drop-recent-row:focus-within { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-drop-recent-open { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; padding: 8px 4px 8px 16px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer; }',
      '.elr-drop-recent-open:hover .elr-recent-name { text-decoration: underline; }',
      '.elr-drop-recent-remove { flex: 0 0 26px; height: 27px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }',
      '.elr-drop-recent-remove:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-error-primary); }',
      '.elr-drop-recent button:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.elr-retry-bar { position: absolute; top: 10px; left: 10px; right: 10px; z-index: 6; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-error-primary); font-size: 12px; flex-wrap: wrap; word-break: break-word; }',
      '.elr-select { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 8px; font-size: 12px; max-width: 190px; }',
      '.elr-select-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.elr-recent { background: transparent; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }',
      '.elr-recent-head { box-shadow: inset 3px 0 0 var(--dsw-alias-state-success-primary); }',
      // (v37) `max-height` → flex growth: the list now fills the room the card has.
      '.elr-recent-list { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 8px 8px; }',
      '.elr-recent-empty { padding: 4px 12px 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.elr-recent-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; font-size: 11px; }',
      '.elr-recent-item:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-recent-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary); }',
      '.elr-recent-item button { border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 11px; padding: 2px 4px; }',
      '.elr-recent-item button:hover { color: var(--dsw-alias-state-error-primary); }',
      // ---- v4: inline translation popup ----
      '.elr-popup { position: fixed; z-index: 120; display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 10px 32px rgba(0,0,0,.28); font-size: 12px; }',
      // (v14 #2) Font size is set EXPLICITLY by the A−/A+ buttons on the title
      // bar and written as an inline fontSize on the card; the text regions simply
      // inherit it. No container query / automatic scaling: `cqw` was silently
      // dropped in the user's Electron build, so resizing never changed the text.
      '.elr-popup-text { font-size: inherit; line-height: 1.65; }',
      // (v15 #2) The two regions are visually distinct cards: the EDITABLE English
      // original sits on a neutral layer with a muted accent, the Chinese result on
      // a soft brand tint. Both use only host theme tokens.
      '.elr-popup-label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 5px; color: var(--dsw-alias-label-secondary); }',
      '.elr-popup-original-head { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin-bottom: 5px; }',
      '.elr-popup-original-head .elr-popup-label { margin: 0; }',
      // (v19 #1) Each of the two cards is a flex COLUMN that owns its own height
      // share of the popup body (`flex-grow` = the weight in `popup.ow`/`popup.rw`).
      // Resizing the outer card therefore stretches BOTH boxes instead of leaving
      // them at their old fixed heights, and the weights can still be rebalanced
      // one at a time by dragging the grip under either box.
      '.elr-popup-block { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; min-height: 52px; overflow: hidden; }',
      '.elr-popup-block + .elr-popup-block { margin-top: 9px; }',
      // (v19 #1) The per-box height grip is a normal flex
      // item at the bottom of the card, not an absolutely positioned overlay.
      '.elr-popup-grip { flex: 0 0 9px; height: 9px; margin-top: 5px; cursor: ns-resize; border-radius: 4px; background: linear-gradient(180deg, transparent 0 40%, var(--dsw-alias-border-l2) 40% 60%, transparent 60%); opacity: .5; touch-action: none; }',
      '.elr-popup-grip:hover, .elr-popup-grip:active { opacity: 1; }',
      '.elr-popup-block-original { background: var(--dsw-alias-bg-layer-1); border-left: 3px solid var(--dsw-alias-border-l2); }',
      '.elr-popup-block-result { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-alias-bg-overlay)); border-left: 3px solid var(--dsw-alias-brand-primary); }',
      // (v15 #1) The English original is an editable textarea, so the same card can
      // be re-translated after correcting pdf.js line-wrap noise. It must NOT start
      // a card drag (unlike the title bar), so its events stay on the textarea.
      // (v17 #1) `max-height` is gone and `resize: vertical` stays: the English box
      // and the Chinese box below are now sized INDEPENDENTLY by the user instead
      // of sharing one scrolling body.
      // (v17 #1) `resize: vertical` + its own scrollbar: the English box and the
      // Chinese box below are sized INDEPENDENTLY by the reader, so making one
      // taller never pushes the other around.
      // (v19 #1) The textarea is now a flex child that FILLS its card, so growing the
      // outer popup grows the writing area automatically. `resize` is off because the
      // height is owned by the card's flex weight (see the grip below it).
      '.elr-popup-textarea { display: block; width: 100%; flex: 1 1 0; min-height: 0; box-sizing: border-box; resize: none; overflow: auto; overscroll-behavior: contain; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.65; }',
      '.elr-popup-text { white-space: pre-wrap; line-height: 1.7; color: var(--dsw-alias-label-primary); font-size: inherit; }',
      // (v17 #1) A native `resize` handle only works when the element scrolls on its
      // own, so the result box gets `overflow: auto`; its height is therefore
      // independent of the English box above it.
      // (v19 #1) Same treatment as the English box: it FILLS the result card, which is
      // a flex child of the popup body, so an outer resize stretches it too.
      '.elr-popup-result-box { display: block; flex: 1 1 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }',
      // (v17 #3) The staged / empty hint must read as a hint, not as a translation:
      // `.elr-popup-text` would otherwise win on equal specificity.
      '.elr-popup-result-box.elr-out-empty { color: var(--dsw-alias-label-secondary); }',
      // (v23 #5) Dark app theme: the Chinese result area must stay readable.
      // (v42 #1) These used to be hard-coded #000000 / #ffffff, which ignored the
      // interface tone completely — picking 淡黄色 / 淡绿色 / 深蓝色 still left a
      // pure black box under a light card. They now consume the same alias tokens
      // as everything else, so `.elr-tone-*` and the host light/dark scheme both
      // drive the colour: light schemes give dark-on-light, dark schemes give
      // light-on-dark, and the result block keeps its brand accent either way.
      '.elr-popup-dark .elr-popup-block-result { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-1)); border-left-color: var(--dsw-alias-brand-primary); }',
      '.elr-popup-dark .elr-popup-result-box { background: transparent; color: var(--dsw-alias-label-primary); }',
      '.elr-popup-dark .elr-popup-block-result .elr-popup-label { color: var(--dsw-alias-label-secondary); }',
      '.elr-popup-dark .elr-popup-result-box.elr-out-empty { color: var(--dsw-alias-label-secondary); }',
      '.elr-popup-actions { display: flex; align-items: center; justify-content: flex-end; margin-top: 7px; }',
      // (v10 #1) The title bar is a drag handle, so it must not select text while
      // dragging; the close button keeps its own cursor via `.elr-icon-btn`.
      '.elr-popup-head { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: move; user-select: none; touch-action: none; }',
      // (v23 #3) The translate button now lives in the title bar, so it must be
      // compact enough to share that row with the two font buttons and the close
      // button, and it is tinted as the card's primary action.
      '.elr-popup-head .elr-popup-translate { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); padding: 2px 8px; font-weight: 600; white-space: nowrap; }',
      '.elr-popup-head .elr-popup-translate:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }',
      '.elr-popup-head .elr-popup-translate:disabled { opacity: .5; cursor: default; border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }',
      // (v17 #1) The body no longer scrolls as a whole: each of the two cards owns
      // its size, so the reader can make the English box tall and the Chinese box
      // short (or the other way round) without them fighting.
      // (v19 #1) The body is the flex CONTAINER whose two cards share its height by
      // weight (`popup.ow` / `popup.rw`). `overflow: hidden` because each card owns
      // its own scrollbar now; nothing should scroll the body itself.
      '.elr-popup-body { padding: 10px 12px; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; overflow: auto; }',
      // ---- v9 #1: floating cards can be resized ----
      // (v18 #3) The native `resize` property only ever exposes the bottom-right
      // corner, which is why resizing felt broken. Every floating card now carries
      // eight invisible edge/corner strips (`.elr-rz-*`) that drive the geometry
      // directly, so ANY edge or corner can be dragged. `overflow: hidden` is kept
      // because the inner body owns its own scrollbar.
      '.elr-resizable { overflow: hidden; }',
      '.elr-grip-corner { position: absolute; right: 2px; bottom: 2px; width: 12px; height: 12px; pointer-events: none; background: linear-gradient(135deg, transparent 0 45%, var(--dsw-alias-border-l2) 45% 55%, transparent 55% 70%, var(--dsw-alias-border-l2) 70% 80%, transparent 80%); }',
      '.elr-rz { position: absolute; z-index: 6; background: transparent; touch-action: none; }',
      '.elr-rz-n { top: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }',
      '.elr-rz-s { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }',
      '.elr-rz-e { right: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }',
      '.elr-rz-w { left: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }',
      '.elr-rz-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }',
      '.elr-rz-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }',
      '.elr-rz-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }',
      '.elr-rz-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }',
      // (v18 #3/#5) A box that resizes by dragging its own bottom edge. The height
      // is written into the element's inline style by the handle, so React never
      // fights the browser over it.
      // (v18 #4/#5) The English side of the selection card is now an editor.
      // (v18 #1) Empty state shown in the analysis pane before a paper is opened.
      // ---- v1.0.5: highlights are painted UNDER the glyphs, on their own layer ----
      // pdf.js draws text AND figures into one opaque page canvas, and its text
      // layer is only 25% opaque with transparent glyphs. Painting a background on
      // a text-layer span therefore washes out the text and can bleed onto
      // neighbouring words. Instead we draw translucent yellow rectangles onto an
      // overlay canvas stacked between the page canvas and the text layer, and use
      // `mix-blend-mode: multiply` so black glyphs stay black and white paper turns
      // pale yellow. Nothing is painted on the spans themselves.
      // The overlay lives INSIDE `.canvasWrapper` (not `.page`): `.page` carries a
      // 9px transparent border (pdf_viewer.css `--page-border`), so anchoring to it
      // shifted every rectangle and dashed underline by the border width — the
      // misalignment reported in v7. `.canvasWrapper` is now the positioning
      // context and its rect is also the measuring origin.
      '.elr-pdf-container .pdfViewer .page .canvasWrapper { position: relative; }',
      '.elr-hl-overlay { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; mix-blend-mode: multiply; }',
      '.elr-hl-note { cursor: help; }',
      // ---- (v44 #3) 纸张纹理 / 护眼黄: repaint ONLY the white paper ----
      // WHAT WAS WRONG (v8 and earlier): the tint was a `::after` on `.page`, i.e.
      // a sheet laid OVER the rendered page. It washed the glyphs, the figures and
      // the tables alike, which is exactly what the user forbids. The `background-color`
      // rules next to it could never do anything either: pdf.js paints an OPAQUE
      // WHITE rectangle into the page canvas itself (`beginDrawing()` in
      // `vendor/pdf.min.js`: `ctx.fillStyle = background || "#ffffff"; fillRect(...)`),
      // so any CSS background behind the canvas is 100% covered.
      //
      // WHAT REPLACES IT: one blended layer per page, inside `.canvasWrapper`
      // (already `position: relative`, already the anchor for the highlight overlay),
      // at `z-index: 1` — above the canvas, below `.elr-hl-overlay` (3) and
      // `.elr-find-overlay` (4).
      // `mix-blend-mode: darken` is the whole trick: every channel keeps the DARKER
      // of (layer, page), so black text stays pure black, a figure or a table rule
      // that is already darker than the tint is returned unchanged, and only the
      // white the renderer painted — plus anything lighter than the tint — becomes
      // paper. `multiply` (the highlight overlay's mode) would have darkened the
      // figures themselves, so it is deliberately NOT used here.
      // TWO generated layers take part, both `mix-blend-mode: darken`:
      //   ::before — the flat paper tint, OPAQUE, so pure white becomes paper at
      //              full strength;
      //   ::after  — the fibre/grain texture, built only from LOW-ALPHA gradients.
      // Because the blend is `darken` and every grain colour is a translucent
      // warm grey, the texture can only ever REMOVE a little light from a channel:
      //   · pure black glyphs  → unchanged (already darker than any grain);
      //   · a figure/table pixel darker than the grain → returned unchanged;
      //   · a near-white pixel inside a figure → gets the same faint grain the
      //     paper around it gets, which is what real print looks like, and is the
      //     only case where anything "inside" a figure is touched at all.
      // `multiply` is deliberately NOT used: it would darken every figure.
      // (v45) The texture is back, after the user asked for it explicitly — but it
      // is built from low-alpha CSS gradients instead of the v8 opaque sheet, so it
      // can never stamp hard lines across a chart.
      '.elr-pdf-container[data-elr-page-theme] .pdfViewer .page .canvasWrapper::before { background-color: var(--elr-paper-color); content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; mix-blend-mode: darken; border-radius: 2px; }',
      '.elr-pdf-container[data-elr-page-theme="paper"] { --elr-paper-color: #f7f3e9; }',
      '.elr-pdf-container[data-elr-page-theme="eye"] { --elr-paper-color: #faf6e5; }',
      '.elr-pdf-container[data-elr-page-theme="linen"] { --elr-paper-color: #f4f1e8; }',
      '.elr-pdf-container[data-elr-page-theme="sage"] { --elr-paper-color: #eff5ef; }',
      '.elr-pdf-container[data-elr-page-theme="mist"] { --elr-paper-color: #eff4f7; }',
      '.elr-pdf-container[data-elr-page-theme="ivory"] { --elr-paper-color: #faf8f1; }',
      '.elr-pdf-container:is([data-elr-page-theme="paper"], [data-elr-page-theme="eye"], [data-elr-page-theme="linen"]) .pdfViewer .page .canvasWrapper::after { content: ""; position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; mix-blend-mode: darken; }',
      // Fibres run in two near-orthogonal directions at coprime pitches (3px / 4px /
      // 7px) so no visible plaid can emerge, plus an isotropic speckle and three
      // large soft blotches for the uneven tone of real stock.
      '.elr-pdf-container[data-elr-page-theme="paper"] .pdfViewer .page .canvasWrapper::after { background-image: repeating-linear-gradient(0deg, rgba(122, 98, 62, 0.05) 0px, rgba(122, 98, 62, 0.05) 1px, rgba(122, 98, 62, 0) 1px, rgba(122, 98, 62, 0) 3px), repeating-linear-gradient(90deg, rgba(122, 98, 62, 0.042) 0px, rgba(122, 98, 62, 0.042) 1px, rgba(122, 98, 62, 0) 1px, rgba(122, 98, 62, 0) 4px), repeating-linear-gradient(46deg, rgba(112, 90, 58, 0.03) 0px, rgba(112, 90, 58, 0.03) 1px, rgba(112, 90, 58, 0) 1px, rgba(112, 90, 58, 0) 7px), repeating-radial-gradient(circle at 50% 50%, rgba(130, 106, 70, 0.045) 0px, rgba(130, 106, 70, 0.045) 0.7px, rgba(130, 106, 70, 0) 0.7px, rgba(130, 106, 70, 0) 3px), radial-gradient(120% 95% at 16% 10%, rgba(150, 122, 80, 0.09), rgba(150, 122, 80, 0) 62%), radial-gradient(105% 85% at 84% 90%, rgba(120, 96, 62, 0.085), rgba(120, 96, 62, 0) 58%), radial-gradient(90% 70% at 58% 42%, rgba(163, 136, 94, 0.055), rgba(163, 136, 94, 0) 72%); }',
      '.elr-pdf-container[data-elr-page-theme="eye"] .pdfViewer .page .canvasWrapper::after { background-image: repeating-linear-gradient(0deg, rgba(150, 126, 58, 0.038) 0px, rgba(150, 126, 58, 0.038) 1px, rgba(150, 126, 58, 0) 1px, rgba(150, 126, 58, 0) 3px), repeating-linear-gradient(90deg, rgba(150, 126, 58, 0.032) 0px, rgba(150, 126, 58, 0.032) 1px, rgba(150, 126, 58, 0) 1px, rgba(150, 126, 58, 0) 4px), repeating-linear-gradient(46deg, rgba(140, 118, 54, 0.024) 0px, rgba(140, 118, 54, 0.024) 1px, rgba(140, 118, 54, 0) 1px, rgba(140, 118, 54, 0) 7px), repeating-radial-gradient(circle at 50% 50%, rgba(158, 134, 66, 0.034) 0px, rgba(158, 134, 66, 0.034) 0.7px, rgba(158, 134, 66, 0) 0.7px, rgba(158, 134, 66, 0) 3px), radial-gradient(120% 95% at 16% 10%, rgba(170, 144, 76, 0.07), rgba(170, 144, 76, 0) 62%), radial-gradient(105% 85% at 84% 90%, rgba(150, 126, 62, 0.065), rgba(150, 126, 62, 0) 58%), radial-gradient(90% 70% at 58% 42%, rgba(180, 155, 88, 0.045), rgba(180, 155, 88, 0) 72%); }',
      '.elr-pdf-container[data-elr-page-theme="linen"] .pdfViewer .page .canvasWrapper::after { background-image: repeating-linear-gradient(0deg, rgba(109, 102, 83, .055) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(109, 102, 83, .04) 0 1px, transparent 1px 4px); }',
      // Keep each palette self-contained, including text for controls and status.
      UI_TONES.light.map((tone) => '.elr-tone-' + tone).join(', ') + ' { color-scheme: light; --dsw-alias-state-success-primary: #256545; --dsw-alias-state-warn-primary: #765118; --dsw-alias-state-error-primary: #9b3e43; }',
      UI_TONES.dark.map((tone) => '.elr-tone-' + tone).join(', ') + ' { color-scheme: dark; --dsw-alias-state-success-primary: #87d4ae; --dsw-alias-state-warn-primary: #f2ca86; --dsw-alias-state-error-primary: #ffa8ad; }',
      '.elr-tone-blue { --dsw-alias-bg-base: #eef2f7; --dsw-alias-bg-layer-1: #fbfcfe; --dsw-alias-bg-layer-2: #e5edf6; --dsw-alias-bg-overlay: #fdfefe; --dsw-alias-border-l1: #ced9e6; --dsw-alias-border-l2: #a7bacf; --dsw-alias-brand-primary: #2b598a; --dsw-alias-label-primary: #172c44; --dsw-alias-label-secondary: #465e76; --dsw-specific-sidebar-fill: #fbfcfe; }',
      '.elr-tone-green { --dsw-alias-bg-base: #edf2ee; --dsw-alias-bg-layer-1: #f9fcf9; --dsw-alias-bg-layer-2: #e2ece4; --dsw-alias-bg-overlay: #fcfefc; --dsw-alias-border-l1: #cddacf; --dsw-alias-border-l2: #adbfaf; --dsw-alias-brand-primary: #30624b; --dsw-alias-label-primary: #1b3026; --dsw-alias-label-secondary: #4b6256; --dsw-specific-sidebar-fill: #f9fcf9; }',
      '.elr-tone-amber { --dsw-alias-bg-base: #f4efe4; --dsw-alias-bg-layer-1: #fffdf8; --dsw-alias-bg-layer-2: #ede4d0; --dsw-alias-bg-overlay: #fffefa; --dsw-alias-border-l1: #ddd1ba; --dsw-alias-border-l2: #bbab8a; --dsw-alias-brand-primary: #775219; --dsw-alias-label-primary: #332b1e; --dsw-alias-label-secondary: #61543e; --dsw-specific-sidebar-fill: #fffdf8; }',
      '.elr-tone-pink { --dsw-alias-bg-base: #f5eff1; --dsw-alias-bg-layer-1: #fefbfc; --dsw-alias-bg-layer-2: #eee2e7; --dsw-alias-bg-overlay: #fffdfe; --dsw-alias-border-l1: #dfcfd8; --dsw-alias-border-l2: #c9afbd; --dsw-alias-brand-primary: #854666; --dsw-alias-label-primary: #372635; --dsw-alias-label-secondary: #6c5263; --dsw-specific-sidebar-fill: #fefbfc; }',
      '.elr-tone-navy { --dsw-alias-bg-base: #101925; --dsw-alias-bg-layer-1: #182536; --dsw-alias-bg-layer-2: #223247; --dsw-alias-bg-overlay: #1c2b3e; --dsw-alias-border-l1: #2b3d53; --dsw-alias-border-l2: #526a84; --dsw-alias-brand-primary: #8cc4ff; --dsw-alias-label-primary: #edf3fa; --dsw-alias-label-secondary: #b6c7d9; --dsw-specific-sidebar-fill: #182536; }',
      '.elr-tone-ink { --dsw-alias-bg-base: #141719; --dsw-alias-bg-layer-1: #1b2023; --dsw-alias-bg-layer-2: #252c30; --dsw-alias-bg-overlay: #21272a; --dsw-alias-border-l1: #313b41; --dsw-alias-border-l2: #55666e; --dsw-alias-brand-primary: #a9c9d4; --dsw-alias-label-primary: #e7eeef; --dsw-alias-label-secondary: #b6c3c8; --dsw-specific-sidebar-fill: #1b2023; }',
      '.elr-tone-forest { --dsw-alias-bg-base: #111a17; --dsw-alias-bg-layer-1: #18241e; --dsw-alias-bg-layer-2: #23332b; --dsw-alias-bg-overlay: #1c2c23; --dsw-alias-border-l1: #304238; --dsw-alias-border-l2: #587665; --dsw-alias-brand-primary: #93d6b0; --dsw-alias-label-primary: #e8f3eb; --dsw-alias-label-secondary: #afcab9; --dsw-specific-sidebar-fill: #18241e; }',
      '.elr-tone-plum { --dsw-alias-bg-base: #1a1520; --dsw-alias-bg-layer-1: #241c2d; --dsw-alias-bg-layer-2: #31263d; --dsw-alias-bg-overlay: #2a2134; --dsw-alias-border-l1: #43344f; --dsw-alias-border-l2: #755e88; --dsw-alias-brand-primary: #d0b5f4; --dsw-alias-label-primary: #f3eaf7; --dsw-alias-label-secondary: #c8b7d1; --dsw-specific-sidebar-fill: #241c2d; }',
      '.elr-tone-ember { --dsw-alias-bg-base: #1c1714; --dsw-alias-bg-layer-1: #27201b; --dsw-alias-bg-layer-2: #362c24; --dsw-alias-bg-overlay: #2f251e; --dsw-alias-border-l1: #47392f; --dsw-alias-border-l2: #7e6452; --dsw-alias-brand-primary: #efc39a; --dsw-alias-label-primary: #f5ede4; --dsw-alias-label-secondary: #ccb9a9; --dsw-specific-sidebar-fill: #27201b; }',
      // ---- v5: context menu for selection actions ----
      '.elr-menu { position: fixed; z-index: 130; min-width: 168px; padding: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 10px 30px rgba(0,0,0,.3); }',
      '.elr-menu-item { display: block; width: 100%; text-align: left; border: none; background: transparent; color: var(--dsw-alias-label-primary); padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }',
      '.elr-menu-item:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-menu-sep { height: 1px; margin: 4px 2px; background: var(--dsw-alias-border-l1); }',
      // ---- v5: note bubble shown beside an annotated sentence ----
      '.elr-note-bubble { position: fixed; z-index: 125; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; padding: 9px 11px; border: 1px solid #2f7fd4; border-left-width: 3px; border-radius: 9px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 10px 28px rgba(0,0,0,.28); font-size: 12px; line-height: 1.65; }',
      '.elr-note-bubble-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: move; user-select: none; touch-action: none; }',
      '.elr-note-bubble-textarea { flex: 1 1 auto; width: 100%; box-sizing: border-box; min-height: 0; resize: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; padding: 6px 7px; }',
      '.elr-note-source { flex: 0 0 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.elr-marks { background: transparent; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }',
      '.elr-marks-head { box-shadow: inset 3px 0 0 var(--dsw-alias-state-warn-primary); }',
      // (v37) `max-height: 200px` → `flex: 1 1 auto`: the annotations list follows the
      // 功能栏 instead of stopping at a fixed 200px.
      '.elr-marks-list { display: grid; align-content: start; gap: 6px; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 8px 8px; }',
      '.elr-marks-list.is-horizontal { container: elr-mark-strip / size; grid-auto-flow: column; grid-auto-columns: clamp(160px, calc((100% - 6px) / 2), 240px); grid-template-rows: minmax(0, 1fr); align-content: stretch; overflow: auto hidden; padding-block-end: 6px; }',
      // (v24 #2) Segmented control under the "高亮与批注" header: 全部 / 仅高亮 / 仅批注.
      // (v41) It used to be glued to the header: `margin: 0 10px 8px` left no space
      // above it, and the segments inherited `.elr-seg`'s `bg-layer-2` background —
      // the SAME tone as the header bar — so the whole thing read as one crammed
      // block. Now it is its own band: a `bg-base` pill tray with real vertical
      // spacing above and below, transparent segments inside it (only the active
      // one is filled), so header / filter / list are three distinct rows.
      '.elr-marks-filter { flex: 0 0 auto; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 2px; margin: 6px 8px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-base); }',
      '.elr-marks-filter .elr-seg { min-width: 0; text-align: center; padding: 3px 4px; font-size: 11px; line-height: 1.45; border-radius: 4px; background: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      // The base `.elr-seg + .elr-seg` divider belongs to the JOINED toolbar control;
      // inside this tray the segments are separate pills, so drop the rule.
      '.elr-marks-filter .elr-seg + .elr-seg { border-left: none; }',
      '.elr-marks-filter .elr-seg:hover { color: var(--dsw-alias-label-primary); }',
      '.elr-marks-filter .elr-seg.active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      '.elr-body.dock-bottom .elr-marks-filter { align-self: flex-start; grid-template-columns: repeat(3, minmax(35px, 1fr)); max-width: calc(100% - 16px); margin-block: 4px 5px; }',
      '.elr-body.dock-bottom .elr-marks-filter .elr-seg { padding-block: 2px; }',
      '.elr-mark-item { display: grid; gap: 3px; box-sizing: border-box; min-width: 0; padding: 5px 7px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); }',
      '.elr-mark-row { display: flex; align-items: center; gap: 3px; min-width: 0; }',
      '.elr-mark-badge { display: inline-flex; align-items: center; gap: 4px; margin-inline-end: auto; font-size: 11px; font-weight: 600; color: var(--dsw-alias-brand-primary); }',
      '.elr-mark-badge::before { content: ""; flex: 0 0 6px; height: 6px; border-radius: 50%; background: currentColor; }',
      '.elr-mark-item.is-hl .elr-mark-badge { color: var(--dsw-alias-state-warn-primary); }',
      '.elr-mark-locate-icon { width: 11px; height: 11px; display: grid; place-items: center; box-sizing: border-box; border: 1px solid currentColor; border-radius: 50%; }',
      '.elr-mark-locate-icon::after { content: ""; width: 3px; height: 3px; background: currentColor; border-radius: 50%; }',
      '.elr-mark-edit-icon { width: 11px; height: 4px; box-sizing: border-box; border: 1px solid currentColor; border-radius: 1px; transform: rotate(-45deg); position: relative; }',
      '.elr-mark-edit-icon::after { content: ""; position: absolute; inset: -1px auto auto -3px; width: 3px; height: 4px; background: currentColor; clip-path: polygon(0 50%, 100% 0, 100% 100%); }',
      '.elr-mark-preview { display: block; width: 100%; min-width: 0; padding: 2px 3px; box-sizing: border-box; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.5; text-align: start; cursor: pointer; }',
      '.elr-mark-preview:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-mark-preview:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-mark-preview > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }',
      '.elr-mark-item.is-note .elr-mark-source { color: var(--dsw-alias-label-secondary); font-size: 11px; border-inline-start: 2px solid var(--dsw-alias-border-l2); padding-inline-start: 6px; }',
      '.elr-mark-item.is-note .elr-mark-source > span { -webkit-line-clamp: 2; }',
      '.elr-marks-list.is-horizontal > .elr-mark-item { display: flex; flex-direction: column; min-height: 0; overflow: hidden; padding: 4px 6px 5px; }',
      '.elr-marks-list.is-horizontal .elr-mark-row { flex: none; }',
      '.elr-marks-list.is-horizontal .elr-mark-preview { min-height: 0; overflow: hidden; }',
      '.elr-marks-list.is-horizontal .elr-mark-preview > span { -webkit-line-clamp: var(--elr-mark-preview-lines, 2); }',
      '.elr-marks-list.is-horizontal .elr-mark-item.is-note .elr-mark-source { display: none; flex: none; margin-block-start: auto; padding: 3px 3px 0; border-inline-start: 0; border-block-start: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-marks-list.is-horizontal .elr-mark-item.is-note .elr-mark-source > span { display: block; white-space: nowrap; text-overflow: ellipsis; }',
      '@container elr-mark-strip (height < 78px) { .elr-mark-item { --elr-mark-preview-lines: 1; } }',
      '@container elr-mark-strip (height >= 100px) { .elr-marks-list.is-horizontal .elr-mark-item.is-note .elr-mark-source { display: block; } }',
      '@container elr-mark-strip (height >= 120px) { .elr-mark-item { --elr-mark-preview-lines: 3; } }',
      '@container elr-mark-strip (height >= 156px) { .elr-mark-item { --elr-mark-preview-lines: 5; } }',
      '@container elr-mark-strip (height >= 210px) { .elr-mark-item { --elr-mark-preview-lines: 8; } }',
      '.elr-marks-empty { padding: 5px 9px 9px; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }',
      // ---- v35 #1: 术语解释. A glossary, not a passage list: each row is the term
      // itself and expands into the explanation that was generated for it.
      '.elr-terms { background: transparent; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }',
      '.elr-terms-busy { font-size: 11px; font-weight: 400; color: var(--dsw-alias-brand-primary); }',
      // (v37) `max-height: 200px` → flex growth, so the glossary grows with the card.
      '.elr-terms-list { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 7px 7px; }',
      '.elr-terms-list.is-vertical { display: flex; align-items: stretch; gap: 5px; overflow: auto hidden; padding: 4px 7px 5px 4px; }',
      '.elr-term-item { border: 1px solid var(--dsw-alias-border-l1); border-inline-start: 2px solid var(--dsw-alias-brand-primary); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); }',
      '.elr-term-item + .elr-term-item { margin-block-start: 4px; }',
      '.elr-term-row { display: flex; align-items: center; gap: 2px; padding-inline-end: 3px; }',
      '.elr-term-toggle { flex: 1 1 auto; min-width: 0; min-height: 28px; display: flex; align-items: center; gap: 5px; padding: 2px 3px 2px 6px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; text-align: start; cursor: pointer; }',
      '.elr-term-toggle::before { content: ""; flex: 0 0 5px; width: 5px; height: 5px; box-sizing: border-box; border-inline-end: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(-45deg); }',
      '.elr-term-toggle[aria-expanded="true"]::before { transform: rotate(45deg); }',
      '.elr-term-toggle:hover .elr-term-name { color: var(--dsw-alias-brand-primary); }',
      '.elr-term-toggle:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-term-name { font-size: 12px; line-height: 1.35; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.elr-terms-list.is-vertical .elr-term-item { flex: 0 0 34px; box-sizing: border-box; min-height: 0; margin: 0; border-inline-start-width: 1px; border-block-start: 2px solid var(--dsw-alias-brand-primary); }',
      '.elr-terms-list.is-vertical .elr-term-row { box-sizing: border-box; height: 100%; flex-direction: column; gap: 0; padding: 2px; }',
      '.elr-terms-list.is-vertical .elr-term-toggle { width: 100%; min-height: 0; flex-direction: column; gap: 5px; padding: 4px 2px; overflow: hidden; }',
      '.elr-terms-list.is-vertical .elr-term-toggle::before { transform: rotate(-135deg); }',
      '.elr-terms-list.is-vertical .elr-term-name { writing-mode: vertical-rl; text-orientation: mixed; min-height: 0; }',
      '.elr-remove-control:is(:hover, :focus-visible) { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, currentColor 11%, transparent); }',
      '.elr-trash-icon { position: relative; display: block; box-sizing: border-box; width: 10px; height: 9px; margin-top: 5px; border: 1px solid currentColor; border-radius: 0 0 2px 2px; }',
      '.elr-trash-icon::before { content: ""; position: absolute; top: -3px; left: -2px; width: 12px; height: 1px; border-radius: 1px; background: currentColor; }',
      '.elr-trash-icon::after { content: ""; position: absolute; top: -6px; left: 2px; box-sizing: border-box; width: 4px; height: 3px; border: 1px solid currentColor; border-bottom: 0; border-radius: 2px 2px 0 0; }',
      '.elr-term-body { border-top: 1px solid var(--dsw-alias-border-l1); padding: 7px 9px 9px; font-size: 11px; color: var(--dsw-alias-label-primary); max-height: 320px; overflow: auto; }',
      '.elr-term-quote { margin: 0 0 7px; padding: 5px 8px; border-left: 2px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; font-style: italic; }',
      '.elr-term-popover { position: fixed; z-index: 127; box-sizing: border-box; display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 10px 28px rgba(0,0,0,.25); font-size: 12px; }',
      '.elr-term-popover:focus { outline: none; }',
      '.elr-term-popover::before { content: ""; position: absolute; z-index: 2; width: 8px; height: 8px; background: var(--dsw-alias-bg-overlay); border: 0 solid var(--dsw-alias-border-l2); pointer-events: none; }',
      '.elr-term-popover[data-side="left"]::before { right: -5px; top: var(--elr-term-arrow); transform: translateY(-50%) rotate(45deg); border-width: 1px 1px 0 0; }',
      '.elr-term-popover[data-side="right"]::before { left: -5px; top: var(--elr-term-arrow); transform: translateY(-50%) rotate(45deg); border-width: 0 0 1px 1px; }',
      '.elr-term-popover[data-side="above"]::before { bottom: -5px; left: var(--elr-term-arrow); transform: translateX(-50%) rotate(45deg); border-width: 0 1px 1px 0; }',
      '.elr-term-popover[data-side="below"]::before { top: -5px; left: var(--elr-term-arrow); transform: translateX(-50%) rotate(45deg); border-width: 1px 0 0 1px; }',
      '.elr-term-popover-surface { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border-radius: inherit; }',
      '.elr-term-popover-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px 5px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-term-popover-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.elr-term-popover-body { min-height: 0; overflow: auto; overscroll-behavior: contain; margin-inline: 5px; padding: 7px 6px 11px; overflow-wrap: anywhere; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-secondary) 42%, transparent) transparent; }',
      '.elr-term-popover-body:is(:hover, :focus-visible) { scrollbar-color: var(--dsw-alias-label-secondary) transparent; }',
      '.elr-term-popover-body:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.elr-term-toggle[aria-haspopup="dialog"][aria-expanded="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }',
      // ---- v5 (#3): dock the reading side pane right or bottom ----
      '.elr-body.dock-bottom { flex-direction: column; }',
      '.elr-body.dock-bottom .elr-main { width: 100%; }',
      '.elr-body.dock-bottom .elr-side { width: 100% !important; max-width: none; border-left: none; border-top: 1px solid var(--dsw-alias-border-l1); }',
      // ---- v25 #3: docked at the bottom, the side panel is WIDE and SHORT, so its
      // three blocks (selection sections / tabs+analysis) go side by side instead of
      // stacking; the old vertical splitter becomes a vertical divider.
      '.elr-body.dock-bottom .elr-side { flex-direction: row; }',
      '.elr-body.dock-bottom .elr-side > .elr-side-col { flex: 1 1 0; min-width: 0; }',
      '.elr-body.dock-bottom .elr-side .elr-sec { border-bottom: none; border-right: 1px solid var(--dsw-alias-border-l1); }',
      '.elr-body.dock-bottom .elr-side .elr-sec:last-child { border-right: none; }',
      // (v25 #3) Side by side, the three sections share one row.
      // (v32 #1) `wrap` was removed: per-card width dragging only reads as "side by
      // side" when the cards cannot wrap onto a second line. The row scrolls
      // horizontally instead, which is what a manual width implies.
      // (v32b #1) The header row is now OUTSIDE the scroller: `.elr-side-top`
      // stacks the header above `.elr-side-body`, so the
      // 「功能栏 · ⚙」 row stays pinned to the top in both docks.
      '.elr-body.dock-bottom .elr-side-top { display: flex; flex-direction: column; flex-wrap: nowrap; align-items: stretch; overflow: hidden; }',
      '.elr-body.dock-bottom .elr-side-top > .elr-col-head { display: none; }',
      // (v27) …except the card column's header, which owns the ⚙ card manager: a
      // hidden header would make the manager unreachable exactly where the cards are
      // laid out side by side.
      '.elr-body.dock-bottom .elr-side-top > .elr-col-head.elr-card-head { display: flex; flex: 0 0 auto; padding: 4px 10px; border-bottom: none; }',
      '.elr-body.dock-bottom .elr-side-body { flex: 1 1 auto; min-height: 0; flex-direction: row; flex-wrap: nowrap; align-items: stretch; padding: 0 10px 10px; overflow: auto; }',
      '.elr-body.dock-bottom .elr-sec { flex: 1 1 200px; min-width: 140px; display: flex; flex-direction: column; overflow: hidden; }',
      '.elr-body.dock-bottom .elr-sec[data-elr-docked-card="selection"]:not(.is-collapsed) { min-width: ' + SELECTION_CARD_MIN_W + 'px; }',
      '.elr-body.dock-bottom .elr-sec[data-elr-docked-card="marks"]:not(.is-collapsed) { min-width: ' + MARKS_CARD_MIN_W + 'px; }',
      '.elr-body.dock-bottom .elr-side-body > .elr-sec.is-collapsed { flex: 0 0 auto; min-width: 0; }',
      '.elr-body.dock-bottom .elr-side-body > .elr-sec > * { flex-direction: row; min-width: 0; }',
      '.elr-body.dock-bottom .elr-function-head { flex: 0 0 36px; width: 36px; height: auto; min-height: 0; flex-direction: column; gap: 4px; padding: 5px 2px; border-bottom: 0; border-right: 1px solid var(--dsw-alias-border-l1); overflow: hidden; }',
      '.elr-body.dock-bottom .elr-card-toggle { min-height: 0; flex-direction: column; justify-content: flex-start; align-self: stretch; overflow: hidden; }',
      '.elr-body.dock-bottom .elr-card-toggle:hover { background: transparent; }',
      '.elr-body.dock-bottom .elr-card-toggle:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.elr-body.dock-bottom .elr-card-label { writing-mode: vertical-rl; min-height: 0; padding: 2px 0; border-radius: 4px; }',
      '.elr-body.dock-bottom .elr-card-toggle:hover .elr-card-label { background: var(--dsw-alias-bg-layer-1); }',
      '.elr-body.dock-bottom .elr-card-head-detail { display: none; }',
      '.elr-body.dock-bottom .elr-side-body > .elr-sec > * { flex: 1 1 auto; min-height: 0; }',
      // (v32b #2) The per-card width handles. They exist in BOTH docks — the right
      // dock treats them as "resize the card column", the bottom dock as "resize
      // this card". The previous build only had a 5px right-hand strip, docked-bottom
      // only, and hid the last card's, so neither edge ever responded.
      //
      // They sit INSIDE the card's border box (`left: 0` / `right: 0`) on purpose:
      // `.elr-sec` is `overflow: hidden`, so a handle hanging outside the box would
      // be clipped away — and a clipped handle cannot be grabbed. `z-index: 3` keeps
      // them above the card body; the card itself is not `draggable` (only its ⠿
      // head is), so a pointerdown here cannot start a native drag.
      '.elr-card-rz { position: absolute; top: 0; bottom: 0; width: 7px; cursor: col-resize; background: transparent; touch-action: none; z-index: 3; }',
      '.elr-card-rz.is-right { right: 0; }',
      '.elr-card-rz.is-left { left: 0; }',
      '.elr-card-rz::before { content: ""; position: absolute; top: 0; bottom: 0; width: 1px; background: var(--dsw-alias-border-l1); opacity: 0; transition: opacity .12s ease; }',
      '.elr-card-rz.is-right::before { right: 0; }',
      '.elr-card-rz.is-left::before { left: 0; }',
      '.elr-card-rz:hover::before, .elr-card-rz:active::before { opacity: 1; background: var(--dsw-alias-brand-primary); }',
      // (v38 #1) Bottom edge handle — right dock only, where the cards are stacked
      // and each one can have its own height. It spans the card's full width so the
      // whole lower border is grabbable, and it sits INSIDE the border box for the
      // same clipping reason as the side handles. `cursor: row-resize` is the only
      // thing distinguishing it from a side handle, so the hairline is horizontal.
      '.elr-card-rz.is-bottom { top: auto; bottom: 0; left: 0; right: 0; width: auto; height: 7px; cursor: row-resize; }',
      '.elr-card-rz.is-bottom::before { top: auto; bottom: 0; left: 0; right: 0; width: auto; height: 1px; }',
      '.elr-card-rz.is-bottom:hover::before, .elr-card-rz.is-bottom:active::before { opacity: 1; background: var(--dsw-alias-brand-primary); }',
      '.elr-recent-name { cursor: pointer; }',
      '.elr-recent-item.current { border-color: var(--dsw-alias-brand-primary); }',
      '.elr-recent-item.current .elr-recent-name { color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      // ---- v8 #3: formula explanation card ----
      '.elr-formula-card { position: fixed; z-index: 126; display: flex; flex-direction: column; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 12px 32px rgba(0,0,0,.3); font-size: 12px; }',
      '.elr-formula-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: move; user-select: none; }',
      '.elr-formula-src { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; max-height: 84px; overflow: auto; white-space: pre-wrap; word-break: break-word; }',
      '.elr-formula-render { flex: 0 0 auto; max-height: 30vh; overflow: auto; padding: 8px 10px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); }',
      '.elr-formula-body { flex: 1 1 auto; min-height: 60px; overflow: auto; line-height: 1.7; white-space: normal; }',
      // ---- v8 #6/#7 rule definitions live with the rest of the layout above ----
      // ---- v4: minimize chip ----
      // (v44 #1) The chip belonged to the removed launcher overlay (it was the
      // "expand" button of the minimized full-screen reader), so it is gone too.
      // ---- v19 #4: three-pages-across reading mode (reworked in v20 #2) ----
      // pdf.js only knows NONE/ODD/EVEN (1 or 2 pages per row), so "three up" is a
      // grid laid over the normal single-page flow: nothing is re-parented, so pdf.js
      // can never undo it.
      // (v20 #2) The columns are `max-content`, NOT `1fr`: a `1fr` column only caps the
      // COLUMN, while the page box keeps its own scaled width, so at a large zoom the
      // page simply overflowed its column and painted over its neighbour. Sizing each
      // column to its page means the pages can never overlap — when three of them no
      // longer fit, the container scrolls horizontally instead, exactly like pdf.js's
      // own two-page spread does.
      '.elr-pdf-container.elr-three .pdfViewer { display: grid; grid-template-columns: repeat(3, max-content); column-gap: 12px; row-gap: 12px; justify-content: start; align-items: start; width: max-content; margin: 0 auto; padding: 10px; }',
      '.elr-pdf-container.elr-three .pdfViewer .page { margin: 0 auto; }',
      // ---- v20 #3: zoom percentage control ----
      // (v28 #3) The number field types an arbitrary percentage; the preset list is
      // a visible <select> beside it. The native spinner arrows are suppressed
      // because 缩小 / 放大 already sit immediately to their left.
      // (v28 #3, revised) ONE control: a text field with a caret that opens the
      // preset list. Typing a value and picking a preset are the same widget, so the
      // toolbar no longer shows a separate input plus a separate <select>. `zoomDraft`
      // still buffers keystrokes so typing "1" on the way to "150" does not jump to
      // 25 %. A `<select>` cannot do this — its value is always one of its options.
      // (v30 #2) The box used to be sized by its children, so it came out visibly
      // SHORTER than the `.elr-btn` beside it (input padding 3px, caret 9px glyph).
      // A fixed height matching `.elr-btn` (6px padding + 1px border + 12px text
      // ≈ 28px) plus `stretch` children makes the three parts one flush block.
      '.elr-zoom { position: relative; display: inline-flex; align-items: stretch; height: 28px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-base); }',
      '.elr-zoom.open, .elr-zoom:focus-within { border-color: var(--dsw-alias-brand-primary); }',
      '.elr-zoom-input { width: 46px; height: 100%; box-sizing: border-box; padding: 0 1px 0 8px; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: right; -moz-appearance: textfield; appearance: textfield; }',
      '.elr-zoom-input::-webkit-outer-spin-button, .elr-zoom-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }',
      '.elr-zoom-suffix { display: flex; align-items: center; padding-right: 1px; font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      // Equal padding on both sides of the caret keeps the ▾ visually centred in
      // its own hit area; the right radius stops the hover fill from squaring off
      // the container's corner.
      '.elr-zoom-caret { display: flex; align-items: center; justify-content: center; height: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 9px; line-height: 1; padding: 0 7px; border-radius: 0 6px 6px 0; }',
      '.elr-zoom-caret:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }',
      '.elr-zoom-caret:disabled { opacity: .45; cursor: default; }',
      // (v30 #3) The menu is glued to the container on BOTH sides (`left`/`right`
      // -1px so it lines up with the container's own 1px border) instead of a
      // `min-width` — the preset list is now exactly as wide as the zoom field.
      // Each item centres its number so the column of percentages is symmetric.
      '.elr-zoom-menu { position: absolute; left: -1px; right: -1px; top: calc(100% + 4px); z-index: 30; box-sizing: border-box; display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 8px 22px rgba(0, 0, 0, .22); }',
      '.elr-zoom-item { border: none; background: transparent; color: var(--dsw-alias-label-primary); text-align: center; padding: 4px 0; border-radius: 5px; cursor: pointer; font: inherit; font-size: 12px; }',
      '.elr-zoom-item:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-zoom-item.active { color: var(--dsw-alias-brand-primary); font-weight: 600; }',
      // (v46) The settings widget is absolutely positioned, so its host span must
      // be its own stacking context; the panel is clamped to the viewport so it
      // cannot run off the right edge when the toolbar is narrow.
      '.elr-settings { position: relative; display: inline-flex; align-items: stretch; }',
      '.elr-settings .elr-settings-btn { display: inline-flex; align-items: center; gap: 5px; }',
      '.elr-settings-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-brand-primary); }',
      '.elr-settings-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; box-sizing: border-box; width: 264px; max-width: 88vw; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 12px 30px rgba(0, 0, 0, .26); }',
      '.elr-settings-head { padding: 4px 8px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.elr-settings-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; }',
      '.elr-settings-row:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.elr-settings-label { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-primary); }',
      '.elr-settings-ctrl { flex: 0 0 auto; display: inline-flex; align-items: center; }',
      '.elr-settings-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }',
      '.elr-settings-seg .elr-seg { padding: 4px 10px; font-size: 11px; }',
      // ---- v39: in-document search box ----
      '.elr-find { display: inline-flex; align-items: center; gap: 4px; width: 118px; max-width: 100%; min-width: 0; height: 28px; box-sizing: border-box; padding: 0 3px 0 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-base); }',
      '.elr-find.is-active { width: 178px; gap: 2px; }',
      '.elr-find:focus-within { border-color: var(--dsw-alias-brand-primary); }',
      '.elr-find-icon { flex: 0 0 12px; height: 12px; position: relative; color: var(--dsw-alias-label-secondary); }',
      '.elr-find.is-active .elr-find-icon { display: none; }',
      '.elr-find-icon::before { content: ""; position: absolute; top: 0; left: 0; width: 8px; height: 8px; box-sizing: border-box; border: 1.25px solid currentColor; border-radius: 50%; }',
      '.elr-find-icon::after { content: ""; position: absolute; top: 7px; left: 7px; width: 5px; height: 1.25px; background: currentColor; border-radius: 1px; transform: rotate(45deg); transform-origin: left center; }',
      '.elr-find-input { flex: 1 1 0; width: 0; min-width: 0; height: 100%; box-sizing: border-box; padding: 0; appearance: none; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }',
      '.elr-find-input::-webkit-search-cancel-button { display: none; }',
      '.elr-find-input::placeholder { color: var(--dsw-alias-label-secondary); }',
      '.elr-find-input:disabled { opacity: .45; }',
      '.elr-find-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 1px; }',
      '.elr-find-count { padding: 0 2px; font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.elr-find-count:empty { display: none; }',
      '.elr-find-btn { display: grid; place-items: center; width: 18px; height: 20px; box-sizing: border-box; padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 14px; line-height: 1; }',
      '.elr-find-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }',
      '.elr-find-btn:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }',
      '.elr-find-btn:disabled { opacity: .4; cursor: default; }',
      '.elr-find-btn.is-prev::before, .elr-find-btn.is-next::before { content: ""; width: 5px; height: 5px; border-top: 1.25px solid currentColor; border-left: 1.25px solid currentColor; transform: translateY(1px) rotate(45deg); }',
      '.elr-find-btn.is-next::before { transform: translateY(-1px) rotate(225deg); }',
      // (v39 #1) The hit overlay sits above the page canvas next to the
      // highlight layer, but with `multiply` it tints text without hiding it.
      '.elr-find-overlay { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 4; mix-blend-mode: multiply; }',
      // ---- v21 #1 / v28 #2: bibliography column ----
      '.elr-refs-count { font-weight: 400; font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.elr-refs-empty { padding: 10px 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }',
      '.elr-refs-list { display: flex; flex-direction: column; gap: 9px; }',
      '.elr-ref { display: flex; gap: 7px; align-items: flex-start; font-size: 12px; line-height: 1.6; }',
      '.elr-ref-index { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }',
      '.elr-ref-body { flex: 1 1 auto; min-width: 0; }',
      '.elr-ref-en { color: var(--dsw-alias-label-primary); word-break: break-word; }',
      '.elr-ref-zh { color: var(--dsw-alias-label-secondary); margin-top: 2px; word-break: break-word; }',
      '.elr-ref-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 2px; }',
      '.elr-ref-link { display: block; margin-top: 3px; font-size: 11px; color: var(--dsw-alias-brand-primary); word-break: break-all; text-decoration: none; }',
      '.elr-ref-link:hover { text-decoration: underline; }',
      '.elr-ref-missing { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-state-warn-primary); }',
      // (v52) The bibliography row now leads with the ORIGINAL entry, with parsed
      // fields and the link stacked above it. The raw text is clamped to four lines
      // so one garbled entry cannot push the rest of the list off screen; the whole
      // string stays in the DOM for selection and for the page-range tooltip.
      '.elr-ref-raw { margin-top: 3px; font-size: 11px; line-height: 1.55; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }',
      '.elr-ref-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }',
      '.elr-ref-chip { flex: 0 0 auto; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); font-size: 10px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }',
      '.elr-ref-chip.is-provided { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }',
      '.elr-ref-chip.is-matched { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }',
      '.elr-ref-chip.is-confirm, .elr-ref-chip.is-retry { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }',
      '.elr-ref-chip.is-none, .elr-ref-chip.is-legacy { color: var(--dsw-alias-label-secondary); }',
      '.elr-ref-row .elr-ref-link { margin-top: 0; flex: 1 1 120px; min-width: 0; }',
      '.elr-ref-row .elr-ref-missing { margin-top: 0; }',
      '.elr-refs-stage { flex: 0 0 auto; padding: 4px 12px 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1); }',
    ].join('\n');

    function installCss() {
      let tag = document.getElementById(CSS_ID);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = CSS_ID;
        tag.dataset.pluginCss = CSS_ID;
        document.head.appendChild(tag);
      }
      tag.textContent = CSS;
      return () => {};
    }

    function installPdfCss() {
      let link = document.getElementById(PDFCSS_ID);
      if (!link) {
        link = document.createElement('link');
        link.id = PDFCSS_ID;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = asset('pdf_viewer.css');
      return () => {};
    }

    // (v9 #2) KaTeX stylesheet. It is a separate <link> so the `fonts/…` URLs it
    // declares resolve against `/plugins/english-lit-reader/vendor/katex/`, which
    // is exactly where the woff2 files were vendored.
    function installKatexCss() {
      let link = document.getElementById(KATEXCSS_ID);
      if (!link) {
        link = document.createElement('link');
        link.id = KATEXCSS_ID;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = asset('katex/katex.min.css');
      return () => {};
    }

    // Load the vendored UMD bundles as classic scripts. Some host pages define a
    // global `define`/`module`; hide those markers while the UMD wrapper runs so
    // it always takes the `globalThis.pdfjsLib` / `globalThis.pdfjsViewer` branch.
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const g = globalThis;
        const saved = {
          define: g.define, module: g.module, exports: g.exports,
          hasDefine: 'define' in g, hasModule: 'module' in g, hasExports: 'exports' in g,
        };
        let restored = false;
        const restore = () => {
          if (restored) return;
          restored = true;
          try {
            if (saved.hasDefine) g.define = saved.define; else delete g.define;
            if (saved.hasModule) g.module = saved.module; else delete g.module;
            if (saved.hasExports) g.exports = saved.exports; else delete g.exports;
          } catch (_) {}
        };
        try {
          if ('define' in g) g.define = undefined;
          if ('module' in g) g.module = undefined;
          if ('exports' in g) g.exports = undefined;
        } catch (_) {}
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => { restore(); resolve(); };
        s.onerror = () => { restore(); reject(new Error('failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }

    // Fallback for pages with a strict script-src CSP.
    async function loadScriptEval(src) {
      const r = await fetch(src, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const code = await r.text();
      const run = new Function('exports', 'module', 'define', code);
      run(undefined, undefined, undefined);
    }

    // (v51) The host page may already publish its own `pdfjsLib` (the app's
    // built-in PDF preview does). Reusing it is not safe: we pair the API with
    // OUR vendored worker, and a newer API against a 3.11.174 worker throws
    // `The API version "6.3.289" does not match the Worker version "3.11.174"`.
    //
    // So we always load our own copy. Both UMD bundles assign their export onto
    // globalThis unconditionally, so loading is enough to take the slot; we
    // snapshot the page's values first and hand them back afterwards, leaving
    // the host's own viewer untouched. The private binding is what we use.
    const PDFJS_VERSION = '3.11.174';
    let pdfJsPromise = null;
    let ownPdfJs = null;

    const takeGlobal = (name) => {
      const g = globalThis;
      const had = name in g;
      const value = g[name];
      return () => {
        try {
          if (had) g[name] = value; else delete g[name];
        } catch (_) {}
      };
    };

    function ensurePdfJs() {
      if (ownPdfJs) return Promise.resolve(ownPdfJs);
      if (pdfJsPromise) return pdfJsPromise;
      pdfJsPromise = (async () => {
        installPdfCss();
        const load = async (file) => {
          const src = asset(file);
          try { await loadScript(src); }
          catch (error) { await loadScriptEval(src); }
        };
        const beforeLib = globalThis.pdfjsLib;
        const beforeViewer = globalThis.pdfjsViewer;
        const restoreLib = takeGlobal('pdfjsLib');
        const restoreViewer = takeGlobal('pdfjsViewer');
        // `pdfjsWorker` is the global the fake-worker fallback reads. A foreign
        // one reintroduces the same version mismatch, so it is cleared while our
        // copy loads and put back afterwards — the host's own viewer keeps its
        // fallback intact.
        const restoreWorker = takeGlobal('pdfjsWorker');
        let lib = null;
        let V = null;
        try {
          await load('pdf.min.js');
          lib = globalThis.pdfjsLib;
          if (!lib) throw new Error('pdf.js core is unavailable');
          if (lib === beforeLib) throw new Error('pdf.js core was not replaced by the bundled copy');
          if (lib.version !== PDFJS_VERSION) {
            throw new Error('pdf.js core version ' + lib.version + ' (expected ' + PDFJS_VERSION + ')');
          }
          // Our own object, not the host's: this assignment cannot leak.
          lib.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.js');
          // The viewer resolves its core through the global at module-eval
          // time (`module.exports = globalThis.pdfjsLib`), so it must be loaded
          // while OUR copy is the visible one.
          await load('pdf_viewer.js');
          V = globalThis.pdfjsViewer;
          if (!V || !V.PDFViewer) throw new Error('pdf.js viewer is unavailable');
        } finally {
          restoreLib();
          restoreViewer();
          restoreWorker();
        }
        ownPdfJs = { pdfjsLib: lib, V };
        return ownPdfJs;
      })().catch((error) => { pdfJsPromise = null; throw error; });
      return pdfJsPromise;
    }

    // (v9 #2) KaTeX is loaded lazily the first time a formula or a `$…$` span
    // needs rendering. Until it arrives, math is shown as monospace source; the
    // hook below re-renders once the library lands so nothing stays raw.
    let katexPromise = null;
    const katexListeners = new Set();
    function ensureKatex() {
      if (globalThis.katex) return Promise.resolve(globalThis.katex);
      if (katexPromise) return katexPromise;
      katexPromise = (async () => {
        installKatexCss();
        const src = asset('katex/katex.min.js');
        try { await loadScript(src); }
        catch (_) { try { await loadScriptEval(src); } catch (_) {} }
        return globalThis.katex || null;
      })().catch(() => null);
      return katexPromise;
    }
    function useKatexReady() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        if (globalThis.katex) return undefined;
        const ping = () => bump((n) => n + 1);
        katexListeners.add(ping);
        let alive = true;
        ensureKatex().then(() => {
          if (!alive) return;
          const list = Array.from(katexListeners);
          katexListeners.clear();
          for (const cb of list) { try { cb(); } catch (_) {} }
        });
        return () => { alive = false; katexListeners.delete(ping); };
      }, []);
    }

    // Render one TeX expression. `throwOnError: false` makes KaTeX draw the
    // offending fragment in red instead of throwing, which keeps a partially
    // malformed answer readable instead of blanking the whole card.
    // (v10 #2) Models routinely emit TeX that KaTeX rejects even though the
    // intent is obvious — `\bm` (needs the bm package), `\mathbbm` (bbm),
    // `\label{}`/`\tag{}` (not in KaTeX), `\operatorname*`, `\hspace*`, stray
    // `\nonumber`. One failed token used to turn the WHOLE expression into a red
    // error node, which is what made "the formulas in the explanation still do not
    // render". Normalising the common offenders and retrying makes far more
    // expressions come out typeset.
    function normalizeTex(tex) {
      let src = String(tex == null ? '' : tex);
      src = src.replace(/\\mathbbm(?![a-zA-Z])/g, '\\mathbb');
      src = src.replace(/\\bm(?![a-zA-Z])\s*\{/g, '\\boldsymbol{');
      src = src.replace(/\\operatorname\*\s*\{/g, '\\operatorname{');
      src = src.replace(/\\(?:label|tag|hspace\*?|phantom)\s*\{[^{}]*\}/g, '');
      src = src.replace(/\\(?:nonumber|notag|displaystyle|textstyle)(?![a-zA-Z])/g, '');
      src = src.replace(/\\mbox\s*\{/g, '\\text{');
      src = src.replace(/\\eqref\s*\{[^{}]*\}/g, '');
      // `\color{...}` and `\begin{figure}` style leftovers cannot be typeset.
      src = src.replace(/\\begin\{(?:figure|table|tabular|center|flushleft|flushright)\}[\s\S]*?\\end\{\1\}/g, '');
      return src;
    }

    // A KaTeX failure node is `<span class="katex-error" ...>`. Detecting it lets
    // us retry with the normalised source instead of showing raw TeX.
    const KATEX_FAILED_RE = /class="[^"]*\bkatex-error\b/;

    function renderMath(tex, display) {
      const src0 = String(tex == null ? '' : tex).trim();
      if (!src0) return null;
      const katex = globalThis.katex;
      if (katex && typeof katex.renderToString === 'function') {
        const attempts = [src0];
        const normalized = normalizeTex(src0).trim();
        if (normalized && normalized !== src0) attempts.push(normalized);
        for (let i = 0; i < attempts.length; i++) {
          try {
            const html = katex.renderToString(attempts[i], {
              displayMode: !!display,
              throwOnError: false,
              strict: 'ignore',
              output: 'html',
              trust: false,
            });
            if (!KATEX_FAILED_RE.test(html)) {
              return h('span', {
                className: 'elr-katex',
                dangerouslySetInnerHTML: { __html: html },
              });
            }
          } catch (_) {}
        }
      }
      return h('code', { className: 'elr-katex-err' }, display ? '$$' + src0 + '$$' : '$' + src0 + '$');
    }

    // Cell text may itself contain math, bold or `code`, so cells go through
    // the same inline renderer as paragraphs.
    //
    // Both delimiter families are honoured because the model uses whichever it
    // prefers: `$…$` / `$$…$$` (TeX style) and `\(…\)` / `\[…\]` (LaTeX style).
    // Only handling dollars left `\(F\)` printed literally, which is unreadable.
    //
    // (v10 #2) The `\(…\)` body must be matched with a LAZY ANY-CHAR pattern, not
    // with `[^)]*?`: a formula such as `\(X_{(T+1):(T+S)}\)` contains closing
    // parentheses of its own, so the character-class version could never reach the
    // real `\)` terminator and the whole expression fell back to raw text. Lazy
    // matching still stops at the FIRST `\)` (or `\]`), which is the correct
    // behaviour for inline math.
    const INLINE_MATH_RE = /(\*\*[^*]+\*\*|`[^`]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+\$)/g;
    function renderInline(text) {
      // `$$…$$`, `\[…\]` and `\(…\)` are tried before `$…$`, otherwise the
      // single-dollar pattern eats their inner pair and leaves the outer
      // delimiters printed.
      const parts = String(text == null ? '' : text).split(INLINE_MATH_RE);
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
          out.push(h('strong', { key: 'b' + i }, part.slice(2, -2)));
          continue;
        }
        if (part.length > 2 && part.charAt(0) === '`' && part.charAt(part.length - 1) === '`') {
          out.push(h('code', { key: 'c' + i }, part.slice(1, -1)));
          continue;
        }
        if (part.length > 4 && part.slice(0, 2) === '$$' && part.slice(-2) === '$$') {
          out.push(h('span', { key: 'M' + i, className: 'elr-math-inline' }, renderMath(part.slice(2, -2), false)));
          continue;
        }
        if (part.length > 4 && part.slice(0, 2) === '\\[' && part.slice(-2) === '\\]') {
          out.push(h('span', { key: 'B' + i, className: 'elr-math-inline' }, renderMath(part.slice(2, -2), false)));
          continue;
        }
        if (part.length > 4 && part.slice(0, 2) === '\\(' && part.slice(-2) === '\\)') {
          out.push(h('span', { key: 'p' + i, className: 'elr-math-inline' }, renderMath(part.slice(2, -2), false)));
          continue;
        }
        if (part.length > 2 && part.charAt(0) === '$' && part.charAt(part.length - 1) === '$') {
          out.push(h('span', { key: 'm' + i, className: 'elr-math-inline' }, renderMath(part.slice(1, -1), false)));
          continue;
        }
        out.push(part);
      }
      return out;
    }

    const isTableSeparator = (line) => {
      const s = String(line || '').trim();
      if (!s) return false;
      if (s.indexOf('|') < 0 && s.indexOf(' ') < 0) return false;
      return /^\|?[\s:-]*-[\s:|-]*\|?$/.test(s) && (s.match(/-/g) || []).length >= 2;
    };
    const splitTableRow = (line) => {
      let s = String(line || '').trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      return s.split('|').map((cell) => cell.trim());
    };

    // (v9 #2) A formula selected out of a PDF arrives as BARE TeX — no `$…$`
    // delimiters — and often spans several lines:
    //
    //   $$X_{(T+1):(T+S)} = F(X_{1:T}, E_{1:T}) \in \mathbb{R}^{M \times S}$$
    //   X_{(T+1):(T+S)} = F(X_{1:T}, E_{1:T}) \in \mathbb{R}^{M \times S}
    //
    // Both have to end up typeset. Text that is already delimited (or is prose
    // with inline math) goes through the Markdown renderer; undelimited source is
    // wrapped in display math and handed to KaTeX directly.
    function renderFormulaPreview(text) {
      const src = String(text == null ? '' : text).trim();
      if (!src) return null;
      // Both delimiter families count as "already delimited": `$$…$$`/`$…$`
      // and the LaTeX pair `\[…\]`/`\(…\)` that the model also emits. The `\(…\)`
      // body is matched with a lazy any-char pattern because the formula itself
      // contains parentheses (`X_{(T+1):(T+S)}`), which the old `[^)]*?` version
      // could never span.
      const hasDisplay = src.indexOf('$$') >= 0 || src.indexOf('\\[') >= 0;
      const hasInline = /\\\([\s\S]*?\\\)/.test(src) || /\$[^$\n]+\$/.test(src);
      if (hasDisplay || hasInline) return renderMarkdown(src);
      // Prose detection: a line of running English would be mangled by KaTeX,
      // whereas a formula is mostly symbols, operators and backslash commands.
      const words = src.split(/\s+/).filter((w) => w.length > 2 && /^[A-Za-z][A-Za-z'’-]*$/.test(w));
      const prose = words.length > src.split(/\s+/).length * 0.55 && words.length > 6;
      if (prose) return h('div', { className: 'elr-markdown' }, renderMarkdown(src));
      // Strip a stray pair of delimiters, then typeset as display math.
      let tex = src;
      if (tex.slice(0, 2) === '$$' && tex.slice(-2) === '$$') tex = tex.slice(2, -2);
      else if (tex.slice(0, 2) === '\\[' && tex.slice(-2) === '\\]') tex = tex.slice(2, -2);
      else if (tex.charAt(0) === '$' && tex.charAt(tex.length - 1) === '$') tex = tex.slice(1, -1);
      // Line breaks inside a formula are layout, not math: a PDF wraps a single
      // expression across lines, so they collapse to one space. (`\\` would need
      // an aligned/gathered environment and would render as a stray red token.)
      tex = tex.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
      return h('div', { className: 'elr-math-block' }, renderMath(tex, true));
    }

    // Block-level Markdown with the two additions the model actually emits:
    // `$$…$$` / `\[…\]` display math and GitHub-style pipe tables.
    function renderMarkdown(text) {
      const lines = String(text || '').split('\n');
      const nodes = [];
      let list = null;
      const flush = () => {
        if (!list) return;
        nodes.push(h(list.tag, { key: list.tag + nodes.length, start: list.start }, list.items));
        list = null;
      };
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Display math, possibly spanning several lines. Both `$$…$$` and the
        // LaTeX pair `\[…\]` are supported: the model uses whichever it likes.
        const opener = line.trim().indexOf('$$') === 0 ? '$$' : (line.trim().indexOf('\\[') === 0 ? '\\[' : '');
        if (opener) {
          flush();
          const closer = opener === '$$' ? '$$' : '\\]';
          const after = line.trim().slice(opener.length);
          if (after.indexOf(closer) >= 0) {
            const tex = after.slice(0, after.lastIndexOf(closer));
            nodes.push(h('div', { key: 'dm' + i, className: 'elr-math-block' }, renderMath(tex, true)));
            continue;
          }
          const buf = after ? [after] : [];
          let closed = false;
          for (let j = i + 1; j < lines.length; j++) {
            const row = lines[j];
            const at = row.indexOf(closer);
            if (at >= 0) {
              if (row.slice(0, at).trim()) buf.push(row.slice(0, at));
              i = j;
              closed = true;
              break;
            }
            buf.push(row);
          }
          nodes.push(h('div', { key: 'dm' + i, className: 'elr-math-block' }, renderMath(buf.join('\n'), true)));
          if (!closed) i = lines.length;
          continue;
        }
        // Pipe table: a header row followed by a separator row.
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
          flush();
          const head = splitTableRow(line);
          const rows = [];
          let j = i + 2;
          for (; j < lines.length; j++) {
            const row = lines[j];
            if (!row.trim() || row.indexOf('|') < 0) break;
            rows.push(splitTableRow(row));
          }
          i = j - 1;
          nodes.push(h('div', { key: 'tb' + i, className: 'elr-table-wrap' },
            h('table', { className: 'elr-md-table' },
              h('thead', null, h('tr', null, head.map((cell, ci) =>
                h('th', { key: 'h' + ci }, renderInline(cell))))),
              h('tbody', null, rows.map((row, ri) =>
                h('tr', { key: 'r' + ri }, row.map((cell, ci) =>
                  h('td', { key: 'c' + ci }, renderInline(cell))))))
            )
          ));
          continue;
        }
        const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
        if (heading) {
          flush();
          const level = Math.max(2, heading[1].length);
          nodes.push(h('h' + level, { key: 'h' + i }, renderInline(heading[2].replace(/[ \t]+#+$/, ''))));
          continue;
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (bullet || numbered) {
          const tag = bullet ? 'ul' : 'ol';
          if (list?.tag !== tag) {
            flush();
            list = { tag, start: numbered ? Number(numbered[1]) : undefined, items: [] };
          }
          list.items.push(h('li', { key: 'li' + i }, renderInline(bullet ? bullet[1] : numbered[2])));
          continue;
        }
        flush();
        if (line.trim() === '') { nodes.push(h('div', { key: 'br' + i, style: { height: '6px' } })); continue; }
        nodes.push(h('p', { key: 'p' + i, style: { margin: '4px 0' } }, renderInline(line)));
      }
      flush();
      return nodes;
    }

    function renderFigureMarkdown(text) {
      const source = text.trim();
      const fenced = /^(`{3,}|~{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1$/i.exec(source);
      return renderMarkdown(fenced ? fenced[2] : source);
    }

    function renderGenerationMetadata(record, selection, t, summary = false) {
      const saved = record || {};
      const unknown = t('generation.unrecorded');
      const nameOf = (route) => route.modelName || route.model;
      const effortOf = (route) => route.reasoningEffortName || route.reasoningEffort || (route.followDefault ? t('effort.follow') : '');
      const current = (value) => value ? t('generation.currentSetting', { value }) : unknown;
      const name = nameOf(saved);
      const model = name ? [saved.provider, name].filter(Boolean).join(' / ')
        : current(nameOf(selection) && [selection.provider, nameOf(selection)].filter(Boolean).join(' / '));
      const effort = effortOf(saved) || current(effortOf(selection));
      const route = [saved.provider, saved.model].filter(Boolean).join(' / ');
      const time = Date.parse(saved.generatedAt);
      return h('div', { className: 'elr-generation-meta' + (summary ? ' elr-summary-meta' : '') },
        h('span', { title: route || undefined }, t('generation.model', { model })),
        h('span', null, t('generation.effort', { effort })),
        h('span', null, t('generation.time') + ' ', Number.isFinite(time)
          ? h('time', { dateTime: saved.generatedAt, title: saved.generatedAt }, new Date(time).toLocaleString()) : unknown)
      );
    }

    async function post(path, payload, timeoutMs, signal) {
      // (v12) A stalled Host call used to hang the browser for ~9 minutes.
      // Bound every request; `ELR_TIMEOUT` marks an abort so callers can show a
      // clear message instead of a generic fetch failure.
      const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 300000;
      let controller = null;
      try { controller = new AbortController(); } catch (_) {}
      const cancel = () => controller && controller.abort();
      if (signal && signal.aborted) cancel();
      else if (signal) signal.addEventListener('abort', cancel, { once: true });
      const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
      try {
        const response = await fetch(BASE + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : signal,
        });
        if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
        return await response.json();
      } catch (error) {
        if (error && error.name === 'AbortError') {
          const timeout = new Error('ELR_TIMEOUT');
          timeout.timeout = true;
          throw timeout;
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', cancel);
      }
    }

    function copyText(text) {
      try { return navigator.clipboard.writeText(text); } catch (_) { return Promise.resolve(); }
    }

    // (v34 #2) Coalesce a drag gesture's DOM writes to ONE per animation frame.
    //
    // `pointermove` is not throttled to the refresh rate: a 1000 Hz gaming mouse
    // delivers that many events per second, and every one of them used to write a
    // width/height straight to the DOM. Each write invalidates layout, and the
    // layout in question re-centres every pdf.js page (`.pdfViewer .page` is
    // `margin: 1px auto`), so hundreds of queued writes per frame turned a drag
    // into a slideshow. Buffering the newest value and painting it once inside a
    // `requestAnimationFrame` keeps the gesture in step with what the screen can
    // actually show — intermediate positions that would never be displayed are
    // simply dropped, and the LAST value always wins.
    function frameWriter(paint) {
      let frame = 0;
      let last = null;
      const run = () => {
        frame = 0;
        const value = last;
        last = null;
        if (value !== null && value !== undefined) paint(value);
      };
      const stop = () => {
        if (!frame) return;
        try {
          if (window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
          else window.clearTimeout(frame);
        } catch (_) {}
        frame = 0;
      };
      return {
        push(value) {
          last = value;
          if (frame) return;
          frame = window.requestAnimationFrame
            ? window.requestAnimationFrame(run)
            : window.setTimeout(run, 16);
        },
        // Paint the pending value right now (used on pointerup so the release
        // frame cannot lag one event behind the commit).
        flush() {
          stop();
          run();
        },
        cancel() {
          stop();
          last = null;
        },
      };
    }

    // (v34 #2) "Cheap paint" mode for the duration of a size gesture. Card
    // transitions and the PDF viewport's hit-testing are pure overhead while a
    // handle is being dragged, and hover tracking over the text layer costs one
    // hit test per frame on top of the layout the drag already forces.
    const GESTURE_CLASS = 'elr-gesturing';
    function gestureStart() {
      try { document.body.classList.add(GESTURE_CLASS); } catch (_) {}
    }
    function gestureEnd() {
      try { document.body.classList.remove(GESTURE_CLASS); } catch (_) {}
    }

    // (v18 #3) Edge/corner resize for the floating cards. The browser's native
    // `resize: both` only ever exposes ONE handle in the bottom-right corner, which
    // is what the reader complained about. These eight transparent strips sit on the
    // four borders and the four corners and drag the corresponding side: the card's
    // own { x, y, w, h } state is patched on every pointermove, so no CSS resize is
    // involved and the geometry stays exact.
    const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

    function popupViewport() {
      const viewport = window.visualViewport;
      const x = (viewport && viewport.offsetLeft) || 0;
      const y = (viewport && viewport.offsetTop) || 0;
      const width = (viewport && viewport.width) || window.innerWidth || 1200;
      const height = (viewport && viewport.height) || window.innerHeight || 800;
      const chrome = window.getComputedStyle(document.documentElement);
      const frameTop = parseFloat(chrome.getPropertyValue('--dsh-frame-chrome-top'));
      const frameClearance = Number.isFinite(frameTop) ? frameTop : (parseFloat(chrome.getPropertyValue('--dsh-frame-top-clearance')) || 0);
      const titleBar = document.fullscreenElement?.classList.contains('elr-view') ? 0 : frameClearance;
      const gapX = Math.min(8, width / 4);
      const gapY = Math.min(8, height / 4);
      const bottom = y + height - gapY;
      return { left: x + gapX, top: Math.min(bottom - 1, Math.max(y, titleBar) + gapY), right: x + width - gapX, bottom };
    }

    const clampPopup = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

    function fitPopupBox(box, viewport) {
      const w = Math.min(box.w, viewport.right - viewport.left);
      const h = Math.min(box.h, viewport.bottom - viewport.top);
      return {
        w, h,
        x: clampPopup(box.x, viewport.left, viewport.right - w),
        y: clampPopup(box.y, viewport.top, viewport.bottom - h),
      };
    }

    function functionCardOrder(saved) {
      const valid = Array.isArray(saved) ? saved.filter((key) => CARD_KEYS.includes(key)) : [];
      return [...new Set([...valid, ...CARD_KEYS])];
    }

    // Readers in the main view and sidebar share one set of floating windows.
    const cardWindowHosts = new Set();
    const cardWindowListeners = new Set();
    let cardWindowHost = null;
    const readCardWindowHost = () => cardWindowHost;
    const subscribeCardWindowHost = (listener) => {
      cardWindowListeners.add(listener);
      return () => cardWindowListeners.delete(listener);
    };
    function selectCardWindowHost(host) {
      if (host === cardWindowHost) return;
      cardWindowHost = host;
      for (const listener of cardWindowListeners) listener();
    }

    function placeFunctionCard(box, open, viewport) {
      return fitPopupBox({ ...box, h: open ? box.h : CARD_HEADER_HEIGHT }, viewport);
    }

    function termPopoverSpace(rect, bounds, card = rect, dock = 'right') {
      const gap = 9;
      const width = Math.min(400, bounds.right - bounds.left);
      const height = Math.min(430, bounds.bottom - bounds.top);
      const centerX = rect.anchorX ?? (rect.left + rect.right) / 2;
      const centerY = rect.anchorY ?? (rect.top + rect.bottom) / 2;
      const sides = dock === 'bottom' ? ['above', 'left', 'right', 'below'] : ['left', 'right', 'above', 'below'];
      const candidates = (target) => {
        const left = Math.max(0, Math.min(width, target.left - gap - bounds.left));
        const right = Math.max(0, Math.min(width, bounds.right - target.right - gap));
        const above = Math.max(0, Math.min(height, target.top - gap - bounds.top));
        const below = Math.max(0, Math.min(height, bounds.bottom - target.bottom - gap));
        const x = clampPopup(centerX - width / 2, bounds.left, bounds.right - width);
        const placements = {
          left: { width: left, maxHeight: height, x: target.left - gap - left },
          right: { width: right, maxHeight: height, x: target.right + gap },
          above: { width, maxHeight: above, x, edgeY: target.top - gap },
          below: { width, maxHeight: below, x, edgeY: target.bottom + gap },
        };
        return sides.map((side) => ({ ...placements[side], side, centerX, centerY }));
      };
      const hasRoom = (fit) => fit.width >= Math.min(250, width) && fit.maxHeight >= Math.min(145, height);
      const nearRow = candidates(rect);
      // Prefer the outside of the whole card, using the row itself as the
      // boundary when a narrow reader leaves little space around the card.
      return candidates(card).find(hasRoom) || nearRow.find(hasRoom)
        || nearRow.sort((a, b) => b.width * b.maxHeight - a.width * a.maxHeight)[0];
    }

    function placePopupNearRect(box, rect, viewport) {
      if (!rect) return fitPopupBox(box, viewport);
      const h = Math.min(box.h, viewport.bottom - viewport.top);
      const below = rect.bottom + 6;
      const above = rect.top - 6;
      const spaceBelow = viewport.bottom - below;
      const spaceAbove = above - viewport.top;
      const y = spaceBelow >= h || (spaceAbove < h && spaceBelow >= spaceAbove) ? below : above - h;
      return fitPopupBox({ ...box, x: rect.left, y }, viewport);
    }

    function placeNoteBubble(id, text, note, rect) {
      const viewport = popupViewport();
      const w = Math.min(400, viewport.right - viewport.left);
      const charsPerLine = Math.max(1, Math.floor((w - 38) / 12));
      const lines = String(note || '').split(/\r?\n/).reduce((total, line) => (
        total + Math.max(1, Math.ceil(line.length / charsPerLine))
      ), 0);
      const box = placePopupNearRect({
        x: viewport.left + 32, y: viewport.top + 32, w, h: Math.min(490, Math.max(168, 84 + lines * 20)),
      }, rect, viewport);
      return { id, text, note, ...box };
    }

    function resizePanelBox(origin, edge, dx, dy, bounds, minWidth, minHeight) {
      const right = origin.x + origin.w;
      const bottom = origin.y + origin.h;
      const width = Math.min(minWidth, bounds.right - bounds.left);
      const height = Math.min(minHeight, bounds.bottom - bounds.top);
      const x = edge.includes('w') ? clampPopup(origin.x + dx, bounds.left, right - width) : origin.x;
      const y = edge.includes('n') ? clampPopup(origin.y + dy, bounds.top, bottom - height) : origin.y;
      const endX = edge.includes('e') ? clampPopup(right + dx, x + width, bounds.right) : right;
      const endY = edge.includes('s') ? clampPopup(bottom + dy, y + height, bounds.bottom) : bottom;
      return { x, y, w: endX - x, h: endY - y };
    }

    function resizeHandles(onPatch, minWidth, minHeight, getBounds, { edges = RESIZE_EDGES, cancelRef, title } = {}) {
      return edges.map((edge) => h('span', {
        key: edge,
        className: 'elr-rz elr-rz-' + edge,
        title, 'aria-hidden': true,
        onPointerDown: (event) => {
          if (event.button !== 0 || event.isPrimary === false || cancelRef?.current) return;
          const handle = event.currentTarget;
          const card = handle.parentElement;
          if (!card) return;
          const start = card.getBoundingClientRect();
          const origin = { x: start.left, y: start.top, w: start.width, h: start.height };
          const originalStyle = { left: card.style.left, top: card.style.top, width: card.style.width, height: card.style.height };
          const bounds = getBounds?.() || { left: 0, top: 0, right: Infinity, bottom: Infinity };
          const computed = window.getComputedStyle(card);
          const inset = (properties) => computed.boxSizing === 'border-box' ? 0
            : properties.reduce((total, property) => total + (parseFloat(computed[property]) || 0), 0);
          const insetX = inset(['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']);
          const insetY = inset(['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']);
          const { clientX: startX, clientY: startY, pointerId: pointer } = event;
          let active = true;
          const nextBox = (ev) => resizePanelBox(origin, edge, ev.clientX - startX, ev.clientY - startY, bounds, minWidth, minHeight);
          const measuredPatch = (box) => {
            const patch = {};
            if (edge.includes('w')) patch.x = box.x;
            if (edge.includes('n')) patch.y = box.y;
            if (edge.includes('w') || edge.includes('e')) patch.w = box.w - insetX;
            if (edge.includes('n') || edge.includes('s')) patch.h = box.h - insetY;
            return patch;
          };
          const paint = (box) => {
            const patch = measuredPatch(box);
            if (patch.x !== undefined) card.style.left = patch.x + 'px';
            if (patch.y !== undefined) card.style.top = patch.y + 'px';
            if (patch.w !== undefined) card.style.width = patch.w + 'px';
            if (patch.h !== undefined) card.style.height = patch.h + 'px';
          };
          const painter = frameWriter(paint);
          const cleanup = () => {
            if (!active) return false;
            active = false;
            if (cancelRef?.current === cancel) cancelRef.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('blur', cancel);
            handle.removeEventListener('lostpointercapture', onCancel);
            try { if (handle.hasPointerCapture?.(pointer)) handle.releasePointerCapture(pointer); } catch (_) {}
            painter.cancel();
            gestureEnd();
            return true;
          };
          const move = (ev) => {
            if (ev.pointerId === pointer) painter.push(nextBox(ev));
          };
          const finish = (ev) => {
            if (ev.pointerId !== pointer || !cleanup()) return;
            const box = nextBox(ev);
            if ((ev.clientX === startX && ev.clientY === startY) || Object.keys(box).every((key) => box[key] === origin[key])) {
              Object.assign(card.style, originalStyle);
              return;
            }
            paint(box);
            onPatch(getBounds ? box : measuredPatch(box), edge);
          };
          const cancel = () => {
            if (cleanup()) Object.assign(card.style, originalStyle);
          };
          const onCancel = (ev) => { if (ev.pointerId === pointer) cancel(); };
          const onKey = (ev) => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            cancel();
          };
          if (cancelRef) cancelRef.current = cancel;
          gestureStart();
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', finish);
          window.addEventListener('pointercancel', onCancel);
          window.addEventListener('keydown', onKey, true);
          window.addEventListener('blur', cancel);
          handle.addEventListener('lostpointercapture', onCancel);
          try { handle.setPointerCapture(pointer); } catch (_) {}
          event.preventDefault();
          event.stopPropagation();
        },
      }));
    }

    function selectionPaneSize(split) {
      return 'calc(' + (split * 100) + '% - ' + (split * SELECTION_SPLITTER_SIZE) + 'px)';
    }

    function selectionPaneGrip(split, onSplit, label, cancelRef, sideBySide) {
      const minSize = sideBySide ? SELECTION_PANE_MIN_W : SELECTION_PANE_MIN_H;
      const growKey = sideBySide ? 'ArrowRight' : 'ArrowDown';
      const shrinkKey = sideBySide ? 'ArrowLeft' : 'ArrowUp';
      const pointerPosition = (event) => sideBySide ? event.clientX : event.clientY;
      const measure = (grip) => {
        const panes = grip.parentElement;
        return {
          panes,
          available: sideBySide ? panes.clientWidth - grip.offsetWidth : panes.clientHeight - grip.offsetHeight,
          originalSize: sideBySide ? grip.previousElementSibling.offsetWidth : grip.previousElementSibling.offsetHeight,
        };
      };
      const splitAt = (size, available) => {
        const floor = Math.min(minSize, available / 2);
        return clampPopup(size, floor, available - floor) / available;
      };
      return h('div', {
        className: 'elr-selection-split', role: 'separator', tabIndex: 0,
        title: label, 'aria-label': label, 'aria-orientation': sideBySide ? 'vertical' : 'horizontal',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(split * 100),
        onKeyDown: (event) => {
          if (![shrinkKey, growKey, 'Home', 'End'].includes(event.key)) return;
          const { available, originalSize } = measure(event.currentTarget);
          if (available <= 0) return;
          const step = event.shiftKey ? 36 : 12;
          const position = event.key === 'Home' ? 0 : event.key === 'End' ? available
            : originalSize + (event.key === shrinkKey ? -step : step);
          event.preventDefault();
          onSplit(splitAt(position, available));
        },
        onPointerDown: (event) => {
          if (event.button !== 0 || event.isPrimary === false || cancelRef.current) return;
          const grip = event.currentTarget;
          const { panes, available, originalSize } = measure(grip);
          if (available <= 0) return;
          const scroller = sideBySide ? panes.closest('.elr-side-body') : panes.parentElement;
          const scroll = () => sideBySide ? scroller?.scrollLeft ?? 0 : scroller.scrollTop;
          const scrollStart = scroll();
          const start = pointerPosition(event);
          const { pointerId } = event;
          const delta = (next) => pointerPosition(next) - start + scroll() - scrollStart;
          const ratio = (next) => splitAt(originalSize + delta(next), available);
          const paint = (value) => panes.style.setProperty('--elr-selection-source', selectionPaneSize(value));
          const painter = frameWriter(paint);
          const remove = () => {
            if (cancelRef.current !== cancel) return false;
            cancelRef.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', interrupt);
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('blur', cancel);
            grip.removeEventListener('lostpointercapture', interrupt);
            try { if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId); } catch (_) {}
            painter.cancel();
            gestureEnd();
            return true;
          };
          const move = (next) => {
            if (next.pointerId === pointerId) painter.push(ratio(next));
          };
          const up = (next) => {
            if (next.pointerId !== pointerId || !remove()) return;
            if (!delta(next)) { paint(split); return; }
            const value = ratio(next);
            paint(value);
            onSplit(value);
          };
          const cancel = () => { if (remove()) paint(split); };
          const interrupt = (next) => { if (next.pointerId === pointerId) cancel(); };
          const escape = (next) => {
            if (next.key !== 'Escape') return;
            next.preventDefault();
            next.stopPropagation();
            cancel();
          };
          cancelRef.current = cancel;
          gestureStart();
          grip.focus({ preventScroll: true });
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', interrupt);
          window.addEventListener('keydown', escape, true);
          window.addEventListener('blur', cancel);
          grip.addEventListener('lostpointercapture', interrupt);
          try { grip.setPointerCapture(pointerId); } catch (_) {}
          event.preventDefault();
          event.stopPropagation();
        },
      });
    }

    // (v13 #3) A pdf.js text-layer selection is NOT clean prose: every visual line
    // ends in a hard newline, words are often split by an end-of-line hyphen
    // ("remark-\nable"), and soft hyphens / ligatures / duplicate spaces leak in.
    // Translating that verbatim is exactly why the result came back scrambled.
    // Normalise it into real paragraphs BEFORE it is sent to the model.
    function cleanSelectionText(raw) {
      let s = String(raw == null ? '' : raw);
      if (!s) return '';
      s = s.replace(/\r\n?/g, '\n');
      // soft hyphen, zero-width joiners, BOM; NBSP becomes a normal space.
      s = s.replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, '');
      s = s.replace(/\u00a0/g, ' ');
      // common typographic ligatures
      s = s.replace(/\ufb00/g, 'ff').replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl')
        .replace(/\ufb03/g, 'ffi').replace(/\ufb04/g, 'ffl');
      // De-hyphenate a word broken by a line wrap, but only when the next line
      // continues in lower case (a real compound like "state-of-the-\nArt"
      // keeps its hyphen).
      s = s.replace(/([A-Za-z])-\n([a-z])/g, '$1$2');
      // A single newline is a visual line wrap inside one paragraph -> space.
      // Two or more newlines are a genuine paragraph break -> exactly two.
      s = s.replace(/\n{2,}/g, '\u0000');
      s = s.replace(/\n/g, ' ');
      s = s.replace(/\u0000/g, '\n\n');
      s = s.replace(/[ \t]{2,}/g, ' ');
      s = s.split('\n').map((line) => line.trim()).join('\n');
      return s.trim();
    }

    // (v13 #4) A Selection can hold several ranges (Ctrl+select, or a selection
    // crossing a pdf.js page boundary). `sel.toString()` is not reliable there,
    // and the old 1500-char clip chopped the tail off a two-paragraph selection.
    // Read every range explicitly, then clean the joined text once.
    function selectionToText(sel) {
      if (!sel || sel.isCollapsed) return '';
      const pieces = [];
      const count = sel.rangeCount || 0;
      for (let i = 0; i < count; i++) {
        try {
          const r = sel.getRangeAt(i);
          const v = r && r.toString ? r.toString() : '';
          if (v) pieces.push(v);
        } catch (_) {}
      }
      if (!pieces.length) {
        try { pieces.push(String(sel.toString() || '')); } catch (_) {}
      }
      // (v14 #1) Join the ranges with a single newline, which cleanSelectionText
      // turns into a space. A multi-range selection is usually several fragments
      // of ONE continuous sentence (pdf.js splits it at a page boundary);
      // inserting "\n\n" would fabricate a paragraph break and split the Chinese
      // translation into disconnected blocks. A genuine "\n\n" already inside a
      // single range is still preserved by cleanSelectionText.
      return cleanSelectionText(pieces.join('\n'));
    }

    function selectionDraft(current, fragment, intent) {
      const previousPrefix = current.selectionPrefix || '';
      const prefix = intent === 'append' ? current.selectionEdit.trimEnd() : intent === 'extend' ? previousPrefix : '';
      const source = prefix ? fragment : fragment.slice(0, MAX_SELECTION);
      if (intent !== 'append' && current.selection === source && previousPrefix === prefix) return null;
      const draft = prefix ? prefix + '\n\n' + source : source;
      if (draft.length > MAX_SELECTION) return { overflow: true };
      return { selection: source, selectionEdit: draft, selectionPrefix: prefix, selectionResult: '' };
    }

    // (v35 #1) The sentence a selected term sits in. A single word carries almost no
    // local sense, so the right-click explanation sends the surrounding sentence
    // separately from the whole paper: that is what tells the model how the authors
    // are USING the term here, not just what the term means in the abstract.
    function sentenceAround(raw, term) {
      const source = cleanSelectionText(raw || '');
      const needle = cleanSelectionText(term || '');
      if (!source || !needle) return '';
      const at = source.toLowerCase().indexOf(needle.toLowerCase());
      if (at === -1) return '';
      let start = at;
      while (start > 0 && !/[.!?;]\s/.test(source.slice(start - 2, start + 1))) start--;
      if (start > 0) start += 1;
      let end = at + needle.length;
      while (end < source.length && !/[.!?]/.test(source.charAt(end))) end++;
      if (end < source.length) end += 1;
      return source.slice(start, Math.min(end, start + 600)).trim();
    }

    function isPdf(file) {
      if (!file) return false;
      const name = String(file.name || '').toLowerCase();
      return name.endsWith('.pdf') || file.type === 'application/pdf';
    }

    function Reader(props) {
      const t = props.t;
      const selectionHintId = React.useId();
      const readerRef = React.useRef(null);
      const fullscreenPendingRef = React.useRef(false);
      const [isFullscreen, setIsFullscreen] = React.useState(false);
      const [floatingHost] = React.useState(() => {
        const node = document.createElement('div');
        node.className = 'elr-floating-host';
        return node;
      });
      // Shared (persisted) view state — survives close/reopen and tab unmount.
      const [mode, setMode] = useShared('mode');
      const [text, setText] = useShared('text');
      const [savedSummary] = useShared('summary');
      const [summaryCoverage] = useShared('summaryCoverage');
      const [summaryMeta] = useShared('summaryMeta');
      const [savedSummaryDetail] = useShared('summaryDetail');
      const summaryDetail = savedSummaryDetail?.format === 'detailed-markdown' ? savedSummaryDetail : null;
      const summary = summaryDetail ? savedSummary : '';
      const [selection] = useShared('selection');
      // (v18 #4/#5) The editable English text shared by the inline card and the
      // side column. `selection` stays the untouched PDF selection.
      const [selectionEdit, setSelectionEdit] = useShared('selectionEdit');
      const [selectionResult, setSelectionResult] = useShared('selectionResult');
      const [pdfName, setPdfName] = useShared('pdfName');
      const [pageNum, setPageNum] = useShared('pageNum');
      const [sideWidth, setSideWidth] = useShared('sideWidth');
      const [sideHeight, setSideHeight] = useShared('sideHeight');
      const [dock, setDock] = useShared('dock');
      const [panMode, setPanMode] = useShared('panMode');
      const [spreadMode, setSpreadMode] = useShared('spreadMode');
      const [theme, setTheme] = useShared('theme');
      // (v40) Reader chrome tint (淡蓝 / 淡绿), independent from `theme` above.
      const [uiTone, setUiTone] = useShared('uiTone');
      // Floating cards also need the tone when the portal host is under document.body.
      const toneCls = uiTone === 'default' ? '' : ' elr-tone-' + uiTone;
      const [popupOn, setPopupOn] = useShared('popupOn');
      const [paperId, setPaperId] = useShared('paperId');
      // (v8 #6) Height of the upper side block, so the selection card and the
      // translation/analysis area can be sized independently.
      const [sideTopHeight, setSideTopHeight] = useShared('sideTopHeight');
      // (v25 #3) Width of that same block when the side panel is docked at the
      // bottom: the two halves sit side by side there, so the divider moves on the
      // horizontal axis and the size that has to be remembered is a width.
      const [sideTopWidth, setSideTopWidth] = useShared('sideTopWidth');
      // (v8 #7) Order of the movable side sections.
      const [sectionOrder, setSectionOrder] = useShared('sectionOrder');
      // (v27) Enabled function cards. Separate from `sectionOrder` so closing and
      // reopening a card keeps its position instead of appending it.
      const [cards] = useShared('cards');
      const [floatingCards, setFloatingCards] = useShared('floatingCards');
      const [floatingBounds, setFloatingBounds] = React.useState(popupViewport);
      const [frontCard, setFrontCard] = React.useState(null);
      const ownsCardWindows = React.useSyncExternalStore(subscribeCardWindowHost, readCardWindowHost) === floatingHost;
      const focusCardGripRef = React.useRef(null);
      // (v21 #1) Parsed bibliography of the current paper, enriched with the
      // addresses the Host resolved. Stored with the analysis so a tab switch does
      // not throw it away.
      const [references, setReferences] = useShared('references');
      // (v28) Which view the analysis column shows: 'summary' | 'references'.
      const [analysisTab, setAnalysisTab] = useShared('analysisTab');
      const [figureSort, setFigureSort] = useShared('figureSort');
      const [selectionSplit, setSelectionSplit] = useShared('selectionSplit');
      const [selectionWidthSplit, setSelectionWidthSplit] = useShared('selectionWidthSplit');
      const [selectionCardOpen, setSelectionCardOpen] = useShared('selectionCardOpen');
      // (v32 #1) Per-card widths for the side-by-side bottom dock only. `{}` means
      // "no override", which falls back to an even split of the row.
      const [cardWidths, setCardWidths] = useShared('cardWidths');
      // (v38) Per-card heights for the stacked right dock only. `{}` means "no
      // override", which falls back to the even share introduced in v37.
      const [cardHeights, setCardHeights] = useShared('cardHeights');
      const hostScheme = useHostScheme();
      const scheme = uiTone === 'default' ? hostScheme : (UI_TONES.dark.includes(uiTone) ? 'dark' : 'light');

      // Local (per-mount) state.
      const [meta, setMeta] = React.useState(null);
      const [catalog, setCatalog] = React.useState(null);
      const [selProvider, setSelProvider] = React.useState('');
      const [selModel, setSelModel] = React.useState('');
      const [selEffort, setSelEffort] = React.useState('');
      // (v12) Whether the user has made an explicit model choice. When false,
      // whole-document translation asks the Host for a fast model.
      const [modelPicked, setModelPicked] = React.useState(() => !!readStore(MODEL_PICKED_KEY, false));
      const [efforts, setEfforts] = React.useState(null);
      const [customProvider, setCustomProvider] = React.useState('');
      const [customModel, setCustomModel] = React.useState('');
      const [showCustom, setShowCustom] = React.useState(false);
      const [recent, setRecent] = React.useState(() => {
        const saved = readStore(RECENT_KEY, []);
        const list = Array.isArray(saved) ? saved : [];
        // (#3 v1.0.5) Entries written by older versions may lack `identity`, which
        // is why the same paper kept appearing several times. Derive a stable
        // identity for every entry, then collapse duplicates keeping the newest.
        const seen = Object.create(null);
        const out = [];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e || typeof e !== 'object') continue;
          const identity = e.identity || [e.name || '', e.size || 0].join('|');
          if (seen[identity]) continue;
          seen[identity] = true;
          out.push(Object.assign({}, e, { identity }));
        }
        if (out.length !== list.length) writeStore(RECENT_KEY, out);
        return out.slice(0, RECENT_MAX);
      });
      const [recentOpen, setRecentOpen] = React.useState(true);
      const [marksOpen, setMarksOpen] = React.useState(true);
      // (v27) Whether the card manager popover is showing. Purely local: it is a
      // transient menu, not a preference.
      const [cardMenuOpen, setCardMenuOpen] = React.useState(false);
      const cardMenuButtonRef = React.useRef(null);
      const cardMenuRef = React.useRef(null);
      const [marks, setMarks] = React.useState([]);
      // (v35 #1) Per-paper glossary of explained professional terms. Separate from
      // `marks` because a term is keyed by the word itself and has no page anchor.
      const [terms, setTerms] = React.useState([]);
      // (v24 #2) Which records the list shows: 'all' | 'hl' | 'note'. Persisted so the
      // choice survives a remount (the Reader is unmounted when the view is switched).
      const [markFilter, setMarkFilter] = React.useState(() => {
        const saved = readStore(MARK_FILTER_KEY, 'all');
        return saved === 'hl' || saved === 'note' ? saved : 'all';
      });
      const marksListRef = React.useRef(null);
      const changeMarkFilter = (next) => {
        const value = next === 'hl' || next === 'note' ? next : 'all';
        if (value === markFilter) return;
        marksListRef.current?.scrollTo(0, 0);
        setMarkFilter(value);
        writeStore(MARK_FILTER_KEY, value);
      };
      const [selectionBusy, setSelectionBusy] = React.useState(false);
      // (v35 #1) The term currently being explained ('' when idle) and whether the
      // 术语解释 card is expanded. A glossary entry can be reopened at any time, so
      // the card only needs to remember which one is showing.
      const [termBusy, setTermBusy] = React.useState('');
      const [termsOpen, setTermsOpen] = React.useState(true);
      const [termOpenId, setTermOpenId] = React.useState('');
      const [termBubble, setTermBubble] = React.useState(null);
      const termBubbleId = React.useId();
      const termBubbleRef = React.useRef(null);
      const [summaryBusy, setSummaryBusy] = React.useState(false);
      const [summaryIssue, setSummaryIssue] = React.useState('');
      // (v21 #1) Reference lookup runs right after the analysis, so it gets its own
      // transient busy flag: the analysis text is already usable while the addresses
      // are still being resolved.
      const [referencesBusy, setReferencesBusy] = React.useState(false);
      // (v52) Free-form status for the bibliography run: which stage is running and
      // how the address lookups ended. Kept separate from the toast line so the
      // column can explain itself after the toast is gone.
      const [referencesStage, setReferencesStage] = React.useState('');
      const [referencesCanContinue, setReferencesCanContinue] = React.useState(false);
      const [status, setStatus] = React.useState('');
      const [statusKind, setStatusKind] = React.useState('');
      const [dragOver, setDragOver] = React.useState(false);
      const [hasPdf, setHasPdf] = React.useState(false);
      const [pdfAnalysisReady, setPdfAnalysisReady] = React.useState(false);
      const [pdfTextBusy, setPdfTextBusy] = React.useState(false);
      const [pageCount, setPageCount] = React.useState(0);
      const [dropSeq, setDropSeq] = React.useState(0);
      const [pdfError, setPdfError] = React.useState('');
      const [previewMode, setPreviewMode] = React.useState('pdfjs');
      const [nativeUrl, setNativeUrl] = React.useState('');
      const [popup, setPopup] = React.useState(null);
      // (v14 #2) Persisted, user-controlled font size for the inline-translation
      // card. Resizing the card no longer changes it implicitly.
      const [popupFont, setPopupFont] = React.useState(() => {
        const v = Number(readStore(POPUP_FONT_KEY, POPUP_FONT_DEFAULT));
        return Number.isFinite(v) ? Math.max(POPUP_FONT_MIN, Math.min(POPUP_FONT_MAX, v)) : POPUP_FONT_DEFAULT;
      });
      const changePopupFont = (delta) => {
        setPopupFont((prev) => {
          const next = Math.max(POPUP_FONT_MIN, Math.min(POPUP_FONT_MAX, prev + delta));
          writeStore(POPUP_FONT_KEY, next);
          return next;
        });
      };
      const [menu, setMenu] = React.useState(null);
      const [noteBubble, setNoteBubble] = React.useState(null);
      const [cardDrop, setCardDrop] = React.useState(null);
      const [ghost, setGhost] = React.useState(null);
      const cardGhostRef = React.useRef(null);
      const cardGestureCancelRef = React.useRef(null);
      // (v32 #3) Same idea for the two live-resize handles below: the pending pixel
      // size is written to the element during the gesture and only committed to
      // shared state on pointerup, so one drag re-renders once instead of ~60 times.
      const sideTopElRef = React.useRef(null);
      const sideElRef = React.useRef(null);
      // (v8 #3) Formula explanation card: { x, y, text, body, busy }.
      const [formulaCard, setFormulaCard] = React.useState(null);
      const [figurePicking, setFigurePicking] = React.useState(false);
      const [figureActivity, setFigureActivity] = React.useState(null);
      const [figureArchive, setFigureArchive] = React.useState(null);
      const [expandedFigure, setExpandedFigure] = React.useState(null);
      const figureListRef = React.useRef(null);
      const revealFigureRef = React.useRef(null);
      const openFigureRef = React.useRef(null);
      const figureEntries = React.useMemo(() => figureArchive?.paper === paperId
        ? orderFigureEntries(figureArchive.entries, figureSort) : [], [figureArchive, paperId, figureSort]);
      React.useLayoutEffect(() => {
        const list = figureListRef.current;
        const entry = openFigureRef.current;
        if (!revealFigureRef.current || revealFigureRef.current !== expandedFigure || !list || !entry) return;
        revealFigureRef.current = null;
        list.scrollTop += entry.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop;
      }, [expandedFigure, analysisTab, mode]);
      // (v9 #2) Re-render once KaTeX finishes loading, so a translation/formula
      // card that mounted before the script arrived upgrades from raw TeX to
      // typeset math without the user having to reopen it.
      useKatexReady();

      const objectUrlRef = React.useRef('');
      const inputRef = React.useRef(null);
      const containerRef = React.useRef(null);
      const viewerElRef = React.useRef(null);
      const pdfFileRef = React.useRef(null);
      const txtFileRef = React.useRef(null);
      const selectionSeq = React.useRef(0);
      const lastFileRef = React.useRef(null);
      const viewerPromiseRef = React.useRef(null);
      const pdfStateRef = React.useRef(null);
      const pdfDocRef = React.useRef(null);
      const pdfLoadingTaskRef = React.useRef(null);
      const translateRef = React.useRef(async () => {});
      // (v17 #3) Selecting text only STAGES the selection: the English text is shown
      // immediately and the model is called only when the reader presses 翻译.
      const stageRef = React.useRef(() => {});
      const popupDragCancelRef = React.useRef(null);
      const bodyRef = React.useRef(null);
      const resizeRef = React.useRef(null);
      const splitRef = React.useRef(null);
      const sideTopHeightRef = React.useRef(sideTopHeight);
      sideTopHeightRef.current = sideTopHeight;
      // (v25 #3) The same block's horizontal size, used by the divider when the side
      // panel is docked at the bottom.
      const sideTopWidthRef = React.useRef(sideTopWidth);
      sideTopWidthRef.current = sideTopWidth;
      const dockRef = React.useRef(dock);
      dockRef.current = dock;
      const selEffortRef = React.useRef(selEffort);
      selEffortRef.current = selEffort;
      const effortSeqRef = React.useRef(0);
      const refRunRef = React.useRef(null);
      const refScanRef = React.useRef(null);
      const pdfReferenceSourceRef = React.useRef(null);
      const pdfTextJobRef = React.useRef(null);
      const figurePickingRef = React.useRef(false);
      const figureOutlineRef = React.useRef(null);
      const figureDragRef = React.useRef(null);
      const figureRunRef = React.useRef(null);
      const summaryRunRef = React.useRef(null);
      const paperIdRef = React.useRef(paperId);
      paperIdRef.current = paperId;
      const marksRef = React.useRef(marks);
      marksRef.current = marks;
      // (v35 #1) Same for the glossary, so an explanation that arrives after the
      // reader closed the paper still appends to the list it was started from.
      const termsRef = React.useRef(terms);
      termsRef.current = terms;
      const popupOnRef = React.useRef(popupOn);
      popupOnRef.current = popupOn;
      const spreadModeRef = React.useRef(spreadMode);
      spreadModeRef.current = spreadMode;
      const applyHighlightsRef = React.useRef(() => {});
      // (v18 #2) Per-page scratch data for the decoration pass: the whitespace-
      // stripped text index (cached between passes) and a flag telling whether any
      // span currently carries our `elr-hl-note` class / `elrMark` dataset, so the
      // document-wide cleanup is skipped whenever there is nothing to clean.
      const pageTextCache = new WeakMap();
      const hlTagsRef = React.useRef(false);
      const customRanges = React.useRef([]);
      // (v13 #1) pdf.js fires `textlayerrendered` / `pagerendered` once PER PAGE.
      // The old handlers ran a full-document `applyHighlights()` (querying every
      // span of every page, building Range rects, and re-rendering theme canvases)
      // for each of those events, so a 30-page paper did the same heavy pass 60+
      // times back-to-back and froze the UI. Coalesce whole bursts into ONE pass.
      const decorateTimerRef = React.useRef(null);
      const scheduleDecorate = () => {
        if (decorateTimerRef.current) clearTimeout(decorateTimerRef.current);
        decorateTimerRef.current = setTimeout(() => {
          decorateTimerRef.current = null;
          applyHighlightsRef.current();
          paintFindHitsRef.current();
        }, DECORATE_DEBOUNCE_MS);
      };
      const scheduleDecorateRef = React.useRef(() => {});
      scheduleDecorateRef.current = scheduleDecorate;

      const notify = (message, kind) => { setStatus(message || ''); setStatusKind(kind || ''); };

      React.useLayoutEffect(() => {
        const syncFullscreen = () => {
          const reader = readerRef.current;
          const active = Boolean(reader && document.fullscreenElement === reader);
          // Keep the portal container stable so floating cards survive the move.
          const target = active ? reader : document.body;
          if (floatingHost.parentNode !== target) target.appendChild(floatingHost);
          setIsFullscreen(active);
        };
        syncFullscreen();
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => {
          document.removeEventListener('fullscreenchange', syncFullscreen);
          floatingHost.remove();
        };
      }, [floatingHost]);

      const toggleFullscreen = async () => {
        const reader = readerRef.current;
        if (!reader || fullscreenPendingRef.current) return;
        fullscreenPendingRef.current = true;
        try {
          if (document.fullscreenElement === reader) await document.exitFullscreen();
          else await reader.requestFullscreen();
        } catch (_) {
          notify(t('fullscreen.failed'), 'error');
        } finally {
          fullscreenPendingRef.current = false;
        }
      };

      React.useEffect(() => {
        let alive = true;
        fetch(BASE + '/meta', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((data) => { if (alive && data && data.ok) setMeta(data); })
          .catch(() => {});
        fetch(BASE + '/models', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((data) => {
            if (!alive || !data || !data.ok) return;
            setCatalog(data);
            const saved = readStore(MODEL_KEY, null) || {};
            const current = data.current || {};
            const providers = Array.isArray(data.providers) ? data.providers : [];
            let p = String(saved.provider || current.provider || (providers[0] && providers[0].id) || '').trim();
            let m = String(saved.model || current.model || '').trim();
            if (!providers.some((x) => x.id === p)) p = providers.length ? providers[0].id : current.provider || '';
            const found = providers.find((x) => x.id === p);
            const models = found && Array.isArray(found.models) ? found.models : [];
            if (!models.some((x) => x.id === m)) m = models.length ? models[0].id : current.model || '';
            setSelProvider(p);
            setSelModel(m);
            const e = String(saved.reasoningEffort ?? current.reasoningEffort ?? '').trim();
            setSelEffort(e);
            if (p && m) writeStore(MODEL_KEY, { provider: p, model: m, reasoningEffort: e });
          })
          .catch(() => {});
        return () => { alive = false; };
      }, []);

      const modelBody = () => {
        const body = {};
        const p = (selProvider || '').trim();
        const m = (selModel || '').trim();
        if (p) body.provider = p;
        if (m) body.model = m;
        const e = (selEffort || '').trim();
        if (e || modelPicked || showCustom) body.reasoningEffort = e;
        // (v12) When the user has NOT explicitly picked a model from the
        // dropdown (or entered a manual one), let the Host choose a fast
        // flash-class model. The slow reasoning default otherwise times out
        // on 1200-char chunks and full-text translation fails.
        if (!modelPicked && !showCustom) body.fastModel = true;
        if (showCustom) {
          const cp = (customProvider || '').trim();
          const cm = (customModel || '').trim();
          if (cp) body.provider = cp;
          if (cm) body.model = cm;
        }
        return body;
      };
      bodyRef.current = modelBody;

      const describeModelSelection = (request) => {
        const provider = request.provider || meta?.provider || '';
        const model = request.model || meta?.model || '';
        const advertised = catalog?.providers?.find((item) => item.id === provider)?.models;
        const modelName = advertised?.find((item) => item.id === model)?.name || model;
        const matchingEfforts = efforts?.provider === provider && efforts?.model === model ? efforts : null;
        const hostEffort = provider === meta?.provider && model === meta?.model ? meta.reasoningEffort : '';
        const reasoningEffort = (request.reasoningEffort ?? hostEffort) || matchingEfforts?.defaultEffort || '';
        const reasoningEffortName = matchingEfforts?.efforts.find((item) => item.id === reasoningEffort)?.name || reasoningEffort;
        return { provider, model, modelName, reasoningEffort, reasoningEffortName, followDefault: !request.reasoningEffort };
      };

      const persistModel = (provider, model, effort) => {
        writeStore(MODEL_KEY, { provider, model, reasoningEffort: effort });
      };

      React.useEffect(() => {
        if (!selProvider || !selModel || showCustom) return;
        let alive = true;
        const effortSeq = ++effortSeqRef.current;
        setEfforts(null);
        fetch(BASE + '/efforts?provider=' + encodeURIComponent(selProvider) + '&model=' + encodeURIComponent(selModel), { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((data) => {
            if (!alive || effortSeq !== effortSeqRef.current || !data || !data.ok) return;
            const list = Array.isArray(data.efforts) ? data.efforts : [];
            setEfforts({ provider: selProvider, model: selModel, efforts: list, defaultEffort: data.defaultEffort || '', fallback: !!data.fallback });
            if (selEffortRef.current && !list.some((x) => x.id === selEffortRef.current)) {
              setSelEffort('');
              persistModel(selProvider, selModel, '');
            }
          })
          .catch(() => {});
        return () => { alive = false; };
      }, [selProvider, selModel, showCustom]);

      // Restore the records for the active paper.
      React.useEffect(() => {
        const id = paperId;
        revealFigureRef.current = null;
        setExpandedFigure(null);
        setTermBubble(null);
        setTermOpenId('');
        if (!id) { setFigureArchive(null); return; }
        const r = { ...(id === legacyPaperId && legacyAnalysis), ...loadResult(id) };
        writeShared({
          summary: typeof r.summary === 'string' ? r.summary : '', summaryCoverage: r.summaryCoverage || null,
          summaryMeta: r.summaryMeta || null, summaryDetail: r.summaryDetail || null,
        });
        setFigureArchive({ paper: id, entries: loadFigureHistory(id, r.figure ?? null) });
        // (v21 #1) Restore the resolved bibliography together with the analysis it
        // was gathered for, so reopening a paper does not re-query Crossref.
        setReferences(Array.isArray(r.references) ? r.references.map((item) => (
          item && item.url && !item.startLine ? { ...item, status: 'legacy' } : item
        )) : []);
        const list = loadMarks(id);
        marksRef.current = list;
        setMarks(list);
        const gloss = loadTerms(id);
        termsRef.current = gloss;
        setTerms(gloss);
        try { if (globalThis.CSS && CSS.highlights) CSS.highlights.delete('elr-lit-note'); } catch (_) {}
      }, [paperId]);

      const setFigurePickMode = (on) => {
        figurePickingRef.current = on;
        setFigurePicking(on);
      };
      const cancelFigureWork = () => {
        figureDragRef.current?.();
        const run = figureRunRef.current;
        figureRunRef.current = null;
        if (run) {
          run.controller.abort();
          try { run.task?.cancel(); } catch (_) {}
        }
      };
      const cancelAnalysisTasks = () => {
        if (refRunRef.current) refRunRef.current.controller.abort();
        if (summaryRunRef.current) summaryRunRef.current.abort();
        refRunRef.current = null;
        refScanRef.current = null;
        summaryRunRef.current = null;
        cancelFigureWork();
      };
      const resetAnalysisTasks = () => {
        cancelAnalysisTasks();
        setSummaryIssue('');
        setFigurePickMode(false);
        setFigureActivity(null);
        setReferencesBusy(false);
        setReferencesStage('');
        setReferencesCanContinue(false);
        setSummaryBusy(false);
      };
      React.useEffect(() => () => {
        cancelAnalysisTasks();
        selectionSeq.current++;
      }, []);

      // (#3) Reopen the in-memory PDF after this Reader is remounted.
      // (v24 #1) …and after a page RELOAD the bytes come from IndexedDB instead, so
      // the paper the snapshot points at is still open when the tab comes back.
      React.useEffect(() => {
        if (mode !== 'pdf' || !paperId) return;
        const cached = fileCache.get(paperId);
        if (cached && !pdfDocRef.current) {
          lastFileRef.current = cached;
          setDropSeq((n) => n + 1);
          return;
        }
        if (pdfDocRef.current) return;
        getStoredFile(paperId).then((record) => {
          if (!record || pdfDocRef.current || readShared().paperId !== paperId || readShared().mode !== 'pdf') return;
          const file = reviveStoredFile(record);
          if (!file) return;
          fileCache.set(paperId, file);
          lastFileRef.current = file;
          setDropSeq((n) => n + 1);
        }).catch(() => {});
      }, []);

      const addRecent = (entry) => {
        setRecent((prev) => {
          const rest = (prev || []).filter((x) => x && x.id !== entry.id &&
            !(entry.identity && x.identity && x.identity === entry.identity));
          const next = [entry].concat(rest).slice(0, RECENT_MAX);
          writeStore(RECENT_KEY, next);
          return next;
        });
      };

      const openRecent = (entry) => {
        if (!entry) return;
        const cached = fileCache.get(entry.id);
        if (cached) { handleFile(cached, entry.id); return; }
        if (typeof entry.text === 'string' && entry.text) {
          resetAnalysisTasks();
          if (entry.id !== readShared().paperId) resetSelection();
          setPaperId(entry.id);
          changeMode('text');
          setText(entry.text);
          setPdfName(entry.name || '');
          notify(t('recent.opened'), 'ok');
          return;
        }
        // (v24 #1) A PDF used to be unrecoverable once the page had been reloaded,
        // so a double-click silently opened the OS file picker instead. The bytes
        // are now persisted in IndexedDB, so restore them first and only fall back
        // to the picker when the store has nothing for this entry.
        if (entry.mode !== 'text') {
          notify(t('recent.loading'), '');
          getStoredFile(entry.id).then((record) => {
            const file = reviveStoredFile(record);
            if (file) {
              fileCache.set(entry.id, file);
              handleFile(file, entry.id);
              notify(t('recent.opened'), 'ok');
              return;
            }
            notify(t('recent.missing'), 'error');
            if (pdfFileRef.current) pdfFileRef.current.click();
          }).catch(() => {
            notify(t('recent.missing'), 'error');
            if (pdfFileRef.current) pdfFileRef.current.click();
          });
          return;
        }
        notify(t('recent.missing'), 'error');
        if (pdfFileRef.current) pdfFileRef.current.click();
      };

      const removeRecent = (id) => {
        setRecent((prev) => {
          const next = (prev || []).filter((x) => x && x.id !== id);
          writeStore(RECENT_KEY, next);
          return next;
        });
        fileCache.delete(id);
        try { deleteStoredFile(id); } catch (_) {}
      };

      const resetSelection = () => {
        selectionSeq.current++;
        setSelectionBusy(false);
        popupDragCancelRef.current?.();
        setPopup(null);
        writeShared({ selection: '', selectionEdit: '', selectionPrefix: '', selectionResult: '' });
      };

      const rectForPopup = (rect) => {
        if (!rect) return null;
        const w = 360;
        return {
          x: Math.max(8, Math.min(Number(rect.left) || 8, (window.innerWidth || 1200) - w - 8)),
          y: Math.max(8, Math.min((Number(rect.bottom) || 0) + 6, (window.innerHeight || 800) - 170)),
        };
      };

      const placeTranslationPopup = (value, rect, previous) => {
        const viewport = popupViewport();
        const root = Math.sqrt(String(value || '').length);
        const w = Math.min(Math.max(300, Math.min(620, Math.round(280 + root * 14))), viewport.right - viewport.left);
        const h = Math.min(Math.max(170, Math.min(560, Math.round(130 + root * 16))), viewport.bottom - viewport.top);
        let x = previous ? previous.x : viewport.left;
        let y = previous ? previous.y : viewport.top;
        if (rect) {
          x = Number.isFinite(rect.left) ? rect.left : x;
          const below = Number.isFinite(rect.bottom) ? rect.bottom + 6 : y;
          const above = Number.isFinite(rect.top) ? rect.top - 6 : below - 12;
          const spaceBelow = viewport.bottom - below;
          const spaceAbove = above - viewport.top;
          y = spaceBelow >= h || (spaceAbove < h && spaceBelow >= spaceAbove) ? below : above - h;
        }
        return { ...previous, ...fitPopupBox({ x, y, w, h }, viewport) };
      };

      stageRef.current = (value, rect, intent) => {
        if (!value) return;
        const next = selectionDraft(readShared(), value, intent);
        if (next?.overflow) {
          notify(t('selection.limit', { count: MAX_SELECTION }), 'warn');
          return;
        }
        if (next) {
          selectionSeq.current++;
          setSelectionBusy(false);
          popupDragCancelRef.current?.();
          writeShared(next);
        }
        if (popupOnRef.current) {
          setPopup((previous) => !next && previous ? previous : placeTranslationPopup(readShared().selectionEdit, rect, previous));
        }
      };

      translateRef.current = async () => {
        const value = readShared().selectionEdit;
        if (!value.trim()) return;
        const seq = ++selectionSeq.current;
        setSelectionBusy(true);
        if (popupOnRef.current) {
          setPopup((previous) => previous || placeTranslationPopup(value));
        }
        try {
          const data = await post('/translate', Object.assign({ text: value, full: false }, bodyRef.current()));
          if (seq !== selectionSeq.current) return;
          if (data && data.ok && data.text) {
            setSelectionResult(data.text);
          } else {
            notify((data && data.error) || 'translation failed', 'error');
          }
        } catch (error) {
          if (seq === selectionSeq.current) notify(String(error && error.message ? error.message : error), 'error');
        } finally {
          if (seq === selectionSeq.current) setSelectionBusy(false);
        }
      };

      const changeMode = (next) => {
        if (next === mode) return;
        setMode(next);
        setDragOver(false);
      };

      const releaseNativeUrl = () => {
        if (objectUrlRef.current) {
          try { URL.revokeObjectURL(objectUrlRef.current); } catch (_) {}
          objectUrlRef.current = '';
        }
      };

      // (v25 #1) Close the current paper. Everything the document owns is released
      // here — pdf.js viewer + document, the native-preview blob URL, the extracted
      // text, the analysis, the pending selection and the inline card — so the reader
      // drops back to the empty state WITHOUT touching anything already persisted
      // (analysis / marks / bibliography stay under their paperId in localStorage and
      // the bytes stay in IndexedDB, so reopening from 近期阅读 restores all of it).
      const closePaper = () => {
        // Drop any queued decoration pass first: it would run against a teardown DOM.
        if (decorateTimerRef.current) {
          clearTimeout(decorateTimerRef.current);
          decorateTimerRef.current = null;
        }
        resetAnalysisTasks();
        clearFind();
        pdfReferenceSourceRef.current = null;
        disposeViewer();
        setPdfAnalysisReady(false);
        setPdfTextBusy(false);
        releaseNativeUrl();
        lastFileRef.current = null;
        setHasPdf(false);
        setPdfName('');
        setPdfError('');
        setPreviewMode('pdfjs');
        setPageCount(0);
        setPageNum(1);
        setText('');
        writeShared({ summary: '', summaryCoverage: null, summaryMeta: null, summaryDetail: null });
        setReferences([]);
        resetSelection();
        setMenu(null);
        setNoteBubble(null);
        setFormulaCard(null);
        setPaperId('');
        notify('');
      };

      function referenceReadingOrder(lines) {
        // Some PDFs emit the two columns one baseline at a time. Only reorder
        // when there is a clear gutter and both columns share several baselines.
        const substantial = lines.filter((line) => line.text.length >= 20 && line.right > line.left);
        if (substantial.length < 6 || lines.some((line) => !Number.isFinite(line.y))) return lines;
        let min = Infinity;
        let max = -Infinity;
        for (const line of substantial) {
          min = Math.min(min, line.left);
          max = Math.max(max, line.right);
        }
        const middle = (min + max) / 2;
        const side = (line) => {
          if (line.right <= middle - 5) return 'left';
          if (line.left >= middle + 5) return 'right';
          return 'span';
        };
        const left = substantial.filter((line) => side(line) === 'left');
        const right = substantial.filter((line) => side(line) === 'right');
        if (left.length < 3 || right.length < 3) return lines;
        const rightBaselines = new Set(right.map((line) => Math.round(line.y)));
        let paired = 0;
        for (const line of left) {
          const baseline = Math.round(line.y);
          for (let y = baseline - 3; y <= baseline + 3; y++) {
            if (rightBaselines.has(y)) { paired++; break; }
          }
          if (paired >= 3) break;
        }
        if (paired < 3) return lines;
        let changes = 0;
        let previous = '';
        for (const line of substantial) {
          const current = side(line);
          if (current === 'span') continue;
          if (previous && current !== previous) changes++;
          previous = current;
        }
        if (changes < 2) return lines;
        const ordered = [];
        let leftColumn = [];
        let rightColumn = [];
        const flush = () => {
          ordered.push(...leftColumn, ...rightColumn);
          leftColumn = [];
          rightColumn = [];
        };
        for (const line of lines.slice().sort((a, b) => b.y - a.y || a.left - b.left)) {
          const column = side(line);
          if (column === 'span') { flush(); ordered.push(line); }
          else if (column === 'left') leftColumn.push(line);
          else rightColumn.push(line);
        }
        flush();
        return ordered;
      }

      function formatPdfPage(items) {
        const cleanLine = (value) => value.normalize('NFC').replace(/[\ufb00-\ufb06]/g, (ligature) => ligature.normalize('NFKC')).replace(/\s+/g, ' ').trim();
        const newLine = () => ({ text: '', left: Infinity, right: -Infinity, y: NaN });
        let positioned = [];
        let inOrder = null;
        if (items.some((item) => item && item.hasEOL)) {
          let line = newLine();
          for (const item of items) {
            if (item && item.str) {
              line.text += item.str;
              const x = item.transform?.[4];
              if (Number.isFinite(x)) {
                line.left = Math.min(line.left, x);
                line.right = Math.max(line.right, x + (Number(item.width) || 0));
                if (!Number.isFinite(line.y)) line.y = item.transform[5];
              }
            }
            if (item && item.hasEOL) {
              line.text = cleanLine(line.text);
              if (line.text) positioned.push(line);
              line = newLine();
            }
          }
          line.text = cleanLine(line.text);
          if (line.text) positioned.push(line);
          inOrder = referenceReadingOrder(positioned);
        } else {
          const rows = new Map();
          let leftEdge = Infinity;
          let rightEdge = -Infinity;
          for (const item of items) {
            if (!item || !item.str) continue;
            const x = Number(item.transform?.[4]) || 0;
            const y = Math.round((Number(item.transform?.[5]) || 0) * 2) / 2;
            leftEdge = Math.min(leftEdge, x);
            rightEdge = Math.max(rightEdge, x);
            if (!rows.has(y)) rows.set(y, []);
            rows.get(y).push({ str: item.str, x, width: Number(item.width) || 0 });
          }
          const lineFromCells = (cells, y) => ({
            text: cleanLine(cells.map((cell) => cell.str).join('')),
            left: cells[0].x, right: cells.reduce((edge, cell) => Math.max(edge, cell.x + cell.width), -Infinity), y,
          });
          const middle = (leftEdge + rightEdge) / 2;
          const left = [];
          const right = [];
          let paired = false;
          for (const y of [...rows.keys()].sort((a, b) => b - a)) {
            const cells = rows.get(y).sort((a, b) => a.x - b.x);
            const line = lineFromCells(cells, y);
            if (!line.text) continue;
            positioned.push(line);
            const startsLeft = cells[0].x < middle - 8;
            const endsRight = cells[cells.length - 1].x > middle + 8;
            if (startsLeft) left.push(lineFromCells(cells.filter((cell) => cell.x <= middle), y));
            if (endsRight) right.push(lineFromCells(cells.filter((cell) => cell.x > middle), y));
            paired ||= startsLeft && endsRight;
          }
          if (paired && left.length >= 3 && right.length >= 3) positioned = left.concat(right).filter((line) => line.text);
          inOrder = positioned;
        }
        const text = positioned.map((line) => line.text).join('\n');
        return {
          positioned: inOrder,
          text,
          referenceText: inOrder === positioned ? text : inOrder.map((line) => line.text).join('\n'),
          // Keep the original glyph order and normalization for PDF text-layer offsets.
          searchText: items.map((item) => String(item?.str || '').replace(/[ \t\n\r\u00a0]/g, '')).join(''),
        };
      }

      function readPdfPageText(job, pageNumber, proxy) {
        const cache = job.pageText || (job.pageText = new Map());
        if (!cache.has(pageNumber)) {
          const read = Promise.resolve(proxy || job.pdf.getPage(pageNumber)).then(async (page) => {
            const content = await page.getTextContent({ disableNormalization: true });
            return formatPdfPage(content?.items || []);
          });
          cache.set(pageNumber, read);
          read.catch(() => { if (cache.get(pageNumber) === read) cache.delete(pageNumber); });
        }
        return cache.get(pageNumber);
      }

      async function extractText(job, alive) {
        const pages = [];
        const referencePages = [];
        for (let pageNumber = 1; pageNumber <= job.pdf.numPages; pageNumber++) {
          // Let the viewer paint between reads and stop when the paper changes.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!alive()) return null;
          const page = await readPdfPageText(job, pageNumber);
          if (!alive()) return null;
          pages.push(page.text);
          referencePages.push(page.referenceText);
        }
        const text = pages.filter(Boolean).join('\n\n');
        return {
          text,
          noText: !text,
          pageTextLengths: pages.map((page) => page.length),
          referenceText: referencePages.filter(Boolean).join('\n\n'),
          pageLineCounts: referencePages.map((page) => page ? page.split('\n').length : 0),
        };
      }

      const prepareAnalysisText = async () => {
        const current = readShared();
        if (current.mode !== 'pdf') return Boolean(current.text.trim());
        const job = pdfTextJobRef.current;
        if (!job || job.paper !== current.paperId) return false;
        const alive = () => pdfTextJobRef.current === job && readShared().paperId === job.paper && readShared().mode === 'pdf';
        if (!job.pending) {
          setPdfTextBusy(true);
          notify(t('pdf.extracting'));
          job.pending = extractText(job, alive).catch(() => null);
        }
        const source = await job.pending;
        if (!alive()) return false;
        setPdfTextBusy(false);
        if (!source) {
          job.pending = null;
          notify(t('pdf.extractFailed'), 'error');
          return false;
        }
        pdfReferenceSourceRef.current = { ...source, paper: job.paper };
        if (source.noText) {
          notify(t('references.noText'), 'warn');
          return false;
        }
        setText(source.text);
        return true;
      };

      const runWithAnalysisText = async (action) => {
        if (await prepareAnalysisText()) await action();
      };

      const selectReaderMode = async (next) => {
        const job = pdfTextJobRef.current;
        if (mode === 'pdf' && next === 'text' && job) {
          await prepareAnalysisText();
          if (pdfTextJobRef.current !== job) return;
        }
        changeMode(next);
      };

      const nearbyFigureText = (pageText, viewport, box) => {
        if (!pageText) return { caption: '', context: '' };
        const left = box.x * viewport.width;
        const right = (box.x + box.w) * viewport.width;
        const top = box.y * viewport.height;
        const bottom = (box.y + box.h) * viewport.height;
        const positioned = pageText.positioned.flatMap((line, index) => {
          if (![line.left, line.right, line.y].every(Number.isFinite)) return [];
          const a = viewport.convertToViewportPoint(line.left, line.y);
          const b = viewport.convertToViewportPoint(line.right, line.y);
          const first = Math.min(a[0], b[0]);
          const last = Math.max(a[0], b[0]);
          const baseline = (a[1] + b[1]) / 2;
          return [{
            text: line.text, index, baseline, first,
            horizontalGap: Math.max(0, left - last, first - right),
            distance: Math.max(0, top - baseline, baseline - bottom),
          }];
        });
        const nearby = positioned.filter((line) => line.horizontalGap <= 28 && line.distance <= 105);
        const opener = nearby.filter((line) => FIGURE_LABEL_RE.test(line.text) && line.distance <= 72)
          .sort((a, b) => (a.distance + a.horizontalGap) - (b.distance + b.horizontalGap))[0];
        const captionLines = [];
        if (opener) {
          captionLines.push(opener);
          for (const line of nearby) {
            const previous = captionLines.at(-1);
            if (line.index <= opener.index) continue;
            if (captionLines.length >= 5 || line.index !== previous.index + 1 || FIGURE_LABEL_RE.test(line.text)
              || line.baseline - previous.baseline < 0 || line.baseline - previous.baseline > 23
              || Math.abs(line.first - opener.first) > 55) break;
            captionLines.push(line);
          }
        }
        const context = nearby.filter((line) => !captionLines.includes(line))
          .sort((a, b) => a.distance - b.distance).slice(0, 18)
          .sort((a, b) => a.index - b.index).map((line) => line.text).join('\n').slice(0, 3000);
        return {
          caption: captionLines.map((line) => line.text).join(' ').slice(0, 1500),
          context: context || (positioned.length ? '' : pageText.text.slice(0, 1800)),
        };
      };

      const renderFigureCrop = async (page, viewport, crop, run) => {
        const edge = Math.max(crop.w * viewport.width, crop.h * viewport.height);
        const scale = Math.min(4, 1600 / edge);
        const scaled = page.getViewport({ scale, rotation: viewport.rotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(crop.w * scaled.width));
        canvas.height = Math.max(1, Math.round(crop.h * scaled.height));
        const canvasContext = canvas.getContext('2d');
        if (!canvasContext) throw new Error(t('figure.renderFailed'));
        const task = page.render({
          canvasContext, viewport: scaled,
          transform: [1, 0, 0, 1, -crop.x * scaled.width, -crop.y * scaled.height],
          background: 'rgb(255, 255, 255)',
        });
        run.task = task;
        try {
          await task.promise;
          const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
          const maxBytes = 1100 * 1024;
          let blob = await encode('image/png');
          if (!blob || blob.size > maxBytes) blob = await encode('image/jpeg', 0.88);
          if (blob && blob.size > maxBytes) blob = await encode('image/jpeg', 0.68);
          if (!blob || blob.size > maxBytes) throw new Error(t('figure.imageInvalid'));
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(t('figure.renderFailed')));
            reader.readAsDataURL(blob);
          });
        } finally {
          run.task = null;
          canvas.width = 0;
          canvas.height = 0;
        }
      };

      const analyzeFigure = async (job, pageNumber, rotation, crop) => {
        cancelFigureWork();
        const request = bodyRef.current();
        const selection = describeModelSelection(request);
        const run = { controller: new AbortController(), task: null };
        figureRunRef.current = run;
        const alive = () => figureRunRef.current === run && pdfTextJobRef.current === job
          && readShared().mode === 'pdf' && readShared().paperId === job.paper;
        setAnalysisTab('figure');
        setFigureActivity({ paper: job.paper, busy: true });
        try {
          const page = await job.pdf.getPage(pageNumber);
          if (!alive()) return;
          const viewport = page.getViewport(Number.isFinite(rotation) ? { scale: 1, rotation } : { scale: 1 });
          const context = readPdfPageText(job, pageNumber, page).catch(() => null);
          const image = await renderFigureCrop(page, viewport, crop, run);
          if (!alive()) return;
          const excerpts = nearbyFigureText(await context, viewport, crop);
          if (!alive()) return;
          const response = await post('/figure', { ...request, image, page: pageNumber, ...excerpts }, 165000, run.controller.signal);
          if (!alive()) return;
          if (!response?.ok) {
            const errors = { 'figure-model': 'figure.modelRequired', 'figure-attachments': 'figure.attachmentsRequired', 'figure-image': 'figure.imageInvalid' };
            const error = errors[response?.code] ? t(errors[response.code]) : (response?.error || t('figure.failed'));
            setFigureActivity({ paper: job.paper, error });
            return;
          }
          if (typeof response.text !== 'string' || !response.text.trim()) throw new Error(t('figure.failed'));
          const result = {
            id: globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2),
            page: pageNumber,
            position: figurePagePosition(page, viewport, crop),
            caption: excerpts.caption,
            text: response.text,
            ...readGenerationMetadata(response, selection),
          };
          const { entries, saved } = appendFigureHistory(job.paper, result);
          revealFigureRef.current = result.id;
          setFigureArchive({ paper: job.paper, entries });
          setExpandedFigure(result.id);
          setFigureActivity(saved ? null : { paper: job.paper, error: t('figure.saveFailed') });
        } catch (error) {
          if (alive()) setFigureActivity({ paper: job.paper, error: String(error?.message || t('figure.failed')) });
        } finally {
          if (figureRunRef.current === run) figureRunRef.current = null;
        }
      };

      const toggleFigurePicker = () => {
        if (!pdfTextJobRef.current || figureRunRef.current) return;
        if (figurePickingRef.current) {
          figureDragRef.current?.();
          setFigurePickMode(false);
        } else {
          setAnalysisTab('figure');
          setFigurePickMode(true);
        }
      };

      const startFigureBox = (event) => {
        if (!figurePickingRef.current || event.button !== 0 || event.isPrimary === false || figureDragRef.current) return;
        const container = containerRef.current;
        const outline = figureOutlineRef.current;
        const job = pdfTextJobRef.current;
        const node = event.target?.closest?.('.pdfViewer .page[data-page-number]');
        if (!container || !outline || !job || !node || !container.contains(node)) return;
        const pageNumber = Number(node.dataset.pageNumber);
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > job.pdf.numPages) return;
        const pageView = pdfStateRef.current?.viewer?.getPageView?.(pageNumber - 1);
        const rotation = pageView?.viewport?.rotation;
        const wrapperBox = node.querySelector('.canvasWrapper')?.getBoundingClientRect();
        const raw = node.getBoundingClientRect();
        const pageBox = wrapperBox?.width && wrapperBox.height ? wrapperBox : {
          left: raw.left + node.clientLeft, top: raw.top + node.clientTop,
          width: node.clientWidth, height: node.clientHeight,
        };
        if (!pageBox.width || !pageBox.height) return;
        const visible = container.getBoundingClientRect();
        const overlayOrigin = outline.parentElement.getBoundingClientRect();
        const minX = Math.max(pageBox.left, visible.left);
        const minY = Math.max(pageBox.top, visible.top);
        const maxX = Math.min(pageBox.left + pageBox.width, visible.left + container.clientWidth);
        const maxY = Math.min(pageBox.top + pageBox.height, visible.top + container.clientHeight);
        const x0 = clampPopup(event.clientX, minX, maxX);
        const y0 = clampPopup(event.clientY, minY, maxY);
        const pointer = event.pointerId;
        const boxAt = (ev) => {
          const x = clampPopup(ev.clientX, minX, maxX);
          const y = clampPopup(ev.clientY, minY, maxY);
          return { x: Math.min(x, x0), y: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0) };
        };
        const paint = frameWriter((box) => {
          outline.style.transform = 'translate3d(' + (box.x - overlayOrigin.left) + 'px,' + (box.y - overlayOrigin.top) + 'px,0)';
          outline.style.width = box.w + 'px';
          outline.style.height = box.h + 'px';
          outline.style.display = 'block';
        });
        const clean = () => {
          if (figureDragRef.current !== clean) return;
          figureDragRef.current = null;
          paint.cancel();
          outline.style.display = 'none';
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('blur', clean);
          window.removeEventListener('resize', clean);
          container.removeEventListener('scroll', clean);
          container.removeEventListener('lostpointercapture', cancel);
          if (container.hasPointerCapture?.(pointer)) container.releasePointerCapture(pointer);
        };
        const move = (ev) => { if (ev.pointerId === pointer) paint.push(boxAt(ev)); };
        const cancel = (ev) => { if (ev.pointerId === pointer) clean(); };
        const up = (ev) => {
          if (ev.pointerId !== pointer) return;
          const box = boxAt(ev);
          clean();
          if (box.w < 10 || box.h < 10) { notify(t('figure.tooSmall'), 'warn'); return; }
          setFigurePickMode(false);
          void analyzeFigure(job, pageNumber, rotation, {
            x: (box.x - pageBox.left) / pageBox.width, y: (box.y - pageBox.top) / pageBox.height,
            w: box.w / pageBox.width, h: box.h / pageBox.height,
          });
        };
        figureDragRef.current = clean;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', clean);
        window.addEventListener('resize', clean);
        container.addEventListener('scroll', clean);
        container.addEventListener('lostpointercapture', cancel);
        try { container.setPointerCapture(pointer); } catch (_) {}
        event.preventDefault();
        event.stopPropagation();
      };

      React.useEffect(() => {
        if (!figurePicking) return;
        const escape = (event) => {
          if (event.key !== 'Escape') return;
          figureDragRef.current?.();
          setFigurePickMode(false);
          event.preventDefault();
        };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
      }, [figurePicking]);

      const openNativePreview = (file, reason) => {
        releaseNativeUrl();
        let url = '';
        try { url = URL.createObjectURL(file); } catch (_) {}
        if (!url) { setPdfError(String(reason || 'PDF preview unavailable')); return; }
        objectUrlRef.current = url;
        setNativeUrl(url);
        setPreviewMode('native');
        setPdfName(file && file.name ? file.name : '');
        setHasPdf(true);
        setPdfError(String(reason || ''));
        notify(t('pdf.nativeFallback'), 'ok');
      };

      // ---- v1.0.5 (#1) highlights, painted UNDER the glyphs ----
      // pdf.js renders every page into one opaque canvas and keeps its text layer at
      // 25% opacity with transparent glyphs on top. Styling text-layer spans was
      // both washed out and prone to bleeding onto unrelated words. We now draw
      // translucent yellow rectangles on a dedicated overlay canvas that sits
      // BETWEEN the page canvas and the text layer, with `mix-blend-mode: multiply`:
      // white paper turns pale yellow while the black glyphs stay black.
      const HL_FILL = 'rgba(255, 222, 74, 0.9)';
      // (v39 #1) A search hit is drawn on its OWN overlay canvas (class
      // `elr-find-overlay`, orange) rather than through `paintPageHighlights`:
      // the marks pass owns `cached.canvas` and calls `clearPageOverlay()` on
      // every page it repaints, so a hit stored there would be wiped the next
      // time a page was decorated. A separate class means both can coexist and
      // `applyHighlights` cannot see it.
      const FIND_FILL = 'rgba(255, 168, 38, 0.8)';
      // Hard ceiling on collected hits: a two-letter query in a long paper can
      // match thousands of times, and every hit is held in React state.
      const MAX_FIND_HITS = 600;
      const normText = (value) => String(value == null ? '' : value).replace(/\s+/g, '');
      const clearHlOverlays = () => {
        const container = containerRef.current;
        if (!container) return;
        const nodes = container.querySelectorAll('.elr-hl-overlay');
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n && n.parentNode) n.parentNode.removeChild(n);
        }
      };
      // (v18 #2) Drop the overlay canvas of ONE page (used both when repainting it
      // and when its marks disappeared), instead of clearing the whole document.
      const clearPageOverlay = (pageEl) => {
        if (!pageEl) return;
        const nodes = pageEl.querySelectorAll('.elr-hl-overlay');
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n && n.parentNode) n.parentNode.removeChild(n);
        }
      };
      const paintPageHighlights = (pageEl, hitRects, noteRects) => {
        // Anchor to `.canvasWrapper`, the box the glyph canvas occupies, instead of
        // `.page` — the latter has a 9px transparent border (`--page-border`), which
        // both offsets absolutely positioned children and inflates the measured rect.
        const wrapper = pageEl.querySelector('.canvasWrapper') || pageEl;
        let rect = null;
        try { rect = wrapper.getBoundingClientRect(); } catch (_) { return null; }
        if (!rect || !rect.width || !rect.height) return null;
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement('canvas');
        canvas.className = 'elr-hl-overlay';
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const sx = canvas.width / rect.width;
        const sy = canvas.height / rect.height;
        ctx.fillStyle = HL_FILL;
        let drew = 0;
        for (let i = 0; i < hitRects.length; i++) {
          const r = hitRects[i];
          if (!r || !r.width || !r.height) continue;
          const x = (r.left - rect.left) * sx;
          const y = (r.top - rect.top) * sy;
          ctx.fillRect(x, y, r.width * sx, r.height * sy);
          drew += 1;
        }
        // (#4) Annotated sentences also get a blue dotted underline, drawn here
        // because a border on a text-layer span would be composited at 25%.
        const notes = noteRects || [];
        if (notes.length) {
          ctx.strokeStyle = '#2f7fd4';
          ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
          ctx.setLineDash([Math.round(3 * dpr), Math.round(2.5 * dpr)]);
          for (let i = 0; i < notes.length; i++) {
            const r = notes[i];
            if (!r || !r.width) continue;
            const y = Math.round(((r.bottom - rect.top) * sy) - ctx.lineWidth);
            ctx.beginPath();
            ctx.moveTo((r.left - rect.left) * sx, y);
            ctx.lineTo((r.right - rect.left) * sx, y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        // (v8 #2) The canvas is appended when there is ANY ink on it: an annotation
        // without a highlight still needs its dotted underline.
        if (!drew && !notes.length) return null;
        wrapper.appendChild(canvas);
        return canvas;
      };
      // (v39 #1) Search-hit overlay. Same geometry as `paintPageHighlights`
      // (anchored to `.canvasWrapper`, DPR-scaled), but a distinct class so the
      // marks pass can neither reuse nor clear it. `active` picks the darker
      // orange for the hit the user is currently on.
      const clearFindOverlays = () => {
        const container = containerRef.current;
        if (!container) return;
        const nodes = container.querySelectorAll('.elr-find-overlay');
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n && n.parentNode) n.parentNode.removeChild(n);
        }
      };
      const paintFindOverlay = (pageEl, rects, active) => {
        if (!pageEl || !rects || !rects.length) return;
        const wrapper = pageEl.querySelector('.canvasWrapper') || pageEl;
        let box = null;
        try { box = wrapper.getBoundingClientRect(); } catch (_) { return; }
        if (!box || !box.width || !box.height) return;
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement('canvas');
        canvas.className = 'elr-find-overlay' + (active ? ' is-active' : '');
        canvas.width = Math.round(box.width * dpr);
        canvas.height = Math.round(box.height * dpr);
        canvas.style.width = box.width + 'px';
        canvas.style.height = box.height + 'px';
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const sx = canvas.width / box.width;
        const sy = canvas.height / box.height;
        ctx.fillStyle = active ? 'rgba(255, 140, 0, 0.95)' : FIND_FILL;
        let drew = 0;
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (!r || !r.width || !r.height) continue;
          ctx.fillRect((r.left - box.left) * sx, (r.top - box.top) * sy, r.width * sx, r.height * sy);
          drew += 1;
        }
        if (!drew) return;
        wrapper.appendChild(canvas);
      };
      // (v9 #3) Word-accurate rectangles for a character range inside one span.
      //
      // Filling a whole `.textLayer span` was the reason selecting two words
      // painted the entire line: pdf.js frequently emits ONE span per visual
      // line, so the span box is the line box. Building a DOM Range over the
      // matched characters and calling `getClientRects()` yields one box per
      // wrapped line segment that actually contains the text, which is what the
      // user expects to see highlighted.
      const rectsForSpanRange = (span, from, to) => {
        try {
          const node = span.firstChild;
          if (!node || node.nodeType !== 3) return null;
          const raw = node.nodeValue || '';
          const start = Math.max(0, Math.min(from, raw.length));
          const end = Math.max(start, Math.min(to, raw.length));
          if (end <= start) return null;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          const list = range.getClientRects ? range.getClientRects() : null;
          const out = [];
          if (list) {
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (r && r.width > 0 && r.height > 0) out.push(r);
            }
          }
          try { range.detach(); } catch (_) {}
          return out.length ? out : null;
        } catch (_) { return null; }
      };
      // (v22) Build (or reuse) the whitespace-stripped text index of one page.
      //
      // Extracted from `applyHighlights` so the "jump to this annotation" feature
      // can locate a mark on a page that has not been decorated yet (for example
      // when the user clicks an annotation before any highlight was painted).
      const pageIndexOf = (pageEl, spans) => {
        let cached = pageTextCache.get(pageEl);
        if (cached && cached.spanCount === spans.length) return cached;
        const texts = [];
        const starts = [];
        const maps = [];
        let cursor = 0;
        for (let i = 0; i < spans.length; i++) {
          const raw = String(spans[i].textContent || '');
          let norm = '';
          const map = [];
          for (let c = 0; c < raw.length; c++) {
            const ch = raw.charAt(c);
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u00a0') continue;
            norm += ch;
            map.push(c);
          }
          starts.push(cursor);
          texts.push(norm);
          maps.push(map);
          cursor += norm.length;
        }
        cached = { spanCount: spans.length, texts, starts, maps, pageText: texts.join(''), sig: '', canvas: null };
        pageTextCache.set(pageEl, cached);
        return cached;
      };

      const applyHighlights = () => {
        const container = containerRef.current;
        if (!container) return;
        const list = marksRef.current || [];
        // (v18 #2) Scrolling a long paper used to stutter because this pass ran on
        // EVERY `pagerendered` / `textlayerrendered` event and each time did three
        // expensive things for the whole DOCUMENT: it cleared a class/dataset on
        // every span, it rebuilt the concatenated page text of every page, and it
        // re-created one overlay canvas per page.
        //
        // Now the pass is incremental:
        //   * each page keeps its own text index in a WeakMap, reused as long as the
        //     page's span count is unchanged (only a zoom / re-render invalidates it);
        //   * a page whose marks signature and overlay canvas are unchanged is
        //     skipped outright, so scrolling only pays for pages that really changed;
        //   * tags and the overlay are dropped per PAGE, not document-wide.
        if (!list.length) {
          clearHlOverlays();
          if (hlTagsRef.current) {
            const allSpans = container.querySelectorAll('.textLayer span');
            for (let i = 0; i < allSpans.length; i++) {
              allSpans[i].classList.remove('elr-hl-note');
              if (allSpans[i].dataset) delete allSpans[i].dataset.elrMark;
            }
            hlTagsRef.current = false;
          }
          return;
        }
        // (v23 #1) Highlight and annotation are two INDEPENDENT layers per mark:
        // `hl === true` paints the yellow band, a non-empty `note` paints the dotted
        // underline. Neither flag is derived from the other.
        const items = list.map((m) => ({
          needle: normText(m.text),
          note: String(m.note || '').trim(),
          hl: m.hl === true,
          id: m.id,
        })).filter((x) => x.needle.length >= 3 && (x.hl || x.note));
        if (!items.length) { clearHlOverlays(); return; }
        const sig = items.map((x) => x.id + ':' + x.needle.length + ':' + (x.hl ? 1 : 0) + ':' + (x.note ? 1 : 0)).join('|');
        const pages = container.querySelectorAll('.pdfViewer .page');
        for (let p = 0; p < pages.length; p++) {
          const pageEl = pages[p];
          const spans = pageEl.querySelectorAll('.textLayer span');
          if (!spans.length) continue;
          // (v22) The per-page index is built by `pageIndexOf`, shared with the
          // "jump to annotation" feature.
          const cached = pageIndexOf(pageEl, spans);
          const { texts, starts, maps, pageText } = cached;
          if (!pageText) continue;
          // (v18 #2) A zoom or a theme repaint replaces the page canvas; the marks
          // signature alone would then look unchanged while the overlay is stale.
          // Fold the rendered canvas size into the signature so such a page is
          // repainted exactly once.
          const glyph = pageEl.querySelector('.canvasWrapper canvas');
          const dim = glyph ? glyph.width + 'x' + glyph.height : '0';
          const pageSig = sig + '#' + dim;
          // Nothing changed for this page and its canvas survived the last render.
          if (cached.sig === pageSig && cached.canvas && cached.canvas.isConnected) continue;
          // Repaint just this page: drop its old tags and its old overlay first.
          for (let i = 0; i < spans.length; i++) {
            spans[i].classList.remove('elr-hl-note');
            if (spans[i].dataset) delete spans[i].dataset.elrMark;
          }
          clearPageOverlay(pageEl);
          const hitRects = [];
          const noteRects = [];
          // (v23 #1) One sentence can carry BOTH a highlight record and an
          // annotation record, so a span maps to a SET of record ids, not one id.
          const touched = new Map();
          for (let j = 0; j < items.length; j++) {
            const needle = items[j].needle;
            let from = 0;
            for (;;) {
              const at = pageText.indexOf(needle, from);
              if (at < 0) break;
              const end = at + needle.length;
              for (let i = 0; i < spans.length; i++) {
                const s = starts[i];
                const e = s + texts[i].length;
                if (!texts[i].length || e <= at || s >= end) continue;
                // Overlap translated back into the span's own character indices.
                const normFrom = Math.max(at, s) - s;
                const normTo = Math.min(end, e) - s;
                const map = maps[i];
                const rawFrom = map[Math.max(0, Math.min(normFrom, map.length - 1))];
                const rawTo = map[Math.max(0, Math.min(normTo - 1, map.length - 1))] + 1;
                let rects = rectsForSpanRange(spans[i], rawFrom, rawTo);
                if (!rects) {
                  try { rects = [spans[i].getBoundingClientRect()]; } catch (_) { rects = null; }
                }
                if (!rects) continue;
                if (items[j].hl) {
                  for (let k = 0; k < rects.length; k++) hitRects.push(rects[k]);
                }
                if (items[j].note) {
                  for (let k = 0; k < rects.length; k++) noteRects.push(rects[k]);
                }
                // (v9 #4) Tag the span for ANY record, so a plain right-click on
                // highlighted text can still resolve it.
                let ids = touched.get(spans[i]);
                if (!ids) { ids = []; touched.set(spans[i], ids); }
                if (items[j].note) spans[i].classList.add('elr-hl-note');
                if (ids.indexOf(items[j].id) === -1) ids.push(items[j].id);
              }
              from = end;
            }
          }
          // (v23 #1) The dataset holds every record id that covers this span,
          // space-separated, so the context menu can offer highlight actions and
          // annotation actions independently on the same sentence.
          if (touched.size) {
            touched.forEach((ids, span) => {
              if (span && span.dataset) span.dataset.elrMark = ids.join(' ');
            });
          }
          if (!hitRects.length && !noteRects.length) { cached.sig = ''; cached.canvas = null; continue; }
          // (v18 #2) Remember what this page's canvas represents, so the next
          // decoration pass — including the ones fired while scrolling — can skip
          // it outright.
          cached.sig = pageSig;
          cached.canvas = paintPageHighlights(pageEl, hitRects, noteRects);
          if (touched.size) hlTagsRef.current = true;
        }
      };
      applyHighlightsRef.current = applyHighlights;


      // (v19 #4) `spreadMode` is now the number of EXTRA pages per row (0/1/2).
      // pdf.js can only do one or two pages per row (`SpreadMode.NONE` / `ODD`), so:
      //  - 0 → NONE
      //  - 1 → ODD (pdf.js groups pages into `.spread` rows of two)
      //  - 2 → NONE plus the `.elr-three` grid, which is a pure CSS overlay on the
      //        normal single-page flow. Nothing is re-parented, so pdf.js cannot
      //        undo it, and page canvases keep their own scale.
      const applySpread = (viewer, V) => {
        const count = Number(spreadModeRef.current) || 0;
        try {
          const odd = V && V.SpreadMode ? V.SpreadMode.ODD : 1;
          const none = V && V.SpreadMode ? V.SpreadMode.NONE : 0;
          viewer.spreadMode = count === 1 ? odd : none;
        } catch (_) {}
      };

      // v1.0.6: dispose the CURRENT viewer completely before a new document is
      // installed. Re-installing a document on a live PDFViewer used to crash inside
      // its own teardown ("Cannot read properties of null (reading 'destroy')"):
      // setDocument() re-enters _resetView() -> _cancelRendering(), which calls
      // cancelRendering() on page views whose annotation-editor layer had already
      // been released, and the plugin's synchronous `applySpread()` right after
      // setDocument() hit an empty `_pages` array (that is also why 单双栏 stopped
      // working after a switch). A fresh viewer per document sidesteps the whole
      // reuse path: nothing of the old document survives.
      // (v51) One dedicated worker for OUR pdf.js copy, owned by us and torn
      // down with the viewer. Handing it over as `workerPort` is deliberate:
      // `GlobalWorkerOptions.workerSrc` is a property of the shared global this
      // library instance exposes, so if the host page later touches its own
      // `pdfjsLib.GlobalWorkerOptions`, our document could end up paired with a
      // foreign worker and fail with a version mismatch. A private port cannot
      // be captured that way.
      const workerRef = React.useRef(null);
      const localWorker = () => {
        const lib = (pdfStateRef.current && pdfStateRef.current.pdfjsLib) || (ownPdfJs && ownPdfJs.pdfjsLib);
        if (!lib || typeof Worker !== 'function') return null;
        if (workerRef.current) return workerRef.current;
        let port;
        try {
          port = new Worker(asset('pdf.worker.min.js'));
          workerRef.current = new lib.PDFWorker({ name: 'english-lit-reader', port });
        } catch (_) {
          port?.terminate();
        }
        return workerRef.current;
      };

      const disposeViewer = () => {
        cancelFigureWork();
        pdfTextJobRef.current = null;
        const s = pdfStateRef.current;
        const task = pdfLoadingTaskRef.current;
        pdfLoadingTaskRef.current = null;
        pdfDocRef.current = null;
        pdfStateRef.current = null;
        viewerPromiseRef.current = null;
        if (s) {
          try { s.viewer.setDocument(null); } catch (_) {}
          try { s.viewer.cleanup(); } catch (_) {}
        }
        const worker = workerRef.current;
        const port = worker?.port;
        workerRef.current = null;
        const stopWorker = () => {
          try { worker?.destroy(); } catch (_) {}
          // PDF.js owns its wrapper, but the Worker passed as its port is ours.
          port?.terminate();
        };
        if (task) Promise.resolve().then(() => task.destroy()).catch(() => {}).finally(stopWorker);
        else stopWorker();
        if (viewerElRef.current) {
          try { viewerElRef.current.textContent = ''; } catch (_) {}
        }
      };

      function ensureViewer() {
        if (viewerPromiseRef.current) return viewerPromiseRef.current;
        const pending = (async () => {
          const { pdfjsLib, V } = await ensurePdfJs();
          if (viewerPromiseRef.current !== pending) return null;
          const container = containerRef.current;
          const viewerEl = viewerElRef.current;
          if (!container || !viewerEl) throw new Error('PDF viewer container is not ready');
          const eventBus = new V.EventBus();
          const linkService = new V.PDFLinkService({ eventBus });
          const viewer = new V.PDFViewer({
            container, viewer: viewerEl, eventBus, linkService, textLayerMode: 1,
          });
          linkService.setViewer(viewer);
          const state = { eventBus, linkService, viewer, V, pdfjsLib };
          eventBus.on('pagechanging', (e) => { if (e && e.pageNumber) setPageNum(e.pageNumber); });
          // (v20 #3) Keep the toolbar percentage in sync with whatever changed the
          // scale: our +/- buttons, the preset list, Ctrl+wheel, or pdf.js itself.
          eventBus.on('scalechanging', (e) => {
            figureDragRef.current?.();
            const scale = e && Number(e.scale);
            if (Number.isFinite(scale) && scale > 0) setZoomPct(Math.round(scale * 100));
          });
          // (v13 #1) ONE coalesced decoration pass for a burst of per-page events,
          // instead of a full-document pass per page per event.
          eventBus.on('textlayerrendered', (event) => {
            scheduleDecorateRef.current();
            const pending = findScrollRef.current;
            if (pending && event && pending.page === event.pageNumber) pending.scroll();
          });
          eventBus.on('pagesloaded', () => scheduleDecorateRef.current());
          // (#1) Spread must be (re)applied AFTER the page views exist. `pagesinit`
          // fires at the end of setDocument() once `_pages` is populated, which is the
          // earliest point where `_updateSpreadMode()` can wrap pages into `.spread`.
          eventBus.on('pagesinit', () => {
            applySpread(viewer, V);
            scheduleDecorateRef.current();
          });
          eventBus.on('pagerendered', () => scheduleDecorateRef.current());
          pdfStateRef.current = state;
          return state;
        })().catch((error) => {
          if (viewerPromiseRef.current === pending) viewerPromiseRef.current = null;
          throw error;
        });
        viewerPromiseRef.current = pending;
        return pending;
      }

      React.useEffect(() => {
        setPdfAnalysisReady(false);
        setPdfTextBusy(false);
        setFigurePickMode(false);
        setFigureActivity(null);
        if (mode !== 'pdf') return;
        return () => {
          // (v13 #1) Drop any pending decoration pass from the old document so it
          // cannot run against a DOM that is about to be torn down.
          if (decorateTimerRef.current) {
            clearTimeout(decorateTimerRef.current);
            decorateTimerRef.current = null;
          }
          disposeViewer();
          releaseNativeUrl();
        };
      }, [mode]);

      React.useEffect(() => {
        if (mode !== 'pdf' || dropSeq === 0) return;
        const file = lastFileRef.current;
        if (!file) return;
        const sourcePaper = readShared().paperId;
        let cancelled = false;
        const alive = () => !cancelled && lastFileRef.current === file
          && readShared().paperId === sourcePaper && readShared().mode === 'pdf';
        (async () => {
          setPdfAnalysisReady(false);
          setPdfTextBusy(false);
          setPdfError('');
          setPreviewMode('pdfjs');
          notify(t('pdf.loading'));
          const buf = await file.arrayBuffer();
          if (!alive()) return;
          // Tear the previous viewer down entirely, then build a fresh one on the
          // same DOM node. This is what makes switching between recently-read PDFs
          // survive; see disposeViewer().
          disposeViewer();
          const state = await ensureViewer();
          if (!state || !alive()) return;
          // (v51) Ask for our own worker explicitly. Without it pdf.js falls
          // back to `GlobalWorkerOptions.workerSrc`, which a foreign `pdfjsLib`
          // on the page may have rewritten to ITS worker.
          const worker = localWorker();
          const task = state.pdfjsLib.getDocument({ data: new Uint8Array(buf), worker: worker || undefined, disableAutoFetch: true });
          pdfLoadingTaskRef.current = task;
          const pdf = await task.promise;
          if (!alive()) return;
          pdfDocRef.current = pdf;
          state.linkService.setDocument(pdf, null);
          state.viewer.setDocument(pdf);
          pdfTextJobRef.current = { pdf, paper: sourcePaper, pending: null };
          setPdfAnalysisReady(true);
          // No synchronous applySpread() here: `_pages` does not exist yet. The
          // `pagesinit` handler above applies the current spread mode instead.
          setPageCount(pdf.numPages || 0);
          setPageNum(1);
          setPdfName(file.name || '');
          setHasPdf(true);
          setPdfError('');
          notify(t('pdf.loaded'), 'ok');
        })().catch((error) => {
          if (!alive()) return;
          const reason = String(error && error.message ? error.message : error);
          disposeViewer();
          setPdfError(reason);
          openNativePreview(file, reason);
        });
        return () => { cancelled = true; };
      }, [mode, dropSeq]);

      // (#4) Two-column browsing. Toggling re-wraps pages and creates the
      // horizontal scroll range that (#5) drag-to-pan then scrolls.
      React.useEffect(() => {
        const s = pdfStateRef.current;
        if (s && s.viewer && s.V) applySpread(s.viewer, s.V);
        scheduleDecorateRef.current();
      }, [spreadMode, dropSeq, hasPdf]);

      React.useEffect(() => {
        scheduleDecorateRef.current();
      }, [marks]);

      // (#6) Ctrl + wheel zooms the PDF instead of scrolling the page.
      React.useEffect(() => {
        if (mode !== 'pdf') return;
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          const s = pdfStateRef.current;
          if (!s || !s.viewer) return;
          e.preventDefault();
          const v = s.viewer;
          const base = v.currentScale || 1;
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, base * factor));
          try { v.currentScale = next; } catch (_) {}
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => { el.removeEventListener('wheel', onWheel); };
      }, [mode, hasPdf]);

      React.useEffect(() => {
        if (!popupOn) {
          popupDragCancelRef.current?.();
          setPopup(null);
        }
      }, [popupOn]);

      React.useEffect(() => {
        const viewport = window.visualViewport;
        const fitPrevious = (previous) => {
          if (!previous) return previous;
          const box = fitPopupBox(previous, popupViewport());
          return Object.keys(box).every((key) => box[key] === previous[key]) ? previous : { ...previous, ...box };
        };
        const reflow = () => {
          popupDragCancelRef.current?.();
          cardGestureCancelRef.current?.();
          if (Object.keys(readShared().floatingCards).length) setFloatingBounds(popupViewport());
          setPopup(fitPrevious);
          setNoteBubble(fitPrevious);
        };
        window.addEventListener('resize', reflow);
        document.addEventListener('fullscreenchange', reflow);
        viewport?.addEventListener('resize', reflow);
        viewport?.addEventListener('scroll', reflow);
        return () => {
          window.removeEventListener('resize', reflow);
          document.removeEventListener('fullscreenchange', reflow);
          viewport?.removeEventListener('resize', reflow);
          viewport?.removeEventListener('scroll', reflow);
          popupDragCancelRef.current?.();
          cardGestureCancelRef.current?.();
        };
      }, []);

      // (#4) Right-click on a selection inside the PDF opens our own menu with
      // Highlight / Add note. A double-click on an annotated span opens the note
      // bubble beside that sentence.
      React.useEffect(() => {
        if (mode !== 'pdf') return;
        const el = containerRef.current;
        if (!el) return;
        const onContextMenu = (e) => {
          // (v9 #4) Two ways in, and the FIRST one needs no selection at all:
          // right-clicking an already highlighted/annotated sentence must open
          // the menu with "remove highlight" / note actions. Requiring a fresh
          // selection made the user re-select the whole sentence every time,
          // which is exactly what was reported.
          const clickEl = e.target && e.target.nodeType === 1 ? e.target : (e.target ? e.target.parentElement : null);
          let clicked = null;
          try {
            clicked = clickEl && clickEl.closest ? clickEl.closest('.textLayer span[data-elr-mark]') : null;
          } catch (_) {}
          if (clicked && clicked.dataset && clicked.dataset.elrMark) {
            // (v23 #1) A span may carry several record ids (a highlight AND an
            // annotation on the same sentence), so resolve them all and keep the
            // one whose TEXT matches, preferring the highlight for the menu's
            // remove-highlight entry and the annotation for its note entry.
            const ids = String(clicked.dataset.elrMark || '').split(' ').filter(Boolean);
            const found = (marksRef.current || []).filter((m) => ids.indexOf(m.id) !== -1);
            const target = found.find((m) => m.kind !== 'note' && m.hl === true) || found[0] || null;
            if (target) {
              e.preventDefault();
              e.stopPropagation();
              let rect = null;
              try { rect = clicked.getBoundingClientRect(); } catch (_) {}
              const noteOne = found.find((m) => m.kind === 'note' || String(m.note || '').trim()) || null;
              setMenu({
                x: e.clientX, y: e.clientY, rect, text: cleanSelectionText(target.text).slice(0, MAX_SELECTION),
                markId: target.id,
                noteId: noteOne ? noteOne.id : '',
                // (v35 #1) The record already stores the sentence it was made from,
                // and a marked passage IS the context a term would need.
                surrounding: cleanSelectionText(target.text).slice(0, 600),
              });
              return;
            }
          }
          let sel = null;
          try { sel = window.getSelection(); } catch (_) {}
          // (v13 #3/#4) Clean the raw pdf.js line-wrap noise AND collect every
          // range of a multi-paragraph selection instead of a hard-clipped
          // `sel.toString()`.
          const raw = selectionToText(sel);
          if (!raw) return;
          let node = sel.anchorNode;
          let inside = false;
          try {
            if (!node && sel.rangeCount) node = sel.getRangeAt(0).commonAncestorContainer;
            inside = !!(node && (node === el || el.contains(node)));
          } catch (_) {}
          if (!inside) return;
          e.preventDefault();
          e.stopPropagation();
          const clipped = raw.slice(0, MAX_SELECTION);
          let rect = null;
          try { if (sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) {}
          // (#2 v1.0.5) If the clicked sentence already carries records, the menu
          // also offers "remove highlight" / "clear annotation" for them.
          // (v23 #1) The two are resolved SEPARATELY: `markId` is the highlight
          // record, `noteId` the annotation record, and either may be absent.
          let markId = '';
          let noteId = '';
          try {
            const anchor = sel.anchorNode;
            const anchorEl = anchor && anchor.nodeType === 1 ? anchor : (anchor ? anchor.parentElement : null);
            const marked = anchorEl && anchorEl.closest ? anchorEl.closest('.textLayer span[data-elr-mark]') : null;
            if (marked && marked.dataset && marked.dataset.elrMark) {
              const ids = String(marked.dataset.elrMark || '').split(' ').filter(Boolean);
              const found = (marksRef.current || []).filter((m) => ids.indexOf(m.id) !== -1);
              const hlOne = found.find((m) => m.kind !== 'note' && m.hl === true);
              const noteOne = found.find((m) => m.kind === 'note' || String(m.note || '').trim());
              if (hlOne) markId = hlOne.id;
              if (noteOne) noteId = noteOne.id;
            }
          } catch (_) {}
          if (!markId || !noteId) {
            const needle = clipped.replace(/\s+/g, '');
            const list = marksRef.current || [];
            for (let i = 0; i < list.length && (!markId || !noteId); i++) {
              const t2 = String(list[i].text || '').replace(/\s+/g, '');
              const hit = t2 && needle && (t2 === needle || t2.indexOf(needle) !== -1 || needle.indexOf(t2) !== -1);
              if (!hit) continue;
              if (!markId && list[i].kind !== 'note' && list[i].hl === true) markId = list[i].id;
              if (!noteId && (list[i].kind === 'note' || String(list[i].note || '').trim())) noteId = list[i].id;
            }
          }
          setMenu({ x: e.clientX, y: e.clientY, rect, text: clipped, markId, noteId, surrounding: sentenceAround(raw, clipped) });
        };
        const onDoubleClick = (e) => {
          if (figurePickingRef.current) return;
          const target = e.target;
          if (!target || !target.closest) return;
          const span = target.closest('.textLayer span.elr-hl-note');
          if (!span) return;
          const rawIds = span.dataset ? String(span.dataset.elrMark || '') : '';
          const ids = rawIds ? rawIds.split(' ').filter(Boolean) : [];
          // (v23 #1) A double-click opens the ANNOTATION, so only note records are
          // considered — a plain highlight must not open the bubble.
          const mark = (marksRef.current || []).find((m) => ids.indexOf(m.id) !== -1 && (m.kind === 'note' || String(m.note || '').trim())) ||
            (marksRef.current || []).find((m) => String(m.note || '').trim() && String(m.text || '').trim() &&
              String(span.textContent || '').trim().indexOf(String(m.text || '').trim()) !== -1);
          if (!mark) return;
          e.preventDefault();
          e.stopPropagation();
          const { top, bottom } = span.getBoundingClientRect();
          setNoteBubble(placeNoteBubble(mark.id, mark.text, mark.note || '', { left: e.clientX, top, bottom }));
        };
        const dismiss = () => setMenu(null);
        el.addEventListener('contextmenu', onContextMenu);
        el.addEventListener('dblclick', onDoubleClick);
        document.addEventListener('click', dismiss);
        document.addEventListener('scroll', dismiss, true);
        return () => {
          el.removeEventListener('contextmenu', onContextMenu);
          el.removeEventListener('dblclick', onDoubleClick);
          document.removeEventListener('click', dismiss);
          document.removeEventListener('scroll', dismiss, true);
        };
      }, [mode, hasPdf]);

      React.useEffect(() => {
        const isPdf = mode === 'pdf';
        const source = isPdf ? containerRef.current : inputRef.current;
        if (!source) return;
        let timer;
        let gesture = null;
        const inside = (node) => Boolean(node && source.contains(node));
        const readSelection = () => {
          if (!isPdf) {
            const value = cleanSelectionText(source.value.slice(source.selectionStart, source.selectionEnd));
            const rect = source.getBoundingClientRect();
            return { value, rect: { left: rect.left + 12, top: rect.top, bottom: rect.top + 36 } };
          }
          const native = window.getSelection();
          if (!native || native.isCollapsed || !native.rangeCount || !inside(native.anchorNode) || !inside(native.focusNode)) return null;
          return { value: selectionToText(native), rect: native.getRangeAt(0).getBoundingClientRect() };
        };
        const cancel = () => {
          clearTimeout(timer);
          gesture = null;
        };
        const commit = () => {
          clearTimeout(timer);
          if (!gesture || gesture.drawing || readShared().paperId !== paperId) return;
          if (isPdf && figurePickingRef.current) { cancel(); return; }
          const { intent, touch } = gesture;
          if (!touch) gesture = null;
          const picked = readSelection();
          if (picked && picked.value.length >= 2) stageRef.current(picked.value, picked.rect, intent);
        };
        const schedule = (delay) => {
          clearTimeout(timer);
          timer = setTimeout(commit, delay);
        };
        const onChange = () => {
          if (gesture && !gesture.drawing) schedule(gesture.touch ? SELECTION_DEBOUNCE_MS : 30);
        };
        const onNativeTextSelect = () => {
          if (!gesture && document.activeElement === source) {
            const picked = readSelection();
            if (!picked || picked.value.length < 2 || picked.value === readShared().selection) return;
            gesture = { drawing: false, intent: 'replace' };
          }
          onChange();
        };
        const onDown = (event) => {
          if (event.isPrimary === false) return;
          if (gesture && !gesture.drawing) commit();
          cancel();
          if (event.button !== 0 || !inside(event.target)
            || (isPdf && (panMode || figurePickingRef.current || event.ctrlKey || event.metaKey))) return;
          const current = readShared();
          const append = event.shiftKey && current.selectionEdit.trim();
          let intent = append ? 'append' : 'replace';
          if (append || (!event.shiftKey && current.selectionPrefix)) {
            if (isPdf) {
              // Reset the browser anchor so a new drag starts at the pointer.
              window.getSelection()?.removeAllRanges();
            } else {
              const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
              if (caret?.offsetNode === source) {
                source.setSelectionRange(caret.offset, caret.offset);
              } else if (append) {
                intent = 'extend';
              } else {
                source.setSelectionRange(source.selectionEnd, source.selectionEnd);
              }
            }
          }
          gesture = { pointer: event.pointerId, drawing: true, touch: event.pointerType === 'touch', intent };
        };
        const onUp = (event) => {
          if (gesture?.pointer !== event.pointerId) return;
          gesture.drawing = false;
          schedule(30);
        };
        const onCancel = (event) => {
          if (gesture?.pointer !== event.pointerId) return;
          if (!gesture.touch) { cancel(); return; }
          gesture.drawing = false;
          schedule(SELECTION_DEBOUNCE_MS);
        };
        const onKey = (event) => {
          const extendsRange = event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key);
          const selectsAll = !isPdf && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';
          if (!extendsRange && !selectsAll) return;
          const insidePdfCaret = isPdf && event.target === document.body && inside(window.getSelection()?.anchorNode);
          if ((!inside(event.target) && !insidePdfCaret) || gesture?.drawing) return;
          if (!gesture?.keyboard || selectsAll) {
            const current = readShared();
            const extend = extendsRange && current.selectionPrefix && readSelection()?.value === current.selection;
            gesture = { keyboard: true, drawing: false, intent: extend ? 'extend' : 'replace' };
          }
          schedule(30);
        };
        document.addEventListener('selectionchange', onChange);
        if (!isPdf) source.addEventListener('select', onNativeTextSelect);
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onCancel, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('blur', cancel);
        return () => {
          document.removeEventListener('selectionchange', onChange);
          if (!isPdf) source.removeEventListener('select', onNativeTextSelect);
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onCancel, true);
          document.removeEventListener('keydown', onKey, true);
          window.removeEventListener('blur', cancel);
          cancel();
        };
      }, [mode, paperId, previewMode, panMode]);

      const referenceScanComplete = (scan) => {
        if (scan.next === null && !scan.failed.size) return true;
        if (!scan.heading) return false;
        const end = (scan.end || scan.totalLines + 1) - 1;
        let next = scan.heading;
        const ranges = Array.from(scan.windows.values()).sort((a, b) => a.from - b.from);
        for (const range of ranges) {
          if (scan.failed.has(range.cursor) || range.to < next) continue;
          if (range.from > next) return false;
          next = range.to + 1;
          if (next > end) return true;
        }
        return false;
      };

      const doReferences = async (options = {}) => {
        const { paperId: paper, text: source } = readShared();
        if (!source.trim()) return;
        const active = refRunRef.current;
        if (active && active.paper === paper && active.source === source) return;
        if (active) active.controller.abort();

        const pdfSource = pdfReferenceSourceRef.current;
        const originalPdf = pdfSource && pdfSource.paper === paper && pdfSource.text === source ? pdfSource : null;
        if (originalPdf && originalPdf.noText) {
          setReferencesStage(t('references.noText'));
          return;
        }

        const ticket = { paper, source, controller: new AbortController() };
        refRunRef.current = ticket;
        const alive = () => refRunRef.current === ticket && readShared().paperId === paper && readShared().text === source;
        const model = bodyRef.current();
        const call = (path, payload, timeout) => post(path, payload, timeout, ticket.controller.signal);
        const save = (rows) => {
          setReferences(rows);
          saveResult(paper, { references: rows });
        };
        const onlyIds = Array.isArray(options.ids) ? new Set(options.ids) : null;
        let current = Array.isArray(readShared().references) ? readShared().references : [];
        let scan = refScanRef.current;
        setReferencesBusy(true);
        setReferencesCanContinue(false);
        try {
          if (!onlyIds) {
            if (!options.resume || !scan || scan.paper !== paper || scan.source !== source) {
              const planning = await loadPaperPlanning().catch(() => null);
              if (!alive()) return;
              const scanText = originalPdf ? originalPdf.referenceText : source;
              const pageCounts = originalPdf ? originalPdf.pageLineCounts : undefined;
              const plan = planning?.planReferenceScan(scanText, pageCounts);
              scan = { paper, source, planning, plan, next: plan && !plan.windows.length ? null : 0, windows: new Map(), failed: new Set() };
              refScanRef.current = scan;
            }
            const retries = [...scan.failed];
            const legacy = scan.plan ? null : {
              text: originalPdf ? originalPdf.referenceText : source,
              pageLineCounts: originalPdf ? originalPdf.pageLineCounts : undefined,
            };
            for (let request = 0; request < 6 && !referenceScanComplete(scan); request++) {
              const retry = retries.length > 0;
              const cursor = retry ? retries.shift() : scan.next;
              if (cursor === null) break;
              setReferencesStage(t('references.stage.identify'));
              let batch;
              try {
                const payload = scan.plan ? { referenceWindow: scan.planning.referenceScanWindow(scan.plan, cursor, retry) } : legacy;
                batch = await call('/references/segment', { ...model, ...payload, windowed: true, cursor, retryWindow: retry }, retry ? 150000 : 80000);
              } catch (_) {}
              if (!alive()) return;
              if (!batch || !batch.ok) {
                scan.failed.add(cursor);
                if (cursor === scan.next) break;
                continue;
              }
              if (cursor === scan.next) scan.next = batch.nextCursor;
              scan.totalLines = batch.totalLines;
              if (batch.partial) scan.failed.add(cursor);
              else scan.failed.delete(cursor);
              const oldBatch = scan.windows.get(cursor);
              if (batch.partial && oldBatch) {
                const recovered = new Map(oldBatch.entries.map((row) => [row.id, row]));
                for (const row of batch.entries) recovered.set(row.id, row);
                batch.entries = [...recovered.values()];
              }
              scan.windows.set(cursor, batch);
              scan.heading = null;
              scan.end = null;
              const candidates = [];
              for (const window of scan.windows.values()) {
                if (!window.partial) {
                  if (window.headingLine) scan.heading = Math.min(scan.heading || Infinity, window.headingLine);
                  if (window.endLine) scan.end = Math.max(scan.end || 0, window.endLine);
                }
                for (const row of window.entries) candidates.push({ row, cursor: window.cursor });
              }
              const rows = [];
              candidates.sort((a, b) => a.row.startLine - b.row.startLine);
              for (const candidate of candidates) {
                const previous = rows[rows.length - 1];
                if (previous && previous.endLine >= candidate.row.startLine) scan.failed.add(candidate.cursor);
                else rows.push(candidate.row);
              }
              if (rows.length) {
                current = mergeReferenceCache(rows, current);
                save(current);
                setReferencesStage(t('references.scanProgress').replace('{total}', String(current.length)));
              } else if (referenceScanComplete(scan)) {
                current = [];
                save(current);
              }
            }
            if (!scan.windows.size || ![...scan.windows.values()].some((window) => window.entries.length)) {
              const incomplete = !referenceScanComplete(scan);
              setReferencesCanContinue(incomplete);
              setReferencesStage(t(incomplete ? 'references.scanPartial' : 'references.notFound'));
              return;
            }
          }

          // Bound each useful unit independently so a slow lookup cannot withhold
          // completed results for the entire bibliography.
          const work = current.filter((item) => (!onlyIds || onlyIds.has(item.id)) && (
            !item.title || !item.zh || !['provided', 'matched', 'confirm', 'none'].includes(item.status)
          ));
          for (let start = 0; start < work.length; start += 6) {
            let entries = work.slice(start, start + 6);
            const needFields = entries.filter((item) => !item.title || !item.zh);
            const needLinks = (item) => item.title && !['provided', 'matched', 'confirm', 'none'].includes(item.status);
            const resolve = async (group) => {
              if (!group.length) return null;
              try {
                const response = await call('/references/resolve', { entries: group }, 240000);
                if (response && response.ok) return response;
              } catch (_) {}
              return { ok: true, results: group.map((item) => ({ id: item.id, status: 'retry' })) };
            };
            setReferencesStage(t('references.stage.resolve'));
            const available = entries.filter(needLinks);
            const addresses = resolve(available).then((result) => {
              if (alive() && result) {
                current = applyReferenceResolve(current, result);
                save(current);
              }
            });
            if (needFields.length) {
              try {
                const fields = await call('/references/fields', { ...model, entries: needFields }, 130000);
                if (alive()) {
                  current = applyReferenceFields(current, fields);
                  entries = applyReferenceFields(entries, fields);
                  save(current);
                }
              } catch (_) {}
            }
            if (!alive()) return;
            await addresses;
            if (!alive()) return;
            const newlyTitled = entries.filter(needLinks).filter((item) => !available.some((prior) => prior.id === item.id));
            if (newlyTitled.length) {
              const resolved = await resolve(newlyTitled);
              if (!alive()) return;
              current = applyReferenceResolve(current, resolved);
              save(current);
            }
          }

          const incomplete = scan && !referenceScanComplete(scan);
          setReferencesCanContinue(Boolean(incomplete));
          const counts = countReferenceStatus(current);
          setReferencesStage(describeReferenceCounts(t, counts, onlyIds ? t('references.stage.retry') : '')
            + (incomplete ? ' · ' + t('references.scanPartial') : ''));
        } catch (error) {
          if (alive()) {
            setReferencesCanContinue(Boolean(scan && !referenceScanComplete(scan)));
            setReferencesStage(String(error && error.message ? error.message : error));
          }
        } finally {
          if (alive()) {
            refRunRef.current = null;
            setReferencesBusy(false);
          }
        }
      };

      const mergeReferenceCache = (fresh, previous) => {
        const byId = new Map(previous.filter((row) => row && row.id).map((row) => [row.id, row]));
        return fresh.map((row) => {
          const old = byId.get(row.id);
          if (!old || old.raw !== row.raw || (row.title && old.title && row.title !== old.title)) return row;
          const sameCitation = (!row.year || !old.year || row.year === old.year)
            && (!row.authors || !old.authors || row.authors === old.authors);
          const cachedAddress = row.status !== 'provided' && sameCitation
            && ['matched', 'confirm', 'none', 'retry'].includes(old.status);
          return {
            ...row,
            title: row.title || old.title || '',
            zh: old.zh || '',
            authors: row.authors || old.authors || '',
            venue: row.venue || old.venue || '',
            year: row.year || old.year || '',
            ...(cachedAddress ? {
              status: old.status,
              url: old.status === 'matched' ? old.url : '',
              doi: old.status === 'matched' ? old.doi : '',
              found: old.status === 'matched' && Boolean(old.url),
            } : {}),
          };
        });
      };

      const applyReferenceFields = (list, payload) => {
        if (!payload || !payload.ok || !Array.isArray(payload.fields)) return list;
        const byId = new Map();
        for (const field of payload.fields) {
          const id = String((field && field.id) || '');
          if (id && !byId.has(id)) byId.set(id, field);
        }
        return list.map((item) => {
          const field = byId.get(item.id);
          if (!field) return item;
          return Object.assign({}, item, {
            title: String(item.title || field.title || ''),
            zh: String(item.zh || field.zh || ''),
            authors: String(item.authors || field.authors || ''),
            venue: String(item.venue || field.venue || ''),
            year: String(item.year || field.year || ''),
            status: item.status === 'provided' ? 'provided' : (item.status === 'pending' ? 'fields' : item.status),
          });
        });
      };

      const applyReferenceResolve = (list, payload) => {
        if (!payload || !payload.ok || !Array.isArray(payload.results)) return list;
        const byId = new Map();
        for (const hit of payload.results) {
          const id = String((hit && hit.id) || '');
          if (id && !byId.has(id)) byId.set(id, hit);
        }
        return list.map((item) => {
          const hit = byId.get(item.id);
          if (!hit) return item;
          return Object.assign({}, item, {
            status: String(hit.status || item.status),
            reason: String(hit.reason || ''),
            url: String(hit.url || ''),
            doi: String(hit.doi || ''),
            found: Boolean(hit.url) && (hit.status === 'matched' || hit.status === 'provided'),
            matchedTitle: String(hit.matchedTitle || ''),
            matchedYear: String(hit.matchedYear || ''),
          });
        });
      };

      const countReferenceStatus = (list) => {
        const counts = { provided: 0, matched: 0, confirm: 0, none: 0, retry: 0, pending: 0, fields: 0, legacy: 0 };
        for (const item of list) {
          const status = String((item && item.status) || (item && item.found ? 'legacy' : 'pending'));
          if (counts[status] == null) counts.pending += 1;
          else counts[status] += 1;
        }
        return counts;
      };

      const retryReferenceFailures = () => {
        const ids = references.filter((item) => item && item.id && (
          item.status === 'retry' || item.status === 'pending' || item.status === 'fields' || !item.zh
        )).map((item) => item.id);
        if (!ids.length) { notify(t('references.retryNone'), 'ok'); return; }
        doReferences({ ids });
      };

      const describeReferenceCounts = (translate, counts, prefix) => {
        const parts = [];
        if (counts.provided) parts.push(translate('references.status.provided') + ' ' + counts.provided);
        if (counts.matched) parts.push(translate('references.status.matched') + ' ' + counts.matched);
        if (counts.confirm) parts.push(translate('references.status.confirm') + ' ' + counts.confirm);
        if (counts.none) parts.push(translate('references.status.none') + ' ' + counts.none);
        if (counts.retry) parts.push(translate('references.status.retry') + ' ' + counts.retry);
        if (counts.pending || counts.fields) parts.push(translate('references.status.pending') + ' ' + (counts.pending + counts.fields));
        if (counts.legacy) parts.push(translate('references.status.legacy') + ' ' + counts.legacy);
        return (prefix ? prefix + ' · ' : '') + parts.join(' · ');
      };

      const doSummary = async (retry = false) => {
        const { paperId: paper, text: source, summaryDetail: previous, summaryMeta: previousMeta } = readShared();
        if (!source.trim()) { notify(t('selection.empty'), 'error'); return; }
        if (summaryRunRef.current) return;
        const summaryDraft = retry && previous?.format === 'detailed-markdown' ? previous.draft : undefined;
        if (retry && !summaryDraft) return;
        const request = bodyRef.current();
        const selection = describeModelSelection(request);
        const controller = new AbortController();
        summaryRunRef.current = controller;
        const alive = () => summaryRunRef.current === controller && readShared().paperId === paper && readShared().text === source;
        const reportIssue = (message) => {
          setSummaryIssue(message);
          notify(message, 'error');
        };
        setSummaryIssue('');
        setSummaryBusy(true);
        notify(t(retry ? 'summary.synthesizing' : 'summary.running'));
        try {
          const pdfSource = pdfReferenceSourceRef.current;
          const pageTextLengths = pdfSource?.paper === paper && pdfSource.text === source ? pdfSource.pageTextLengths : undefined;
          const meta = await fetch(BASE + '/meta', {
            credentials: 'same-origin', cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          }).then((response) => response.ok ? response.json() : null).catch(() => null);
          if (!alive()) return;
          if (meta?.summaryFormat !== 'detailed-markdown') {
            reportIssue(t('summary.hostUnavailable'));
            return;
          }
          const data = await post('/summary', {
            ...request, text: source, pageTextLengths, summaryDraft,
          }, 780000, controller.signal);
          if (!alive()) return;
          if (data && data.ok) {
            if (data.format !== 'detailed-markdown') {
              reportIssue(t('summary.hostUnavailable'));
              return;
            }
            if (typeof data.text !== 'string' || !data.text.trim()) {
              reportIssue(t('summary.failed'));
              return;
            }
            const value = data.text;
            const coverage = data.coverage ? { ...data.coverage, failedChunks: Number(data.failedChunks) || 0, notes: data.mode === 'notes' } : null;
            const result = {
              summary: value, summaryCoverage: coverage,
              summaryMeta: retry && coverage?.notes ? previousMeta : readGenerationMetadata(data, selection),
              summaryDetail: {
                format: 'detailed-markdown', mode: data.mode, draft: data.summaryDraft || null,
                error: typeof data.synthesisError === 'string' ? data.synthesisError.slice(0, 500) : '',
              },
            };
            writeShared(result);
            saveResult(paper, result);
            let message = coverage?.notes ? t('summary.notesOnly') : t('ready');
            if (data.failedChunks) message += ' · ' + t('summary.coverageFailed', { count: data.failedChunks });
            notify(message, data.failedChunks ? 'error' : 'ok');
          } else reportIssue(data?.error || t('summary.failed'));
        } catch (error) {
          if (alive()) {
            reportIssue(error?.status === 404 || error?.status === 405
              ? t('summary.hostUnavailable') : String(error?.message || t('summary.failed')));
          }
        } finally {
          if (summaryRunRef.current === controller) {
            summaryRunRef.current = null;
            setSummaryBusy(false);
          }
        }
      };

      // (#6) Explicit re-analysis: nothing is regenerated unless this is pressed.
      // (v20 #1) This used to re-run the full-text translation as well; that feature
      // is gone, so the analysis panel's own button (doSummary) is the only entry.

      // (v8 #3) Explain a formula in the context of the current paper. The paper
      // text is forwarded so the Host can ground the symbols in what the authors
      // actually defined, instead of guessing from the expression alone.
      const explainFormula = async (value, rect) => {
        const formula = String(value || '').trim();
        if (!formula) { notify(t('selection.empty'), 'error'); return; }
        const pos = rectForPopup(rect) || { x: 40, y: 120 };
        setFormulaCard({ x: pos.x, y: pos.y, text: formula, body: '', busy: true });
        try {
          const data = await post('/formula', Object.assign({
            formula,
            context: String(text || '').slice(0, 40000),
          }, bodyRef.current()));
          if (data && data.ok) {
            const body = data.text || '';
            setFormulaCard({ x: pos.x, y: pos.y, text: formula, body, busy: false });
            notify(t('ready'), 'ok');
          } else {
            const msg = (data && data.error) || t('formula.failed');
            setFormulaCard({ x: pos.x, y: pos.y, text: formula, body: msg, busy: false });
            notify(msg, 'error');
          }
        } catch (error) {
          const msg = String(error && error.message ? error.message : error);
          setFormulaCard({ x: pos.x, y: pos.y, text: formula, body: msg, busy: false });
          notify(msg, 'error');
        }
      };

      // (v35 #1) Explain the selected professional term in the light of THIS paper
      // and its field, then record the explanation into the 术语解释 card. The
      // sentence the term came from is forwarded separately from the whole paper
      // text: the local sense is what the reader is stuck on, while the paper text
      // is what tells the model which subfield the term is being used in.
      const addTerm = (list, entry) => {
        const term = String((entry && entry.term) || '').trim();
        if (!term) return list;
        const key = term.toLowerCase();
        // One entry per term (case-insensitive): explaining the same word again
        // REPLACES its explanation instead of filling the glossary with duplicates.
        const rest = (list || []).filter((x) => x && String(x.term || '').trim().toLowerCase() !== key);
        return [normalizeTerm(Object.assign({}, entry, { term }))].concat(rest);
      };

      const explainTerm = async (value, surrounding) => {
        const term = String(value || '').trim();
        if (!term) { notify(t('selection.empty'), 'error'); return; }
        const id = paperIdRef.current;
        if (!id) { notify(t('term.needPaper'), 'error'); return; }
        const context = String(text || '').slice(0, 40000);
        setTermBusy(term);
        notify(t('term.running'));
        try {
          const data = await post('/term', Object.assign({
            term,
            context,
            surrounding: String(surrounding || '').slice(0, 2000),
          }, bodyRef.current()));
          if (data && data.ok) {
            const record = {
              id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
              term: data.term || term,
              body: data.text || '',
              surrounding: String(surrounding || ''),
              at: Date.now(),
            };
            const next = addTerm(termsRef.current || [], record);
            termsRef.current = next;
            setTerms(next);
            saveTerms(id, next);
            // Open the card so the reader sees the explanation land where it is
            // stored, instead of a toast that disappears.
            setTermsOpen(true);
            notify(t('ready'), 'ok');
          } else notify((data && data.error) || t('term.failed'), 'error');
        } catch (error) {
          notify(String(error && error.message ? error.message : error), 'error');
        } finally {
          setTermBusy('');
        }
      };

      const removeTerm = (id) => {
        const next = (termsRef.current || []).filter((x) => x.id !== id);
        termsRef.current = next;
        setTerms(next);
        saveTerms(paperIdRef.current, next);
        if (termBubble?.id === id) setTermBubble(null);
        if (termOpenId === id) setTermOpenId('');
      };

      const handleFile = (file, existingId) => {
        if (!file) return;
        const name = file.name || 'untitled';
        // (#5) One entry per physical file: identity is name + size + lastModified,
        // so re-opening the same paper refreshes its entry instead of adding a new
        // one. The entry id stays stable so saved translation/analysis/marks and
        // any in-memory bytes keep working.
        const identity = [name, file.size || 0, file.lastModified || 0].join('|');
        const known = recent.find((x) => x && x.identity === identity);
        const id = existingId || (known && known.id) || (String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8));
        fileCache.set(id, file);
        pdfTextJobRef.current = null;
        pdfReferenceSourceRef.current = null;
        setPdfAnalysisReady(false);
        setPdfTextBusy(false);
        resetAnalysisTasks();
        if (id !== readShared().paperId) resetSelection();
        clearFind();
        setText('');
        setPaperId(id);
        const base = { id, identity, name, size: file.size || 0, addedAt: Date.now() };
        if (isPdf(file)) {
          // (v24 #1) Persist the bytes so double-clicking this entry still works
          // after the page is reloaded. Fire and forget: a failed store only costs
          // the durable reopen, never the current session.
          try {
            putStoredFile(id, file, { name, size: file.size || 0, lastModified: file.lastModified || Date.now() });
          } catch (_) {}
          addRecent(Object.assign({}, base, { mode: 'pdf' }));
          lastFileRef.current = file;
          changeMode('pdf');
          setDropSeq((n) => n + 1);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            if (readShared().paperId !== id) return;
            const value = String(reader.result || '');
            addRecent(Object.assign({}, base, { mode: 'text', text: value.slice(0, RECENT_TEXT_CAP) }));
            changeMode('text');
            setText(value);
            setPdfName(name);
            notify(t('ready'), 'ok');
          };
          reader.onerror = () => notify(t('error'), 'error');
          reader.readAsText(file);
        }
      };

      const onDrop = (event) => {
        // (v19 #3) A section-reorder drop bubbles here as well; it carries no files
        // and must not be treated as "the user dropped a paper".
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files[0]) handleFile(files[0]);
      };
      // (v19 #3) Only a FILE drag may raise the "release to open" mask. The section
      // grips in the right column start an HTML5 drag too, and that dragover event
      // bubbles up to this root handler, which used to light up the mask while the
      // user was merely reordering the analysis panels.
      const isFileDrag = (event) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const types = dt.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
          if (types[i] === 'Files' || types[i] === 'application/x-moz-file') return true;
        }
        return false;
      };
      const onDragOver = (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!dragOver) setDragOver(true);
      };
      const onDragLeave = (event) => {
        if (!dragOver) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
      };
      const onPdfFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) handleFile(file);
        event.target.value = '';
      };
      const onTxtFile = (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) handleFile(file);
        event.target.value = '';
      };

      const goPage = (delta) => {
        const s = pdfStateRef.current;
        if (!s || !s.viewer) return;
        try {
          const v = s.viewer;
          const total = v.pagesCount || 1;
          const next = Math.max(1, Math.min(total, (v.currentPageNumber || 1) + delta));
          v.currentPageNumber = next;
          setPageNum(next);
        } catch (_) {}
      };

      // ---------------------------------------------------------------------
      // (v39) In-document search.
      //
      // Search uses rendered text when available and reads PDF text directly
      // for unopened pages. Both paths ignore whitespace. Hits are stored as
      // { page, at, len } offsets into that page's `pageText`; rectangles are
      // recomputed at paint time from the live spans, so a zoom only repaints
      // instead of re-searching.
      // ---------------------------------------------------------------------
      const [findQuery, setFindQuery] = React.useState('');
      const [findHits, setFindHits] = React.useState([]);
      const [findAt, setFindAt] = React.useState(-1);
      const [findBusy, setFindBusy] = React.useState(false);
      const findInputRef = React.useRef(null);
      const findHitsRef = React.useRef([]);
      findHitsRef.current = findHits;
      const findAtRef = React.useRef(-1);
      findAtRef.current = findAt;
      const findQueryRef = React.useRef('');
      findQueryRef.current = findQuery;
      // The needle the current `findHits` were produced from. Enter compares it
      // against what is typed now: an edited query must RE-SEARCH, an unchanged
      // one must step — otherwise typing a new word and pressing Enter would walk
      // through the previous word's hits.
      const findSearchedRef = React.useRef('');
      const findRunRef = React.useRef(0);
      const findScrollRef = React.useRef(null);
      const paintFindHitsRef = React.useRef(() => {});

      // Rectangles of ONE hit inside ONE page, resolved through the cached
      // index (norm index -> raw index per span, exactly like the marks pass).
      const findRectsForPage = (pageEl, hit) => {
        const spans = pageEl.querySelectorAll('.textLayer span:not(.markedContent)');
        if (!spans.length) return null;
        const cached = pageIndexOf(pageEl, spans);
        const { texts, starts, maps, pageText } = cached;
        if (!pageText) return null;
        const at = hit.at;
        const end = at + hit.len;
        const out = [];
        for (let i = 0; i < spans.length; i++) {
          const s = starts[i];
          const e = s + texts[i].length;
          if (!texts[i].length || e <= at || s >= end) continue;
          const normFrom = Math.max(at, s) - s;
          const normTo = Math.min(end, e) - s;
          const map = maps[i];
          if (!map || !map.length) continue;
          const rawFrom = map[Math.max(0, Math.min(normFrom, map.length - 1))];
          const rawTo = map[Math.max(0, Math.min(normTo - 1, map.length - 1))] + 1;
          let rects = rectsForSpanRange(spans[i], rawFrom, rawTo);
          if (!rects) {
            try { rects = [spans[i].getBoundingClientRect()]; } catch (_) { rects = null; }
          }
          if (rects) for (let k = 0; k < rects.length; k++) out.push(rects[k]);
        }
        return out.length ? out : null;
      };

      // Repaint EVERY hit on every laid-out page, with the current one darker.
      // Called after each decoration pass too (a zoom replaces the page canvas
      // and would otherwise leave stale orange rectangles behind).
      const paintFindHits = () => {
        const container = containerRef.current;
        if (!container) return;
        clearFindOverlays();
        const hits = findHitsRef.current || [];
        if (!hits.length) return;
        const active = findAtRef.current;
        const pages = container.querySelectorAll('.pdfViewer .page');
        // Group by page so one page pays for one canvas, not one per hit.
        const byPage = new Map();
        for (let i = 0; i < hits.length; i++) {
          const h = hits[i];
          const list = byPage.get(h.page);
          if (list) list.push({ hit: h, active: i === active });
          else byPage.set(h.page, [{ hit: h, active: i === active }]);
        }
        byPage.forEach((entries, pageNo) => {
          const pageEl = pages[pageNo - 1];
          if (!pageEl) return;
          // Two layers per page: the active hit gets the darker fill, every other
          // hit the lighter one, so stepping through matches is always visible no
          // matter how many of them share a page.
          const idleRects = [];
          const liveRects = [];
          for (let i = 0; i < entries.length; i++) {
            const r = findRectsForPage(pageEl, entries[i].hit);
            if (!r) continue;
            const bucket = entries[i].active ? liveRects : idleRects;
            for (let k = 0; k < r.length; k++) bucket.push(r[k]);
          }
          if (idleRects.length) paintFindOverlay(pageEl, idleRects, false);
          if (liveRects.length) paintFindOverlay(pageEl, liveRects, true);
        });
      };
      paintFindHitsRef.current = paintFindHits;

      const collectFindHits = async (rawQuery, job, alive) => {
        const container = containerRef.current;
        const needle = normText(rawQuery);
        if (!container || !job || !needle) return [];
        const pages = container.querySelectorAll('.pdfViewer .page');
        const out = [];
        for (let p = 0; p < job.pdf.numPages; p++) {
          if (!alive()) return [];
          const pageEl = pages[p];
          const spans = pageEl && pageEl.querySelectorAll('.textLayer span:not(.markedContent)');
          let pageText = spans && spans.length ? pageIndexOf(pageEl, spans).pageText : null;
          if (pageText == null) {
            try {
              const content = await readPdfPageText(job, p + 1);
              if (!alive()) return [];
              pageText = content.searchText;
            } catch (_) { continue; }
          }
          if (!pageText) continue;
          let from = 0;
          for (;;) {
            const at = pageText.indexOf(needle, from);
            if (at < 0) break;
            out.push({ page: p + 1, at, len: needle.length });
            if (out.length >= MAX_FIND_HITS) return out;
            from = at + Math.max(1, needle.length);
          }
        }
        return out;
      };

      const showFindHit = (next, hits) => {
        setFindAt(next);
        findAtRef.current = next;
        const hit = hits[next];
        const container = containerRef.current;
        const s = pdfStateRef.current;
        if (container && s && s.viewer) {
          // Setting the page FIRST is what makes the target page exist in the
          // DOM at all — pdf.js only lays out pages around the current one, so
          // scrolling before the switch lands on an element that does not exist.
          try {
            s.viewer.currentPageNumber = hit.page;
            setPageNum(hit.page);
          } catch (_) {}
        }
        const scroll = () => {
          if (findScrollRef.current !== pending) return;
          const again = containerRef.current;
          if (!again) return;
          const pages = again.querySelectorAll('.pdfViewer .page');
          const pageEl = pages[hit.page - 1];
          if (!pageEl) return;
          const spans = pageEl.querySelectorAll('.textLayer span:not(.markedContent)');
          if (!spans.length) { paintFindHitsRef.current(); return; }
          findScrollRef.current = null;
          const cached = pageIndexOf(pageEl, spans);
          // Scroll to the span that CONTAINS the hit, not to the page top.
          let target = null;
          for (let i = 0; i < spans.length; i++) {
            const from = cached.starts[i];
            const to = from + cached.texts[i].length;
            if (to > hit.at) { target = spans[i]; break; }
          }
          paintFindHitsRef.current();
          if (target) scrollElementIntoView(again, target);
        };
        const pending = { page: hit.page, scroll };
        findScrollRef.current = pending;
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(scroll);
        } else {
          setTimeout(scroll, 16);
        }
      };

      const runFind = async (delta) => {
        const query = normText(findQueryRef.current);
        const job = pdfTextJobRef.current;
        if (!query || !job) return;
        const run = ++findRunRef.current;
        const alive = () => findRunRef.current === run && pdfTextJobRef.current === job && normText(findQueryRef.current) === query;
        setFindBusy(true);
        try {
          const hits = await collectFindHits(query, job, alive);
          if (!alive()) return;
          findHitsRef.current = hits;
          findSearchedRef.current = query;
          setFindHits(hits);
          if (!hits.length) {
            setFindAt(-1);
            findAtRef.current = -1;
            clearFindOverlays();
            notify(t('find.noMatches'));
            return;
          }
          const pageNow = Number(pdfStateRef.current?.viewer?.currentPageNumber) || Number(pageNum) || 1;
          const start = delta < 0
            ? hits.findLastIndex((hit) => hit.page <= pageNow)
            : hits.findIndex((hit) => hit.page >= pageNow);
          showFindHit(start >= 0 ? start : (delta < 0 ? hits.length - 1 : 0), hits);
        } finally {
          if (findRunRef.current === run) setFindBusy(false);
        }
      };
      const stepFind = (delta) => {
        const query = normText(findQueryRef.current);
        if (!query || findBusy) return;
        const hits = findHitsRef.current;
        if (!hits.length || query !== findSearchedRef.current) {
          void runFind(delta);
          return;
        }
        const start = findAtRef.current;
        const next = start < 0 ? (delta < 0 ? hits.length - 1 : 0) : (start + delta + hits.length) % hits.length;
        showFindHit(next, hits);
      };
      const resetFindResults = () => {
        findRunRef.current++;
        findScrollRef.current = null;
        setFindBusy(false);
        findSearchedRef.current = '';
        setFindHits([]);
        findHitsRef.current = [];
        setFindAt(-1);
        findAtRef.current = -1;
        clearFindOverlays();
      };
      const clearFind = () => {
        setFindQuery('');
        findQueryRef.current = '';
        resetFindResults();
      };
      // (v20 #3) Zoom percentage. `zoomPct` is the committed value and mirrors
      // `viewer.currentScale`; `zoomDraft` holds what is currently being typed, so
      // typing "1" on the way to "150" does not jump the page to 25 % first. The
      // pdf.js `scalechanging` event keeps `zoomPct` correct for every other path
      // (Ctrl+wheel, the +/- buttons, a preset).
      const [zoomPct, setZoomPct] = React.useState(100);
      const [zoomDraft, setZoomDraft] = React.useState(null);
      // (v28 #3, revised) The merged zoom control keeps its preset list open or closed.
      const [zoomMenuOpen, setZoomMenuOpen] = React.useState(false);
      const zoomBoxRef = React.useRef(null);
      const applyZoomPct = (pct) => {
        const s = pdfStateRef.current;
        const numeric = Number(pct);
        if (!Number.isFinite(numeric)) return;
        const clamped = Math.max(ZOOM_MIN * 100, Math.min(ZOOM_MAX * 100, Math.round(numeric)));
        setZoomPct(clamped);
        if (!s || !s.viewer) return;
        try { s.viewer.currentScale = clamped / 100; } catch (_) {}
      };
      const commitZoomDraft = () => {
        if (zoomDraft == null) return;
        const raw = String(zoomDraft).trim();
        setZoomDraft(null);
        if (!raw) return;
        applyZoomPct(raw);
      };

      // (v28 #3, revised) Close the preset popup on any outside click / Escape. The
      // listener is only attached while the popup is open, so the toolbar stays free
      // of global handlers the rest of the time.
      React.useEffect(() => {
        if (!zoomMenuOpen) return undefined;
        const onDown = (event) => {
          const box = zoomBoxRef.current;
          const target = event && event.target;
          if (box && target && typeof box.contains === 'function' && box.contains(target)) return;
          setZoomMenuOpen(false);
        };
        const onKey = (event) => {
          if (event && event.key === 'Escape') setZoomMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [zoomMenuOpen]);

      // (v46) Appearance controls are all in ONE panel now. Previously the two
      // colour selects, the dock toggle and the inline-translation toggle each
      // took a slot in the toolbar, which made a row of six controls where five
      // of them were "look" and only one was "read". The panel closes on an
      // outside click or Escape, exactly like the zoom preset list above.
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const settingsBoxRef = React.useRef(null);
      React.useEffect(() => {
        if (!settingsOpen) return undefined;
        const onDown = (event) => {
          const box = settingsBoxRef.current;
          const target = event && event.target;
          if (box && target && typeof box.contains === 'function' && box.contains(target)) return;
          setSettingsOpen(false);
        };
        const onKey = (event) => {
          if (event && event.key === 'Escape') setSettingsOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [settingsOpen]);

      // (v46) One row of the settings panel: a label on the left, the control on
      // the right. `elr-settings-row` is a <label>, so clicking the text focuses
      // its select — the whole row is a hit target, not just the 12px control.
      const settingsRow = (key, label, control) => h('label', { key, className: 'elr-settings-row' },
        h('span', { className: 'elr-settings-label' }, label),
        h('span', { className: 'elr-settings-ctrl' }, control)
      );
      // (v46) A two-option segmented control for the panel's switches. `active`
      // is what `--dsw-alias-brand-primary` hangs off, so the current choice is
      // readable at a glance instead of being inferred from the button text.
      const settingsSeg = (key, options, current, onPick) => h('span', { key, className: 'elr-settings-seg' },
        options.map((opt) => h('button', {
          key: opt.value,
          className: 'elr-seg' + (opt.value === current ? ' active' : ''),
          onClick: (e) => { e.preventDefault(); onPick(opt.value); },
        }, opt.label))
      );

      const zoom = (dir) => {
        const s = pdfStateRef.current;
        if (!s || !s.viewer) return;
        try {
          const v = s.viewer;
          v.currentScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (v.currentScale || 1) * (dir > 0 ? 1.2 : 1 / 1.2)));
        } catch (_) {}
      };

      // (v23 #1) Highlight and annotation are INDEPENDENT. Adding one never turns on
      // the other, and removing one never removes the other. A record that ends up
      // with neither flag is pruned, so the list only holds real content.
      // (v23 #1) A record is EITHER a highlight OR an annotation — never both.
      // `findMarkByText` therefore only matches a record of the requested kind, so
      // highlighting a sentence that is already annotated creates a second,
      // independent record instead of mutating the annotation.
      const markKind = (m) => (m && (m.kind === 'note' || (m.note && m.note.trim())) ? 'note' : 'hl');
      const findMarkByText = (value, kind) => {
        const needle = normText(value);
        if (!needle) return null;
        const list = marksRef.current || [];
        for (let i = 0; i < list.length; i++) {
          if (markKind(list[i]) === kind && normText(list[i].text) === needle) return list[i];
        }
        return null;
      };
      const writeMarks = (next) => {
        marksRef.current = next;
        setMarks(next);
        saveMarks(paperIdRef.current, next);
        applyHighlights();
      };
      const pruneMarks = () => {
        const list = marksRef.current || [];
        const kept = list.filter((m) => m.hl === true || String(m.note || '').trim());
        if (kept.length !== list.length) writeMarks(kept);
      };
      const newMarkId = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
      // Yellow band only. An annotation on the same sentence is a DIFFERENT record
      // and is left completely untouched.
      const addHighlight = (source = selection) => {
        const value = String(source || '').trim();
        if (!value) { notify(t('selection.empty'), 'error'); return; }
        setMenu(null);
        const existing = findMarkByText(value, 'hl');
        if (existing) {
          notify(t('mark.saved'), 'ok');
          return;
        }
        writeMarks([{ id: newMarkId(), text: value, kind: 'hl', note: '', hl: true }]
          .concat(marksRef.current || []).slice(0, 120));
        notify(t('mark.saved'), 'ok');
      };
      // Annotation only. It never adds a highlight.
      const addNote = (source = selection, rect = null) => {
        const value = String(source || '').trim();
        if (!value) { notify(t('selection.empty'), 'error'); return; }
        setMenu(null);
        const existing = findMarkByText(value, 'note');
        let id;
        if (existing) {
          id = existing.id;
        } else {
          id = newMarkId();
          writeMarks([{ id, text: value, kind: 'note', note: '', hl: false }]
            .concat(marksRef.current || []).slice(0, 120));
        }
        setNoteBubble(placeNoteBubble(id, value, existing?.note || '', rect));
      };
      // Only ever touches annotation records.
      const updateNote = (id, value) => {
        const list = marksRef.current || [];
        const target = list.find((m) => m.id === id);
        if (!target || markKind(target) !== 'note') return;
        const note = String(value == null ? '' : value);
        // An annotation with an empty body is not an annotation: drop the record so
        // the list matches what is drawn (nothing).
        if (!note.trim()) {
          writeMarks(list.filter((m) => m.id !== id));
          return;
        }
        writeMarks(list.map((m) => (m.id === id ? Object.assign({}, m, { note }) : m)));
      };
      // (v23 #1) Removing the yellow band deletes ONLY the highlight record.
      const removeHighlight = (id) => {
        const list = marksRef.current || [];
        const target = list.find((m) => m.id === id);
        if (!target) return;
        if (markKind(target) !== 'hl') return;
        writeMarks(list.filter((m) => m.id !== id));
      };
      // (v23 #1) Clearing an annotation deletes ONLY the annotation record.
      const clearNote = (id) => {
        const list = marksRef.current || [];
        const target = list.find((m) => m.id === id);
        if (!target) return;
        if (markKind(target) !== 'note') return;
        writeMarks(list.filter((m) => m.id !== id));
      };
      const removeMark = (id) => {
        writeMarks((marksRef.current || []).filter((m) => m.id !== id));
      };

      // (v22) Jump the reading view to an annotation.
      //
      // The right-hand panel lists marks whose text is a plain string; nothing
      // records WHERE in the PDF that string lived. So the location is recovered
      // the same way the highlights themselves are painted: by rebuilding the
      // per-page whitespace-stripped text index and searching for the mark text.
      // That keeps the feature correct even for marks restored from localStorage
      // after a reload, when no scroll position was ever saved.
      //
      // Order matters: the page must be switched BEFORE scrolling, because
      // pdf.js only lays out the target page once it is current; scrolling first
      // would land on the old page's coordinates.
      const scrollElementIntoView = (container, element) => {
        if (!container || !element) return;
        const box = container.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const top = container.scrollTop + (rect.top - box.top) - Math.max(40, box.height * 0.25);
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      };

      // (v24 #2) Resolve a record to its position in the document. Returns
      // `{ page, offset, el }` where `page` is 1-based and `offset` is the character
      // offset inside that page's flattened text — together they give a stable
      // reading-order key for sorting the 高亮与批注 list. Returns null when the text
      // cannot be found (e.g. the PDF is closed, or the page is not laid out yet).
      const locateMark = (mark) => {
        const text = String(mark && mark.text ? mark.text : '').trim();
        const needle = normText(text);
        const container = containerRef.current;
        if (!needle || needle.length < 3 || !container) return null;
        const pages = container.querySelectorAll('.pdfViewer .page');
        for (let p = 0; p < pages.length; p++) {
          const pageEl = pages[p];
          const spans = pageEl.querySelectorAll('.textLayer span');
          if (!spans.length) continue;
          const cached = pageIndexOf(pageEl, spans);
          const at = cached.pageText.indexOf(needle);
          if (at === -1) continue;
          let first = -1;
          for (let i = 0; i < spans.length; i++) {
            const from = cached.starts[i];
            const to = from + cached.texts[i].length;
            if (to > at) { first = i; break; }
          }
          if (first === -1) first = 0;
          return { page: p + 1, offset: at, el: spans[first] || null };
        }
        const head = needle.slice(0, 24);
        for (let p = 0; p < pages.length; p++) {
          const pageEl = pages[p];
          const spans = pageEl.querySelectorAll('.textLayer span');
          if (!spans.length) continue;
          const cached = pageIndexOf(pageEl, spans);
          const at = cached.pageText.indexOf(head);
          if (at === -1) continue;
          return { page: p + 1, offset: at, el: spans[0] || null };
        }
        return null;
      };

      const jumpToMark = (mark) => {
        const needle = normText(String(mark && mark.text ? mark.text : '').trim());
        const container = containerRef.current;
        const s = pdfStateRef.current;
        if (!needle || needle.length < 3 || !container || !s || !s.viewer) {
          notify(t('mark.locateFailed'), 'warn');
          return;
        }
        const hit = locateMark(mark);
        const hitEl = hit ? hit.el : null;
        const hitPage = hit ? hit.page : 0;
        if (!hitEl) {
          notify(t('mark.locateFailed'), 'warn');
          return;
        }
        try {
          s.viewer.currentPageNumber = hitPage;
          setPageNum(hitPage);
        } catch (_) {}
        // Wait one frame so pdf.js has swapped the page before measuring.
        const scroll = () => {
          const again = containerRef.current;
          if (!again) return;
          const el = again.querySelectorAll('.pdfViewer .page')[hitPage - 1];
          const spans = el ? el.querySelectorAll('.textLayer span') : null;
          let target = null;
          if (spans && spans.length) {
            const cached = pageIndexOf(el, spans);
            const at = cached.pageText.indexOf(needle);
            const head = at === -1 ? cached.pageText.indexOf(needle.slice(0, 24)) : at;
            if (head !== -1) {
              for (let i = 0; i < spans.length; i++) {
                const from = cached.starts[i];
                const to = from + cached.texts[i].length;
                if (to > head) { target = spans[i]; break; }
              }
            }
          }
          scrollElementIntoView(again, target || el);
        };
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(scroll);
        } else {
          setTimeout(scroll, 16);
        }
      };

      const cardWindowBox = (key, rect) => readShared().floatingCards[key] || {
        x: rect.left, y: rect.top,
        w: clampPopup(rect.width, 285, 440),
        h: clampPopup(rect.height, 210, 430),
      };

      const floatFunctionCard = (key, box, bounds) => {
        setFloatingBounds(bounds);
        setFrontCard(key);
        setFloatingCards((previous) => ({ ...previous, [key]: box }));
      };

      const dockFunctionCard = (key, target = null, after = false) => {
        const { floatingCards: previous, sectionOrder: saved } = readShared();
        const patch = {};
        if (previous[key]) {
          const next = { ...previous };
          delete next[key];
          patch.floatingCards = next;
        }
        if (target && target !== key) {
          const order = functionCardOrder(saved).filter((card) => card !== key);
          order.splice(order.indexOf(target) + (after ? 1 : 0), 0, key);
          patch.sectionOrder = order;
        }
        if (Object.keys(patch).length) writeShared(patch);
      };

      const toggleFunctionCardFloat = (key, open, event) => {
        if (event.detail !== 0) return;
        focusCardGripRef.current = key;
        if (readShared().floatingCards[key]) {
          dockFunctionCard(key);
          return;
        }
        const rect = event.currentTarget.closest('.elr-sec').getBoundingClientRect();
        const bounds = popupViewport();
        const size = cardWindowBox(key, rect);
        const box = placeFunctionCard({ ...size, x: (bounds.left + bounds.right - size.w) / 2 }, open, bounds);
        floatFunctionCard(key, { ...size, x: box.x, y: box.y }, bounds);
      };

      const beginCardDrag = (key, open) => (event) => {
        if (event.button !== 0 || event.isPrimary === false || cardGestureCancelRef.current) return;
        const grip = event.currentTarget;
        const card = grip.closest('.elr-sec');
        if (!card) return;
        const initial = card.getBoundingClientRect();
        const pointer = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const offsetX = startX - initial.left;
        const offsetY = startY - initial.top;
        const bounds = popupViewport();
        const wasFloating = Boolean(readShared().floatingCards[key]);
        const size = cardWindowBox(key, initial);
        const order = functionCardOrder(readShared().sectionOrder);
        const boxAt = (x, y) => placeFunctionCard({ ...size, x: x - offsetX, y: y - offsetY }, open, bounds);
        const dockAt = (x, y) => {
          const panel = sideTopElRef.current;
          if (!panel) return null;
          const rect = panel.getBoundingClientRect();
          if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
          const hit = document.elementsFromPoint(x, y).find((el) => panel.contains(el));
          if (!hit) return null;
          const targetCard = hit.closest('[data-elr-docked-card]');
          const target = targetCard?.dataset.elrDockedCard;
          if (!target || target === key) return { target: null, after: false };
          if (!wasFloating) return { target, after: order.indexOf(key) < order.indexOf(target) };
          const targetRect = targetCard.getBoundingClientRect();
          const after = dockRef.current === 'bottom' ? x >= (targetRect.left + targetRect.right) / 2
            : y >= (targetRect.top + targetRect.bottom) / 2;
          return { target, after };
        };

        let started = false;
        let hover = null;
        const painter = frameWriter(({ x, y }) => {
          const next = dockAt(x, y);
          if (Boolean(next) !== Boolean(hover) || next?.target !== hover?.target || next?.after !== hover?.after) {
            hover = next;
            setCardDrop(next);
          }
          const box = boxAt(x, y);
          const preview = cardGhostRef.current;
          if (preview) preview.style.transform = 'translate3d(' + box.x + 'px,' + box.y + 'px,0)';
        });
        const cleanup = () => {
          if (cardGestureCancelRef.current !== cleanup) return;
          cardGestureCancelRef.current = null;
          painter.cancel();
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('blur', cleanup);
          window.removeEventListener('keydown', onKey, true);
          grip.removeEventListener('lostpointercapture', cancel);
          try { if (grip.hasPointerCapture?.(pointer)) grip.releasePointerCapture(pointer); } catch (_) {}
          if (started) {
            gestureEnd();
            setGhost(null);
            setCardDrop(null);
          }
        };
        const move = (e) => {
          if (e.pointerId !== pointer) return;
          const { clientX: x, clientY: y } = e;
          if (!started) {
            if (Math.hypot(x - startX, y - startY) < 5) return;
            started = true;
            gestureStart();
            setTermBubble(null);
            setGhost({ key, ...boxAt(x, y) });
          }
          painter.push({ x, y });
        };
        const finish = (e) => {
          if (e.pointerId !== pointer) return;
          const { clientX: x, clientY: y } = e;
          const inside = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
          if (started && inside) {
            const target = dockAt(x, y);
            if (target) {
              dockFunctionCard(key, target.target, target.after);
            } else {
              const box = boxAt(x, y);
              floatFunctionCard(key, { ...size, x: box.x, y: box.y }, bounds);
            }
          }
          cleanup();
        };
        const cancel = (e) => { if (e.pointerId === pointer) cleanup(); };
        const onKey = (e) => {
          if (!started || e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          cleanup();
        };
        cardGestureCancelRef.current = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cleanup);
        window.addEventListener('keydown', onKey, true);
        grip.addEventListener('lostpointercapture', cancel);
        try { grip.setPointerCapture(pointer); } catch (_) {}
      };

      // (v32 #1, fixed in v32b #2) Per-card left/right edge drag.
      //
      // Two things made the first version dead:
      //   1. the grips were only rendered when `dock === 'bottom'`, so in the
      //      default right-hand dock there was nothing to grab at all;
      //   2. even in the bottom dock only a 5px right-hand strip existed and the
      //      last card's strip was `display: none` — so "拉左右边界" could not work.
      //
      // Now both edges of every card carry a grip. What it resizes depends on the
      // dock, because that is what "the card's width" means in each layout:
      //   • bottom dock  → this card's own width (`cardWidths`); siblings reflow.
      //   • right dock   → the card is full width, so the grip resizes the whole
      //                    card COLUMN (`sideWidth`) — the only meaningful width there.
      //
      // A pointerdown on a descendant of a `draggable` element can start a native
      // drag and steal the subsequent `pointermove`, hence `draggable: false` on the
      // grip plus `stopPropagation` here.
      //
      // Same gesture rule as the pane resizers: paint straight onto the DOM, commit
      // to shared state once on pointerup — one re-render per drag.
      const beginCardResize = (key, side) => (event) => {
        if (event.button !== 0) return;
        const grip = event.currentTarget;
        const card = grip && grip.closest ? grip.closest('.elr-sec') : null;
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        const dir = side === -1 ? -1 : 1;
        const startX = Number(event.clientX) || 0;
        const bottom = dockRef.current === 'bottom';
        const minWidth = bottom ? parseFloat(window.getComputedStyle(card).minWidth) || CARD_MIN_W : CARD_MIN_W;
        const maxWidth = key === 'selection' ? Math.max(minWidth, window.innerWidth - 16) : Infinity;
        const columnEl = bottom ? null : sideElRef.current;
        const startW = bottom
          ? card.getBoundingClientRect().width
          : (columnEl ? columnEl.getBoundingClientRect().width : SIDE_DEFAULT);
        let pending = startW;
        let active = true;
        // (v34 #2) One DOM write per animation frame, not per pointermove.
        const painter = frameWriter((px) => {
          if (bottom) {
            card.style.width = px + 'px';
            card.style.flex = '0 0 auto';
          } else if (columnEl) {
            columnEl.style.width = px + 'px';
          }
        });
        const apply = (px) => {
          pending = px;
          painter.push(px);
        };
        const move = (e) => {
          if (!active) return;
          const dx = ((Number(e.clientX) || 0) - startX) * dir;
          if (bottom) {
            apply(clampPopup(startW + dx, minWidth, maxWidth));
            return;
          }
          const body = card.parentElement;
          const max = body ? Math.max(SIDE_MIN, body.clientWidth - 360) : 900;
          apply(Math.max(SIDE_MIN, Math.min(max, startW + dx)));
        };
        const up = () => {
          if (!active) return;
          active = false;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          gestureEnd();
          painter.cancel();
          try { document.body.style.userSelect = ''; } catch (_) {}
          if (bottom) setCardWidths((prev) => Object.assign({}, prev, { [key]: Math.round(pending) }));
          else setSideWidth(Math.round(pending));
        };
        try { document.body.style.userSelect = 'none'; } catch (_) {}
        gestureStart();
        try { grip.setPointerCapture(event.pointerId); } catch (_) {}
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      };

      // (v38 #1) Per-card BOTTOM edge drag, right dock only.
      //
      // v37 made the stacked cards share the column height evenly
      // (`.elr-side-body > .elr-sec { flex: 1 1 auto }`). That is the right default,
      // but it means "this card is taller" had nowhere to live: an even split is
      // recomputed on every layout. So a stored pixel height pins ONE card
      // (`flex: 0 0 auto`) and lets the others divide the remainder.
      //
      // The gesture follows the same rule as every other resize here: paint straight
      // onto the DOM once per frame, commit to shared state once on pointerup.
      const beginCardHeightResize = (key) => (event) => {
        if (event.button !== 0) return;
        const grip = event.currentTarget;
        const card = grip && grip.closest ? grip.closest('.elr-sec') : null;
        if (!card) return;
        event.preventDefault();
        event.stopPropagation();
        const startY = Number(event.clientY) || 0;
        const minHeight = parseFloat(window.getComputedStyle(card).minHeight) || CARD_MIN_H;
        const startH = card.getBoundingClientRect().height || minHeight;
        const body = card.parentElement;
        // Leave room for the cards below: never let one card swallow the column.
        const maxH = () => {
          const total = body ? body.clientHeight : 600;
          return Math.max(minHeight, startH, total - 84);
        };
        let pending = Math.round(startH);
        let active = true;
        const painter = frameWriter((px) => {
          card.style.height = px + 'px';
          card.style.flex = '0 0 auto';
        });
        const apply = (px) => {
          pending = px;
          painter.push(px);
        };
        const move = (e) => {
          if (!active) return;
          const dy = (Number(e.clientY) || 0) - startY;
          apply(clampPopup(startH + dy, minHeight, maxH()));
        };
        const up = () => {
          if (!active) return;
          active = false;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          gestureEnd();
          painter.cancel();
          try { document.body.style.userSelect = ''; } catch (_) {}
          setCardHeights((prev) => Object.assign({}, prev, { [key]: Math.round(pending) }));
        };
        try { document.body.style.userSelect = 'none'; } catch (_) {}
        gestureStart();
        try { grip.setPointerCapture(event.pointerId); } catch (_) {}
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      };

      // (v32 #1) Below this the card content (a textarea, a filename, a URL) is
      // unreadable, so the per-card width drag refuses to go narrower.
      const CARD_MIN_W = 140;
      // (v38 #1) Floor for the per-card height drag. It matches the CSS floor
      // `.elr-side-body > .elr-sec { min-height: 84px }` so the two can never
      // disagree — a card dragged below this would look stuck at the stylesheet
      // minimum while the stored value kept shrinking.
      const CARD_MIN_H = 84;
      const cardLabel = (key) => (
        key === 'selection' ? t('selection.title')
          : key === 'recent' ? t('recent.title')
            : key === 'terms' ? t('term.cardTitle')
              : t('mark.title')
      );
      const enabledCards = CARD_KEYS.filter((key) => Array.isArray(cards) && cards.indexOf(key) !== -1);
      const setCardEnabled = (key, on) => {
        if (CARD_KEYS.indexOf(key) === -1) return;
        const current = Array.isArray(cards) ? cards : [];
        const has = current.indexOf(key) !== -1;
        if (on === has) return;
        const next = on ? CARD_KEYS.filter((k) => k === key || current.indexOf(k) !== -1)
          : current.filter((k) => k !== key);
        if (on) { writeShared({ cards: next }); return; }
        const detached = { ...readShared().floatingCards };
        delete detached[key];
        writeShared({ cards: next, floatingCards: detached });
      };
      // Closing a card has to be undoable from ONE place, so the header gets a ×
      // that simply disables it; the ⚙ entry in the column head brings it back.
      const closeCard = (key) => setCardEnabled(key, false);
      const closeCardMenu = (restoreFocus = false) => {
        setCardMenuOpen(false);
        if (restoreFocus) cardMenuButtonRef.current?.focus({ preventScroll: true });
      };
      const resetCardLayout = () => {
        const fields = ['sectionOrder', 'cards', 'floatingCards', 'cardWidths', 'cardHeights', 'sideWidth', 'sideHeight',
          'sideTopWidth', 'sideTopHeight', 'selectionSplit', 'selectionWidthSplit', 'selectionCardOpen'];
        writeShared(Object.fromEntries(fields.map((key) => [key, DEFAULT_SHARED[key]])));
        setRecentOpen(true);
        setMarksOpen(true);
        setTermsOpen(true);
        closeCardMenu(true);
      };

      // (#5 / v8 #5) Drag-to-pan on BOTH axes. The pan tool can be toggled on, and
      // holding Ctrl turns any left-drag into a pan even when the tool is off, so
      // zooming in with Ctrl+wheel and then repositioning needs no mode switch.
      React.useEffect(() => {
        if (mode !== 'pdf') return;
        const el = containerRef.current;
        if (!el) return;
        let ctrl = false;
        let startX = 0, startY = 0, left = 0, top = 0, dragging = false;
        const ctrlDown = (e) => { if (e.key === 'Control' || e.ctrlKey) ctrl = true; };
        const ctrlUp = (e) => { if (e.key === 'Control' || !e.ctrlKey) ctrl = false; };
        const blur = () => { ctrl = false; };
        const canPan = (e) => panMode || ctrl || e.ctrlKey || e.metaKey;
        const down = (e) => {
          if (e.button !== 0 || figurePickingRef.current) return;
          if (!canPan(e)) return;
          dragging = true;
          startX = e.clientX; startY = e.clientY;
          left = el.scrollLeft; top = el.scrollTop;
          el.classList.add('panning');
          el.setPointerCapture && el.setPointerCapture(e.pointerId);
          e.preventDefault();
          // A Ctrl+drag would otherwise start a text selection in the text layer.
          try { window.getSelection && window.getSelection().removeAllRanges(); } catch (_) {}
        };
        const move = (e) => {
          if (!dragging) return;
          el.scrollLeft = left - (e.clientX - startX);
          el.scrollTop = top - (e.clientY - startY);
        };
        const up = () => { dragging = false; el.classList.remove('panning'); };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        window.addEventListener('keydown', ctrlDown);
        window.addEventListener('keyup', ctrlUp);
        window.addEventListener('blur', blur);
        return () => {
          el.removeEventListener('pointerdown', down);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          window.removeEventListener('keydown', ctrlDown);
          window.removeEventListener('keyup', ctrlUp);
          window.removeEventListener('blur', blur);
          el.classList.remove('panning');
        };
      }, [mode, panMode, hasPdf]);

      const hasPaper = mode === 'pdf' ? hasPdf : Boolean(text.trim());
      const showPdfStart = mode === 'pdf' && !hasPaper;
      const shownTerm = termBubble?.paper === paperId && hasPaper && termsOpen
        && enabledCards.includes('terms') && !floatingCards.terms ? terms.find((item) => item.id === termBubble.id) : null;

      const closeTermBubble = (restoreFocus = false) => {
        setTermBubble(null);
        if (restoreFocus && termBubble?.anchor.isConnected) termBubble.anchor.focus({ preventScroll: true });
      };

      React.useEffect(() => {
        if (!hasPaper || !ownsCardWindows) cardGestureCancelRef.current?.();
      }, [hasPaper, ownsCardWindows]);

      React.useLayoutEffect(() => {
        if (!hasPaper) return;
        cardWindowHosts.add(floatingHost);
        if (!readCardWindowHost()) selectCardWindowHost(floatingHost);
        return () => {
          cardWindowHosts.delete(floatingHost);
          if (readCardWindowHost() === floatingHost) selectCardWindowHost(cardWindowHosts.values().next().value || null);
        };
      }, [hasPaper, floatingHost]);

      React.useLayoutEffect(() => {
        if (ownsCardWindows && Object.keys(readShared().floatingCards).length) setFloatingBounds(popupViewport());
      }, [ownsCardWindows]);

      React.useLayoutEffect(() => {
        const key = focusCardGripRef.current;
        if (!key) return;
        const isFloating = Boolean(floatingCards[key]);
        const root = isFloating ? floatingHost : sideTopElRef.current;
        const grip = root?.querySelector((isFloating ? '[data-elr-floating-card="' : '[data-elr-docked-card="') + key + '"] .elr-grip');
        if (!grip) return;
        focusCardGripRef.current = null;
        grip.focus({ preventScroll: true });
      }, [floatingCards, floatingHost, ownsCardWindows]);

      React.useLayoutEffect(() => {
        if (!termBubble) return;
        const bubble = termBubbleRef.current;
        const trigger = termBubble.anchor;
        const row = trigger.closest('.elr-term-row');
        const card = row?.closest('.elr-sec');
        const strip = row?.closest('.elr-side-body');
        const list = row?.closest('.elr-terms-list');
        if (!shownTerm || !bubble || !card || !strip || !list) { closeTermBubble(); return; }
        const updatePosition = () => {
          if (!trigger.isConnected) { closeTermBubble(); return; }
          const bounds = popupViewport();
          const stripRect = strip.getBoundingClientRect();
          const anchor = dock === 'bottom' ? trigger : row;
          const clips = [anchor.getBoundingClientRect(), list.getBoundingClientRect(), stripRect, bounds];
          const rect = {
            left: Math.max(...clips.map((box) => box.left)),
            top: Math.max(...clips.map((box) => box.top)),
            right: Math.min(...clips.map((box) => box.right)),
            bottom: Math.min(...clips.map((box) => box.bottom)),
          };
          if (rect.right <= rect.left || rect.bottom <= rect.top) { closeTermBubble(); return; }
          const label = trigger.querySelector('.elr-term-name')?.getBoundingClientRect();
          if (label) {
            rect.anchorX = clampPopup((label.left + label.right) / 2, rect.left, rect.right);
            if (dock === 'bottom') rect.anchorY = clampPopup((label.top + label.bottom) / 2, rect.top, rect.bottom);
          }
          const cardBox = card.getBoundingClientRect();
          const cardRect = {
            left: Math.max(cardBox.left, stripRect.left), right: Math.min(cardBox.right, stripRect.right),
            top: Math.max(cardBox.top, stripRect.top), bottom: Math.min(cardBox.bottom, stripRect.bottom),
          };
          const fit = termPopoverSpace(rect, bounds, cardRect, dock);
          if (fit.width < 60 || fit.maxHeight < 36) { closeTermBubble(); return; }
          bubble.style.width = fit.width + 'px';
          bubble.style.maxHeight = fit.maxHeight + 'px';
          const height = bubble.getBoundingClientRect().height;
          const side = fit.side === 'left' || fit.side === 'right';
          const y = side ? clampPopup(fit.centerY - height / 2, bounds.top, bounds.bottom - height)
            : fit.edgeY - (fit.side === 'above' ? height : 0);
          const arrow = side ? clampPopup(fit.centerY - y, 10, height - 10)
            : clampPopup(fit.centerX - fit.x, 10, fit.width - 10);
          bubble.style.left = fit.x + 'px';
          bubble.style.top = y + 'px';
          bubble.style.setProperty('--elr-term-arrow', arrow + 'px');
          bubble.dataset.side = fit.side;
        };
        const painter = frameWriter(updatePosition);
        const reflow = (event) => {
          const target = event?.target;
          if (target === list || target === strip) { updatePosition(); return; }
          if (target instanceof Node && bubble.contains(target)) return;
          painter.push(true);
        };
        const dismissOutside = (event) => {
          if (!bubble.contains(event.target) && !trigger.contains(event.target)) closeTermBubble();
        };
        const dismissEscape = (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          closeTermBubble(true);
        };
        updatePosition();
        if (termBubble.keyboard && document.activeElement === trigger) bubble.focus({ preventScroll: true });
        document.addEventListener('pointerdown', dismissOutside, true);
        document.addEventListener('keydown', dismissEscape);
        document.addEventListener('fullscreenchange', reflow);
        window.addEventListener('resize', reflow);
        window.addEventListener('scroll', reflow, true);
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', reflow);
        viewport?.addEventListener('scroll', reflow);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reflow) : null;
        for (const el of [row, list, strip, card, bubble]) observer?.observe(el);
        return () => {
          painter.cancel();
          document.removeEventListener('pointerdown', dismissOutside, true);
          document.removeEventListener('keydown', dismissEscape);
          document.removeEventListener('fullscreenchange', reflow);
          window.removeEventListener('resize', reflow);
          window.removeEventListener('scroll', reflow, true);
          viewport?.removeEventListener('resize', reflow);
          viewport?.removeEventListener('scroll', reflow);
          observer?.disconnect();
        };
      }, [termBubble, shownTerm, dock, terms, sectionOrder, cards, floatingCards]);

      React.useEffect(() => {
        const panel = sideTopElRef.current;
        const strip = panel?.querySelector('.elr-side-body');
        if (!strip) return;
        const hideTimers = new Map();
        const showScrollbar = (event) => {
          const scroller = event.target;
          clearTimeout(hideTimers.get(scroller));
          scroller.classList.add('elr-scrolling');
          hideTimers.set(scroller, setTimeout(() => {
            scroller.classList.remove('elr-scrolling');
            hideTimers.delete(scroller);
          }, 650));
        };
        const scrollAcross = (event) => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.deltaX || !event.deltaY) return;
          const list = event.target.closest?.('.elr-terms-list.is-vertical, .elr-marks-list.is-horizontal');
          if (!list && event.target.closest?.('.elr-sec, button, input, select, textarea')) return;
          const scroller = list || strip;
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientWidth : 1;
          const before = scroller.scrollLeft;
          scroller.scrollLeft += event.deltaY * unit;
          if (scroller.scrollLeft !== before) event.preventDefault();
        };
        strip.addEventListener('scroll', showScrollbar, { capture: true, passive: true });
        if (dock === 'bottom') panel.addEventListener('wheel', scrollAcross, { passive: false });
        return () => {
          strip.removeEventListener('scroll', showScrollbar, true);
          panel.removeEventListener('wheel', scrollAcross);
          for (const [scroller, timer] of hideTimers) {
            clearTimeout(timer);
            scroller.classList.remove('elr-scrolling');
          }
        };
      }, [dock, hasPaper]);

      React.useLayoutEffect(() => {
        if (!cardMenuOpen) return;
        const menu = cardMenuRef.current;
        const trigger = cardMenuButtonRef.current;
        if (!hasPaper || !menu || !trigger) { closeCardMenu(); return; }
        const updatePosition = () => {
          const bounds = popupViewport();
          const anchor = trigger.getBoundingClientRect();
          const width = Math.min(232, bounds.right - bounds.left);
          const belowY = clampPopup(anchor.bottom + 6, bounds.top, bounds.bottom);
          const aboveY = clampPopup(anchor.top - 6, bounds.top, bounds.bottom);
          menu.style.width = width + 'px';
          const spaceBelow = bounds.bottom - belowY;
          const spaceAbove = aboveY - bounds.top;
          const opensUp = menu.scrollHeight + 2 > spaceBelow && spaceAbove > spaceBelow;
          menu.style.maxHeight = (opensUp ? spaceAbove : spaceBelow) + 'px';
          menu.style.left = clampPopup(anchor.right - width, bounds.left, bounds.right - width) + 'px';
          menu.style.top = (opensUp ? aboveY - menu.offsetHeight : belowY) + 'px';
        };
        const dismissOutside = (event) => {
          if (!menu.contains(event.target) && !trigger.contains(event.target)) closeCardMenu();
        };
        const dismissOnEscape = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          closeCardMenu(true);
        };
        updatePosition();
        menu.querySelector('input')?.focus({ preventScroll: true });
        document.addEventListener('pointerdown', dismissOutside, true);
        document.addEventListener('focusin', dismissOutside);
        document.addEventListener('keydown', dismissOnEscape);
        window.addEventListener('resize', updatePosition);
        document.addEventListener('fullscreenchange', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', updatePosition);
        viewport?.addEventListener('scroll', updatePosition);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updatePosition) : null;
        if (sideTopElRef.current) observer?.observe(sideTopElRef.current);
        return () => {
          document.removeEventListener('pointerdown', dismissOutside, true);
          document.removeEventListener('focusin', dismissOutside);
          document.removeEventListener('keydown', dismissOnEscape);
          window.removeEventListener('resize', updatePosition);
          document.removeEventListener('fullscreenchange', updatePosition);
          window.removeEventListener('scroll', updatePosition, true);
          viewport?.removeEventListener('resize', updatePosition);
          viewport?.removeEventListener('scroll', updatePosition);
          observer?.disconnect();
        };
      }, [cardMenuOpen, hasPaper]);

      // Move the separator as a preview. The two panes keep their layout
      // until release, so PDF.js has only one viewport resize to handle.
      React.useEffect(() => {
        const handle = resizeRef.current;
        const side = sideElRef.current;
        if (!handle || !side || !handle.parentElement) return;
        const bottom = dock === 'bottom';
        const dimension = bottom ? 'height' : 'width';
        const coordinate = (event) => bottom ? event.clientY : event.clientX;
        const body = handle.parentElement;
        let drag = null;
        const readLimits = () => {
          const total = bottom ? body.clientHeight : body.clientWidth;
          const divider = bottom ? handle.offsetHeight : handle.offsetWidth;
          const start = Math.round(side.getBoundingClientRect()[dimension]);
          if (!total || !start) return null;
          const min = Math.min(start, bottom ? SIDE_H_MIN : SIDE_MIN);
          const readerMinimum = bottom ? 200 : 360;
          const layoutMax = bottom ? total : Math.floor(total * 0.7);
          const max = Math.max(start, min, Math.min(layoutMax, total - readerMinimum - divider));
          return { start, min, max };
        };
        const syncValue = (limits, value = limits.start) => {
          handle.setAttribute('aria-valuemin', String(limits.min));
          handle.setAttribute('aria-valuemax', String(limits.max));
          handle.setAttribute('aria-valuenow', String(value));
        };
        const syncCurrent = () => {
          const limits = drag ? drag.limits : readLimits();
          if (limits) syncValue(limits);
        };
        const sizeAt = (value, limits) => Math.round(Math.max(limits.min, Math.min(limits.max, value)));
        const commit = (size, limits) => {
          syncValue(limits, size);
          if (size === limits.start) return;
          side.style[dimension] = size + 'px';
          if (bottom) setSideHeight(size);
          else setSideWidth(size);
        };
        const painter = frameWriter((delta) => {
          handle.style.transform = bottom ? 'translate3d(0,' + delta + 'px,0)' : 'translate3d(' + delta + 'px,0,0)';
        });
        const down = (event) => {
          if (event.button !== 0 || event.isPrimary === false || drag) return;
          const limits = readLimits();
          if (!limits) return;
          drag = { id: event.pointerId, origin: coordinate(event), limits };
          handle.focus({ preventScroll: true });
          handle.classList.add('active');
          handle.style.willChange = 'transform';
          try { handle.setPointerCapture(event.pointerId); } catch (_) {}
          event.preventDefault();
        };
        const previewSize = (event) => sizeAt(drag.limits.start + drag.origin - coordinate(event), drag.limits);
        const move = (event) => {
          if (drag && event.pointerId === drag.id) painter.push(drag.limits.start - previewSize(event));
        };
        const finish = (size) => {
          if (!drag) return;
          const { id, limits } = drag;
          drag = null;
          painter.cancel();
          if (size !== undefined) commit(size, limits);
          handle.style.transform = '';
          handle.style.willChange = '';
          handle.classList.remove('active');
          if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture(id);
        };
        const up = (event) => {
          if (drag && event.pointerId === drag.id) finish(previewSize(event));
        };
        const cancel = (event) => {
          if (drag && (event.pointerId == null || event.pointerId === drag.id)) finish();
        };
        const onKey = (event) => {
          if (event.key === 'Escape' && drag) {
            finish();
            event.preventDefault();
            return;
          }
          const towardReader = bottom ? 'ArrowUp' : 'ArrowLeft';
          const awayFromReader = bottom ? 'ArrowDown' : 'ArrowRight';
          if (drag || ![towardReader, awayFromReader, 'Home', 'End'].includes(event.key)) return;
          const limits = readLimits();
          if (!limits) return;
          const step = event.shiftKey ? 48 : 16;
          const size = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max
            : sizeAt(limits.start + (event.key === towardReader ? step : -step), limits);
          commit(size, limits);
          event.preventDefault();
        };
        syncCurrent();
        handle.addEventListener('pointerdown', down);
        handle.addEventListener('lostpointercapture', cancel);
        handle.addEventListener('focus', syncCurrent);
        handle.addEventListener('keydown', onKey);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        window.addEventListener('resize', cancel);
        return () => {
          finish();
          handle.removeEventListener('pointerdown', down);
          handle.removeEventListener('lostpointercapture', cancel);
          handle.removeEventListener('focus', syncCurrent);
          handle.removeEventListener('keydown', onKey);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('blur', cancel);
          window.removeEventListener('resize', cancel);
        };
      }, [dock, hasPaper]);

      // (v8 #6) Splitter between the upper side block (selection card + movable
      // sections) and the translation/analysis area. Without it the two halves
      // were laid out by flexbox alone and could not be resized at all.
      // (v25 #3) The divider follows the dock axis: docked right it splits
      // vertically (a height), docked bottom the two halves sit SIDE BY SIDE and it
      // splits horizontally (a width), which is what the horizontal layout needs.
      // The splitter is mounted with the document tools.
      React.useEffect(() => {
        const handle = splitRef.current;
        if (!handle) return;
        let startX = 0, startY = 0, startSize = 0, active = false, pending = 0;
        // (v32 #3) Same gesture-perf rule as the pane resizer above: paint straight
        // onto the element while dragging, commit to shared state on pointerup.
        // (v34 #2) …and coalesce the painting to one write per animation frame.
        const painter = frameWriter((px) => {
          const el = sideTopElRef.current;
          if (!el) return;
          if (dockRef.current === 'bottom') el.style.width = px + 'px';
          else el.style.height = px + 'px';
        });
        const apply = (px) => {
          pending = px;
          painter.push(px);
        };
        const down = (e) => {
          if (e.button !== 0) return;
          active = true;
          startX = e.clientX;
          startY = e.clientY;
          startSize = dockRef.current === 'bottom' ? sideTopWidthRef.current : sideTopHeightRef.current;
          pending = startSize;
          handle.classList.add('active');
          gestureStart();
          e.preventDefault();
          // (v29 fix) Keep receiving the drag when the pointer leaves the 6px bar,
          // and stop the browser from starting a text selection on the way.
          try { handle.setPointerCapture(e.pointerId); } catch (_) {}
          try { document.body.style.userSelect = 'none'; } catch (_) {}
        };
        const move = (e) => {
          if (!active) return;
          if (dockRef.current === 'bottom') {
            const pane = handle.parentElement;
            const total = pane ? pane.clientWidth : 900;
            const max = Math.max(SIDE_TOP_MIN + 40, total - 260);
            apply(Math.max(SIDE_TOP_MIN, Math.min(max, startSize + (e.clientX - startX))));
            return;
          }
          const pane = handle.parentElement;
          const total = pane ? pane.clientHeight : 600;
          const max = Math.max(SIDE_TOP_MIN + 40, total - 160);
          apply(Math.max(SIDE_TOP_MIN, Math.min(max, startSize + (e.clientY - startY))));
        };
        const up = () => {
          if (!active) return;
          active = false;
          handle.classList.remove('active');
          gestureEnd();
          painter.cancel();
          try { document.body.style.userSelect = ''; } catch (_) {}
          if (dockRef.current === 'bottom') setSideTopWidth(pending);
          else setSideTopHeight(pending);
          flushSnapshot();
        };
        handle.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
          handle.removeEventListener('pointerdown', down);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
      }, [mode, dock, hasPaper]);

      const modelSelection = describeModelSelection(bodyRef.current());

      const providers = catalog && Array.isArray(catalog.providers) ? catalog.providers : [];
      const providerRow = providers.find((x) => x.id === selProvider);
      const modelList = providerRow && Array.isArray(providerRow.models) ? providerRow.models : [];
      const effortList = efforts && Array.isArray(efforts.efforts) ? efforts.efforts : [];
      const followLabel = (efforts && efforts.defaultEffort)
        ? t('effort.followNamed').replace('{effort}', efforts.defaultEffort)
        : t('effort.follow');

      const onProviderChange = (e) => {
        const p = e.target.value;
        const row = providers.find((x) => x.id === p);
        const models = row && Array.isArray(row.models) ? row.models : [];
        const m = models.length ? models[0].id : '';
        setSelProvider(p);
        setSelModel(m);
        setSelEffort('');
        setEfforts(null);
        setModelPicked(true);
        writeStore(MODEL_PICKED_KEY, true);
        persistModel(p, m, '');
      };
      const onModelChange = (e) => {
        const m = e.target.value;
        setSelModel(m);
        setSelEffort('');
        setEfforts(null);
        setModelPicked(true);
        writeStore(MODEL_PICKED_KEY, true);
        persistModel(selProvider, m, '');
      };
      const onEffortChange = (e) => {
        const v = e.target.value;
        setSelEffort(v);
        setModelPicked(true);
        writeStore(MODEL_PICKED_KEY, true);
        persistModel(selProvider, selModel, v);
      };

      const modelControl = (label, select) => h('label', { className: 'elr-head-model' },
        h('span', { className: 'elr-select-label' }, t(label)), select
      );
      const fullscreenLabel = t(isFullscreen ? 'fullscreen.exit' : 'fullscreen.enter');
      const head = h('div', { className: 'elr-head' },
        h('div', { className: 'elr-head-identity' },
          h('span', { className: 'elr-launcher-dot', 'aria-hidden': true }),
          h('span', { className: 'elr-title' }, t('title')),
          h('div', { className: 'elr-segment' },
            ['pdf', 'text'].map((key) => h('button', {
              key,
              className: 'elr-seg' + (mode === key ? ' active' : ''),
              onClick: () => selectReaderMode(key),
            }, t('source.' + key)))
          )
        ),
        h('div', { className: 'elr-head-models' },
          modelControl('model.provider', h('select', {
            className: 'elr-select elr-select-provider',
            value: selProvider,
            title: providerRow?.name || selProvider || undefined,
            disabled: !providers.length,
            onChange: onProviderChange,
          }, providers.length
            ? providers.map((x) => h('option', { key: x.id, value: x.id }, x.name))
            : h('option', { value: '' }, t('models.loading')))),
          modelControl('model.model', h('select', {
            className: 'elr-select',
            value: selModel,
            title: modelList.find((item) => item.id === selModel)?.name || selModel || undefined,
            disabled: !modelList.length,
            onChange: onModelChange,
          }, modelList.length
            ? modelList.map((x) => h('option', { key: x.id, value: x.id }, x.name))
            : h('option', { value: '' }, t('models.loading')))),
          modelControl('effort.label', h('select', {
            className: 'elr-select elr-select-effort',
            value: selEffort,
            title: effortList.find((item) => item.id === selEffort)?.name || selEffort || followLabel,
            onChange: onEffortChange,
          }, h('option', { key: '', value: '' }, followLabel),
            effortList.map((x) => h('option', { key: x.id, value: x.id }, x.name || x.id))
          )),
          h('button', {
            className: 'elr-btn' + (showCustom ? ' active' : ''),
            'aria-expanded': showCustom,
            onClick: () => { setShowCustom((v) => !v); setModelPicked(true); writeStore(MODEL_PICKED_KEY, true); },
          }, t('model.manual')),
          showCustom ? h('input', { className: 'elr-field', placeholder: t('providerPlaceholder'), 'aria-label': t('providerPlaceholder'), value: customProvider, onChange: (e) => setCustomProvider(e.target.value) }) : null,
          showCustom ? h('input', { className: 'elr-field', placeholder: t('modelPlaceholder'), 'aria-label': t('modelPlaceholder'), value: customModel, onChange: (e) => setCustomModel(e.target.value) }) : null
        ),
        h('div', { className: 'elr-head-actions' },
          h('button', {
            type: 'button', className: 'elr-icon-btn elr-fullscreen-btn',
            'aria-label': fullscreenLabel, title: fullscreenLabel, onClick: toggleFullscreen,
          }, h('span', { className: 'elr-fullscreen-icon' + (isFullscreen ? ' is-active' : ''), 'aria-hidden': true },
            h('span'), h('span'), h('span'), h('span')
          )),
          props.onMinimize ? h('button', { className: 'elr-icon-btn', onClick: props.onMinimize }, t('minimize')) : null,
          props.onClose ? h('button', { className: 'elr-icon-btn', onClick: props.onClose }, t('close')) : null
        ),
        h('input', { ref: pdfFileRef, type: 'file', accept: '.pdf,application/pdf', style: { display: 'none' }, onChange: onPdfFile }),
        h('input', { ref: txtFileRef, type: 'file', accept: '.txt,.md,.text,text/plain', style: { display: 'none' }, onChange: onTxtFile })
      );

      // (v46) The panel body is built ONCE and shared by both modes: PDF mode
      // adds the paper-theme row (there is a rendered page to tint), text mode
      // does not, but the other three rows are identical by construction.
      const settingsPanel = (withTheme) => h('div', { className: 'elr-settings-panel', role: 'dialog', 'aria-label': t('settings.panel') },
        h('div', { className: 'elr-settings-head' }, t('settings.title')),
        withTheme
          ? settingsRow('theme', t('theme.label'), h('select', {
              className: 'elr-select',
              value: theme,
              disabled: !hasPdf,
              onChange: (e) => setTheme(e.target.value),
            },
              PAGE_THEMES.map((key) => h('option', { key, value: key }, t('theme.' + key)))
            ))
          : null,
        settingsRow('tone', t('tone.label'), h('select', {
          className: 'elr-select',
          value: uiTone,
          onChange: (e) => setUiTone(e.target.value),
        },
          h('option', { value: 'default' }, t('tone.default')),
          Object.entries(UI_TONES).map(([group, tones]) => h('optgroup', { key: group, label: t('tone.' + group) },
            tones.map((tone) => h('option', { key: tone, value: tone }, t('tone.' + tone)))
          ))
        )),
        settingsRow('dock', t('dock.label'), settingsSeg('dock', [
          { value: 'right', label: t('dock.rightShort') },
          { value: 'bottom', label: t('dock.bottomShort') },
        ], dock, (next) => setDock(next))),
        settingsRow('popup', t('popup.label'), settingsSeg('popup', [
          { value: 'off', label: t('popup.offShort') },
          { value: 'on', label: t('popup.onShort') },
        ], popupOn ? 'on' : 'off', (next) => setPopupOn(next === 'on')))
      );
      // (v46) The single "appearance" entry point: one button plus, while open,
      // the panel directly beneath it. The panel lives INSIDE the button's span
      // so `settingsBoxRef` containment covers both, and so the absolute
      // positioning is relative to the button rather than the toolbar.
      const settingsWidget = (withTheme, ref) => h('span', {
        ref: ref || undefined,
        className: 'elr-settings' + (settingsOpen ? ' open' : ''),
      },
        h('button', {
          className: 'elr-btn elr-settings-btn' + (settingsOpen ? ' active' : ''),
          title: t('settings.hint'),
          onClick: (e) => { e.preventDefault(); setSettingsOpen((v) => !v); },
        },
          t('settings.title'),
          theme !== 'default' || uiTone !== 'default' ? h('span', { className: 'elr-settings-dot' }) : null
        ),
        settingsOpen ? settingsPanel(withTheme) : null
      );

      const openPdfPicker = () => pdfFileRef.current?.click();
      let mainToolbar;
      if (showPdfStart) {
        mainToolbar = h('div', { className: 'elr-toolbar elr-start-toolbar' }, settingsWidget(true, settingsBoxRef));
      } else if (mode === 'pdf') {
        const canStepFind = pdfAnalysisReady && !findBusy && Boolean(normText(findQuery))
          && (!findSearchedRef.current || findHits.length > 0);
        mainToolbar = h('div', { className: 'elr-toolbar' },
          h('button', { className: 'elr-btn', onClick: openPdfPicker }, t('pdf.open')),
          // (v25 #1) Close the current paper. Disabled when nothing is open so it
          // never looks like a no-op control.
          h('button', {
            className: 'elr-btn',
            disabled: !hasPdf && !String(text || '').trim(),
            title: t('pdf.closeHint'),
            onClick: closePaper,
          }, t('pdf.close')),
          h('button', { className: 'elr-btn', disabled: !hasPdf, onClick: () => goPage(-1) }, t('page.prev')),
          h('span', { className: 'elr-model' }, hasPdf ? pageNum + ' / ' + pageCount : '—'),
          h('button', { className: 'elr-btn', disabled: !hasPdf, onClick: () => goPage(1) }, t('page.next')),
          h('button', { className: 'elr-btn', disabled: !hasPdf, onClick: () => zoom(-1) }, t('zoom.out')),
          h('button', { className: 'elr-btn', disabled: !hasPdf, onClick: () => zoom(1) }, t('zoom.in')),
          // (v28 #3, revised) One merged control: type any percentage, or open the
          // caret for the presets. The native spinner stays suppressed because it
          // duplicated the 缩小 / 放大 buttons beside it.
          h('span', { ref: zoomBoxRef, className: 'elr-zoom' + (zoomMenuOpen ? ' open' : '') },
            h('input', {
              className: 'elr-zoom-input',
              type: 'number',
              min: Math.round(ZOOM_MIN * 100),
              max: Math.round(ZOOM_MAX * 100),
              step: 10,
              value: zoomDraft == null ? String(zoomPct) : zoomDraft,
              disabled: !hasPdf,
              title: t('zoom.input'),
              onChange: (e) => setZoomDraft(e.target.value),
              onBlur: commitZoomDraft,
              onKeyDown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitZoomDraft(); setZoomMenuOpen(false); }
                else if (e.key === 'Escape') { e.preventDefault(); setZoomDraft(null); setZoomMenuOpen(false); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setZoomMenuOpen(true); }
              },
            }),
            h('span', { className: 'elr-zoom-suffix' }, '%'),
            h('button', {
              className: 'elr-zoom-caret',
              disabled: !hasPdf,
              title: t('zoom.label'),
              onClick: (e) => { e.preventDefault(); setZoomMenuOpen((v) => !v); },
            }, zoomMenuOpen ? '▴' : '▾'),
            zoomMenuOpen
              ? h('div', { className: 'elr-zoom-menu' },
                  ZOOM_PRESETS.map((p) => h('button', {
                    key: p,
                    className: 'elr-zoom-item' + (p === zoomPct ? ' active' : ''),
                    onClick: (e) => { e.preventDefault(); setZoomDraft(null); applyZoomPct(p); setZoomMenuOpen(false); },
                  }, p + '%'))
                )
              : null
          ),
          // (v19 #4) One / two / three pages across. pdf.js itself tops out at two
          // pages per row, so the third state is our own CSS grid (see applySpread).
          h('button', {
            className: 'elr-btn' + (spreadMode ? ' active' : ''),
            disabled: !hasPdf,
            title: t('spread.label'),
            onClick: () => setSpreadMode((v) => (Number(v) + 1) % 3),
          }, spreadMode === 0 ? t('spread.one') : (spreadMode === 1 ? t('spread.two') : t('spread.three'))),
          h('button', { className: 'elr-btn' + (panMode ? ' active' : ''), disabled: !hasPdf, onClick: () => setPanMode((v) => !v) }, panMode ? t('pan.on') : t('pan.off')),
          h('button', {
            className: 'elr-btn' + (figurePicking ? ' active' : ''),
            disabled: !pdfAnalysisReady || Boolean(figureActivity?.busy),
            'aria-pressed': figurePicking,
            title: t('figure.selectHint'),
            onClick: toggleFigurePicker,
          }, figurePicking ? t('figure.cancel') : t('figure.select')),
          h('span', {
            className: 'elr-find' + (findQuery ? ' is-active' : ''),
            role: 'search',
            'aria-label': t('find.placeholder'),
            onKeyDown: (event) => {
              if (event.key === 'Escape' && !event.nativeEvent?.isComposing) {
                event.preventDefault();
                clearFind();
                findInputRef.current?.focus({ preventScroll: true });
              }
            },
          },
            h('span', { className: 'elr-find-icon', 'aria-hidden': true }),
            h('input', {
              ref: findInputRef,
              className: 'elr-find-input',
              type: 'search',
              value: findQuery,
              disabled: !pdfAnalysisReady,
              placeholder: t('find.placeholder'),
              'aria-label': t('find.placeholder'),
              title: t('find.hint'),
              spellCheck: false,
              onChange: (event) => {
                const next = event.target.value;
                const changed = normText(next) !== normText(findQueryRef.current);
                findQueryRef.current = next;
                setFindQuery(next);
                if (changed) resetFindResults();
              },
              onKeyDown: (event) => {
                if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return;
                event.preventDefault();
                stepFind(event.shiftKey ? -1 : 1);
              },
            }),
            findQuery ? h('span', { className: 'elr-find-actions' },
              h('output', {
                className: 'elr-find-count',
                role: 'status',
                'aria-label': findBusy ? t('find.searching') : undefined,
              }, findBusy ? '…' : (findSearchedRef.current ? (findAt + 1) + '/' + findHits.length : '')),
              h('button', {
                type: 'button', className: 'elr-find-btn is-prev', disabled: !canStepFind,
                title: t('find.prev'), 'aria-label': t('find.prev'),
                onClick: () => stepFind(-1),
              }),
              h('button', {
                type: 'button', className: 'elr-find-btn is-next', disabled: !canStepFind,
                title: t('find.next'), 'aria-label': t('find.next'),
                onClick: () => stepFind(1),
              }),
              h('button', {
                type: 'button', className: 'elr-find-btn',
                title: t('find.clear'), 'aria-label': t('find.clear'),
                onClick: () => { clearFind(); findInputRef.current?.focus({ preventScroll: true }); },
              }, '×')
            ) : null
          ),
          // (v46) All appearance controls live behind this one button.
          settingsWidget(true, settingsBoxRef),
          h('span', { className: 'elr-spacer' }),
          pdfName ? h('span', { className: 'elr-model' }, pdfName) : null
        );
      } else {
        mainToolbar = h('div', { className: 'elr-toolbar' },
          h('button', { className: 'elr-btn', onClick: () => txtFileRef.current && txtFileRef.current.click() }, t('load')),
          // (v25 #1) Same 关闭文献 affordance in text mode: the reader has one way to
          // leave a paper, whether it arrived as a PDF or as pasted text.
          h('button', {
            className: 'elr-btn',
            disabled: !String(text || '').trim(),
            title: t('pdf.closeHint'),
            onClick: closePaper,
          }, t('pdf.close')),
          h('button', { className: 'elr-btn', onClick: () => { resetAnalysisTasks(); resetSelection(); writeShared({ text: '', summary: '', summaryCoverage: null, summaryMeta: null, summaryDetail: null }); notify(''); } }, t('clear')),
          // (v46) Text mode gets the same settings widget; only the paper-theme
          // row is absent there (there is no rendered page to tint), but the
          // other rows come from the same helpers so the two modes cannot drift.
          settingsWidget(false),
          h('span', { className: 'elr-spacer' }),
          h('span', { className: 'elr-model' }, text.length + ' ' + t('chars'))
        );
      }

      let mainContent;
      if (mode === 'pdf') {
        const pdfjsLayer = h('div', {
          ref: containerRef,
          className: 'elr-pdf-container'
            + (spreadMode === 2 ? ' elr-three' : '')
            + (figurePicking ? ' elr-picking-figure' : ''),
          'data-elr-page-theme': theme === 'default' ? undefined : theme,
          style: { display: previewMode === 'native' ? 'none' : '' },
          onPointerDownCapture: startFigureBox,
        }, h('div', { ref: viewerElRef, className: 'pdfViewer' }));
        const nativeLayer = previewMode === 'native' && nativeUrl
          ? h('iframe', { className: 'elr-pdf-iframe', src: nativeUrl, title: pdfName || 'PDF' })
          : null;
        mainContent = h('div', { className: 'elr-pdf-wrap' + (showPdfStart ? ' is-start' : '') },
          pdfjsLayer,
          nativeLayer,
          h('div', { ref: figureOutlineRef, className: 'elr-figure-outline', 'aria-hidden': true }),
          showPdfStart ? h('div', { className: 'elr-drop' },
            h('div', { className: 'elr-drop-col' },
              h('section', { className: 'elr-drop-card' },
                h('div', { className: 'elr-drop-icon', 'aria-hidden': true }),
                h('div', { className: 'elr-drop-copy' },
                  h('h2', { className: 'elr-drop-title' }, t('pdf.drop')),
                  h('p', { className: 'elr-drop-sub' }, t('pdf.dropSub'))
                ),
                h('button', { type: 'button', className: 'elr-btn primary elr-drop-open', onClick: openPdfPicker }, t('pdf.open')),
                pdfError ? h('p', { className: 'elr-drop-error', role: 'alert' }, t('pdf.failed') + ' ' + pdfError) : null
              ),
              recent.length ? h('section', { className: 'elr-drop-recent' },
                h('div', { className: 'elr-drop-recent-head' }, h('h3', null, t('recent.title')), h('span', null, String(recent.length))),
                h('ul', { className: 'elr-drop-recent-list' }, recent.map((entry) => {
                  const name = entry.name || '(untitled)';
                  return h('li', {
                    key: entry.id, className: 'elr-drop-recent-row',
                    onDoubleClick: (event) => { if (!event.target.closest?.('button')) openRecent(entry); },
                  },
                    h('button', {
                      type: 'button', className: 'elr-drop-recent-open', title: name,
                      onClick: (event) => { if (event.detail <= 1) openRecent(entry); },
                    }, h('span', { className: 'elr-recent-name' }, name)),
                    h('button', {
                      type: 'button', className: 'elr-drop-recent-remove', title: t('recent.remove'),
                      'aria-label': t('recent.remove') + ' ' + name,
                      onClick: () => removeRecent(entry.id),
                    }, '×')
                  );
                }))
              ) : null
            )
          ) : null,
          hasPdf && pdfError ? h('div', { className: 'elr-retry-bar' },
            h('span', null, t('pdf.failed') + ' ' + pdfError),
            h('button', { className: 'elr-btn', onClick: () => { setPdfError(''); setPreviewMode('pdfjs'); setDropSeq((n) => n + 1); } }, t('retry')),
            h('button', { className: 'elr-btn', onClick: () => releaseNativeUrl() }, t('close'))
          ) : null,
          dragOver ? h('div', { className: 'elr-drag-mask' }, t('pdf.dropHere')) : null
        );
      } else {
        mainContent = h(React.Fragment, null,
          h('textarea', {
            ref: inputRef,
            className: 'elr-input',
            value: text,
            placeholder: t('paste'),
            onChange: (e) => {
              resetAnalysisTasks();
              setText(e.target.value);
              setReferences([]);
            },
            spellCheck: false,
          }),
          h('div', { className: 'elr-hint' }, t('selection.hint'))
        );
      }

      const main = h('div', { className: 'elr-main' },
        mainToolbar,
        mainContent
      );

      const cardHeader = (key, open, toggle, detail) => h('div', {
        className: 'elr-function-head' + (key === 'recent' ? ' elr-recent-head' : key === 'marks' ? ' elr-marks-head' : ''),
      },
        h('button', {
          type: 'button', className: 'elr-grip', title: t(floatingCards[key] ? 'card.floatingDrag' : 'section.drag'),
          'aria-label': t(floatingCards[key] ? 'card.dock' : 'card.float') + ' · ' + cardLabel(key),
          onPointerDown: beginCardDrag(key, open), onClick: (event) => toggleFunctionCardFloat(key, open, event),
        }, '⠿'),
        h('button', {
          type: 'button', className: 'elr-card-toggle', 'aria-expanded': open,
          title: dock === 'bottom' && !floatingCards[key] ? undefined : cardLabel(key), onClick: () => toggle((previous) => !previous),
        },
          h('span', { 'aria-hidden': true }, open ? (dock === 'bottom' && !floatingCards[key] ? '◂' : '▾') : '▸'),
          h('span', { className: 'elr-card-label' }, cardLabel(key))
        ),
        detail ? h('span', { className: 'elr-card-head-detail' }, detail) : null,
        floatingCards[key] ? h('button', {
          type: 'button', className: 'elr-card-control',
          title: t('card.dock'), 'aria-label': t('card.dock'),
          onClick: (event) => {
            if (event.detail === 0) focusCardGripRef.current = key;
            dockFunctionCard(key);
          },
        }, h('span', { className: 'elr-float-dock-icon', 'aria-hidden': true })) : null,
        h('button', {
          type: 'button', className: 'elr-card-control elr-card-x',
          title: t('card.close'), 'aria-label': t('card.close'), onClick: () => closeCard(key),
        })
      );

      const hasSelectionDraft = Boolean(String(selectionEdit || '').trim());
      const selectionSideBySide = dock === 'bottom' && !floatingCards.selection;
      const paneSplit = selectionSideBySide ? selectionWidthSplit : selectionSplit;
      const selCard = h('div', { className: 'elr-sel-card' },
        cardHeader('selection', selectionCardOpen, setSelectionCardOpen),
        selectionCardOpen ? h('div', { className: 'elr-selection-content' },
          h('div', { className: 'elr-sel-actions' },
            h('button', {
              type: 'button', className: 'elr-btn primary', disabled: !hasSelectionDraft || selectionBusy,
              onClick: () => translateRef.current(),
            }, t('selection.translate')),
            h('button', { type: 'button', className: 'elr-btn', disabled: !selection, onClick: () => addHighlight() }, t('mark.add')),
            h('button', { type: 'button', className: 'elr-btn', disabled: !selection, onClick: () => addNote() }, t('mark.note'))
          ),
          h('div', {
            className: 'elr-selection-panes' + (selectionSideBySide ? ' is-side-by-side' : ''),
            style: { '--elr-selection-source': selectionPaneSize(paneSplit) },
          },
            h('div', { className: 'elr-selection-pane' },
              h('div', { className: 'elr-selection-pane-head' },
                h('label', { htmlFor: selectionHintId + '-card-source' }, t('popup.original')),
                h('span', { className: 'elr-selection-hint', id: selectionHintId + '-card' }, t('selection.appendHint'))
              ),
              h('textarea', {
                className: 'elr-sel-edit', id: selectionHintId + '-card-source', 'aria-describedby': selectionHintId + '-card',
                value: selectionEdit || '', spellCheck: false, placeholder: t('selection.empty'),
                onChange: (e) => setSelectionEdit(e.target.value),
              })
            ),
            selectionPaneGrip(paneSplit, selectionSideBySide ? setSelectionWidthSplit : setSelectionSplit,
              t(selectionSideBySide ? 'selection.resizePaneWidths' : 'selection.resizePanes'), cardGestureCancelRef, selectionSideBySide),
            h('div', { className: 'elr-selection-pane' },
              h('div', { className: 'elr-selection-pane-head' },
                h('span', { id: selectionHintId + '-card-result' }, t('popup.translation')),
                selectionResult ? h('button', {
                  type: 'button', className: 'elr-btn elr-selection-copy',
                  onClick: () => copyText(selectionResult).then(() => notify(t('selection.copied'), 'ok')),
                }, t('selection.copy')) : null
              ),
              h('div', {
                className: 'elr-sel-text' + (selectionResult ? '' : ' elr-out-empty'), role: 'region',
                'aria-labelledby': selectionHintId + '-card-result', 'aria-busy': selectionBusy, tabIndex: 0,
              }, selectionBusy ? t('selection.working') : selectionResult || (hasSelectionDraft ? t('selection.pending') : null))
            )
          )
        ) : null
      );

      const selectedAnalysisTab = analysisTab === 'figure' && mode !== 'pdf' ? 'summary' : analysisTab;
      const analysisTabs = h('div', { className: 'elr-tabs' },
        h('div', { className: 'elr-segment' },
          h('button', {
            className: 'elr-seg' + (selectedAnalysisTab === 'summary' ? ' active' : ''),
            title: t('tab.summary'),
            onClick: () => setAnalysisTab('summary'),
          }, t('tab.summary')),
          h('button', {
            className: 'elr-seg' + (selectedAnalysisTab === 'references' ? ' active' : ''),
            title: t('references.title'),
            onClick: () => setAnalysisTab('references'),
          }, t('references.title') + (references.length ? ' (' + references.length + ')' : '')),
          mode === 'pdf' ? h('button', {
            className: 'elr-seg' + (selectedAnalysisTab === 'figure' ? ' active' : ''),
            onClick: () => setAnalysisTab('figure'),
          }, t('figure.title')) : null
        ),
        h('span', { className: 'elr-spacer' }),
        selectedAnalysisTab === 'summary'
          ? (summaryBusy ? h('span', { className: 'elr-sel-working' }, t('summary.running')) : null)
          : (selectedAnalysisTab === 'references' && referencesBusy ? h('span', { className: 'elr-sel-working' }, t('references.running')) : null)
      );

      const canAnalyze = mode === 'pdf' ? pdfAnalysisReady : Boolean(text.trim());
      const analysisUnavailable = mode === 'pdf' && previewMode === 'native' ? t('pdf.analysisUnavailable') : undefined;
      const coverageLabel = () => {
        if (!summaryCoverage || !summary) return '';
        const ranges = (summaryCoverage.pages || []).map(([from, to]) => from === to ? from : from + '–' + to).join(', ');
        const label = ranges
          ? t('summary.coveragePages', { pages: ranges, total: summaryCoverage.totalPages })
          : t('summary.coverageText', { count: summaryCoverage.analyzedChars, total: summaryCoverage.sourceChars });
        const method = summaryDetail?.mode;
        return [label,
          method === 'direct' && t('summary.fullPass'), method === 'map-reduce' && t('summary.sectionPass'),
          summaryCoverage.failedChunks > 0 && t('summary.coverageFailed', { count: summaryCoverage.failedChunks }),
          summaryCoverage.notes && t('summary.notesOnly')].filter(Boolean).join(' · ');
      };
      const summaryCoverageText = coverageLabel();
      const summaryPanel = h('div', { className: 'elr-col' },
        h('div', { className: 'elr-toolbar' },
          h('button', { className: 'elr-btn primary', title: analysisUnavailable, disabled: summaryBusy || pdfTextBusy || !canAnalyze, onClick: () => runWithAnalysisText(doSummary) },
            pdfTextBusy ? t('pdf.extracting') : (summaryBusy ? t('summary.running') : (summary ? t('summary.rerun') : t('summary.run')))),
          summaryDetail?.draft ? h('button', {
            className: 'elr-btn', type: 'button', disabled: summaryBusy || pdfTextBusy || !canAnalyze,
            onClick: () => runWithAnalysisText(() => doSummary(true)),
          }, t('summary.retrySynthesis')) : null,
          h('span', { className: 'elr-spacer' }),
          summary ? h('button', { className: 'elr-btn', onClick: () => copyText(summary).then(() => notify(t('selection.copied'), 'ok')) }, t('summary.copy')) : null
        ),
        summary ? renderGenerationMetadata(summaryMeta, modelSelection, t, true) : null,
        summaryIssue ? h('div', { className: 'elr-refs-stage elr-summary-error', role: 'alert' }, summaryIssue) : null,
        summaryCoverageText ? h('div', { className: 'elr-refs-stage' }, summaryCoverageText) : null,
        summaryDetail?.error ? h('div', { className: 'elr-refs-stage elr-summary-error' }, t('summary.synthesisError', { error: summaryDetail.error })) : null,
        h('div', { className: 'elr-out' + (summary ? ' elr-markdown' : ' elr-out-empty') },
          summary ? renderMarkdown(summary) : (analysisUnavailable || t('summary.placeholder'))
        )
      );

      const currentFigure = figureActivity?.paper === paperId ? figureActivity : null;
      const activeFigureId = expandedFigure ?? figureEntries[0]?.id;
      const figureStatus = figurePicking ? t('figure.selectHint') : currentFigure?.busy ? t('figure.working') : currentFigure?.error;
      const figurePanel = selectedAnalysisTab === 'figure' ? h('div', { className: 'elr-col' },
        figureEntries.length ? h('div', { className: 'elr-toolbar' },
          h('label', { className: 'elr-figure-sort' },
            h('span', null, t('figure.sort')),
            h('select', {
              className: 'elr-select', value: figureSort,
              onChange: (event) => {
                setExpandedFigure(activeFigureId);
                setFigureSort(event.target.value);
                if (figureListRef.current) figureListRef.current.scrollTop = 0;
              },
            }, FIGURE_SORT_ORDERS.map((order) => h('option', { key: order, value: order }, t('figure.sort.' + order))))
          )
        ) : null,
        figureStatus ? h('div', { className: 'elr-figure-activity', role: currentFigure?.error && !figurePicking ? 'alert' : 'status' },
          h('span', null, figureStatus),
          currentFigure?.busy ? h('button', {
            type: 'button', className: 'elr-btn', onClick: () => { cancelFigureWork(); setFigureActivity(null); },
          }, t('figure.cancel')) : null
        ) : null,
        h('div', { ref: figureListRef, className: 'elr-out elr-figure-out' + (figureEntries.length ? '' : ' elr-out-empty') },
          figureEntries.length ? figureEntries.map((entry) => {
            const open = entry.id === activeFigureId;
            const label = entry.caption?.match(FIGURE_LABEL_RE)?.[0];
            return h('article', { key: entry.id, ref: open ? openFigureRef : null, className: 'elr-figure-entry' },
              h('div', { className: 'elr-figure-entry-head' },
                h('button', {
                  type: 'button', className: 'elr-figure-entry-toggle', 'aria-expanded': open,
                  onClick: () => setExpandedFigure(open ? '' : entry.id),
                }, label || t('figure.entry')),
                entry.page ? h('button', {
                  type: 'button', className: 'elr-btn elr-figure-entry-page', disabled: !pdfAnalysisReady,
                  onClick: () => {
                    const viewer = pdfStateRef.current?.viewer;
                    if (viewer) viewer.currentPageNumber = entry.page;
                  },
                }, t('figure.page', { page: entry.page })) : null
              ),
              renderGenerationMetadata(entry, modelSelection, t),
              open ? h('div', { className: 'elr-figure-entry-body elr-markdown' },
                entry.caption ? h('blockquote', null, entry.caption) : null,
                renderFigureMarkdown(entry.text)
              ) : null
            );
          }) : (!figureStatus ? t('figure.empty') : null))
      ) : null;

      // (v52) One row per bibliography entry. The ORIGINAL text is always the body
      // of the row so the numbering can be checked against the paper; the Chinese
      // title and the link are additive layers that arrive later, and the status
      // chip says exactly which of them is present.
      const referencesBody = (() => {
        if (!references.length) {
          return h('div', { className: 'elr-refs-empty' },
            referencesBusy ? t('references.running') : (analysisUnavailable || t('references.placeholder')));
        }
        return h('div', { className: 'elr-refs-list' }, references.map((item, index) => {
          const raw = String((item && item.raw) || '');
          const en = String((item && (item.title || item.en)) || '');
          const zh = String((item && item.zh) || '');
          const status = String((item && item.status) || (item && item.found ? 'legacy' : 'pending'));
          const url = String((item && item.url) || '');
          const linked = /^(?:provided|matched)$/.test(status) && /^https?:\/\//i.test(url);
          const number = String((item && item.number) || '');
          const pages = String((item && item.pages) || '');
          const meta = [item && item.authors, item && item.venue, item && item.year].filter(Boolean).join(' · ');
          const citationHint = [pages && t('references.page') + ' ' + pages, raw].filter(Boolean).join('\n');
          const chip = t('references.status.' + (status === 'fields' ? 'pending' : status));
          return h('div', { key: (item && item.id) || ('ref' + index), className: 'elr-ref is-' + status },
            h('div', { className: 'elr-ref-index' }, number ? '[' + number + ']' : '[' + (index + 1) + ']'),
            h('div', { className: 'elr-ref-body', title: citationHint || undefined },
              en ? h('div', { className: 'elr-ref-en' }, en) : null,
              zh ? h('div', { className: 'elr-ref-zh' }, zh) : null,
              meta ? h('div', { className: 'elr-ref-meta' }, meta) : null,
              raw && !en ? h('div', { className: 'elr-ref-raw' }, raw) : null,
              h('div', { className: 'elr-ref-row' },
                h('span', { className: 'elr-ref-chip is-' + status, title: t('references.statusHint.' + (status === 'fields' ? 'pending' : status)) }, chip),
                linked
                  ? h('a', { className: 'elr-ref-link', href: url, target: '_blank', rel: 'noreferrer noopener', title: url }, url)
                  : null,
                status === 'none' ? h('span', { className: 'elr-ref-missing' }, t('references.missing')) : null
              )
            )
          );
        }));
      })();

      const referenceCounts = countReferenceStatus(references);
      const referencesPanel = h('div', { className: 'elr-col' },
        h('div', { className: 'elr-toolbar' },
          h('button', { className: 'elr-btn primary', title: analysisUnavailable, disabled: referencesBusy || pdfTextBusy || !canAnalyze, onClick: () => runWithAnalysisText(doReferences) },
            pdfTextBusy ? t('pdf.extracting') : (referencesBusy ? t('references.running') : (references.length ? t('references.rerun') : t('references.run')))),
          referencesCanContinue
            ? h('button', { className: 'elr-btn', disabled: referencesBusy, onClick: () => doReferences({ resume: true }) }, t('references.continue'))
            : null,
          references.length
            ? h('button', {
                className: 'elr-btn',
                disabled: referencesBusy,
                title: t('references.retryHint'),
                onClick: retryReferenceFailures,
              }, t('references.retry'))
            : null,
          h('span', { className: 'elr-spacer' }),
          references.length
            ? h('span', { className: 'elr-refs-count' }, t('references.count')
                .replace('{total}', String(references.length))
                .replace('{found}', String(referenceCounts.matched + referenceCounts.provided)))
            : null
        ),
        referencesStage
          ? h('div', { className: 'elr-refs-stage' }, referencesStage)
          : null,
        h('div', { className: 'elr-out elr-refs-out' }, referencesBody)
      );

      const recentSection = h('div', { className: 'elr-recent' },
        cardHeader('recent', recentOpen, setRecentOpen, recent.length || null),
        recentOpen ? (recent.length
          ? h('div', { className: 'elr-recent-list' }, recent.map((entry) => h('div', {
              key: entry.id,
              className: 'elr-recent-item' + (entry.id === paperId ? ' current' : ''),
              title: (entry.name || '') + ' · ' + t('recent.hint'),
              onDoubleClick: () => openRecent(entry),
            },
              h('span', { className: 'elr-recent-name' }, entry.name || '(untitled)'),
              h('button', { title: t('recent.open'), onClick: () => openRecent(entry) }, '▸'),
              h('button', { title: t('recent.remove'), onClick: () => removeRecent(entry.id) }, '×')
            )))
          : h('div', { className: 'elr-recent-empty' }, t('recent.empty'))
        ) : null
      );

      // (v24 #2) The list respects the filter, and in 'all' mode it follows the
      // document's reading order instead of the order the records happened to be
      // created in. Records whose text cannot be located (PDF closed, page not laid
      // out yet) keep their insertion order after the located ones, so the list never
      // reshuffles on its own while the viewer is loading.
      const listMarks = (() => {
        const all = Array.isArray(marks) ? marks.filter((m) => m && typeof m === 'object') : [];
        const visible = markFilter === 'all' ? all : all.filter((m) => markKind(m) === markFilter);
        // Only the OPEN list needs reading order; skipping it while collapsed keeps a
        // closed section from paying a full-document scan on every re-render.
        if (markFilter !== 'all' || visible.length < 2 || !marksOpen) return visible;
        const located = [];
        const rest = [];
        for (let i = 0; i < visible.length; i++) {
          const at = locateMark(visible[i]);
          if (at) located.push({ mark: visible[i], page: at.page, offset: at.offset, seq: i });
          else rest.push({ mark: visible[i], seq: i });
        }
        located.sort((a, b) => (a.page - b.page) || (a.offset - b.offset) || (a.seq - b.seq));
        rest.sort((a, b) => a.seq - b.seq);
        return located.map((x) => x.mark).concat(rest.map((x) => x.mark));
      })();

      const horizontalMarks = dock === 'bottom' && !floatingCards.marks;
      const marksSection = h('div', { className: 'elr-marks' },
        cardHeader('marks', marksOpen, setMarksOpen, listMarks.length || null),
        marksOpen ? h('div', { className: 'elr-card-content' },
          h('div', { className: 'elr-marks-filter', role: 'group', 'aria-label': t('mark.title') },
            ['all', 'hl', 'note'].map((filter) => h('button', {
              key: filter, type: 'button', className: 'elr-seg' + (markFilter === filter ? ' active' : ''),
              'aria-pressed': markFilter === filter, title: t('mark.filter.' + filter), onClick: () => changeMarkFilter(filter),
            }, t('mark.filter.' + filter)))
          ),
          listMarks.length ? h('div', { ref: marksListRef, className: 'elr-marks-list' + (horizontalMarks ? ' is-horizontal' : '') }, listMarks.map((m) => {
            const isNote = markKind(m) === 'note';
            const locate = () => jumpToMark(m);
            const edit = (event) => setNoteBubble(placeNoteBubble(m.id, m.text, m.note, event.currentTarget.getBoundingClientRect()));
            const action = (label, icon, onClick, extraClass = '') => h('button', {
              type: 'button', className: 'elr-card-control' + extraClass, title: t(label), 'aria-label': t(label), onClick,
            }, h('span', { className: icon, 'aria-hidden': true }));
            return h('article', { key: m.id, className: 'elr-mark-item' + (isNote ? ' is-note' : ' is-hl') },
              h('div', { className: 'elr-mark-row' },
                h('span', { className: 'elr-mark-badge' }, isNote ? t('mark.badgeNote') : t('mark.badgeHl')),
                action('mark.locate', 'elr-mark-locate-icon', locate),
                isNote ? action('mark.editNote', 'elr-mark-edit-icon', edit) : null,
                action(isNote ? 'mark.removeNote' : 'mark.removeHl2', 'elr-trash-icon', () => removeMark(m.id), ' elr-remove-control')
              ),
              isNote ? h('button', { type: 'button', className: 'elr-mark-preview elr-mark-note-preview', title: t('mark.editNote'), onClick: edit },
                h('span', null, m.note || t('mark.notePlaceholder'))
              ) : null,
              h('button', { type: 'button', className: 'elr-mark-preview elr-mark-source', title: t('mark.locate'), onClick: locate },
                h('span', null, m.text)
              )
            );
          })) : h('div', { className: 'elr-marks-empty' }, (marks.length && markFilter !== 'all') ? t('mark.filterEmpty') : t('mark.empty'))
        ) : null
      );

      const termExplanation = (item, className) => h('div', { className: className + ' elr-markdown', tabIndex: 0 },
        item.surrounding ? h('div', { className: 'elr-term-quote' }, item.surrounding) : null,
        renderMarkdown(item.body || '')
      );
      const floatingTerms = Boolean(floatingCards.terms);
      const verticalTerms = dock === 'bottom' && !floatingTerms;
      const termsSection = h('div', { className: 'elr-terms' },
        cardHeader('terms', termsOpen, setTermsOpen, termBusy ? t('term.runningShort') : terms.length || null),
        termsOpen ? (terms.length
          ? h('div', { className: 'elr-terms-list' + (verticalTerms ? ' is-vertical' : '') }, terms.map((item) => {
            const open = (floatingTerms ? termOpenId : shownTerm?.id) === item.id;
            return h('div', { key: item.id, className: 'elr-term-item' + (open ? ' open' : '') },
              h('div', { className: 'elr-term-row' },
                h('button', {
                  type: 'button', className: 'elr-term-toggle', 'aria-expanded': open,
                  'aria-haspopup': floatingTerms ? undefined : 'dialog',
                  'aria-controls': !floatingTerms && open ? termBubbleId : undefined,
                  title: t('term.toggle') + ' · ' + item.term,
                  onClick: (event) => {
                    if (floatingTerms) setTermOpenId(open ? '' : item.id);
                    else if (open) closeTermBubble();
                    else setTermBubble({ id: item.id, paper: paperId, anchor: event.currentTarget, keyboard: event.detail === 0 });
                  },
                }, h('span', { className: 'elr-term-name' }, item.term)),
                h('button', {
                  type: 'button', className: 'elr-card-control elr-remove-control',
                  title: t('term.remove'),
                  'aria-label': t('term.remove') + ' · ' + item.term,
                  onClick: () => removeTerm(item.id),
                }, h('span', { className: 'elr-trash-icon', 'aria-hidden': true }))
              ),
              open && floatingTerms ? termExplanation(item, 'elr-term-body') : null
            );
          }))
          : h('div', { className: 'elr-recent-empty' }, t('term.empty'))
        ) : null
      );
      const termBubbleNode = shownTerm ? createPortal(h('div', {
        ref: termBubbleRef, id: termBubbleId, className: 'elr-term-popover' + toneCls,
        role: 'dialog', 'aria-label': shownTerm.term, tabIndex: -1,
      },
        h('div', { className: 'elr-term-popover-surface' },
          h('div', { className: 'elr-term-popover-head' },
            h('strong', { title: shownTerm.term }, shownTerm.term),
            h('button', {
              type: 'button', className: 'elr-card-control elr-card-x', title: t('close'), 'aria-label': t('close'),
              onClick: () => closeTermBubble(true),
            })
          ),
          termExplanation(shownTerm, 'elr-term-popover-body')
        )
      ), floatingHost) : null;

      // (#2) Upper side sections scroll in their own box; the analysis/translation
      // area below is a flex column whose .elr-out always keeps its own scrollbar.
      // (v8 #7) The three sections below the selection card are reorderable: the
      // grip in each header starts an HTML5 drag and the drop target decides where
      // the section lands. The resulting order is persisted in `sectionOrder`.
      // (v27) Only ENABLED cards are rendered, and the ⚙ in this header is the
      // manager that enables them again — a card closed years ago is always one
      // click away, which is the whole point of having a manager instead of only
      // the × on each card.
      const cardMenu = cardMenuOpen && hasPaper
        ? createPortal(h('div', {
          ref: cardMenuRef, className: 'elr-card-menu' + toneCls,
          role: 'dialog', 'aria-label': t('card.manage'),
        },
          h('div', { className: 'elr-card-menu-title' }, t('card.manage')),
          CARD_KEYS.map((key) => {
            const on = enabledCards.indexOf(key) !== -1;
            return h('label', {
              key,
              className: 'elr-card-menu-row' + (on ? ' on' : ''),
              onClick: (e) => e.stopPropagation(),
            },
              h('input', {
                type: 'checkbox',
                checked: on,
                onChange: (e) => setCardEnabled(key, e.target.checked),
              }),
              h('span', null, cardLabel(key))
            );
          }),
          h('div', { className: 'elr-card-menu-actions' },
            h('button', { type: 'button', className: 'elr-btn', onClick: resetCardLayout }, t('card.resetLayout'))
          )
        ), floatingHost)
        : null;

      const cardNodes = { selection: selCard, recent: recentSection, terms: termsSection, marks: marksSection };
      const openCards = { selection: selectionCardOpen, recent: recentOpen, marks: marksOpen, terms: termsOpen };
      const dockedCards = functionCardOrder(sectionOrder).filter((key) => enabledCards.includes(key) && !floatingCards[key]);
      const floatingCardNodes = hasPaper && ownsCardWindows ? enabledCards.filter((key) => floatingCards[key]).map((key) => {
        const open = openCards[key];
        const box = placeFunctionCard(floatingCards[key], open, floatingBounds);
        let minHeight = 130;
        if (key === 'selection') minHeight = SELECTION_CARD_MIN_H;
        else if (key === 'marks') minHeight = MARKS_CARD_MIN_H;
        const saveSize = (patch, edge) => setFloatingCards((previous) => {
          const saved = previous[key];
          if (!saved) return previous;
          const next = { ...saved, x: patch.x, y: patch.y };
          if (edge.includes('e') || edge.includes('w')) next.w = patch.w;
          if (edge.includes('n') || edge.includes('s')) next.h = patch.h;
          return { ...previous, [key]: next };
        });
        return createPortal(h('div', {
          className: 'elr-sec elr-floating-card' + toneCls + (frontCard === key ? ' is-front' : '')
            + (ghost?.key === key ? ' dragging' : ''),
          'data-elr-floating-card': key,
          style: { left: box.x, top: box.y, width: box.w, height: box.h },
          onPointerDownCapture: () => setFrontCard(key),
          onFocus: () => setFrontCard(key),
        }, cardNodes[key], resizeHandles(saveSize, 220, minHeight, popupViewport, {
          edges: open ? RESIZE_EDGES : ['e', 'w'], cancelRef: cardGestureCancelRef, title: t('card.floatResize'),
        })), floatingHost, key);
      }) : [];

      const otherDock = dock === 'bottom' ? 'right' : 'bottom';
      const switchDockLabel = t('dock.switch', { side: t('dock.' + otherDock + 'Short') });
      const sideTop = h('div', {
        ref: sideTopElRef,
        className: 'elr-side-top' + (ghost ? ' drag-active' : '') + (cardDrop ? ' elr-card-dock-target' : ''),
        // (v25 #3) Docked at the bottom the two halves are side by side, so the
        // remembered size is a WIDTH there and a height in the right-hand dock.
        style: dock === 'bottom' ? { width: sideTopWidth } : { height: sideTopHeight },
      },
        h('div', { className: 'elr-col-head elr-card-head' },
          // (v28 #1) This header titles the whole card column, not the selection
          // card, so it must not reuse `selection.title`.
          h('span', null, t('cards.title')),
          h('button', {
            type: 'button', className: 'elr-card-control',
            title: switchDockLabel, 'aria-label': switchDockLabel,
            onClick: () => setDock(otherDock),
          }, h('span', { className: 'elr-dock-icon to-' + otherDock, 'aria-hidden': true })),
          h('span', { className: 'elr-spacer' }),
          h('button', {
            type: 'button', ref: cardMenuButtonRef,
            className: 'elr-icon-btn' + (cardMenuOpen ? ' active' : ''),
            title: t('card.manage'), 'aria-label': t('card.manage'),
            'aria-haspopup': 'dialog', 'aria-expanded': cardMenuOpen,
            onClick: (e) => { e.stopPropagation(); setCardMenuOpen((v) => !v); },
          }, '⚙')
        ),
        h('div', { className: 'elr-side-body' },
          dockedCards.length ? dockedCards.map((key) => {
            const collapsed = !openCards[key];
            const dropEdge = cardDrop?.target === key ? (cardDrop.after ? 'below' : 'above') : null;
            return h('div', {
              key,
              'data-elr-docked-card': key,
              className: 'elr-sec'
                + (collapsed ? ' is-collapsed' : '')
                + (ghost?.key === key ? ' dragging' : '')
                + (dropEdge ? ' over over-' + dropEdge : ''),
              style: dock === 'bottom'
                ? (collapsed ? undefined : cardWidths[key] ? { width: cardWidths[key], flex: '0 0 auto' } : { flex: '1 1 200px' })
                : ((!collapsed && cardHeights[key]) ? { height: cardHeights[key], flex: '0 0 auto' } : undefined),
            }, cardNodes[key],
              // (v42 #3) Side grips belong to the BOTTOM dock only. When the 功能栏 is
              // docked right a card spans the whole column, so a "left/right edge"
              // there resized the COLUMN, not the card — two handles that did not do
              // what their cursor promised, drawn right on top of the text. The right
              // dock resizes height instead (see the `is-bottom` grip below).
              (dock === 'bottom' && !collapsed) ? h('div', {
                className: 'elr-card-rz is-right',
                draggable: false,
                title: t('card.resize'),
                onPointerDown: beginCardResize(key, 1),
                onDragStart: (e) => { e.preventDefault(); e.stopPropagation(); },
              }) : null,
              (dock === 'bottom' && !collapsed) ? h('div', {
                className: 'elr-card-rz is-left',
                draggable: false,
                title: t('card.resize'),
                onPointerDown: beginCardResize(key, -1),
                onDragStart: (e) => { e.preventDefault(); e.stopPropagation(); },
              }) : null,
              // (v38 #1) The BOTTOM edge, only where stacking makes a per-card
              // height meaningful (the right dock). In the bottom dock the cards sit
              // in a row whose height is the row's, so a per-card height there would
              // just be a taller box with the same content — hence no grip.
              //
              // A COLLAPSED card gets no grip either: it is header-only, and the
              // stored height is deliberately not applied to it, so dragging here
              // would move a handle that visibly changes nothing.
              (dock !== 'bottom' && !collapsed) ? h('div', {
                className: 'elr-card-rz is-bottom',
                draggable: false,
                title: t('card.resizeH'),
                onPointerDown: beginCardHeightResize(key),
                // Double-click drops the pin, so the card returns to the even share
                // instead of keeping a stale pixel height forever.
                onDoubleClick: () => {
                  setCardHeights((prev) => {
                    const next = Object.assign({}, prev);
                    delete next[key];
                    return next;
                  });
                },
                onDragStart: (e) => { e.preventDefault(); e.stopPropagation(); },
              }) : null
            );
          }) : h('div', { className: 'elr-card-none' }, t(enabledCards.length ? 'card.dockEmpty' : 'card.none'))
        )
      );

      const splitter = h('div', {
        ref: splitRef,
        className: 'elr-divider elr-splitter' + (dock === 'bottom' ? '' : ' axis-row'),
        title: t('resize.split'),
      });

      // (v25 #3) The analysis column keeps its own vertical column in BOTH docks.
      // Docked at the bottom `side` becomes a row, so without this wrapper the tabs
      // header and the analysis body would sit next to each other as two thin strips
      // instead of stacking above the text.
      // (v28 #2, revised) 论文分析 and 参考文献 are switched, not side by side: the
      // segmented control picks ONE panel, which then fills the whole column.
      const sideCol = h('div', { className: 'elr-side-col' },
        analysisTabs,
        selectedAnalysisTab === 'references' ? referencesPanel : selectedAnalysisTab === 'figure' ? figurePanel : summaryPanel
      );

      const side = h('div', {
        ref: sideElRef,
        className: 'elr-side',
        style: dock === 'bottom' ? { height: sideHeight } : { width: sideWidth },
      }, sideTop, splitter, sideCol);

      const resizer = h('div', {
        ref: resizeRef,
        className: 'elr-divider elr-resizer' + (dock === 'bottom' ? ' axis-row' : ''),
        role: 'separator',
        tabIndex: 0,
        'aria-orientation': dock === 'bottom' ? 'horizontal' : 'vertical',
        'aria-label': t('resize.panes'),
        title: t('resize.panes'),
      });

      // (v19 #1) The popup has TWO independently grippable inner boxes. `flex-grow`
      // weights are used instead of pixel heights so that resizing the outer card
      // stretches BOTH of them (their ratio stays, their sizes grow), while the grip
      // under either box only rebalances the ratio.
      const popupOW = Math.max(0.15, Number(popup && popup.ow) || 1);
      const popupRW = Math.max(0.15, Number(popup && popup.rw) || 1);
      const rebalance = (selfKey, otherKey, sign) => (e) => {
        if (e.button !== 0) return;
        const grip = e.currentTarget;
        const body = grip && grip.closest ? grip.closest('.elr-popup-body') : null;
        const total = body ? body.clientHeight : 0;
        if (!total) return;
        const startY = e.clientY;
        const w0 = selfKey === 'ow' ? popupOW : popupRW;
        const w1 = otherKey === 'rw' ? popupRW : popupOW;
        const sum = w0 + w1;
        // (v34 #2) Rebalancing used to call `setPopup` on every pointermove, i.e. a
        // full re-render of the reader (PDF view, cards, portals) per event. The two
        // blocks are flex children, so while dragging the weights are written
        // straight onto them and React only hears about the final ratio.
        const selfEl = body ? body.children[selfKey === 'ow' ? 0 : 1] : null;
        const otherEl = body ? body.children[otherKey === 'rw' ? 1 : 0] : null;
        let pending = w0;
        const painter = frameWriter((next) => {
          if (selfEl && selfEl.style) selfEl.style.flexGrow = String(next);
          if (otherEl && otherEl.style) otherEl.style.flexGrow = String(Math.max(0.15, sum - next));
        });
        const apply = (next) => {
          pending = next;
          painter.push(next);
        };
        const move = (ev) => {
          const dy = (ev.clientY - startY) * sign;
          // Pixel change of THIS box, expressed back in flex-weight units.
          apply(Math.max(0.15, w0 + (dy * sum) / Math.max(40, total)));
        };
        const finish = (commit) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          painter.cancel();
          gestureEnd();
          if (commit) setPopup((prev) => (prev ? Object.assign({}, prev, { [selfKey]: pending }) : prev));
        };
        const up = () => finish(true);
        const cancel = () => finish(false);
        gestureStart();
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        e.preventDefault();
        e.stopPropagation();
      };

      const startTranslationDrag = (event) => {
        if (event.button !== 0 || event.isPrimary === false || event.target?.closest?.('button')) return;
        const handle = event.currentTarget;
        const card = handle.parentElement;
        const origin = card.getBoundingClientRect();
        const bounds = popupViewport();
        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        const positionAt = (ev) => ({
          x: clampPopup(origin.left + ev.clientX - startX, bounds.left, bounds.right - origin.width),
          y: clampPopup(origin.top + ev.clientY - startY, bounds.top, bounds.bottom - origin.height),
        });
        const painter = frameWriter(({ x, y }) => {
          card.style.transform = 'translate3d(' + (x - origin.left) + 'px,' + (y - origin.top) + 'px,0)';
        });
        const move = (ev) => {
          if (ev.pointerId === pointerId) painter.push(positionAt(ev));
        };
        const finish = (position) => {
          if (popupDragCancelRef.current !== cancel) return;
          popupDragCancelRef.current = null;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('blur', cancel);
          handle.removeEventListener('lostpointercapture', onCancel);
          if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
          painter.cancel();
          if (position) {
            card.style.left = position.x + 'px';
            card.style.top = position.y + 'px';
            setPopup((previous) => previous && { ...previous, ...position });
          }
          card.style.transform = '';
          card.style.willChange = '';
        };
        const cancel = () => finish(null);
        const onCancel = (ev) => { if (ev.pointerId === pointerId) cancel(); };
        const up = (ev) => { if (ev.pointerId === pointerId) finish(positionAt(ev)); };
        popupDragCancelRef.current?.();
        popupDragCancelRef.current = cancel;
        card.style.willChange = 'transform';
        try { handle.setPointerCapture(pointerId); } catch (_) {}
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('blur', cancel);
        handle.addEventListener('lostpointercapture', onCancel);
        event.preventDefault();
        event.stopPropagation();
      };

      const popupNode = popupOn && popup ? createPortal(
        h('div', {
          className: 'elr-popup elr-resizable' + (scheme === 'dark' ? ' elr-popup-dark' : '') + toneCls,
          style: { left: popup.x, top: popup.y, width: popup.w, height: popup.h, fontSize: popupFont + 'px' },
        },
          h('div', { className: 'elr-popup-head', onPointerDown: startTranslationDrag },
            h('span', { className: 'elr-launcher-dot' }),
            h('span', null, t('popup.title')),
            h('span', { className: 'elr-spacer' }),
            // (v23 #3) The translate button moved up into the title bar, immediately
            // to the LEFT of the A−/A+ font buttons: it is the primary action of the
            // card, so it must not sit under a long English paragraph.
            h('button', {
              className: 'elr-icon-btn elr-popup-translate',
              title: selectionResult ? t('popup.retranslate') : t('popup.translate'),
              disabled: selectionBusy || !String(selectionEdit || '').trim(),
              onClick: () => translateRef.current(),
            }, selectionBusy ? t('selection.working') : (selectionResult ? t('popup.retranslate') : t('popup.translate'))),
            // (v14 #2) Explicit font-size controls. They must NOT start a drag.
            h('button', {
              className: 'elr-icon-btn elr-font-btn', title: t('popup.fontDec'),
              disabled: popupFont <= POPUP_FONT_MIN,
              onClick: () => changePopupFont(-1),
            }, 'A−'),
            h('button', {
              className: 'elr-icon-btn elr-font-btn', title: t('popup.fontInc'),
              disabled: popupFont >= POPUP_FONT_MAX,
              onClick: () => changePopupFont(1),
            }, 'A+'),
            h('button', { className: 'elr-icon-btn', onClick: () => { popupDragCancelRef.current?.(); setPopup(null); } }, t('popup.close'))
          ),
          // (v15 #1/#2) Two visually distinct cards. The English original is a
          // controlled <textarea>, and 翻译 re-runs the translation with the
          // corrected text (rect === null keeps the card where the user dragged it).
          // (v17 #1) Both boxes carry their own native `resize: vertical` handle, so
          // the English height and the Chinese height are set INDEPENDENTLY.
          // (v17 #3) A fresh selection only fills the English box (`pending`); the
          // Chinese box shows a hint until 翻译 is pressed.
          // (v18 #4/#5) The textarea is bound to the SHARED `selectionEdit`, and the
          // result to `selectionResult`: the inline card and the side column edit the
          // very same state, so typing in either place changes both, and a
          // translation started here also shows up in the side column.
          h('div', { className: 'elr-popup-body' },
            h('div', {
              className: 'elr-popup-block elr-popup-block-original',
              style: { flexGrow: popupOW, flexShrink: 1, flexBasis: 0 },
            },
              h('div', { className: 'elr-popup-original-head' },
                h('label', { className: 'elr-popup-label', htmlFor: selectionHintId + '-original' }, t('popup.original')),
                h('span', { className: 'elr-selection-hint', id: selectionHintId + '-popup' }, t('selection.appendHint'))
              ),
              h('textarea', {
                className: 'elr-popup-textarea',
                id: selectionHintId + '-original', 'aria-describedby': selectionHintId + '-popup',
                value: selectionEdit || '',
                spellCheck: false,
                onChange: (e) => setSelectionEdit(e.target.value),
              }),
              // (v19 #1) Drag DOWN to make the English box taller.
              h('div', { className: 'elr-popup-grip', title: t('box.editHint'), onPointerDown: rebalance('ow', 'rw', 1) })
            ),
            h('div', {
              className: 'elr-popup-block elr-popup-block-result',
              style: { flexGrow: popupRW, flexShrink: 1, flexBasis: 0 },
            },
              h('label', { className: 'elr-popup-label' }, t('popup.translation')),
              h('div', {
                className: 'elr-popup-result-box elr-popup-text' + (selectionResult ? '' : ' elr-out-empty'),
              }, selectionResult || (selectionBusy ? t('selection.working') : t('selection.pending'))),
              h('div', { className: 'elr-popup-grip', title: t('box.editHint'), onPointerDown: rebalance('rw', 'ow', 1) })
            )
          ),
          h('span', { className: 'elr-grip-corner' }),
          // (v18 #3) Grippable edges (N/S/E/W + the four corners), so the card can be
          // resized from any border instead of only the bottom-right corner.
          resizeHandles((patch) => setPopup((prev) => (prev ? Object.assign({}, prev, patch) : prev)), 220, 120, popupViewport)
        ),
        floatingHost
      ) : null;

      // The formula card floats beside the PDF and can be dragged by its title bar.
      const formulaNode = formulaCard ? createPortal(
        h('div', {
          className: 'elr-formula-card elr-resizable' + toneCls,
          // (v18 #3) Same edge-resize treatment as the popup card: width/height are
          // state, patched by the eight `.elr-rz-*` strips.
          style: {
            left: Math.max(8, Math.min(formulaCard.x, (window.innerWidth || 1200) - 420)),
            top: Math.max(8, Math.min(formulaCard.y, (window.innerHeight || 800) - 240)),
            width: formulaCard.w || 440,
            height: formulaCard.h || undefined,
            minWidth: 260, minHeight: 160, maxHeight: '78vh',
          },
        },
          h('div', {
            className: 'elr-formula-head',
            onPointerDown: (e) => {
              if (e.button !== 0) return;
              if (e.target && e.target.closest && e.target.closest('button')) return;
              const startX = e.clientX, startY = e.clientY;
              const origin = { x: formulaCard.x || 0, y: formulaCard.y || 0 };
              // (v34 #2) Same frame-coalesced drag as the popup: the card is moved
              // through its own DOM style, state is written once on release.
              const cardEl = e.currentTarget && e.currentTarget.parentElement;
              let pending = { x: origin.x, y: origin.y };
              const painter = frameWriter((pos) => {
                if (!cardEl || !cardEl.style) return;
                cardEl.style.left = pos.x + 'px';
                cardEl.style.top = pos.y + 'px';
              });
              const move = (ev) => {
                const maxX = Math.max(8, (window.innerWidth || 1200) - 420);
                const maxY = Math.max(8, (window.innerHeight || 800) - 240);
                pending = {
                  x: Math.max(8, Math.min(origin.x + (ev.clientX - startX), maxX)),
                  y: Math.max(8, Math.min(origin.y + (ev.clientY - startY), maxY)),
                };
                painter.push(pending);
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                painter.cancel();
                gestureEnd();
                setFormulaCard((prev) => (prev ? Object.assign({}, prev, { x: pending.x, y: pending.y }) : prev));
              };
              gestureStart();
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
              window.addEventListener('pointercancel', up);
              e.preventDefault();
            },
          },
            h('span', null, t('formula.title')),
            h('span', { className: 'elr-spacer', style: { flex: 1 } }),
            h('button', { className: 'elr-icon-btn', onClick: () => setFormulaCard(null) }, t('close'))
          ),
          // (v9 #2) The selection is shown TYPESET, not as raw TeX: the source box
          // keeps the original string for copying, and the rendered copy above it
          // is what the reader actually needs to recognise the expression.
          //
          // A selection copied out of a PDF usually arrives as BARE TeX with no
          // `$…$` delimiters (`X_{(T+1):(T+S)} = F(X_{1:T}, E_{1:T}) \in
          // \mathbb{R}^{M \times S}`), so it cannot be pushed through the Markdown
          // path — that would print the same unreadable source again. Bare TeX is
          // fed straight to KaTeX as display math; only text that already carries
          // its own delimiters or prose goes through the Markdown renderer.
          h('div', { className: 'elr-formula-render elr-katex' }, renderFormulaPreview(formulaCard.text)),
          h('div', { className: 'elr-formula-src' }, formulaCard.text),
          h('div', { className: 'elr-formula-body elr-markdown' + (formulaCard.body ? '' : ' elr-out-empty') },
            formulaCard.busy ? t('formula.working') : (formulaCard.body ? renderMarkdown(formulaCard.body) : t('formula.empty'))),
          h('span', { className: 'elr-grip-corner' }),
          resizeHandles((patch) => setFormulaCard((prev) => (prev ? Object.assign({}, prev, patch) : prev)), 260, 160)
        ),
        floatingHost
      ) : null;

      // (v23 #1) The context menu offers highlight actions and annotation actions
      // as two SEPARATE groups, each keyed by its own record (`menu.markId` for the
      // yellow band, `menu.noteId` for the annotation). Acting on one never touches
      // the other, and the same sentence may legitimately show both groups.
      const menuHasHl = Boolean(menu && menu.markId);
      const menuHasNote = Boolean(menu && menu.noteId);
      const noteTarget = menuHasNote
        ? ((marksRef.current || []).find((m) => m.id === menu.noteId) || null)
        : null;
      const menuNode = menu ? createPortal(
        h('div', {
          className: 'elr-menu' + toneCls,
          style: { left: Math.max(8, Math.min(menu.x, (window.innerWidth || 1200) - 200)), top: Math.max(8, Math.min(menu.y, (window.innerHeight || 800) - 190)) },
          onMouseDown: (e) => e.stopPropagation(),
        },
          menuHasHl
            ? h('button', {
                className: 'elr-menu-item',
                onClick: () => { removeHighlight(menu.markId); setMenu(null); },
              }, t('mark.removeHl'))
            : null,
          menuHasNote
            ? h('button', {
                className: 'elr-menu-item',
                onClick: () => {
                  if (!noteTarget) { setMenu(null); return; }
                  const anchor = menu.rect || { left: menu.x, top: menu.y, bottom: menu.y };
                  setNoteBubble(placeNoteBubble(noteTarget.id, noteTarget.text, noteTarget.note || '', anchor));
                  setMenu(null);
                },
              }, t('mark.editNote'))
            : null,
          menuHasNote
            ? h('button', {
                className: 'elr-menu-item',
                onClick: () => {
                  clearNote(menu.noteId);
                  setMenu(null);
                  notify(t('mark.noteCleared'), 'ok');
                },
              }, t('mark.clearNote'))
            : null,
          (menuHasHl || menuHasNote) ? h('div', { className: 'elr-menu-sep' }) : null,
          // The two add actions are always offered; each one creates or re-opens
          // its OWN record kind and never touches the other.
          menuHasHl
            ? null
            : h('button', { className: 'elr-menu-item', onClick: () => addHighlight(menu.text) }, t('mark.add')),
          menuHasNote
            ? null
            : h('button', { className: 'elr-menu-item', onClick: () => addNote(menu.text, menu.rect) }, t('mark.note')),
          // (v8 #3) Formula explanation is offered whenever the selection looks
          // like math; it is also always available so an odd formula can still be
          // explained on demand.
          h('div', { className: 'elr-menu-sep' }),
          h('button', {
            className: 'elr-menu-item',
            onClick: () => { explainFormula(menu.text, menu.rect); setMenu(null); },
          }, t('formula.explain')),
          // (v35 #1) Explain the selected word/short phrase as a professional term
          // of this paper's field, and record it in the 术语解释 card.
          h('button', {
            className: 'elr-menu-item',
            onClick: () => {
              // The sentence the term sits in is what carries its local sense, so it
              // is sent separately from the whole paper text.
              const quoted = String(menu.surrounding || '').trim();
              explainTerm(menu.text, quoted);
              setMenu(null);
            },
          }, t('term.explain')),
          h('div', { className: 'elr-menu-sep' }),
          h('button', {
            className: 'elr-menu-item',
            onClick: () => { copyText(menu.text); setMenu(null); },
          }, t('selection.copy'))
        ),
        floatingHost
      ) : null;

      const noteSource = String(noteBubble?.text || '').replace(/\s+/g, ' ').trim();
      const noteNode = noteBubble ? createPortal(
        h('div', {
          className: 'elr-note-bubble elr-resizable' + toneCls,
          // (v18 #3) Edge-resize for the annotation bubble as well, so EVERY floating
          // card can be sized from any border.
          style: {
            left: noteBubble.x, top: noteBubble.y, width: noteBubble.w, height: noteBubble.h,
          },
        },
          h('div', {
            className: 'elr-note-bubble-head',
            // (v8 #1) Drag the bubble by its title bar. The drag writes into the
            // bubble's own x/y so it stays where it was dropped.
            onPointerDown: (e) => {
              if (e.button !== 0 || e.isPrimary === false) return;
              if (e.target && e.target.closest && e.target.closest('button')) return;
              const startX = e.clientX, startY = e.clientY;
              const node = e.currentTarget.parentNode;
              const origin = node.getBoundingClientRect();
              if (node && node.setPointerCapture) { try { node.setPointerCapture(e.pointerId); } catch (_) {} }
              // (v34 #2) Frame-coalesced drag: write the card's own style per frame,
              // commit `{x, y}` to state only when the pointer is released.
              let pending = { x: origin.left, y: origin.top };
              const painter = frameWriter((pos) => {
                if (!node || !node.style) return;
                node.style.left = pos.x + 'px';
                node.style.top = pos.y + 'px';
              });
              const move = (ev) => {
                if (ev.pointerId !== e.pointerId) return;
                pending = fitPopupBox({
                  x: origin.left + ev.clientX - startX, y: origin.top + ev.clientY - startY,
                  w: origin.width, h: origin.height,
                }, popupViewport());
                painter.push(pending);
              };
              const up = (ev) => {
                if (ev.pointerId !== e.pointerId) return;
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                painter.cancel();
                gestureEnd();
                if (node && node.releasePointerCapture) { try { node.releasePointerCapture(ev.pointerId); } catch (_) {} }
                setNoteBubble((prev) => (prev?.id === noteBubble.id ? { ...prev, ...pending } : prev));
              };
              gestureStart();
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
              window.addEventListener('pointercancel', up);
              e.preventDefault();
            },
          },
            h('span', null, t('mark.noteTitle')),
            h('span', { className: 'elr-spacer', style: { flex: 1 } }),
            h('button', {
              className: 'elr-icon-btn',
              onClick: () => {
                const value = String(noteBubble.note || '').trim();
                updateNote(noteBubble.id, value);
                setNoteBubble(null);
                // The blue dotted underline only exists for marks WITH a note, so
                // repaint after saving/clearing the text.
                applyHighlightsRef.current();
                notify(t(value ? 'mark.noteSaved' : 'mark.noteCleared'), 'ok');
              },
            }, t('mark.saveNote')),
            h('button', { className: 'elr-icon-btn', onClick: () => setNoteBubble(null) }, t('close'))
          ),
          h('textarea', {
            className: 'elr-note-bubble-textarea',
            autoFocus: true,
            'aria-label': t('mark.noteTitle'),
            placeholder: t('mark.notePlaceholder'),
            value: noteBubble.note || '',
            onChange: (e) => {
              const value = e.target.value;
              setNoteBubble((prev) => (prev ? Object.assign({}, prev, { note: value }) : prev));
            },
          }),
          noteSource ? h('div', { className: 'elr-note-source' }, noteSource.length > 110 ? noteSource.slice(0, 110) + '…' : noteSource) : null,
          resizeHandles((patch) => setNoteBubble((prev) => (prev?.id === noteBubble.id ? { ...prev, ...patch } : prev)), 180, 140, popupViewport)
        ),
        floatingHost
      ) : null;

      const ghostNode = ghost ? createPortal(
        h('div', {
          ref: cardGhostRef,
          className: 'elr-drag-ghost' + toneCls,
          'aria-hidden': true,
          style: {
            transform: 'translate3d(' + ghost.x + 'px,' + ghost.y + 'px,0)',
            width: ghost.w,
            height: ghost.h,
          },
        },
          h('div', { className: 'elr-drag-ghost-head' }, '⠿', cardLabel(ghost.key)),
          h('div', { className: 'elr-drag-ghost-body' }, t('card.dragHint'))
        ),
        floatingHost
      ) : null;

      const bodyClass = 'elr-body' + (dock === 'bottom' ? ' dock-bottom' : '');

      return h('div', {
        ref: readerRef,
        className: 'elr-view' + (panMode ? ' elr-pan-on' : '') + toneCls,
        onDragOver,
        onDragLeave,
        onDrop,
        onPointerDownCapture: hasPaper ? () => selectCardWindowHost(floatingHost) : undefined,
        onFocusCapture: hasPaper ? () => selectCardWindowHost(floatingHost) : undefined,
      },
        head,
        h('div', { className: bodyClass }, main, hasPaper ? resizer : null, hasPaper ? side : null),
        showPdfStart && !status ? null : h('div', { className: 'elr-status' + (statusKind ? ' ' + statusKind : '') }, status),
        popupNode,
        formulaNode,
        menuNode,
        noteNode,
        floatingCardNodes,
        termBubbleNode,
        ghostNode,
        cardMenu
      );
    }

    // Inline full-page View registered as a conversation.view tab. order: 20
    // places it inline beside 对话(0) / 痕迹(10) / 上下文(30) instead of the
    // width-based "More" overflow menu.
    let viewT = (key) => key;
    function View() {
      return h(Reader, { t: viewT });
    }

    // (v44 #1) The secondary entry — the floating bottom-right launcher button and
    // the full-screen overlay reader it opened — was REMOVED at the user's request
    // ("取消悬浮在全部界面右下角的文献阅读器按钮"). The remaining entry points are
    // the conversation tab, the sidebar palette row and the right-sidebar guide tab,
    // and all three render `View`/`Panel` below, so nothing else depended on it.

    // (v11 #2) The sidebar-tool destination. A `sidebar.panellist` row can only
    // open a `main` KEYED panel — that is the one destination the host's public
    // contracts allow for a sidebar entry (`dshmarket` is the reference). Opening
    // the row calls `layout.selectPanel(PANEL_ID)`, which renders this component
    // in the centre column. The panel keeps the same Reader instance as the tab,
    // so a half-read paper, its translation and its marks survive the switch.
    const PANEL_ID = 'english-lit-reader-panel';
    // (v21 #2) The right-sidebar tab type id. It doubles as the `kind` the guide
    // capsule opens and as the `key` of the panel registration, so the capsule and
    // the page it opens can never drift apart.
    const GUIDE_TAB_ID = 'english-lit-reader';
    let panelT = (key) => key;
    function Panel(props) {
      // The registration's `inject: () => ({ t })` hands the bound translator in
      // as a prop; `panelT` is only the fallback for a host that does not.
      const t = props && typeof props.t === 'function' ? props.t : panelT;
      return h('div', { className: 'elr-panel' }, h(Reader, { t }));
    }

    // The icon seat renders inside the sidebar rail at the host's own size.
    let navT = (key) => key;
    function NavIcon(owner) {
      const size = owner && typeof owner.size === 'number' ? owner.size : 16;
      const t = owner && typeof owner.t === 'function' ? owner.t : navT;
      return h('span', { className: 'elr-nav-icon', title: t('launcher') },
        h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
          h('path', { d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H10l1.6 2H18.5A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z' }),
          h('path', { d: 'M8 12h8M8 15h5' })
        )
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        const slots = ctx.get('slots');
        // (v26 fix) The right-sidebar tab registry is NOT read here any more.
        //
        // `ctx.reflect.provide('sidebarRightTabs', …)` in
        // `@deepseek-ai/dsh-client-ui-sidebar-right` publishes the service from
        // that plugin's own apply, which can still be pending while our `apply`
        // body runs — a top-level `ctx.get('sidebarRightTabs')` then yields
        // `undefined`, the whole launcher block below is skipped, and the
        // 「开始」 panel silently loses its 文献阅读器 capsule while the
        // conversation view and sidebar row keep working (exactly the reported
        // symptom, and the live slot tree confirms no `english-lit-reader` cell
        // was ever registered).
        //
        // The service IS readable once effects run — that is how `dsh-pet`
        // registers its 桌宠对话 capsule — so the lookup moved inside the
        // `ctx.effect` below and is retried there.
        const slotService = slots;
        const dictionaries = {
          en: {
            launcher: 'Literature reader', title: 'English literature reader', close: 'Close',
            tabTitle: 'Literature', 'source.pdf': 'PDF', 'source.text': 'Text', 'tab.read': 'Read',
            'fullscreen.enter': 'Fullscreen', 'fullscreen.exit': 'Exit fullscreen', 'fullscreen.failed': 'Could not switch to or from fullscreen.',
            'pdf.drop': 'Open a paper', 'pdf.dropSub': 'Drop a PDF here or choose one from your device.',
            'pdf.dropHere': 'Release to open the PDF', 'pdf.open': 'Open PDF', 'pdf.loading': 'Loading PDF…',
            'pdf.close': 'Close paper', 'pdf.closeHint': 'Close the current paper and go back to the empty view',
            'pdf.loaded': 'PDF ready — select any sentence to translate it.', 'pdf.failed': 'Could not open this PDF.',
            'pdf.nativeFallback': 'Showing the built-in PDF preview.',
            'pdf.textReady': 'Full text extracted — paper analysis is available.',
            'pdf.extracting': 'Extracting PDF text…',
            'pdf.extractFailed': 'Could not extract the PDF text. Retry, or paste the text in the Text tab.',
            'pdf.analysisUnavailable': 'Text extraction is unavailable in the built-in preview. Paste the paper text in the Text tab to analyze it.',
            'page.prev': 'Prev', 'page.next': 'Next', 'zoom.in': 'Zoom +', 'zoom.out': 'Zoom −',
            'tab.summary': 'Paper analysis',
            paste: 'Paste or type an English paper here…', load: 'Load .txt file', clear: 'Clear', chars: 'characters',
            'selection.hint': 'Hold Shift while selecting to add another passage. Press Translate when ready.',
            'selection.appendHint': 'Hold Shift while selecting to add more text.',
            'selection.resizePanes': 'Adjust the height of the original and translation panes',
            'selection.resizePaneWidths': 'Adjust the width of the original and translation panes',
            'selection.limit': 'The translation selection is limited to {count} characters. The previous text is still in the editor.',
            'selection.empty': 'Select a sentence or paragraph in the reading pane.',
            'selection.working': 'Translating selection…', 'selection.title': 'Selection translation',
            // (v17 #3) Selecting text only stages it now, so these two strings tell the
            // reader that the model has not been called yet.
            'selection.pending': 'Text staged — press Translate to translate it.',
            'selection.translate': 'Translate',
            'selection.copy': 'Copy', 'selection.copied': 'Copied',
            'figure.select': 'Explain figure',
            'figure.title': 'Figure',
            'figure.sort': 'Sort',
            'figure.sort.document-asc': 'Document order · First to last',
            'figure.sort.document-desc': 'Document order · Last to first',
            'figure.sort.time-asc': 'Analysis time · Oldest first',
            'figure.sort.time-desc': 'Analysis time · Newest first',
            'figure.cancel': 'Cancel',
            'figure.selectHint': 'Drag a box around the figure on a single PDF page. Press Esc to cancel.',
            'figure.empty': 'Use Explain figure in the PDF toolbar to analyze a chart or diagram.',
            'figure.working': 'Analyzing the selected figure…',
            'figure.page': 'Page {page}',
            'figure.entry': 'Figure analysis',
            'generation.model': 'Model {model}',
            'generation.effort': 'Reasoning {effort}',
            'generation.time': 'Generated',
            'generation.unrecorded': 'Unrecorded',
            'generation.currentSetting': '{value} (current setting)',
            'figure.saveFailed': 'Storage is unavailable. The new analysis is available until this browser page closes.',
            'figure.tooSmall': 'Drag a larger box around the figure.',
            'figure.renderFailed': 'Could not capture the selected PDF area.',
            'figure.imageInvalid': 'This image could not be prepared. Try selecting a smaller area.',
            'figure.modelRequired': 'Choose a model with image input, such as DeepSeek Flash, then select the figure again.',
            'figure.attachmentsRequired': 'This Harness profile does not provide image attachments.',
            'figure.failed': 'Could not analyze this figure.',
            'summary.coveragePages': 'Pages examined {pages} of {total}',
            'summary.coverageText': 'Examined {count} of {total} characters',
            'summary.failed': 'Could not analyze the paper.',
            'summary.hostUnavailable': 'The paper analysis service is unavailable. Quit and reopen Harness to load the current plugin.',
            'summary.coverageFailed': '{count} excerpts failed',
            'summary.notesOnly': 'Showing available notes because synthesis failed',
            'summary.fullPass': 'Full text in one call', 'summary.sectionPass': 'Analyzed in sections',
            'summary.retrySynthesis': 'Retry synthesis', 'summary.synthesizing': 'Synthesizing saved notes…',
            'summary.synthesisError': 'Synthesis error: {error}',
            'summary.run': 'Analyze paper', 'summary.running': 'Analyzing innovations and technical approach…',
            'summary.rerun': 'Re-analyze',
            'summary.copy': 'Copy analysis', 'summary.placeholder': 'A structured analysis (innovations, technical approach, experiments, limitations) will appear here.',
            truncated: 'Note: the input was clipped to the model\'s length limit.', chunks: 'segments',
            failedChunks: 'segment(s) failed (marked inline)',
            error: 'Error', retry: 'Retry', model: 'Model', customModel: 'Custom provider / model (optional)',
            providerPlaceholder: 'provider (e.g. workbuddy)', modelPlaceholder: 'model (e.g. hy4free)',
            apply: 'Apply', defaultModel: 'Using the current default model', ready: 'Ready', minimized: 'Expand',
            'models.loading': 'Loading…', 'model.provider': 'Provider', 'model.model': 'Model',
            'model.manual': 'Manual', 'effort.label': 'Reasoning',
            'effort.follow': 'Default', 'effort.followNamed': 'Default ({effort})',
            'pan.on': 'Pan: on', 'pan.off': 'Pan: off', 'resize.panes': 'Resize the tools pane by dragging or using the arrow keys',
            'recent.title': 'Recent papers', 'recent.empty': 'No recent papers yet — open a PDF or text file.',
            'recent.remove': 'Remove', 'recent.opened': 'Opened from recent list.',
            'recent.loading': 'Opening the saved PDF…',
            'spread.on': 'Two pages', 'spread.off': 'One page',
            'spread.one': '1 page', 'spread.two': '2 pages', 'spread.three': '3 pages',
            'spread.label': 'Pages per row',
            // (v20 #3) Zoom percentage control.
            'zoom.label': 'Zoom', 'zoom.input': 'Zoom percentage (25–600) — pick a preset or type any value',
            'popup.on': 'Inline translation: on', 'popup.off': 'Inline translation: off',
            // (v46) Appearance controls moved into one settings panel.
            'settings.title': 'Display', 'settings.hint': 'Page theme, interface tone, card column and inline popup',
            'settings.panel': 'Display settings',
            'dock.label': 'Card column', 'dock.rightShort': 'Right', 'dock.bottomShort': 'Bottom',
            'dock.switch': 'Dock cards at {side}',
            'popup.label': 'Inline popup', 'popup.onShort': 'On', 'popup.offShort': 'Off',
            'popup.title': 'Selection translation', 'popup.close': 'Close',
            'popup.fontDec': 'Decrease font size', 'popup.fontInc': 'Increase font size',
            'popup.original': 'English original (editable)', 'popup.translation': '中文译文',
            'popup.retranslate': 'Re-translate', 'popup.translate': 'Translate',
            minimize: 'Minimize', expand: 'Expand', reanalyze: 'Re-analyze',
            'mark.add': 'Highlight', 'mark.note': 'Add note', 'mark.title': 'Highlights & notes',
            'mark.empty': 'Select text to add a highlight or note.',
            'mark.filter.all': 'All', 'mark.filter.hl': 'Highlights', 'mark.filter.note': 'Notes',
            'mark.filterEmpty': 'Nothing in this filter yet.',
            'mark.notePlaceholder': 'Write a note…', 'mark.remove': 'Remove',
            'mark.badgeHl': 'Highlight', 'mark.badgeNote': 'Note',
            'mark.removeHl2': 'Remove highlight', 'mark.removeNote': 'Delete note',
            'mark.locate': 'Jump to this passage', 'mark.locateFailed': 'This passage is not on the current pages — open the PDF first, then try again.',
            'mark.saved': 'Highlight saved.',
            'mark.noteSaved': 'Note saved.',
            'dark.on': 'Dark: on', 'dark.off': 'Dark: off',
            // (v28 #4) The toggle moves the whole function-card column.
            'dock.bottom': 'Card column: bottom', 'dock.right': 'Card column: right',
            'recent.hint': 'Double-click to open',
            'mark.noteTitle': 'Note', 'mark.saveNote': 'Save', 'mark.clearNote': 'Clear note', 'mark.noteCleared': 'Note cleared',
            'theme.label': 'Page theme', 'theme.default': 'Default',
            'theme.paper': 'Paper texture', 'theme.eye': 'Eye-care yellow',
            'theme.ivory': 'Soft ivory', 'theme.mist': 'Mist blue', 'theme.sage': 'Pale sage', 'theme.linen': 'Fine linen',
            'tone.label': 'Interface tone', 'tone.default': 'Follow Harness',
            'tone.light': 'Light themes', 'tone.dark': 'Dark themes',
            'tone.blue': 'Rainwashed Blue', 'tone.green': 'Pine Mist', 'tone.amber': 'Autumn Wheat', 'tone.pink': 'Rose Haze',
            'tone.navy': 'Midnight Sea', 'tone.ink': 'Ink in the Rain', 'tone.forest': 'Nightfall Pines',
            'tone.plum': 'Violet Dusk', 'tone.ember': 'Fireside Stories',
            'mark.editNote': 'Edit note', 'mark.removeHl': 'Remove highlight',
            'recent.open': 'Open', 'recent.missing': 'This PDF must be re-opened — pick the file again.',
            'formula.explain': 'Explain formula', 'formula.title': 'Formula explanation',
            // (v35 #1) 术语解释 card.
            'term.cardTitle': 'Terms', 'term.explain': 'Explain this term',
            'term.running': 'Explaining this term from the paper\'s context…',
            'term.runningShort': 'Explaining…', 'term.failed': 'Could not explain this term.',
            'term.empty': 'Right-click a word in the paper and choose 「解释术语」 to start a glossary.',
            'term.toggle': 'Show or hide the explanation', 'term.remove': 'Remove this term',
            'term.needPaper': 'Open a paper first — the explanation is grounded in its text.',
            'formula.working': 'Explaining this formula in the paper\'s context…',
            'formula.empty': 'No explanation yet.', 'formula.failed': 'Could not explain this formula.',
            'section.drag': 'Drag to reorder or float the card', 'resize.split': 'Drag to resize the two panes',
            // (v27) Function-card manager.
            'card.manage': 'Manage cards', 'card.resetLayout': 'Restore default layout',
            'card.close': 'Close this card', 'card.none': 'All cards are closed — open ⚙ above to enable one.',
            'card.dragHint': 'Drop on the page to float or in the function bar to dock',
            'card.dockEmpty': 'Drag a floating card here to dock it.',
            'card.float': 'Float card', 'card.dock': 'Dock card', 'card.floatingDrag': 'Drag to move or dock the card',
          'card.resize': 'Drag to resize this card',
          'card.floatResize': 'Drag to resize the floating card',
          'card.resizeH': 'Drag the bottom edge to change this card\'s height',
          // (v39) In-document search box in the reading toolbar.
          'find.placeholder': 'Search in document',
          'find.hint': 'Enter = next hit, Shift+Enter = previous, Esc = clear',
          'find.prev': 'Previous hit',
          'find.next': 'Next hit',
          'find.clear': 'Clear the search',
          'find.noMatches': 'No matches found in this PDF.',
          'find.searching': 'Searching in document',
            'cards.title': 'Cards',
            'box.editHint': 'Drag the bar under a box to change its height',
            // (v21 #1) Bibliography view, switched with the analysis in the same column.
            'references.title': 'References',
            'references.placeholder': 'Run the paper analysis and the bibliography with each entry\'s address will be collected here.',
            'references.running': 'Collecting references and resolving their addresses…',
            'references.run': 'Collect references',
            'references.rerun': 'Collect again',
            'references.ready': 'References: {total} entries, {found} resolved, {missing} not found.',
            'references.failed': 'Could not collect the bibliography.',
            'references.count': '{total} entries · {found} with address',
            'references.missing': 'Not found',
            'references.untitled': '(no title parsed)',
            // (v52) Progressive bibliography. The column now shows the original
            // entries first and fills in the Chinese title and the address later, so
            // it needs its own vocabulary: which stage is running, and what each
            // row's status chip actually claims.
            'references.scanProgress': '{total} references found so far',
            'references.scanPartial': 'Some parts remain unchecked. Continue to scan the remaining text or retry failed sections.',
            'references.continue': 'Continue scan',
            'references.noText': 'No selectable text in this PDF. Use OCR or paste the bibliography in the text box.',
            'references.stage.identify': 'Identifying references…',
            'references.stage.fields': 'Reading titles and authors from each entry…',
            'references.stage.resolve': 'Filling in titles and addresses…',
            'references.stage.retry': 'Retrying the unfinished entries',
            'references.segmented': 'Found {total} entries ({mode}). Addresses are being filled in.',
            'references.mode.numbered': 'numbered list',
            'references.mode.authorYear': 'author–year list',
            'references.notFound': 'The model did not find a bibliography in the scanned text. You can paste the reference section and try again.',
        'references.partial': ' · the section was cut after the last citation ({lines} lines left out)',
        'references.partialDropped': ' · {rows} numbered rows after the bibliography were not citations and were dropped',
            'references.needPaper': 'Open a PDF first: the bibliography is cached per paper.',
            'references.retry': 'Retry unfinished',
            'references.retryHint': 'Retry unfinished titles and temporarily failed address lookups',
            'references.retryNone': 'Every entry is already resolved.',
            'references.page': 'Pages',
            'references.status.provided': 'From the text',
            'references.status.matched': 'Matched',
            'references.status.confirm': 'Needs confirmation',
            'references.status.none': 'No match',
            'references.status.retry': 'Temporarily failed',
            'references.status.pending': 'Pending',
            'references.status.legacy': 'Old cache',
            'references.statusHint.provided': 'The address was verified against the original citation',
            'references.statusHint.matched': 'A single candidate matches the title, year and authors',
            'references.statusHint.confirm': 'A possible work was found, but the title, year or authors did not confirm a unique match. No link is shown.',
            'references.statusHint.none': 'Crossref and OpenAlex were both searched and nothing matched',
            'references.statusHint.retry': 'The address service was rate limited or unreachable — press retry',
            'references.statusHint.pending': 'This citation was extracted. Its bibliographic details or link still need processing. Use Retry unfinished when needed.',
            'references.statusHint.legacy': 'Saved by an older version that only stored "found" — treated as unverified',
            // (v21 #2) Launcher capsule description in the right-hand guide panel.
            'guide.desc': 'Open the literature reader in the right column',
          },
          zh: {
            launcher: '文献阅读器', title: '英文文献阅读器', close: '关闭',
            tabTitle: '文献阅读', 'source.pdf': 'PDF', 'source.text': '文本', 'tab.read': '阅读',
            'fullscreen.enter': '全屏', 'fullscreen.exit': '退出全屏', 'fullscreen.failed': '无法切换全屏。',
            'pdf.drop': '打开文献', 'pdf.dropSub': '拖入 PDF 文件，或从本机选择。',
            'pdf.dropHere': '松开即可打开 PDF', 'pdf.open': '打开 PDF', 'pdf.loading': '正在载入 PDF…',
            'pdf.close': '关闭文献', 'pdf.closeHint': '关闭当前文献，回到空白界面',
            'pdf.loaded': 'PDF 已就绪——选中任意句子即可翻译。', 'pdf.failed': '无法打开该 PDF。',
            'pdf.nativeFallback': '已切换为浏览器内置 PDF 预览。',
            'pdf.textReady': '已提取全文——可进行论文分析。',
            'pdf.extracting': '正在提取 PDF 文本…',
            'pdf.extractFailed': '无法提取 PDF 文本。请重试，或将原文粘贴到「文本」页。',
            'pdf.analysisUnavailable': '内置预览无法提取文本。可将论文原文粘贴到「文本」页进行分析。',
            'page.prev': '上一页', 'page.next': '下一页', 'zoom.in': '放大', 'zoom.out': '缩小',
            'tab.summary': '论文分析',
            paste: '在此粘贴或输入英文论文全文…', load: '载入 .txt 文件', clear: '清空', chars: '字符',
            'selection.hint': '按住 Shift 划选可追加选区，再点击「翻译」。',
            'selection.appendHint': '按住 Shift 划选可追加原文',
            'selection.resizePanes': '调整原文和译文区域的高度',
            'selection.resizePaneWidths': '调整原文和译文区域的宽度',
            'selection.limit': '选中翻译最多支持 {count} 个字符，已保留之前的内容。',
            'selection.empty': '请在阅读区选中一个句子或段落。',
            'selection.working': '正在翻译选中内容…', 'selection.title': '选中翻译',
            'selection.pending': '已选中文本，点击「翻译」后再开始翻译。',
            'selection.translate': '翻译',
            'selection.copy': '复制', 'selection.copied': '已复制',
            'figure.select': '插图解释',
            'figure.title': '图解',
            'figure.sort': '排序',
            'figure.sort.document-asc': '文中位置 · 正序',
            'figure.sort.document-desc': '文中位置 · 倒序',
            'figure.sort.time-asc': '分析时间 · 最早优先',
            'figure.sort.time-desc': '分析时间 · 最新优先',
            'figure.cancel': '取消',
            'figure.selectHint': '在同一页拖动框住插图，按 Esc 取消。',
            'figure.empty': '点击 PDF 工具栏的「插图解释」，选中要解析的图表或示意图。',
            'figure.working': '正在解析所选插图…',
            'figure.page': '第 {page} 页',
            'figure.entry': '插图解读',
            'generation.model': '模型 {model}',
            'generation.effort': '推理强度 {effort}',
            'generation.time': '生成时间',
            'generation.unrecorded': '未记录',
            'generation.currentSetting': '{value}（当前设置）',
            'figure.saveFailed': '浏览器暂时无法保存图解，这条记录可在当前页面继续查看。',
            'figure.tooSmall': '请拖动框住更完整的插图区域。',
            'figure.renderFailed': '无法截取所选的 PDF 区域。',
            'figure.imageInvalid': '无法处理该图片，请尝试框选更小的区域。',
            'figure.modelRequired': '请选择支持图像输入的模型（例如 DeepSeek Flash），再框选插图。',
            'figure.attachmentsRequired': '当前 Harness 配置未提供图片附件服务。',
            'figure.failed': '无法解析所选插图。',
            'summary.coveragePages': '已分析第 {pages} 页，共 {total} 页',
            'summary.coverageText': '已分析 {count} / {total} 字符',
            'summary.failed': '论文分析失败。',
            'summary.hostUnavailable': '论文分析服务未就绪。请完全退出并重新打开 Harness，以加载当前插件。',
            'summary.coverageFailed': '{count} 个摘录处理失败',
            'summary.notesOnly': '综合分析失败，已保留成功的分段笔记',
            'summary.fullPass': '一次全文分析', 'summary.sectionPass': '按章节分段分析',
            'summary.retrySynthesis': '仅重试汇总', 'summary.synthesizing': '正在汇总已保存的笔记…',
            'summary.synthesisError': '汇总失败原因：{error}',
            'summary.run': '分析论文', 'summary.running': '正在总结创新点与技术方案…',
            'summary.rerun': '重新分析',
            'summary.copy': '复制分析', 'summary.placeholder': '结构化分析（创新点、技术方案、实验、局限）将显示在这里。',
            truncated: '提示：输入已按模型长度上限截断。', chunks: '个分段',
            failedChunks: '个分段失败（已在文中标注）',
            error: '错误', retry: '重试', model: '模型', customModel: '自定义服务商 / 模型（可选）',
            providerPlaceholder: '服务商（如 workbuddy）', modelPlaceholder: '模型（如 hy4free）',
            apply: '应用', defaultModel: '使用当前默认模型', ready: '就绪', minimized: '展开',
            'models.loading': '加载中…', 'model.provider': '服务商', 'model.model': '模型',
            'model.manual': '手动输入', 'effort.label': '推理强度',
            'effort.follow': '默认', 'effort.followNamed': '默认（{effort}）',
            'pan.on': '拖动漫游：开', 'pan.off': '拖动漫游：关', 'resize.panes': '拖动或使用方向键调整功能栏大小',
            'recent.title': '近期阅读', 'recent.empty': '暂无记录——打开一个 PDF 或文本文件后会显示在这里。',
            'recent.remove': '移除', 'recent.opened': '已从近期阅读打开。',
            'recent.loading': '正在打开已保存的 PDF…',
            'spread.on': '双栏', 'spread.off': '单栏',
            'spread.one': '单页', 'spread.two': '双页', 'spread.three': '三页',
            'spread.label': '每行页数',
            'zoom.label': '缩放比例', 'zoom.input': '缩放百分比（25–600）——可选常用值或直接输入',
            'popup.on': '内联翻译：开', 'popup.off': '内联翻译：关',
            // (v46) 外观控件统一收进设置面板。
            'settings.title': '显示设置', 'settings.hint': '页面配色、界面配色、功能栏停靠与内联翻译浮层',
            'settings.panel': '显示设置',
            'dock.label': '功能栏停靠', 'dock.rightShort': '右侧', 'dock.bottomShort': '下方',
            'dock.switch': '将功能栏停靠到{side}',
            'popup.label': '内联翻译浮层', 'popup.onShort': '开', 'popup.offShort': '关',
            'popup.title': '选中翻译', 'popup.close': '关闭',
            'popup.fontDec': '缩小字体', 'popup.fontInc': '放大字体',
            'popup.original': '英文原文（可编辑）', 'popup.translation': '中文译文',
            'popup.retranslate': '重新翻译', 'popup.translate': '翻译',
            minimize: '最小化', expand: '展开', reanalyze: '重新分析',
            'mark.add': '高亮', 'mark.note': '批注', 'mark.title': '高亮与批注',
            'mark.empty': '选中文本后可添加高亮或批注。',
            'mark.filter.all': '全部', 'mark.filter.hl': '高亮', 'mark.filter.note': '批注',
            'mark.filterEmpty': '当前筛选下没有记录。',
            'mark.notePlaceholder': '写批注…', 'mark.remove': '移除',
            'mark.badgeHl': '高亮', 'mark.badgeNote': '批注',
            'mark.removeHl2': '移除高亮', 'mark.removeNote': '删除批注',
            'mark.locate': '跳转到该段落', 'mark.locateFailed': '在当前页面中找不到该段落——请先打开 PDF 再试。',
            'mark.saved': '已保存高亮。',
            'mark.noteSaved': '已保存批注。',
            'dark.on': '深色：开', 'dark.off': '深色：关',
            'dock.bottom': '功能栏停靠：下方', 'dock.right': '功能栏停靠：右侧',
            'recent.hint': '双击打开',
            'mark.noteTitle': '批注', 'mark.saveNote': '保存', 'mark.clearNote': '清除批注', 'mark.noteCleared': '已清除批注',
            'theme.label': '页面配色', 'theme.default': '默认',
            'theme.paper': '纸张纹理', 'theme.eye': '护眼黄',
            'theme.ivory': '柔白', 'theme.mist': '雾蓝', 'theme.sage': '浅青绿', 'theme.linen': '细麻纹',
            'tone.label': '界面配色', 'tone.default': '跟随 Harness',
            'tone.light': '浅色主题', 'tone.dark': '深色主题',
            'tone.blue': '雨后天青', 'tone.green': '山间松雾', 'tone.amber': '秋日麦穗', 'tone.pink': '蔷薇薄雾',
            'tone.navy': '深海子夜', 'tone.ink': '墨池听雨', 'tone.forest': '松林入夜',
            'tone.plum': '暮紫星河', 'tone.ember': '炉边夜话',
            'mark.editNote': '编辑批注', 'mark.removeHl': '取消高亮',
            'recent.open': '打开', 'recent.missing': '该 PDF 需要重新选择文件才能打开。',
            'formula.explain': '解释公式', 'formula.title': '公式详解',
            // (v35 #1) 术语解释卡片。
            'term.cardTitle': '术语解释', 'term.explain': '解释术语',
            'term.running': '正在结合论文内容与专业领域解释该名词…',
            'term.runningShort': '解释中…', 'term.failed': '无法解释该名词。',
            'term.empty': '在论文中右键选中一个词并选择「解释术语」，解释会收录到这里。',
            'term.toggle': '显示或关闭解释', 'term.remove': '删除该术语',
            'term.needPaper': '请先打开一篇论文，解释需要结合论文正文。',
            'formula.working': '正在结合论文内容解释该公式…',
            'formula.empty': '暂无解释。', 'formula.failed': '无法解释该公式。',
            'section.drag': '拖动排序或移出功能栏', 'resize.split': '拖动调整上下两块的高度',
            // (v27) 功能卡片管理。
            'card.manage': '管理功能卡片', 'card.resetLayout': '恢复默认布局',
            'card.close': '关闭这张卡片', 'card.none': '所有功能卡片都已关闭——点上方 ⚙ 启用。',
            'card.dragHint': '松手放在页面上，或拖回功能栏停靠',
            'card.dockEmpty': '把浮动卡片拖回这里即可停靠。',
            'card.float': '浮动卡片', 'card.dock': '停靠到功能栏', 'card.floatingDrag': '拖动移动或停靠卡片',
          'card.resize': '拖动可调整这张卡片的宽度',
          'card.floatResize': '拖动以调整浮动卡片大小',
          'card.resizeH': '拖动下边界可调整这张卡片的高度',
            // (v39) 阅读工具栏中的文中搜索框。
            'find.placeholder': '在文中搜索',
            'find.hint': '回车=下一个，Shift+回车=上一个，Esc=清空',
            'find.prev': '上一个匹配',
            'find.next': '下一个匹配',
            'find.clear': '清空搜索',
            'find.noMatches': '在这份 PDF 中没有找到匹配内容。',
            'find.searching': '正在文中搜索',
            'cards.title': '功能栏',
            'box.editHint': '拖动每个框下方的横条可单独调整高度',
            // (v21 #1) 参考文献视图，与论文分析在同一栏内切换。
            'references.title': '参考文献',
            'references.placeholder': '点击「论文分析」后，这里会同时列出参考文献及各条文献的地址。',
            'references.running': '正在整理参考文献并查找地址…',
            'references.run': '整理参考文献',
            'references.rerun': '重新整理',
            'references.ready': '参考文献：共 {total} 条，{found} 条已找到地址，{missing} 条未找到。',
            'references.failed': '无法整理参考文献。',
            'references.count': '共 {total} 条 · {found} 条有地址',
            'references.missing': '未找到',
            'references.untitled': '（未识别到标题）',
            // (v52) 渐进式参考文献：先显示原文条目，再逐批补中文标题与地址。
            'references.scanProgress': '目前已识别 {total} 条参考文献',
            'references.scanPartial': '仍有区段尚未确认，可以继续扫描或重试失败的区段。',
            'references.continue': '继续扫描',
            'references.noText': '该 PDF 没有可提取的文本。请先做 OCR，或将参考文献粘贴到文本框。',
            'references.stage.identify': '正在识别参考文献…',
            'references.stage.fields': '正在逐条识别标题与作者…',
            'references.stage.resolve': '正在补充标题和地址…',
            'references.stage.retry': '正在重试未完成的条目',
            'references.segmented': '已找到 {total} 条（{mode}），正在补充地址。',
            'references.mode.numbered': '编号列表',
            'references.mode.authorYear': '作者—年份列表',
            'references.notFound': '模型未从已检查的文本中找到参考文献。可粘贴参考文献部分后重试。',
        'references.partial': ' · 已在最后一条引文后截断（跳过 {lines} 行）',
        'references.partialDropped': ' · 参考文献之后有 {rows} 条编号行并非引文，已丢弃',
            'references.needPaper': '请先打开一份 PDF：参考文献按论文缓存。',
            'references.retry': '重试未完成',
            'references.retryHint': '只重试未补齐的标题与暂时失败的地址查询',
            'references.retryNone': '所有条目都已经处理完毕。',
            'references.page': '页码',
            'references.status.provided': '原文提供',
            'references.status.matched': '已匹配',
            'references.status.confirm': '待确认',
            'references.status.none': '无匹配',
            'references.status.retry': '暂时失败',
            'references.status.pending': '待处理',
            'references.status.legacy': '旧缓存',
            'references.statusHint.provided': '地址已经过引文原文核对',
            'references.statusHint.matched': '有唯一候选同时匹配标题、年份与作者',
            'references.statusHint.confirm': '找到可能的候选，但标题、年份或作者不足以确认唯一匹配，因此暂不显示链接。',
            'references.statusHint.none': 'Crossref 与 OpenAlex 都查过，没有匹配项',
            'references.statusHint.retry': '地址服务限流或不可达，可点「重试未完成」再跑一次',
            'references.statusHint.pending': '已从论文中识别出条目，书目信息或地址还未处理完。可用「重试未完成」继续。',
            'references.statusHint.legacy': '旧版本只存了「已找到」，视为未经当前规则验证',
            // (v21 #2) 右侧「开始」面板里的启动入口。
            'guide.desc': '在右栏打开英文文献阅读器',
          },
        };
        ctx.effect(() => {
          window.addEventListener('pagehide', flushSnapshot);
          let disposeCss = () => {};
          if (document && document.head) disposeCss = installCss();
          let disposeLocale = () => {};
          if (locale && typeof locale.register === 'function') {
            // (v23 fix) `register` THROWS when this namespace already holds a
            // dictionary for a locale — which happens on every hot reload /
            // re-enable inside one page session, because the previous
            // registration is still resident. The throw used to be swallowed by
            // an empty catch, so `t()` kept reading the OLD dictionary and any
            // key added in the new version rendered as its raw key name
            // (`mark.badgeNote`, `mark.removeNote`). Registering per locale keeps
            // a partial failure from dropping the other language, and the
            // fallback below guarantees a raw key can never reach the UI.
            for (const [code, dict] of Object.entries(dictionaries)) {
              try {
                const off = locale.register(NS, code, dict);
                if (typeof off === 'function') {
                  const previous = disposeLocale;
                  disposeLocale = () => {
                    try { off(); } catch (_) {}
                    try { previous(); } catch (_) {}
                  };
                }
              } catch (_) {}
            }
          }
          const boundT = locale && typeof locale.bind === 'function' ? locale.bind(NS) : null;
          const activeLocaleId = () => {
            try {
              const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null;
              return snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en';
            } catch (_) { return 'en'; }
          };
          // Resolve through the locale service first, then the inline
          // dictionaries. The inline path is what makes a stale or missing
          // registration harmless instead of visible.
          const t = (key, params) => {
            let value = boundT ? boundT(key, params) : undefined;
            if (typeof value !== 'string' || value === key) {
              const dict = activeLocaleId().indexOf('zh') === 0 ? dictionaries.zh : dictionaries.en;
              const inline = dict && dict[key] !== undefined ? dict[key] : dictionaries.en[key];
              if (typeof inline === 'string') value = inline;
            }
            if (typeof value !== 'string') return key;
            if (!params) return value;
            return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
          };
          viewT = t;
          panelT = t;
          navT = t;
          // (v11 #2) `layout` clears the selected panel on dispose: leaving a stale
          // `activePanelId` behind would render an empty centre column after the
          // plugin is disabled. It is a plain service read (`ctx.get`) — `layout`
          // is declared in `dsh.client.inject` in package.json, so the bundle
          // loads after it and the read is safe; a host without it yields
          // undefined and the row simply disappears.
          let layout;
          try { layout = ctx.get('layout'); } catch (_) { layout = undefined; }
          // ---- (v23 #5) Track the host light/dark scheme ----
          // `theme` is an optional client service; when it is missing we fall back
          // to sampling `--dsw-alias-bg-base` on every root attribute change, which
          // covers hosts that only toggle a class on <html>.
          let disposeTheme = () => {};
          const applyScheme = (snapshot) => {
            const active = snapshot && snapshot.active ? snapshot.active : null;
            const schemeValue = active && typeof active.colorScheme === 'string' ? active.colorScheme : '';
            if (schemeValue === 'dark' || schemeValue === 'light') setHostScheme(schemeValue);
            else setHostScheme(readSchemeFromCss());
          };
          let themeService;
          try { themeService = ctx.get('theme'); } catch (_) { themeService = undefined; }
          if (themeService && typeof themeService.getTheme === 'function') {
            try { applyScheme(themeService.getTheme()); } catch (_) { setHostScheme(readSchemeFromCss()); }
            // `theme/change` is an emitted Client event with the ThemeSnapshot as
            // its only argument; `ctx.on` returns the disposer.
            try {
              const offTheme = ctx.on('theme/change', (snapshot) => { applyScheme(snapshot); });
              if (typeof offTheme === 'function') disposeTheme = () => { try { offTheme(); } catch (_) {} };
            } catch (_) {}
          }
          let schemeObserver = null;
          try {
            if (typeof MutationObserver === 'function' && document && document.documentElement) {
              setHostScheme(readSchemeFromCss());
              schemeObserver = new MutationObserver(() => {
                // Skip the CSS probe entirely when the service is authoritative.
                if (themeService && typeof themeService.getTheme === 'function') {
                  try { applyScheme(themeService.getTheme()); return; } catch (_) {}
                }
                setHostScheme(readSchemeFromCss());
              });
              schemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
            }
          } catch (_) { schemeObserver = null; }
          const disposeSchemeObserver = () => {
            try { if (schemeObserver) schemeObserver.disconnect(); } catch (_) {}
            try { disposeTheme(); } catch (_) {}
          };
          const NOOP = () => {};
          let disposeView = () => {};
          let disposePanel = () => {};
          let disposeRow = () => {};
          // (v21 #2) Three disposers for the guide-panel launcher: the tab type,
          // the page body and the tab chip title.
          let disposeGuideTab = NOOP;
          let disposeGuideBody = NOOP;
          let disposeGuideTitle = NOOP;
          if (slots && typeof slots.inject === 'function') {
            disposeView = slots.inject('conversation.view', () => slots.register({
              name: 'conversation.view',
              id: 'english-lit-reader',
              order: 20,
              label: () => t('tabTitle'),
              locale: NS,
            }, View)) || (() => {});
            // (v44 #1) No `shell.overlay` registration any more: the launcher button
            // that floated over every screen (and the full-screen overlay it opened)
            // was removed on request. Five seats remain.
            // (v11 #2) The two seats a sidebar tool needs: a KEYED `main` panel
            // (what the row opens) and the `sidebar.panellist` row itself. They are
            // registered independently because `main` may be declared later than
            // the sidebar — `slots.inject` queues until the slot exists, so no
            // declaration order is assumed.
            disposePanel = slots.inject('main', () => slots.register({
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t }),
            }, Panel)) || (() => {});
            disposeRow = slots.inject('sidebar.panellist', () => slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 4,
              label: () => t('launcher'),
              locale: NS,
            }, NavIcon)) || (() => {});
            // ---- (v21 #2) Launcher entry inside the right-hand "开始" panel ----
            //
            // That panel is the right sidebar's GUIDE tab, and its capsules come
            // from the tab registry, not from a slot list. A page type therefore
            // needs the two-stage registration the shipped `files` type uses:
            //   1. `sidebarRightTabs.register({ id, kind, title, guide })` —
            //      `guide` is what renders the capsule, `kind` is what the capsule
            //      opens;
            //   2. a `sidebar.right.pane.tab` registration keyed by the SAME `id`,
            //      which is the component shown once that page is open.
            //
            // (v26 fix) The registry is resolved HERE, inside the effect, and
            // retried. Reading it at the top of `apply` gave `undefined` whenever
            // the sidebar-right plugin had not provided the service yet, which
            // silently dropped the capsule. `dsh-pet` succeeds because it looks
            // the service up while its own effects run; we now do the same and
            // keep retrying for a few hundred milliseconds, because plugin apply
            // order is not guaranteed either way.
            let guideTimer = null;
            let guideAttempts = 0;
            const GUIDE_RETRY_MS = 120;
            const GUIDE_MAX_ATTEMPTS = 12;
            const installGuide = () => {
              guideTimer = null;
              if (disposeGuideTab !== NOOP || disposeGuideBody !== NOOP) return;
              let tabs;
              try { tabs = ctx.get('sidebarRightTabs'); } catch (_) { tabs = undefined; }
              if (!tabs || typeof tabs.register !== 'function') {
                guideAttempts += 1;
                if (guideAttempts < GUIDE_MAX_ATTEMPTS) {
                  guideTimer = setTimeout(installGuide, GUIDE_RETRY_MS);
                } else if (typeof console !== 'undefined' && console && console.warn) {
                  // Visible in the browser console only; the reader itself keeps
                  // working through the conversation view and the sidebar row.
                  console.warn('[english-lit-reader] sidebarRightTabs unavailable — 右侧「开始」入口未注册');
                }
                return;
              }
              try {
                disposeGuideTab = tabs.register({
                  id: GUIDE_TAB_ID,
                  kind: GUIDE_TAB_ID,
                  title: () => t('launcher'),
                  guide: [{
                    id: GUIDE_TAB_ID,
                    order: 20,
                    title: () => t('launcher'),
                    description: () => t('guide.desc'),
                    icon: NavIcon,
                  }],
                }) || NOOP;
              } catch (_) {
                // A duplicate id/kind from a previous generation is the only
                // realistic throw here; the body/title registrations below are
                // still worth installing so an existing type keeps its page.
                disposeGuideTab = NOOP;
              }
              if (slotService && typeof slotService.inject === 'function') {
                try {
                  disposeGuideBody = slotService.inject('sidebar.right.pane.tab', () => slotService.register({
                    name: 'sidebar.right.pane.tab',
                    key: GUIDE_TAB_ID,
                    locale: NS,
                    inject: () => ({ t }),
                  }, Panel)) || NOOP;
                  disposeGuideTitle = slotService.inject('sidebar.right.pane.tab.title', () => slotService.register({
                    name: 'sidebar.right.pane.tab.title',
                    key: GUIDE_TAB_ID,
                    locale: NS,
                  }, () => h('span', null, t('launcher')))) || NOOP;
                } catch (_) {}
              }
            };
            installGuide();
          }
          return () => {
            window.removeEventListener('pagehide', flushSnapshot);
            flushSnapshot();
            // Leaving a stale `activePanelId` behind would render an empty centre
            // column after the plugin is disabled, so reset it first.
            try {
              const info = layout && layout.panelInfo && layout.panelInfo.getSnapshot ? layout.panelInfo.getSnapshot() : null;
              if (info && info.activePanelId === PANEL_ID) layout.selectPanel(null);
            } catch (_) {}
            try { disposeRow(); } catch (_) {}
            try { if (guideTimer) clearTimeout(guideTimer); } catch (_) { guideTimer = null; }
            try { disposeGuideTitle(); } catch (_) {}
            try { disposeGuideBody(); } catch (_) {}
            try { disposeGuideTab(); } catch (_) {}
            try { disposePanel(); } catch (_) {}
            try { disposeView(); } catch (_) {}
            try { disposeSchemeObserver(); } catch (_) {}
            try { disposeLocale(); } catch (_) {}
            try { disposeCss(); } catch (_) {}
          };
        }, 'english-lit-reader: conversation view + PDF reader');
      },
    };
  },
});

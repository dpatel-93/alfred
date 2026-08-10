// Alfred chunk-level retrieval — splits a note's markdown into heading-aware
// passages ("chunks"), builds the text sent to the embedder for a chunk, and
// ranks chunks against a query vector (with a keyword-overlap fallback for
// when no vectors are available).
//
// This module is PURE — no file I/O, no network calls, no side effects.
// index-vault.mjs (owned by data-pipeline-eng) imports chunkNote() and
// buildEmbedText() from here, calls its own Ollama embed(), and attaches the
// resulting vector to each chunk record before writing index.json. query.mjs
// (owned by this file's author) imports rankChunks() and cosineSim().
//
// ---------------------------------------------------------------------------
// CHUNK RECORD CONTRACT
// ---------------------------------------------------------------------------
// chunkNote() returns records of this shape:
//   {
//     heading:      string | null,  // leaf heading text this chunk belongs to
//                                    // (e.g. "Delivered"), or null if the note
//                                    // (or the text before its first heading)
//                                    // has no heading.
//     headingPath:  string | null,  // full ancestor breadcrumb, e.g.
//                                    // "Alfred > Current State (2026-08-08) > Delivered",
//                                    // or null when heading is null.
//     text:         string,         // raw chunk text as it appears in the note
//                                    // (NOT prefixed for embedding) — used for
//                                    // display/context. May include a short
//                                    // leading "... " overlap fragment borrowed
//                                    // from the previous chunk in the same
//                                    // section (see CHUNK_OVERLAP_CHARS below);
//                                    // that borrowed fragment is NOT reflected
//                                    // in charStart.
//     charStart:    number,         // offset into the ORIGINAL note content
//                                    // where this chunk's own (non-borrowed)
//                                    // text begins.
//     charEnd:      number,         // offset into the ORIGINAL note content
//                                    // where this chunk's own text ends.
//   }
//
// index-vault.mjs is expected to add exactly one field per chunk after
// embedding it:
//   vector: number[] | null   // 768-dim nomic-embed vector, or null if
//                              // embedding failed (mirrors how note.vector
//                              // already degrades on Ollama failure).
//
// The resulting array is attached to the note object as a NEW field,
// alongside (never replacing) the existing note-level fields server.mjs
// depends on:
//   notes[i].chunks = [...]
//
// rankChunks() below tolerates notes with `chunks` missing or `[]` (e.g. a
// note that predates this feature, or whose embedding failed at index time).
// ---------------------------------------------------------------------------

// --- Tunable constants ---------------------------------------------------
// Measured against two real vault notes (25,362 chars / 18 headings, and
// 27,577 chars / 22 headings) before picking these. The numbers are kept
// because they are why the constants are what they are; the note titles are
// not, because they were one person's project files:
//   - Section size between consecutive headings (any level): avg 1250-1410,
//     median 1000-1200, max 4362-5191. That confirms a ~1200-char soft
//     target (most sections land close to it as a single chunk) and a
//     ~2000-char hard ceiling (only the 2 largest sections per note need
//     further splitting) — both starting values held up, no change needed.
//   - Paragraph size (blank-line-separated) within those big sections: avg
//     617-1019, max 2187-3438. The 3438-char outlier is a long undivided
//     bullet list (a "Header now:" style block with no blank lines
//     between bullets) — it will not be reduced by paragraph-splitting
//     alone and needs the sentence-boundary fallback, which is why that
//     fallback exists as a real (not theoretical) path, not just an edge case.
const CHUNK_TARGET_CHARS = 1200;
const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 150;
const CHUNK_PREFIX = true;
const RETRIEVAL_TOP_K = 5;

// --- Small range/text helpers --------------------------------------------

// Trims whitespace off a [start, end) range of `content` without copying,
// returning an adjusted [start, end).
function trimRange(content, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(content[s])) s++;
  while (e > s && /\s/.test(content[e - 1])) e--;
  return [s, e];
}

// Splits content[start,end) on a separator regex, returning the ranges of
// the pieces BETWEEN separators (not the separators themselves), as
// [absoluteStart, absoluteEnd] pairs. Never returns empty/whitespace-only
// pieces.
function splitOnRegex(content, start, end, sepRegex) {
  const text = content.slice(start, end);
  const flags = sepRegex.flags.includes('g') ? sepRegex.flags : `${sepRegex.flags}g`;
  const re = new RegExp(sepRegex.source, flags);
  const pieces = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) pieces.push([start + last, start + m.index]);
    last = m.index + (m[0].length || 1);
  }
  if (last < text.length) pieces.push([start + last, end]);
  return pieces
    .map(([s, e]) => trimRange(content, s, e))
    .filter(([s, e]) => e > s);
}

// Breaks a [start, end) range that is too long into atomic pieces that are
// each <= maxChars, preferring (in order): paragraph boundaries (blank
// lines), then sentence boundaries (. ! ? followed by whitespace), then bare
// newlines (covers undivided bullet-list blocks with no blank lines and no
// terminal punctuation), then — only as an absolute last resort, for a
// single unbroken run of text longer than maxChars with no whitespace to
// break on nearby — a hard cut at the nearest word boundary at or before
// maxChars. That last path is the only one that can produce a mid-sentence
// cut; every other path never does.
function atomizeRange(content, start, end, maxChars) {
  const atoms = [];
  const paragraphs = splitOnRegex(content, start, end, /\n[ \t]*\n+/);
  for (const [ps, pe] of paragraphs) {
    if (pe - ps <= maxChars) {
      atoms.push([ps, pe]);
      continue;
    }
    const sentences = splitOnRegex(content, ps, pe, /(?<=[.!?])\s+/);
    for (const [ss, se] of sentences) {
      if (se - ss <= maxChars) {
        atoms.push([ss, se]);
        continue;
      }
      const lines = splitOnRegex(content, ss, se, /\n+/);
      for (const [ls, le] of lines) {
        if (le - ls <= maxChars) {
          atoms.push([ls, le]);
          continue;
        }
        // Last resort: hard-slice at the nearest preceding space.
        let cur = ls;
        while (cur < le) {
          let cut = Math.min(cur + maxChars, le);
          if (cut < le) {
            const wsIdx = content.lastIndexOf(' ', cut);
            if (wsIdx > cur) cut = wsIdx;
          }
          atoms.push([cur, cut]);
          cur = cut;
          while (cur < le && /\s/.test(content[cur])) cur++;
        }
      }
    }
  }
  return atoms;
}

// Greedily merges consecutive atoms into groups, stopping a group once it
// has reached targetChars (soft) and never letting a group exceed maxChars
// (hard). Operates on ranges directly against `content` so the resulting
// chunk text is the literal original substring (preserves original
// formatting between merged pieces) rather than a rejoined approximation.
function packRanges(content, ranges, targetChars, maxChars) {
  const groups = [];
  let gs = null;
  let ge = null;
  for (const [s, e] of ranges) {
    if (gs === null) {
      gs = s;
      ge = e;
      continue;
    }
    const mergedLen = e - gs;
    if (mergedLen <= maxChars && ge - gs < targetChars) {
      ge = e;
    } else {
      groups.push([gs, ge]);
      gs = s;
      ge = e;
    }
  }
  if (gs !== null) groups.push([gs, ge]);
  return groups;
}

// --- Heading-aware section splitting --------------------------------------

// Finds all ATX headings (#..######) in `content`, skipping any that appear
// inside fenced code blocks (``` or ~~~) so a commented-out "# heading" in a
// code sample never gets treated as real vault structure.
function parseHeadings(content) {
  const lines = content.split('\n');
  const fenceRe = /^\s*(```|~~~)/;
  const headingRe = /^(#{1,6})\s+(.*)$/;
  const headings = [];
  let idx = 0;
  let inFence = false;
  for (const line of lines) {
    if (fenceRe.test(line)) {
      inFence = !inFence;
      idx += line.length + 1;
      continue;
    }
    if (!inFence) {
      const m = line.match(headingRe);
      if (m) {
        headings.push({ level: m[1].length, text: m[2].trim(), lineStart: idx, lineEnd: idx + line.length + 1 });
      }
    }
    idx += line.length + 1;
  }
  return headings;
}

// Splits the note into leaf sections: one per heading occurrence (any
// level), each running from just after its heading line to just before the
// NEXT heading of any level. Nesting is preserved via `headingPath`, a
// breadcrumb built from the stack of currently-open ancestor headings
// ("H1 > H2 > H3"), rather than by bundling a parent heading's subsections
// into one oversized unit — that would either duplicate text across
// overlapping units or bury a subsection's own heading identity inside a
// giant undifferentiated chunk, both worse for passage retrieval than a
// leaf-level split with a breadcrumb.
//
// A note with no headings at all returns a single section covering the
// whole note (heading/headingPath both null) — the paragraph-boundary
// fallback path described in the module contract.
function buildLeafSections(content) {
  const headings = parseHeadings(content);
  if (headings.length === 0) {
    return [{ heading: null, headingPath: null, bodyStart: 0, bodyEnd: content.length }];
  }
  const sections = [];
  if (headings[0].lineStart > 0) {
    sections.push({ heading: null, headingPath: null, bodyStart: 0, bodyEnd: headings[0].lineStart });
  }
  const stack = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push({ level: h.level, text: h.text });
    const headingPath = stack.map((s) => s.text).join(' > ');
    const bodyStart = h.lineEnd;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].lineStart : content.length;
    sections.push({ heading: h.text, headingPath, bodyStart, bodyEnd });
  }
  return sections;
}

// --- Public API ------------------------------------------------------------

/**
 * Splits one note's markdown content into chunk records. Pure function —
 * does not know or care about the note's title/path/mtime; the caller
 * (index-vault.mjs) attaches those. See the module-level contract comment
 * above for the exact chunk record shape.
 *
 * `title` is accepted for interface stability (buildEmbedText is the
 * function that actually incorporates it) but is not itself read here.
 */
function chunkNote({
  title, // accepted for signature stability; see buildEmbedText for where title is actually used
  content,
  targetChars = CHUNK_TARGET_CHARS,
  maxChars = CHUNK_MAX_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
} = {}) {
  void title;
  if (typeof content !== 'string' || !content.trim()) return [];

  const sections = buildLeafSections(content);
  const chunks = [];

  for (const section of sections) {
    const [bs, be] = trimRange(content, section.bodyStart, section.bodyEnd);
    if (be <= bs) continue; // heading immediately followed by another heading — empty body

    if (be - bs <= maxChars) {
      chunks.push({
        heading: section.heading,
        headingPath: section.headingPath,
        text: content.slice(bs, be),
        charStart: bs,
        charEnd: be,
      });
      continue;
    }

    const atoms = atomizeRange(content, bs, be, maxChars);
    const groups = packRanges(content, atoms, targetChars, maxChars);

    groups.forEach(([gs, ge], i) => {
      let text = content.slice(gs, ge);
      if (i > 0 && overlapChars > 0) {
        const prevGs = groups[i - 1][0];
        const prevGe = groups[i - 1][1];
        let overlapStart = Math.max(prevGs, prevGe - overlapChars);
        const spaceIdx = content.indexOf(' ', overlapStart);
        if (spaceIdx !== -1 && spaceIdx < prevGe) overlapStart = spaceIdx + 1;
        const overlapText = content.slice(overlapStart, prevGe).trim();
        if (overlapText) text = `${overlapText} … ${text}`;
      }
      chunks.push({
        heading: section.heading,
        headingPath: section.headingPath,
        text,
        charStart: gs,
        charEnd: ge,
      });
    });
  }

  return chunks;
}

/**
 * Builds the exact string index-vault.mjs should send to the embedder for a
 * given chunk. Honors CHUNK_PREFIX: when true, prefixes the note title and
 * the chunk's heading breadcrumb ahead of the text, matching the
 * "search_document: <title>\n\n<body>" convention index-vault.mjs already
 * uses at note level (nomic-embed-text needs this task prefix — see
 * index-vault.mjs's own comment on EMBED_CHARS/embedInput).
 */
function buildEmbedText({ noteTitle, chunk }) {
  const body = chunk && typeof chunk.text === 'string' ? chunk.text : '';
  if (!CHUNK_PREFIX) return `search_document: ${body}`;
  const title = noteTitle || '';
  let headingPart = '';
  if (chunk && chunk.headingPath) {
    // Most notes open with an H1 matching the filename/title (e.g. "# Alfred"
    // in Alfred.md) — without this, headingPath's leading segment duplicates
    // noteTitle verbatim ("Alfred > Alfred > Purpose"). Drop that redundant
    // leading segment rather than embed the same token twice.
    const segments = chunk.headingPath.split(' > ');
    if (segments[0].trim().toLowerCase() === title.trim().toLowerCase()) segments.shift();
    if (segments.length > 0) headingPart = ` > ${segments.join(' > ')}`;
  }
  return `search_document: ${title}${headingPart}\n\n${body}`;
}

// Same cosine similarity math already duplicated in query.mjs/server.mjs/
// index-vault.mjs — kept consistent with those (dot / (sqrt(na)*sqrt(nb) || 1))
// rather than "fixed" here, since this file isn't the place to de-duplicate
// three other files it doesn't own.
function cosineSim(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Field-weighted term overlap for a single chunk, mirroring server.mjs's
// lexicalScore() for notes (title/keywords/excerpt/folder) — specifically its
// title.includes(t) -> +3 weighting, server.mjs's single strongest lexical
// field (see server.mjs rankNotes(), ~line 2318). A chunk-only score (as
// originally shipped here) is blind to the note title, which is exactly the
// field a query term is most likely to hit (e.g. a note titled "Contoso Media"
// answering a "contoso" query even when no heading/body text mentions it) — so
// `note` is a required second argument here, not chunk-only. headingPath (the
// breadcrumb, which already carries the leaf heading text as its last
// segment) counts for less, and the chunk body text counts for the least.
// Normalized by terms.length * 3 so it lands on roughly the same 0..1 scale
// as cosine similarity for blending.
function lexicalScoreChunk(terms, note, chunk) {
  if (!terms.length) return 0;
  const title = String(note && note.title || '').toLowerCase();
  const headingPath = String(chunk.headingPath || '').toLowerCase();
  const text = String(chunk.text || '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 3;
    if (headingPath.includes(t)) score += 2;
    if (text.includes(t)) score += 1;
  }
  return score / (terms.length * 3);
}

/**
 * Ranks chunks across every note against a query vector. Degrades gracefully
 * in every direction:
 *   - a note with no `chunks` field, or an empty `chunks` array, contributes
 *     nothing and never throws;
 *   - a chunk with `vector == null` (embedding failed at index time) is
 *     skipped from vector scoring;
 *   - if NO chunk anywhere has a vector (e.g. Ollama was down for the whole
 *     indexing run, or the query embed itself failed and queryVector is
 *     missing), falls back to a simple term-overlap score against
 *     `queryText` so retrieval still returns something instead of nothing.
 */
function rankChunks({ notes, queryVector, queryText, topK = RETRIEVAL_TOP_K } = {}) {
  const noteList = Array.isArray(notes) ? notes : [];
  const flat = [];
  for (const note of noteList) {
    const chunks = Array.isArray(note && note.chunks) ? note.chunks : [];
    for (const chunk of chunks) {
      if (chunk && typeof chunk.text === 'string') flat.push({ note, chunk });
    }
  }

  const withVectors = Array.isArray(queryVector)
    ? flat.filter(({ chunk }) => Array.isArray(chunk.vector))
    : [];

  let scored;
  if (withVectors.length > 0) {
    // Restores the same 0.8 semantic / 0.2 lexical blend server.mjs's
    // rankNotes() already uses live for note-level ranking (see server.mjs's
    // rankNotes(), ~line 2318) — pure cosine alone let two real questions'
    // target chunks rank far too low (see retrieval-eval.mjs). This is the
    // proven live weighting, not a value tuned to any one eval question set.
    const terms = String(queryText || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
    scored = withVectors.map(({ note, chunk }) => {
      const sem = cosineSim(queryVector, chunk.vector);
      const lex = lexicalScoreChunk(terms, note, chunk);
      return {
        path: note.path,
        title: note.title,
        folder: note.folder,
        heading: chunk.heading ?? null,
        headingPath: chunk.headingPath ?? null,
        text: chunk.text,
        score: sem * 0.8 + lex * 0.2,
      };
    });
  } else if (flat.length > 0) {
    const terms = String(queryText || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
    scored = flat.map(({ note, chunk }) => {
      const haystack = chunk.text.toLowerCase();
      const hits = terms.filter((t) => haystack.includes(t)).length;
      return {
        path: note.path,
        title: note.title,
        folder: note.folder,
        heading: chunk.heading ?? null,
        headingPath: chunk.headingPath ?? null,
        text: chunk.text,
        score: terms.length > 0 ? hits / terms.length : 0,
      };
    });
  } else {
    scored = [];
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export {
  CHUNK_TARGET_CHARS,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_PREFIX,
  RETRIEVAL_TOP_K,
  chunkNote,
  buildEmbedText,
  rankChunks,
  cosineSim,
};

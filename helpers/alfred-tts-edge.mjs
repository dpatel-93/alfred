#!/usr/bin/env node
// --- alfred-tts-edge.mjs ----------------------------------------------------
// Renders text to an MP3 using Microsoft's neural voices, via the service Edge
// itself uses for read-aloud. Free, uncapped, no account, no API key, and it
// sounds like a person rather than a 2013 speech synthesiser.
//
// Two things to know before relying on it:
//   1. It needs the network. Every caller must have a fallback, and the
//      launcher does — the built-in system voice.
//   2. It is the endpoint Edge uses, not a published API, so Microsoft can
//      change it without notice. Acceptable for a personal talk-back; it would
//      not be acceptable in anything shipped to other people.
//
// Text arrives via a FILE, never an argument. Responses routinely contain
// quotes, newlines and backticks, and on Windows a shell reassembles argv
// unescaped — this project has been bitten by that twice already.
//
// CLI:  node alfred-tts-edge.mjs --text-file <in.txt> --out <out.mp3>
//                                [--voice en-GB-RyanNeural] [--rate -10..10]
// Exit: 0 wrote the file · 3 dependency missing · 4 synthesis failed
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const DEFAULT_VOICE = 'en-GB-RyanNeural';

/**
 * msedge-tts is the one non-stdlib dependency talk-back has, and it is NOT in
 * the repo (node_modules is ignored), so a fresh machine will not have it until
 * `npm install` has run here. Look in both places it can legitimately live, and
 * report its absence as a distinct exit code so the launcher can fall back to
 * the system voice instead of producing silence — which is indistinguishable
 * from a broken speaker.
 */
export function loadEdgeTts(extraRoots = []) {
  const roots = [
    path.join(HERE, 'node_modules', 'msedge-tts', 'dist', 'index.js'),
    ...extraRoots,
  ];
  const repo = repoRoot();
  if (repo) roots.push(path.join(repo, 'brain', 'node_modules', 'msedge-tts', 'dist', 'index.js'));
  for (const p of roots) {
    try { if (fs.existsSync(p)) return require(p); } catch { /* try the next one */ }
  }
  return null;
}

/** The repo path from the operator's own profile — it differs per machine. */
function repoRoot() {
  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.claude', 'alfred-profile.md'), 'utf8');
    const m = text.match(/^\s*-\s*\*\*Alfred repo location\*\*:\s*(.+)$/m);
    const value = m && m[1].replace(/\s*\(.*?\)\s*$/, '').trim();
    return value && !/^\(?not specified\)?$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** -10..10, the scale the rest of talk-back uses, to the percentage SSML wants. */
export function rateToPercent(rate) {
  const n = Number.isFinite(Number(rate)) ? Number(rate) : 0;
  const pct = Math.round(Math.max(-10, Math.min(10, n)) * 10);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

export function synthesize(mod, { text, voice, rate, out }) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
  return new Promise((resolve, reject) => {
    // Without a ceiling a network stall would hold the launcher open forever,
    // and the next answer could never interrupt it.
    const timer = setTimeout(() => reject(new Error('timed out')), 30000);
    (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        { rate: rateToPercent(rate) });
      // toStream, not toFile: toFile owns its own temp path and its cleanup
      // unlinks a file that never existed when the request fails, throwing over
      // the top of the real error.
      const { audioStream } = tts.toStream(text);
      const chunks = [];
      audioStream.on('data', (d) => chunks.push(d));
      audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
      audioStream.on('close', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (!buf.length) return reject(new Error('empty audio'));
        fs.writeFileSync(out, buf);
        resolve(buf.length);
      });
    })().catch((e) => { clearTimeout(timer); reject(e); });
  });
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const textFile = arg('text-file');
  const out = arg('out');
  const voice = arg('voice', DEFAULT_VOICE);
  const rate = arg('rate', '0');

  if (!textFile || !out) {
    console.error('usage: --text-file <in.txt> --out <out.mp3> [--voice <name>] [--rate <-10..10>]');
    process.exit(2);
  }

  const mod = loadEdgeTts();
  if (!mod) {
    console.error('msedge-tts not installed — run `npm install` in ~/.claude/helpers');
    process.exit(3);
  }

  let text = '';
  try { text = fs.readFileSync(textFile, 'utf8').trim(); } catch { /* handled below */ }
  if (!text) { console.error('no text'); process.exit(4); }

  try {
    const bytes = await synthesize(mod, { text, voice, rate, out });
    // stdout, not stderr. The PowerShell launcher runs with
    // $ErrorActionPreference='Stop', which turns ANY native stderr write into a
    // terminating error — so announcing success on stderr made a working
    // synthesis look like a crash, and talk-back fell back to the robotic voice
    // while reporting "ok" as the reason. Observed, not theorised.
    console.log(`ok ${bytes} bytes -> ${out}`);
    process.exit(0);
  } catch (e) {
    console.error(`synthesis failed: ${String(e.message).slice(0, 200)}`);
    process.exit(4);
  }
}

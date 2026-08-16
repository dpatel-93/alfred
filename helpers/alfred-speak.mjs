#!/usr/bin/env node
// --- alfred-speak.mjs ------------------------------------------------------
// Talk-back for Claude Code: reads the final assistant message of a turn and
// speaks it aloud through the Windows built-in speech engine.
//
// Registered as a Stop hook. It NEVER blocks: it cleans the text, hands it to
// a detached PowerShell process, and exits. Every failure path exits 0, because
// a broken speaker must never break a session.
//
// CLI:  node alfred-speak.mjs on | off | status | list | voice <name>
//                             rate <-10..10> | test | say "<text>" | dry
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- Configuration ---------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, 'alfred-speak.config.json');
const QUEUE_PATH = path.join(HERE, '.alfred-speak-queue.txt');
const PID_PATH = path.join(HERE, '.alfred-speak.pid');
const PS_SCRIPT = path.join(HERE, 'alfred-speak.ps1');
const TASK_NAME = 'AlfredSpeak';
const TAIL_BYTES = 2 * 1024 * 1024; // transcripts grow unbounded; only the end matters

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const DEFAULTS = {
  enabled: true,
  // On macOS an empty voice means "the system voice", which is guaranteed to
  // exist. Naming a voice that was never downloaded silences the hook, and a
  // silent speaker is indistinguishable from a broken one.
  voice: IS_WINDOWS ? 'Microsoft Zira Desktop' : '',
  // Normalised -10..10 on BOTH platforms so "/speak rate 3" means the same
  // thing everywhere. macOS is told words-per-minute; the mapping is below.
  rate: 1,
  volume: 95,
  maxChars: 700,
  minChars: 2,
  // The HUD's spoken welcome. Separate from `enabled` because wanting Claude to
  // read its answers and wanting the dashboard to greet you are different
  // appetites — and the greeting fires without you having asked for anything.
  // `enabled: false` still silences it: talk-back off means the machine is quiet.
  greetOnEnter: true,
  // 'brief' speaks the lead paragraph only — the conclusion, not the whole
  // answer. The screen already holds the detail, and asking for it is one
  // sentence away. 'full' restores reading the entire response aloud.
  brevity: 'brief',
  briefSentences: 2,
  // 'edge'   — Microsoft's neural voices. Natural, free, uncapped, needs the
  //            network, and falls back to 'system' automatically when it fails.
  // 'system' — the built-in OS voice. Instant and always available; on Windows
  //            that means the 2013-era SAPI voices, which is the sound this
  //            setting exists to get away from.
  engine: 'edge',
  edgeVoice: 'en-GB-RyanNeural',
};

/** The neural voices worth naming — the shortlist, not the full catalogue. */
const EDGE_VOICES = {
  ryan: 'en-GB-RyanNeural',
  sonia: 'en-GB-SoniaNeural',
  ava: 'en-US-AvaNeural',
  emma: 'en-US-EmmaNeural',
  andrew: 'en-US-AndrewNeural',
  brian: 'en-US-BrianNeural',
};

// The config file is deliberately per-machine (alfred-sync never copies it), so
// a Mac and a PC keep their own voice without any platform-scoped keys.

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// --- Text cleaning ---------------------------------------------------------
// Markdown read aloud verbatim is unlistenable. Code blocks, tables, URLs and
// absolute paths are the worst offenders and are removed rather than spoken.

function cleanForSpeech(raw, maxChars) {
  let t = String(raw);

  t = t.replace(/```[\s\S]*?```/g, ' . ');            // fenced code blocks
  t = t.replace(/^\s*\|.*\|\s*$/gm, '');              // table rows
  t = t.replace(/^\s*\|?[-:\s|]{4,}\|?\s*$/gm, '');   // table separators
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');         // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');      // links keep their label
  t = t.replace(/https?:\/\/\S+/g, 'a link');
  t = t.replace(/`([^`\n]{1,40})`/g, '$1');           // short inline code is readable
  t = t.replace(/`[^`\n]*`/g, 'that');                // long inline code is not
  t = t.replace(/[A-Za-z]:[\\/][^\s`"']{3,}/g, 'a file path');
  t = t.replace(/(?:^|\s)[~.]{0,2}[\\/][^\s`"']*[\\/][^\s`"']+/g, ' a file path');
  t = t.replace(/^#{1,6}\s*/gm, '');                  // headings
  t = t.replace(/^\s*>\s?/gm, '');                    // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, '');                // bullet markers
  t = t.replace(/^\s*\d+\.\s+/gm, '');                // ordered list markers
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, '');           // horizontal rules
  t = t.replace(/\*\*|__|~~|\*|(?<=\w)_(?=\w)/g, ''); // emphasis
  // Normalise typographic punctuation before filtering, or it is simply deleted
  // and two clauses run together with no pause where the dash used to be.
  t = t.replace(/\s*[—–]\s*/g, ', ');       // em/en dash -> spoken pause
  t = t.replace(/[‘’]/g, "'");              // smart single quotes
  t = t.replace(/[“”]/g, '"');              // smart double quotes
  t = t.replace(/…/g, '.');                      // ellipsis

  // Emoji, box-drawing and arrows. Slash and at-sign survive: URLs and paths are
  // already gone by here, so what is left is slash-commands and @file references.
  t = t.replace(/[^\p{L}\p{N}\s.,;:!?'"()%$&+=/@-]/gu, '');
  t = t.replace(/,\s*,/g, ',');                       // dashes adjacent to commas
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\s*\n\s*/g, '\n');
  t = t.replace(/\n{2,}/g, '\n');
  t = t.replace(/(?:\s*\.\s*){2,}/g, '. ');           // collapse the code-block markers

  return truncateAtSentence(t.trim(), maxChars);
}

// --- Brevity ---------------------------------------------------------------
// Reading a whole answer aloud is the wrong shape for speech. The screen holds
// the tables, the file paths and the options; the ear wants the conclusion.
//
// This exploits a convention the answers already follow: lead with the answer,
// then structure it. So the LEAD PARAGRAPH — everything before the first
// heading, list, table or rule — is already the summary, and needs no model to
// produce and no extra latency to fetch. Taking it is nearly free.

/** Blocks that are structure rather than prose, and are never the summary. */
function isStructuralBlock(block) {
  return /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||```|---|===|\*\*\*)/.test(block);
}

/**
 * The first N sentences, without cutting one in half.
 *
 * A full stop is only a sentence end when what follows looks like a new
 * sentence — whitespace then a capital, or the end of the text. Splitting on
 * every dot cuts `server.mjs` into "server." and stops there, which is not a
 * hypothetical: these answers name files constantly, and the first version of
 * this function truncated one mid-filename on its first real input.
 * The same rule handles "e.g." and "vs." for free, since a lowercase word
 * follows them.
 */
function firstSentences(text, n) {
  const s = String(text).trim();
  const re = /[.!?]+["')\]]*(?=\s+[A-Z"'([]|\s*$)/g;
  const out = [];
  let start = 0;
  let m;
  while (out.length < n && (m = re.exec(s)) !== null) {
    out.push(s.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  return out.length ? out.join(' ') : s;
}

/**
 * The spoken-length version of an answer: its lead paragraph, capped to a
 * couple of sentences.
 *
 * Falls through deliberately rather than going silent. An answer that opens
 * with a heading or is nothing but a table has no lead paragraph, and saying
 * nothing at all is indistinguishable from a broken speaker — so the first
 * prose block anywhere is used, and failing that the first block of any kind.
 */
function briefForSpeech(raw, sentences = 2) {
  let t = String(raw).replace(/```[\s\S]*?```/g, '\n\n');   // code is never spoken
  const blocks = t.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return '';

  const prose = blocks.find((b) => !isStructuralBlock(b));
  const chosen = prose || blocks[0];
  return firstSentences(chosen, sentences);
}

function truncateAtSentence(text, maxChars) {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const lastStop = Math.max(window.lastIndexOf('.'), window.lastIndexOf('!'), window.lastIndexOf('?'));
  const cut = lastStop > maxChars * 0.5 ? window.slice(0, lastStop + 1) : window;
  return cut.trim() + ' Response truncated.';
}

// --- Transcript reading ----------------------------------------------------

function readTail(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    // A non-zero offset almost certainly lands mid-line; that line is unparseable.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

// Walks backwards for the last main-thread assistant message carrying text.
// isSidechain records are subagent output and must never be read aloud.
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = readTail(transcriptPath, TAIL_BYTES).split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;

    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== 'assistant' || rec.isSidechain === true) continue;

    const blocks = rec?.message?.content;
    if (!Array.isArray(blocks)) continue;

    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (text) return text;
  }
  return '';
}

// --- Speaking --------------------------------------------------------------

// Interrupting whatever is already speaking is the speaker script's job, not
// ours: it owns the PID file and is the only thing that knows when it finished.

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
  '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT];

function speak(text, cfg) {
  const clean = String(text).trim();
  if (clean.length < cfg.minChars) return false;
  if (IS_MAC) return speakMac(clean, cfg);
  if (IS_WINDOWS) return speakWindows(clean, cfg);
  return false; // no speech engine assumed on other platforms
}

// --- Windows ---------------------------------------------------------------
// Launching is the whole difficulty here. A process spawned as a child of this
// one dies when this one exits, ~80ms in - measured across detached,
// stdio:'ignore' and `cmd /c start`, all of which lose the child before a word
// is spoken. Task Scheduler runs it with no parent to inherit that death.

function speakWindows(clean) {
  fs.writeFileSync(QUEUE_PATH, clean, 'utf8');
  const viaTask = spawnSync('schtasks.exe', ['/run', '/tn', TASK_NAME],
    { stdio: 'ignore', windowsHide: true });
  if (viaTask.status === 0) return true;

  // Fallback for a machine where the task was never installed. Works whenever
  // this process outlives the speech (the CLI paths), not from the Stop hook.
  try {
    const child = spawn('powershell.exe', PS_ARGS, { stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// --- macOS -----------------------------------------------------------------
// None of the Windows difficulty applies. On POSIX an orphaned process is
// re-parented to init and keeps running, so detached + unref is genuinely
// enough and no scheduled task is needed. macOS also ships its own speech
// engine at /usr/bin/say, so there is nothing to install at all.

/** -10..10 -> words per minute. macOS speaks ~175 wpm by default. */
function macWordsPerMinute(rate) {
  const n = Number.isFinite(rate) ? rate : 0;
  return Math.max(80, Math.min(400, Math.round(175 + n * 12)));
}

/** Single-quote for /bin/sh, the only quoting that is safe for arbitrary paths. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * The shell line macOS runs. Exported so it can be asserted on a machine that
 * is not a Mac - the command is the part worth checking, and building it wrong
 * is silent (`say` just prints to stderr nobody reads).
 */
function buildMacCommand(textFile, cfg) {
  const wpm = macWordsPerMinute(cfg.rate);
  const file = shQuote(textFile);
  const withVoice = cfg.voice
    ? `say -v ${shQuote(cfg.voice)} -r ${wpm} -f ${file} || ` : '';
  // If the configured voice is not installed, fall back to the system voice
  // rather than saying nothing. The rm always runs, so nothing is left behind.
  const sayChain = `${withVoice}say -r ${wpm} -f ${file}`;

  if (cfg.engine !== 'edge') return `${sayChain}; rm -f ${file}`;

  // Neural first, `say` as the safety net — the same order Windows uses, so a
  // machine that is offline still speaks rather than going quiet. afplay ships
  // with macOS and handles MP3, so there is nothing extra to install.
  const mp3 = shQuote(`${textFile}.mp3`);
  const synth = shQuote(path.join(HERE, 'alfred-tts-edge.mjs'));
  const node = shQuote(process.execPath);
  return `if ${node} ${synth} --text-file ${file} --out ${mp3} --voice ${shQuote(cfg.edgeVoice)}`
    + ` --rate ${Number(cfg.rate) || 0} >/dev/null 2>&1; then afplay ${mp3}; else ${sayChain}; fi;`
    + ` rm -f ${file} ${mp3}`;
}

function speakMac(clean, cfg) {
  stopCurrentSpeech();
  // A unique file per utterance: a fixed path would let the previous speaker's
  // cleanup delete the next one's text.
  const textFile = path.join(os.tmpdir(), `alfred-speak-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(textFile, clean, 'utf8');
  try {
    const child = spawn('/bin/sh', ['-c', buildMacCommand(textFile, cfg)],
      { detached: true, stdio: 'ignore' });
    child.unref();
    // detached:true puts the child in its own process group, so the negative
    // PID below can stop `say` and its wrapper together.
    try { fs.writeFileSync(PID_PATH, String(child.pid), 'utf8'); } catch { /* best effort */ }
    return true;
  } catch {
    return false;
  }
}

/** Interrupt whatever is still speaking - a new answer supersedes the old one. */
function stopCurrentSpeech() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) process.kill(-pid, 'SIGTERM');
  } catch {
    // nothing in flight, or it already finished - both fine
  }
}

// --- Task installation -----------------------------------------------------

function taskCommand(psInline) {
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psInline],
    { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function installTask() {
  const psInline = [
    `$arg = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${PS_SCRIPT}"';`,
    `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg;`,
    `$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited;`,
    `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances Parallel -Hidden;`,
    `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $a -Principal $p -Settings $s`,
    `  -Description 'Claude Code talk-back: speaks the last assistant response aloud.' -Force | Out-Null;`,
    `Write-Output 'installed'`,
  ].join(' ');
  return taskCommand(psInline);
}

function uninstallTask() {
  return taskCommand(
    `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue; Write-Output 'removed'`,
  );
}

// --- Hook mode -------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function runHook() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  let payload = {};
  try { payload = JSON.parse(await readStdin()); } catch { return; }

  const raw = lastAssistantText(payload.transcript_path);
  if (!raw) return;

  // Brevity is applied to the RAW markdown, before cleaning: the headings,
  // bullets and pipes are what mark where the summary ends, and cleanForSpeech
  // strips exactly those. Reversing the order loses the structure that the
  // decision depends on.
  const source = cfg.brevity === 'full' ? raw : briefForSpeech(raw, cfg.briefSentences);
  const spoken = cleanForSpeech(source, cfg.maxChars);
  if (spoken) speak(spoken, cfg);
}

// --- CLI -------------------------------------------------------------------

const HELP = `alfred-speak - Claude Code talk-back

  on | off        enable or disable talk-back
  status          show current settings and whether the launcher is installed
  engine edge|system   neural voices (needs network) or the built-in one
  neural <name>   set the neural voice: ryan, sonia, ava, emma, andrew, brian
  list            list installed system voices
  voice <name>    set the SYSTEM voice (use a name from 'list')
  rate <-10..10>  set speaking speed (0 = normal, higher = faster)
  test            speak a sample line with the current settings
  say "<text>"    speak arbitrary text now
  brief [n]       speak only the lead n sentences (default 2) — the conclusion
  full            speak the entire response aloud
  greet "<text>"  speak a HUD welcome — obeys both switches, silent if either is off
  welcome on|off  enable or disable the HUD's spoken welcome
  dry             print what the last response would sound like, without speaking
  install         register the scheduled task that launches the speaker
  uninstall       remove the scheduled task
`;

// Only Windows needs a launcher installed. On macOS the speech engine ships
// with the OS and detached processes survive on their own, so there is nothing
// to register - reporting "not installed" there would be a false alarm.
function taskInstalled() {
  if (!IS_WINDOWS) return true;
  const r = spawnSync('schtasks.exe', ['/query', '/tn', TASK_NAME],
    { stdio: 'ignore', windowsHide: true });
  return r.status === 0;
}

function listVoices() {
  if (IS_MAC) {
    // `say -v ?` prints "Name  lang  # example". Trim to just the usable name,
    // since that is the only part `voice` accepts.
    const r = spawnSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8' });
    const names = (r.stdout || '').split('\n')
      .map((l) => l.match(/^(.+?)\s{2,}[a-z]{2}[-_][A-Z]{2}/)?.[1]?.trim())
      .filter(Boolean);
    console.log(names.length ? names.join('\n') : (r.stdout || r.stderr || 'no voices found'));
    return;
  }
  const ps = 'Add-Type -AssemblyName System.Speech; ' +
    '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() ' +
    '| ForEach-Object { $_.VoiceInfo.Name }';
  const r = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  r.on('error', () => process.exit(1));
}

function latestTranscript() {
  const dir = path.join(os.homedir(), '.claude', 'projects');
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) found.push({ p, m: fs.statSync(p).mtimeMs });
    }
  };
  try { walk(dir); } catch { return ''; }
  found.sort((a, b) => b.m - a.m);
  return found.length ? found[0].p : '';
}

function runCli(argv) {
  const cfg = loadConfig();
  const [cmd, ...rest] = argv;
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case 'on':
    case 'off':
      cfg.enabled = cmd === 'on';
      saveConfig(cfg);
      console.log(`Talk-back ${cfg.enabled ? 'ENABLED' : 'DISABLED'}.`);
      return;

    case 'status': {
      console.log(JSON.stringify(cfg, null, 2));
      console.log(`config:    ${CONFIG_PATH}`);
      console.log(`launcher:  ${taskInstalled() ? 'installed' : 'NOT INSTALLED - run: install'}`);
      // The neural engine has one dependency that is NOT in the repo, so a
      // freshly cloned machine silently falls back to the system voice. Saying
      // so here is the difference between "sounds wrong" and a two-word fix.
      const edgeReady = fs.existsSync(path.join(HERE, 'node_modules', 'msedge-tts'));
      console.log(`neural:    ${edgeReady ? `ready (${cfg.edgeVoice})`
        : 'NOT AVAILABLE - run `npm install` in this folder; using the system voice until then'}`);
      return;
    }

    case 'install': {
      if (!IS_WINDOWS) { console.log('Nothing to install on this platform — macOS speaks via built-in `say`.'); return; }
      const r = installTask();
      console.log(r.ok ? 'Launcher installed.' : `Install failed:\n${r.out}`);
      return;
    }

    case 'uninstall': {
      if (!IS_WINDOWS) { console.log('Nothing to uninstall on this platform.'); return; }
      const r = uninstallTask();
      console.log(r.ok ? 'Launcher removed.' : `Removal failed:\n${r.out}`);
      return;
    }

    case 'list':
      return listVoices();

    case 'voice':
      if (!arg) return console.log('Usage: voice "<name>"  (see: list)');
      cfg.voice = arg;
      saveConfig(cfg);
      speak(`Voice set to ${arg}.`, cfg);
      console.log(`Voice set to "${arg}".`);
      return;

    case 'rate': {
      const n = parseInt(arg, 10);
      if (!Number.isInteger(n)) return console.log('Usage: rate <-10..10>');
      cfg.rate = Math.max(-10, Math.min(10, n));
      saveConfig(cfg);
      speak(`Speaking rate is now ${cfg.rate}.`, cfg);
      console.log(`Rate set to ${cfg.rate}.`);
      return;
    }

    case 'test':
      speak('Talk-back is working. This is how Claude will read its answers to you.', cfg);
      // Name the engine that will actually be used. This line used to report
      // the SYSTEM voice unconditionally, so a successful neural run looked
      // like a fallback and a real fallback looked correct.
      console.log(cfg.engine === 'edge'
        ? `Speaking a test line with the neural voice "${cfg.edgeVoice}" at rate ${cfg.rate}.`
        + ' If it sounds robotic, the neural engine failed — check .alfred-speak-last.json.'
        : `Speaking a test line using the system voice "${cfg.voice || 'default'}" at rate ${cfg.rate}.`);
      return;

    case 'say':
      if (!arg) return console.log('Usage: say "<text>"');
      speak(cleanForSpeech(arg, cfg.maxChars), { ...cfg, minChars: 1 });
      return;

    case 'brief':
    case 'full': {
      cfg.brevity = cmd;
      const n = parseInt(arg, 10);
      if (cmd === 'brief' && Number.isInteger(n) && n > 0) cfg.briefSentences = Math.min(6, n);
      saveConfig(cfg);
      console.log(cfg.brevity === 'full'
        ? 'Speaking the FULL response.'
        : `Speaking the lead ${cfg.briefSentences} sentence(s) only.`);
      return;
    }

    case 'engine': {
      if (arg !== 'edge' && arg !== 'system') return console.log('Usage: engine edge|system');
      cfg.engine = arg;
      saveConfig(cfg);
      console.log(arg === 'edge'
        ? `Using the neural voice (${cfg.edgeVoice}), falling back to the system voice when offline.`
        : 'Using the built-in system voice only.');
      speak('Engine switched.', { ...cfg, minChars: 1 });
      return;
    }

    // Named separately from `voice`, which sets the SYSTEM voice. One command
    // setting two unrelated catalogues depending on hidden state is the kind of
    // thing that silently does nothing and looks like a bug in the speaker.
    case 'neural': {
      if (!arg) {
        console.log(`Usage: neural <name>\n  ${Object.entries(EDGE_VOICES).map(([k, v]) => `${k} (${v})`).join('\n  ')}`);
        return;
      }
      cfg.edgeVoice = EDGE_VOICES[arg.toLowerCase()] || arg;
      cfg.engine = 'edge';
      saveConfig(cfg);
      console.log(`Neural voice set to "${cfg.edgeVoice}".`);
      speak(`This is ${arg}. Talk-back will sound like this from now on.`, { ...cfg, minChars: 1 });
      return;
    }

    case 'welcome': {
      if (arg !== 'on' && arg !== 'off') return console.log('Usage: welcome on|off');
      cfg.greetOnEnter = arg === 'on';
      saveConfig(cfg);
      console.log(`HUD welcome ${cfg.greetOnEnter ? 'ENABLED' : 'DISABLED'}.`);
      return;
    }

    // Unlike `say`, this is machine-triggered: the HUD fires it when the landing
    // page is dismissed, without the operator having asked for anything. So it
    // obeys BOTH switches and reports which one silenced it — a greeting that
    // simply does not arrive is indistinguishable from a broken speaker, and
    // that ambiguity has already cost this project a debugging session.
    case 'greet': {
      if (!arg) return console.log('Usage: greet "<text>"');
      if (!cfg.enabled) return console.log('skipped: talk-back is off (speak on)');
      if (cfg.greetOnEnter === false) return console.log('skipped: welcome is off (welcome on)');
      const spoken = speak(cleanForSpeech(arg, cfg.maxChars), { ...cfg, minChars: 1 });
      console.log(spoken ? 'spoken' : 'skipped: no speech engine available');
      return;
    }

    case 'dry': {
      const t = latestTranscript();
      if (!t) return console.log('No transcript found.');
      const raw = lastAssistantText(t);
      // Mirrors runHook exactly, brevity included — a preview that previewed a
      // different pipeline than the hook uses would be worse than no preview.
      const source = cfg.brevity === 'full' ? raw : briefForSpeech(raw, cfg.briefSentences);
      const spoken = cleanForSpeech(source, cfg.maxChars);
      console.log(`--- transcript: ${t}`);
      console.log(`--- mode: ${cfg.brevity}${cfg.brevity === 'brief' ? ` (${cfg.briefSentences} sentences)` : ''}`
        + `  |  ${raw.length} chars in, ${spoken.length} out`);
      console.log(`--- would speak:\n${spoken}`);
      return;
    }

    default:
      console.log(HELP);
  }
}

// --- Entry point -----------------------------------------------------------
// No arguments means the harness invoked us as a Stop hook: read stdin.
// Any failure is swallowed - a speaker that breaks a session is worse than a
// silent one. Guarded so the test file can import the pure functions without
// the hook firing and blocking on stdin.

export {
  cleanForSpeech, truncateAtSentence, lastAssistantText, loadConfig, DEFAULTS,
  buildMacCommand, macWordsPerMinute, shQuote,
  briefForSpeech, firstSentences, isStructuralBlock,
};

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    if (process.argv.length > 2) runCli(process.argv.slice(2));
    else await runHook();
  } catch {
    // deliberately silent
  }
  process.exitCode = 0;
}

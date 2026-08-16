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

const DEFAULTS = {
  enabled: true,
  voice: 'Microsoft Zira Desktop',
  rate: 1,
  volume: 95,
  maxChars: 700,
  minChars: 2,
};

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
  fs.writeFileSync(QUEUE_PATH, clean, 'utf8');
  return launchSpeaker();
}

// Launching is the whole difficulty on Windows. A process spawned as a child of
// this one dies when this one exits, ~80ms in - measured across detached,
// stdio:'ignore' and `cmd /c start`, all of which lose the child before a word
// is spoken. Task Scheduler runs it with no parent to inherit that death.
function launchSpeaker() {
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

  const spoken = cleanForSpeech(raw, cfg.maxChars);
  if (spoken) speak(spoken, cfg);
}

// --- CLI -------------------------------------------------------------------

const HELP = `alfred-speak - Claude Code talk-back

  on | off        enable or disable talk-back
  status          show current settings and whether the launcher is installed
  list            list installed voices
  voice <name>    set the voice (use a name from 'list')
  rate <-10..10>  set speaking speed (0 = normal, higher = faster)
  test            speak a sample line with the current settings
  say "<text>"    speak arbitrary text now
  dry             print what the last response would sound like, without speaking
  install         register the scheduled task that launches the speaker
  uninstall       remove the scheduled task
`;

function taskInstalled() {
  const r = spawnSync('schtasks.exe', ['/query', '/tn', TASK_NAME],
    { stdio: 'ignore', windowsHide: true });
  return r.status === 0;
}

function listVoices() {
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

    case 'status':
      console.log(JSON.stringify(cfg, null, 2));
      console.log(`config:    ${CONFIG_PATH}`);
      console.log(`launcher:  ${taskInstalled() ? 'installed' : 'NOT INSTALLED - run: install'}`);
      return;

    case 'install': {
      const r = installTask();
      console.log(r.ok ? 'Launcher installed.' : `Install failed:\n${r.out}`);
      return;
    }

    case 'uninstall': {
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
      console.log(`Speaking a test line using "${cfg.voice || 'system default'}" at rate ${cfg.rate}.`);
      return;

    case 'say':
      if (!arg) return console.log('Usage: say "<text>"');
      speak(cleanForSpeech(arg, cfg.maxChars), { ...cfg, minChars: 1 });
      return;

    case 'dry': {
      const t = latestTranscript();
      if (!t) return console.log('No transcript found.');
      const spoken = cleanForSpeech(lastAssistantText(t), cfg.maxChars);
      console.log(`--- transcript: ${t}\n--- would speak (${spoken.length} chars):\n${spoken}`);
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

export { cleanForSpeech, truncateAtSentence, lastAssistantText, loadConfig, DEFAULTS };

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

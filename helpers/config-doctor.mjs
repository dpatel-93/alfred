#!/usr/bin/env node
/**
 * config-doctor.mjs — Deterministic "latest & greatest" config enforcer.
 *
 * Runs as a plain local Node script (invoked by a SessionStart hook or a
 * scheduled task that the USER installs), not as one of Claude's agent tool
 * calls. It reads config-policy.json (intent) and makes the config match it.
 * Because the user opts in by running/registering it themselves, config edits
 * are user-authorized rather than silent agent self-modification.
 *
 * What it enforces (safe, deterministic):
 *   - Default model -> alias from policy (e.g. "opus" = always latest Opus)
 *   - Fallback model alias
 *   - autoUpdatesChannel -> "latest"
 *
 * What it only REPORTS (too sensitive to auto-change):
 *   - Broken/fragment permission entries in settings.local.json
 *   - CLI version changes
 *   - Deep-audit due (>auditEveryDays since last /self-improve)
 *
 * Design rules: non-blocking, fails silent, ALWAYS exits 0, throttled so it
 * costs nothing on rapid session restarts.
 *
 * Usage: node config-doctor.mjs [--force] [--report-only] [--register]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- Paths ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = path.resolve(__dirname, '..');            // ~/.claude
const settingsPath = path.join(claudeDir, 'settings.json');
const localSettingsPath = path.join(claudeDir, 'settings.local.json');
const policyPath = path.join(claudeDir, 'config-policy.json');
const statePath = path.join(claudeDir, '.config-doctor-state.json');
const logDir = path.join(claudeDir, 'logs');
const reportsDir = path.join(claudeDir, 'audit-reports');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const REPORT_ONLY = args.includes('--report-only');
const REGISTER = args.includes('--register');

// --- Helpers ---
const readJson = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
const nowIso = () => new Date().toISOString();
const changes = [];
const notes = [];

function log(line) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'config-doctor.log'), `[${nowIso()}] ${line}\n`);
  } catch { /* non-fatal */ }
}

// --- Throttle: skip if run within the last 6h (unless --force) ---
function throttled() {
  if (FORCE) return false;
  const state = readJson(statePath, {});
  if (!state.lastRun) return false;
  const hours = (Date.now() - new Date(state.lastRun).getTime()) / 36e5;
  return hours < 6;
}

// --- 1. Enforce model alias + update channel in settings.json ---
function enforceSettings(policy) {
  const s = readJson(settingsPath);
  if (!s) { notes.push('settings.json unreadable — skipped enforcement'); return; }

  const isPinnedVersion = (v) => typeof v === 'string' && /claude-(opus|sonnet|haiku|fable)-\d/.test(v);
  const alias = policy.model || 'opus';

  // Top-level default model: set to alias if missing or a stale pinned version.
  if (!s.model || isPinnedVersion(s.model)) {
    if (s.model !== alias) { changes.push(`settings.model: ${s.model ?? '(unset)'} -> ${alias}`); s.model = alias; }
  }

  // Fallback model alias.
  if (policy.fallbackModel && s.fallbackModel !== policy.fallbackModel && (!s.fallbackModel || isPinnedVersion(s.fallbackModel))) {
    changes.push(`settings.fallbackModel: ${s.fallbackModel ?? '(unset)'} -> ${policy.fallbackModel}`);
    s.fallbackModel = policy.fallbackModel;
  }

  // Update channel.
  if (policy.autoUpdatesChannel && s.autoUpdatesChannel !== policy.autoUpdatesChannel) {
    changes.push(`settings.autoUpdatesChannel: ${s.autoUpdatesChannel ?? '(unset)'} -> ${policy.autoUpdatesChannel}`);
    s.autoUpdatesChannel = policy.autoUpdatesChannel;
  }

  // If the (soon-to-be-retired) alfredFlow block still pins versions, alias them too.
  if (s.alfredFlow?.modelPreferences?.default && isPinnedVersion(s.alfredFlow.modelPreferences.default)) {
    changes.push(`alfredFlow.modelPreferences.default: ${s.alfredFlow.modelPreferences.default} -> ${alias}`);
    s.alfredFlow.modelPreferences.default = alias;
  }

  if (changes.length && !REPORT_ONLY) writeJson(settingsPath, s);
}

// --- 2. Report broken permission entries (do NOT auto-delete) ---
function auditPermissions(policy) {
  const s = readJson(localSettingsPath);
  const allow = s?.permissions?.allow;
  if (!Array.isArray(allow)) return;
  const markers = policy.brokenPermissionMarkers || [];
  const broken = allow.filter((e) => markers.some((m) => e.startsWith(m)));
  if (broken.length) notes.push(`settings.local.json: ${broken.length} broken permission fragment(s) to clean (run /self-improve or edit manually)`);
}

// --- 3. CLI version drift ---
function checkCliVersion(state) {
  let ver = null;
  try { ver = execSync('claude --version', { encoding: 'utf8', timeout: 8000 }).trim(); } catch { /* offline / not found */ }
  if (ver && state.lastCliVersion && ver !== state.lastCliVersion) {
    notes.push(`Claude CLI updated: ${state.lastCliVersion} -> ${ver}`);
  }
  return ver;
}

// --- 4. Deep-audit due? ---
function auditDue(policy, state) {
  const days = policy.auditEveryDays ?? 7;
  if (!state.lastAudit) { notes.push(`Deep audit never recorded — consider running /self-improve`); return; }
  const elapsed = (Date.now() - new Date(state.lastAudit).getTime()) / 864e5;
  if (elapsed >= days) notes.push(`Deep audit due (${Math.floor(elapsed)}d since last) — run /self-improve`);
}

// --- 5. Surface any new headless audit reports ---
function newReports(state) {
  try {
    if (!fs.existsSync(reportsDir)) return;
    const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.md')).sort();
    const latest = files[files.length - 1];
    if (latest && latest !== state.lastSeenReport) {
      notes.push(`New audit report available: audit-reports/${latest}`);
      state.lastSeenReport = latest;
    }
  } catch { /* non-fatal */ }
}

// --- 6. Self-register into settings.json SessionStart (idempotent) ---
function selfRegister() {
  const s = readJson(settingsPath);
  if (!s) return;
  const cmd = `cmd /c node ${claudeDir.replace(/\\/g, '/')}/helpers/config-doctor.mjs`;
  s.hooks = s.hooks || {};
  s.hooks.SessionStart = s.hooks.SessionStart || [];
  const flat = JSON.stringify(s.hooks.SessionStart);
  if (flat.includes('config-doctor.mjs')) return; // already registered
  const group = s.hooks.SessionStart[0] || { hooks: [] };
  group.hooks = group.hooks || [];
  group.hooks.push({ type: 'command', command: cmd, timeout: 10000 });
  if (!s.hooks.SessionStart.length) s.hooks.SessionStart.push(group);
  writeJson(settingsPath, s);
  changes.push('Registered config-doctor into settings.json SessionStart');
}

// --- Main ---
function main() {
  if (REGISTER) { selfRegister(); }
  if (throttled()) { process.exit(0); }

  const policy = readJson(policyPath, { model: 'opus', fallbackModel: 'sonnet', autoUpdatesChannel: 'latest', auditEveryDays: 7 });
  const state = readJson(statePath, {});

  try { enforceSettings(policy); } catch (e) { notes.push('enforceSettings error: ' + e.message); }
  try { auditPermissions(policy); } catch { /* non-fatal */ }
  const ver = checkCliVersion(state);
  try { auditDue(policy, state); } catch { /* non-fatal */ }
  try { newReports(state); } catch { /* non-fatal */ }

  // Persist state.
  state.lastRun = nowIso();
  if (ver) state.lastCliVersion = ver;
  writeJson(statePath, state);

  // Emit summary. SessionStart stdout is shown to the user; keep it terse and
  // only speak when there is something to say.
  const out = [];
  if (changes.length) out.push('[config-doctor] applied: ' + changes.join('; '));
  if (notes.length) out.push('[config-doctor] notes: ' + notes.join('; '));
  if (out.length) { const msg = out.join('\n'); console.log(msg); log(msg.replace(/\n/g, ' | ')); }
  process.exit(0);
}

try { main(); } catch (e) { try { log('fatal: ' + e.message); } catch {} process.exit(0); }

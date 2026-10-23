/**
 * Brain redaction — strips personal identifiers from text before it is written
 * to a shared brain (e.g. a Google Drive folder every AI reads).
 *
 * Two layers:
 *   - Generic rules live here: emails, GUIDs, IPv4 addresses, common secret
 *     token formats. Nothing personal.
 *   - Personal rules (the operator's name, handles, employer, machine names)
 *     live in ~/.alfred/redact.json, which never leaves the machine. This file
 *     is published with the framework, so it must not carry anyone's identity.
 *
 * No rules file means redaction is off and load() returns null — a supported
 * state, so a vault that is private to one machine keeps verbatim copies.
 *
 * redact.json shape:
 *   {
 *     "replace": [{ "find": "regex", "flags": "g", "with": "replacement" }],
 *     "keepEmailDomains": ["example.com"],
 *     "keepIds": ["00000000-0000-0000-0000-000000000000"]
 *   }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RULES_PATH = process.env.ALFRED_REDACT_RULES || path.join(os.homedir(), '.alfred', 'redact.json');

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
const SECRETS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9]{32,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function compile(rules) {
  const keepDomains = (rules.keepEmailDomains || ['example.com']).map((d) => d.toLowerCase());
  const keepIds = new Set((rules.keepIds || []).map((g) => g.toLowerCase()));
  const personal = (rules.replace || []).map((r) => {
    const flags = r.flags || 'g';
    return [new RegExp(r.find, flags.includes('g') ? flags : flags + 'g'), r.with];
  });

  function text(input) {
    let t = String(input);
    t = t.replace(EMAIL, (m) => (keepDomains.some((d) => m.toLowerCase().endsWith('@' + d)) ? m : '<redacted-email>'));
    t = t.replace(GUID, (m) => (keepIds.has(m.toLowerCase()) ? m : '<redacted-id>'));
    for (const re of SECRETS) t = t.replace(re, '<redacted-secret>');
    for (const [re, sub] of personal) t = t.replace(re, sub);
    t = t.replace(IPV4, '<ip>');
    return t;
  }

  // File and folder names get the personal rules and IP addresses, minus the
  // angle brackets, which Windows does not allow in names.
  function name(input) {
    let n = String(input);
    for (const [re, sub] of personal) n = n.replace(re, sub);
    return n.replace(IPV4, 'ip').replace(/[<>]/g, '');
  }

  return { text, name, rulesPath: RULES_PATH };
}

/** Returns a redactor, or null when no rules file exists (redaction off). */
function load() {
  if (!fs.existsSync(RULES_PATH)) return null;
  return compile(JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')));
}

module.exports = { load, compile, RULES_PATH };

// Ported from Brainiac (the alfie repo, engine/src/life/); keep the two in step.
// --- life-view.mjs ---------------------------------------------------------------------
// What the Life tab, the Day page and the morning brief show from the life-admin records: what is due (past its
// date, this week, the next 30 and 90 days), what needs a date, a card per area, the bills with their monthly and
// yearly cost, and the next twelve months at a glance. Read only.
// ---------------------------------------------------------------------------
import { AREAS, amountOf, listRecords, monthDayOf } from './life-store.mjs';
import {
  MONTHS, addDays, addInterval, daysBetween, isDate, nextOnOrAfter, parseLead, parseRepeats, standing, stepAfter,
} from './life-schedule.mjs';

const ASSET_AREA = { home: 'home', vehicle: 'car', appliance: 'home', device: 'digital', pet: 'pets', other: 'other' };
const MONEY_TYPES = ['bill', 'subscription'];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const possessive = (name) => (/^(me|my|i)$/i.test(name) ? 'My' : `${name}'${/s$/i.test(name) ? '' : 's'}`);

// The next time a day of the year comes round, counting one that passed in the last week as still to handle.
function nextYearly(monthDay, today, grace = 7) {
  if (!monthDay) return null;
  const from = addDays(today, -grace);
  const y = Number(from.slice(0, 4));
  for (const year of [y, y + 1]) {
    const d = `${year}-${String(monthDay[0]).padStart(2, '0')}-${String(monthDay[1]).padStart(2, '0')}`;
    if (isDate(d) && d >= from) return d;
    if (!isDate(d) && monthDay[0] === 2 && monthDay[1] === 29 && `${year}-02-28` >= from) return `${year}-02-28`;
  }
  return null;
}

// --- Each record -> the dated things it brings (an occasion, a renewal, a warranty ending...) ---
function dueOf(rec, today) {
  const lead = (v, dflt) => parseLead(v) ?? dflt;
  const base = { file: rec.file, register: rec.register };
  if (rec.register === 'recurring') {
    return [{ ...base, key: rec.file, title: rec.title, area: rec.area || 'other', type: rec.type, due: rec.nextDue,
      lead: lead(rec.remind, 3), amount: rec.amount || '', autopay: rec.autopay === 'yes', provider: rec.provider || '',
      repeats: rec.repeats, actions: ['done', 'snooze', ...(rec.repeats === 'once' ? [] : ['skip'])] }];
  }
  if (rec.register === 'people') {
    const out = [];
    for (const which of ['birthday', 'anniversary']) {
      const md = monthDayOf(rec[which]);
      const due = nextYearly(md, today);
      if (!due || (rec[`${which}Done`] || '') >= addDays(due, -30)) continue;
      const year = (/, (\d{4})$/.exec(rec[which]) || [])[1];
      const turns = which === 'birthday' && year ? ` (turns ${Number(due.slice(0, 4)) - Number(year)})` : '';
      out.push({ ...base, key: `${rec.file}#${which}`, title: `${possessive(rec.title)} ${which}${turns}`,
        area: 'family', type: 'occasion', due, md, lead: lead(rec.remind, 7), occasion: which, actions: ['wished'] });
    }
    const keep = parseRepeats(rec.keepInTouch);
    if (keep?.type === 'interval') {
      const since = isDate(rec.lastContact) ? rec.lastContact : null;
      out.push({ ...base, key: `${rec.file}#touch`, title: `Get in touch with ${rec.title}`, area: 'family',
        type: 'task', due: since ? addInterval(since, keep.n, keep.unit) : today, lead: 0,
        said: since ? `last in touch ${since}` : 'no contact noted yet', actions: ['contacted'] });
    }
    return out;
  }
  if (rec.register === 'documents') {
    return [{ ...base, key: rec.file, title: `Renew ${rec.title.replace(/^(my|the) /i, (m) => m.toLowerCase())}`,
      area: 'documents', type: 'renewal', due: rec.expires, lead: lead(rec.renew, 30),
      said: isDate(rec.expires) ? `expires ${rec.expires}` : 'expiry date to set', actions: ['renewed'] }];
  }
  const area = ASSET_AREA[rec.type] || 'other';
  return [['warrantyUntil', 'warranty', 'warranty ends'], ['leaseEnds', 'lease', 'lease ends']]
    .filter(([f, w]) => isDate(rec[f]) && !(rec[`${w}Noted`] && rec[`${w}Noted`] >= addDays(rec[f], -400)))
    .map(([f, w, said]) => ({ ...base, key: `${rec.file}#${w}`, title: `${rec.title}: ${said}`, area,
      type: 'renewal', due: rec[f], lead: lead(rec.remind, 30), what: w, actions: ['noted'] }));
}

// One record a hand or an AI wrote oddly is left out, never the whole page.
export function safeDue(rec, today) {
  try {
    return dueOf(rec, today);
  } catch {
    return [];
  }
}

// --- Money: what a bill costs a month, and what falls due in a month ---
export function monthlyCost(rec) {
  const amount = amountOf(rec.amount);
  const rule = parseRepeats(rec.repeats);
  if (!amount || !rule) return 0;
  if (rule.type === 'interval') {
    return amount * { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }[rule.unit] / rule.n;
  }
  if (rule.type === 'monthday') return amount;
  if (rule.type === 'dates') return (amount * rule.dates.length) / 12;
  return rule.type === 'once' ? 0 : amount / 12;
}
// Every date a recurring record falls on from its next date up to `end`.
export function datesUntil(rec, end) {
  const rule = parseRepeats(rec.repeats);
  if (!rule || !isDate(rec.nextDue)) return [];
  const out = [rec.nextDue];
  const weekdays = rec.weekends === 'next weekday';
  // A fixed interval counts each date from where it started, as Done does (no drift at month ends or weekends).
  const from = isDate(rec.started) && rec.started <= rec.nextDue && rec.anchor !== 'after done' ? rec.started : null;
  for (let d = rec.nextDue, i = 0; rule.type !== 'once' && i < 400; i++) {
    if (rule.type !== 'interval') d = nextOnOrAfter(rule, addDays(d, 1), { weekdays });
    else d = from ? stepAfter(from, rule.n, rule.unit, d, { weekdays }) : addInterval(d, rule.n, rule.unit);
    if (!d || d > end) break;
    out.push(d);
  }
  return out.filter((d) => d <= end);
}
const round = (n) => Math.round(n * 100) / 100;

// --- The whole picture for the Life tab ---
export function lifeView(brain, now, { horizon = 90 } = {}) {
  const today = now.date;
  const records = listRecords(brain);
  const active = records.filter((r) => r.status === 'active');
  const dated = [];
  const needsDate = [];
  for (const rec of active) {
    for (const it of safeDue(rec, today)) {
      const s = standing(it.due, it.lead, today);
      if (s === 'needs-date') needsDate.push({ ...it, standing: s });
      else dated.push({ ...it, standing: s, inDays: daysBetween(today, it.due) });
    }
  }
  dated.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  const upcoming = {
    late: dated.filter((i) => i.standing === 'late'),
    week: dated.filter((i) => i.inDays >= 0 && i.inDays <= 6),
    month: dated.filter((i) => i.inDays > 6 && i.inDays <= 30),
    later: dated.filter((i) => i.inDays > 30 && i.inDays <= horizon),
  };
  const attention = dated.filter((i) => i.standing === 'late' || i.standing === 'soon');
  return {
    today, attention, upcoming, needsDate, areas: areaCards(active, dated, needsDate),
    bills: billsOf(active, now), year: yearOf(active, today), registers: registersOf(records),
    counts: { records: records.length, active: active.length, late: upcoming.late.length,
      soon: attention.length - upcoming.late.length, needsDate: needsDate.length },
  };
}

function areaCards(active, dated, needsDate) {
  const areaOfRec = (r) => (r.register === 'recurring' ? r.area || 'other' : r.register === 'people' ? 'family'
    : r.register === 'documents' ? 'documents' : ASSET_AREA[r.type] || 'other');
  return AREAS.map((area) => {
    const items = dated.filter((i) => i.area === area);
    return { area, label: cap(area), records: active.filter((r) => areaOfRec(r) === area).length,
      late: items.filter((i) => i.standing === 'late').length, soon: items.filter((i) => i.standing === 'soon').length,
      needsDate: needsDate.filter((i) => i.area === area).length, next: items.find((i) => i.inDays >= 0) || null };
  }).filter((c) => c.records);
}

function billsOf(active, now) {
  const monthEnd = `${now.month}-31`;
  const bills = active.filter((r) => r.register === 'recurring' && (MONEY_TYPES.includes(r.type) || r.amount))
    .map((r) => ({ file: r.file, title: r.title, type: r.type, area: r.area, repeats: r.repeats, due: r.nextDue,
      amount: r.amount || '', autopay: r.autopay === 'yes', provider: r.provider || '', monthly: round(monthlyCost(r)),
      thisMonth: round(datesUntil(r, monthEnd).filter((d) => d.startsWith(now.month)).length * amountOf(r.amount)) }))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const monthly = round(bills.reduce((s, b) => s + b.monthly, 0));
  return { list: bills, monthly, yearly: round(monthly * 12),
    thisMonth: round(bills.reduce((s, b) => s + b.thisMonth, 0)),
    autopay: bills.filter((b) => b.autopay).length, manual: bills.filter((b) => b.amount && !b.autopay).length };
}

// The next twelve months, each with what falls in it and the money due.
function yearOf(active, today) {
  const start = `${today.slice(0, 7)}-01`;
  const end = addDays(addInterval(start, 12, 'month'), -1);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = addInterval(start, i, 'month').slice(0, 7);
    return { month: m, label: `${cap(MONTHS[Number(m.slice(5)) - 1])} ${m.slice(0, 4)}`, items: [], total: 0 };
  });
  const put = (date, it) => {
    const month = months.find((x) => x.month === date.slice(0, 7));
    if (!month || date < today) return;
    month.items.push({ ...it, date });
    month.total = round(month.total + amountOf(it.amount));
  };
  for (const rec of active) {
    if (rec.register === 'recurring') {
      for (const d of datesUntil(rec, end)) put(d, { title: rec.title, area: rec.area, amount: rec.amount || '',
        file: rec.file });
      continue;
    }
    for (const it of safeDue(rec, today)) {
      if (!isDate(it.due)) continue;
      put(it.due, { title: it.title, area: it.area, file: it.file });
      // Next year's birthday from its own day (a Feb 29 one lands on the 29th again in a leap year).
      if (it.occasion) {
        put(nextYearly(it.md, addDays(it.due, 1), 0), { title: it.title, area: it.area, file: it.file });
      }
    }
  }
  for (const m of months) m.items.sort((a, b) => a.date.localeCompare(b.date));
  return months;
}

function registersOf(records) {
  const out = { recurring: [], people: [], documents: [], assets: [] };
  for (const r of records) (out[r.register] || []).push(r);
  for (const list of Object.values(out)) {
    list.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      || a.title.localeCompare(b.title));
  }
  return out;
}

// --- The short version for the Day page and the brief: what is in its window now ---
export function lifeDue(brain, now) {
  const v = lifeView(brain, now, { horizon: 7 });
  const week = [...v.upcoming.late, ...v.upcoming.week];
  const money = week.filter((i) => i.amount);
  return { attention: v.attention, week, needsDate: v.needsDate.length, counts: v.counts,
    weekMoney: round(money.reduce((s, i) => s + amountOf(i.amount), 0)) };
}

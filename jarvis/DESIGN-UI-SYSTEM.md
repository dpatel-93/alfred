# Alfred Mission Control — Visual Component System

Design authority for every surface at `localhost:7777`. Sonnet implements from this
verbatim. This document describes **how things look and move**; the parallel UX spec
describes **what surfaces exist and what they do**.

Source of the language: `jarvis/ui.html` (live HUD) and
`CE-Project-Portfolio/static/style.css` (the control-room DNA Alfred inherited).
The galactic dressing pass now landed in `ui.html` — corner brackets, starfield,
canvas gauges, edge telemetry, orbital arcs — is **part of the system**, not a layer
to work around. Everything below composes with it.

**Prime directive.** This is an instrument panel, not a poster. Glow, arcs, and
scanlines are *set dressing around readable data*. If a decorative element competes
with a number, the decoration loses. Every ring in this system is drawn from a real
value.

---

## 0. Rules of engagement for the implementer

1. **Existing token names are load-bearing.** `--bg`, `--surface-1/2/3`, `--border`,
   `--blue`, `--mint`, `--amber`, `--red`, `--violet`, `--orange`, `--gray`, `--text`,
   `--text-dim`, `--panel-bg` are referenced throughout `ui.html` and the JS. Never
   rename or remove them. Section 1 keeps all of them and adds the rest.
2. **Additive edits only.** New tokens go into the same `:root` block. New components
   go in a clearly commented section. Do not reformat existing CSS.
3. **`color-mix()` is the house technique** for every tint, glow, and hairline. Do not
   introduce hardcoded `rgba()` for anything that derives from a palette color. The two
   legitimate exceptions already in the file are pure-black scrims
   (`rgba(0,0,0,0.32)` inset wells) and canvas `ACCENT_RGB` strings.
4. **Semantic color is a contract, not a palette.** mint = live/healthy/success and the
   primary action. blue = informational, selected, the default instrument color. amber =
   warn/stale. red = critical/error/destructive. violet and orange are *category* colors
   only (Decisions, Claude-Code) — never status. gray = idle/disabled/absent.
   A card is never mint because mint looks nice.
5. **Mono is the identity.** JetBrains Mono for all chrome, labels, data, and numerics.
   The one exception is long-form prose (section 2.11).

---

## 1. Design tokens

Paste-ready. Replaces the current `:root` block in `ui.html` in full.

```css
:root {
  color-scheme: dark;

  /* ---------- Surfaces (existing — do not rename) ---------- */
  --bg:            #080b10;   /* page canvas, behind everything */
  --surface-1:     #0b0f16;   /* panel ground */
  --surface-2:     #101620;   /* raised panel / chrome strips */
  --surface-3:     #141c27;   /* inset wells, track backgrounds, hover fill */
  --surface-4:     #192331;   /* nested surface inside a raised panel */
  --border:        #202b39;   /* decorative hairline — NOT for interactive edges */
  --border-strong: #2c3a4b;   /* structural divider, table rules */
  --border-focusable: #556d8f; /* the ONLY border for interactive control edges (3:1+) */

  /* ---------- Palette (existing — do not rename) ---------- */
  --blue:   #5ca8ff;   /* primary instrument / info / selected */
  --blue-strong: #2f8cff;
  --mint:   #63e6b5;   /* live, healthy, success, primary action */
  --amber:  #f0b35a;   /* warn, stale, degraded */
  --red:    #ff6b72;   /* critical, error, destructive */
  --violet: #ad8cff;   /* category: Decisions */
  --orange: #f18b5b;   /* category: Claude-Code */
  --gray:   #93a1b2;   /* idle / disabled / absent — RAISED from #7a8896, see §5 */

  /* ---------- Text ---------- */
  --text:       #d9e2ec;  /* primary */
  --text-soft:  #b9c6d4;  /* secondary body */
  --text-dim:   #93a1b2;  /* labels, meta, kickers */
  --text-faint: #7d8b9c;  /* decorative only — never load-bearing information */
  --on-accent:  #06111a;  /* text on mint/blue/amber solid fills */

  /* ---------- Composed surfaces ---------- */
  --panel-bg:     color-mix(in srgb, var(--surface-1) 93%, transparent);
  --panel-bg-2:   color-mix(in srgb, var(--surface-2) 82%, transparent);
  --panel-bg-3:   color-mix(in srgb, var(--surface-2) 96%, transparent); /* modal/expanded */
  --well-bg:      rgba(0, 0, 0, 0.32);   /* terminal + code inset wells */
  --scrim-bg:     rgba(2, 5, 8, 0.62);
  --overlay-bg:   rgba(2, 5, 8, 0.72);
  --hairline:     color-mix(in srgb, var(--blue) 10%, transparent); /* in-panel rules */

  /* ---------- Type ---------- */
  --font-mono: 'JetBrains Mono', 'Cascadia Mono', 'Consolas', monospace;
  --font-ui:   'Aptos', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;

  --fs-micro: 9px;    /* canvas gauge captions only */
  --fs-mini:  10px;   /* badges, pills, dense meta */
  --fs-xs:    11px;   /* kickers, secondary labels */
  --fs-sm:    12px;   /* table cells, list meta */
  --fs-base:  13px;   /* DEFAULT — body, inputs, list titles, terminal */
  --fs-md:    15px;   /* panel titles, expanded terminal */
  --fs-lg:    18px;   /* section headings */
  --fs-xl:    22px;   /* secondary stat values */
  --fs-2xl:   30px;   /* hero stat values */
  --fs-hero:  clamp(26px, 5vw, 50px);  /* landing wordmark only */

  --lh-tight: 1.25;
  --lh-base:  1.5;
  --lh-prose: 1.65;

  --track-ui:     0.04em;  /* body-ish mono at rest */
  --track-kicker: 0.12em;  /* UPPERCASE section labels */
  --track-label:  0.18em;  /* edge telemetry, vertical readouts */
  --track-hero:   0.35em;  /* page title, landing subtitle */

  /* ---------- Spacing (4px base) ---------- */
  --sp-1:  2px;
  --sp-2:  4px;
  --sp-3:  6px;
  --sp-4:  8px;
  --sp-5:  10px;
  --sp-6:  12px;
  --sp-7:  16px;
  --sp-8:  20px;
  --sp-9:  24px;
  --sp-10: 32px;
  --sp-11: 40px;

  /* ---------- Radius (angular language — small radii only) ---------- */
  --r-0:    0;       /* .frame panels: geometry comes from clip-path, not radius */
  --r-xs:   2px;     /* pills, chips, badges */
  --r-sm:   3px;     /* buttons, inputs, small wells */
  --r-md:   6px;     /* cards that are NOT notched frames */
  --r-pill: 999px;
  --notch:  12px;    /* .frame corner cut — one value, system-wide */
  --notch-sm: 8px;   /* .frame.frame-sm cut for cards under ~220px wide */

  /* ---------- Elevation / z-layers ---------- */
  --z-starfield:  -1;
  --z-grid:        0;
  --z-graph:       1;
  --z-vignette:    5;
  --z-scanlines:   6;
  --z-brackets:    7;
  --z-telemetry:   8;
  --z-gauges:      15;
  --z-chrome:      20;   /* rail, command bar, page title */
  --z-drawer:      25;
  --z-tooltip:     30;
  --z-console:     40;   /* expanded terminal */
  --z-toast:       60;
  --z-scrim:       100;
  --z-modal:       110;
  --z-landing:     200;

  /* ---------- Glow ladder ----------
     Usage: set --glow-color on the element, then apply the ladder value.
     box-shadow: var(--glow-2);  with  --glow-color: var(--mint); */
  --glow-color: var(--blue);
  --glow-0: none;
  --glow-1: 0 0 8px  color-mix(in srgb, var(--glow-color) 22%, transparent);
  --glow-2: 0 0 14px color-mix(in srgb, var(--glow-color) 35%, transparent);
  --glow-3: 0 0 24px color-mix(in srgb, var(--glow-color) 45%, transparent);
  --glow-inset: inset 0 0 12px color-mix(in srgb, var(--glow-color) 6%, transparent);
  --glow-text-1: 0 0 6px  color-mix(in srgb, var(--glow-color) 50%, transparent);
  --glow-text-2: 0 0 10px color-mix(in srgb, var(--glow-color) 70%, transparent);

  --shadow-panel: 0 20px 70px rgba(0, 0, 0, 0.5);
  --shadow-modal: 0 0 50px rgba(0, 0, 0, 0.7);
  --shadow-drawer: -20px 0 40px rgba(0, 0, 0, 0.5);

  /* ---------- Motion ---------- */
  --t-instant: 80ms;
  --t-fast:    130ms;   /* hover, press, tint swaps */
  --t-base:    200ms;   /* state changes, tab swaps */
  --t-slow:    350ms;   /* drawer slide, panel open */
  --t-reveal:  900ms;   /* HUD fade-in on entry */
  --ease-out:      cubic-bezier(0.2, 0.8, 0.2, 1);   /* the house easing */
  --ease-emphasis: cubic-bezier(0.5, 0, 0.25, 1);    /* landing zoom-out only */
  --ease-linear:   linear;                            /* ambient loops only */

  /* ---------- Layout regions ---------- */
  --rail-w:        250px;
  --rail-w-narrow: 56px;
  --drawer-w:      420px;
  --cmdbar-w:      580px;
  --gutter:        18px;   /* fixed inset of chrome from viewport edge */
}
```

### 1.1 Category accent convention

`--accent` is a **local** variable set inline per element (already the pattern on
`.cat-btn`). Never define it in `:root`. Any component that takes a category or status
tint reads `var(--accent, var(--blue))`, so the blue instrument color is the fallback.

| Vault folder / domain | `--accent` |
|---|---|
| Projects | `var(--blue)` |
| Patterns | `var(--amber)` |
| Decisions | `var(--violet)` |
| Learning | `var(--mint)` |
| Claude-Code | `var(--orange)` |

### 1.2 Status semantics (the contract)

| State | Color | Where it may appear |
|---|---|---|
| live / running / healthy / success | `--mint` | badge, dot, gauge ring, primary action |
| info / selected / idle-but-present | `--blue` | badge, selection edge, default instrument |
| warn / stale / degraded / queued | `--amber` | badge, gauge ring override, banner |
| critical / error / failed / destructive | `--red` | badge, left rule, toast, danger button |
| idle / disabled / never-run / absent | `--gray` | badge, dimmed row, disabled control |

---

## 2. Component library

### 2.0 The frame — foundation of every panel

Existing `.frame` is correct and unchanged. Formalise it with size variants and make
the notch a token.

```css
.frame {
  position: relative;
  border: 1px solid var(--border);
  border-top-color: color-mix(in srgb, var(--blue) 25%, transparent); /* lit edge */
  clip-path: polygon(
    0 var(--notch), var(--notch) 0,
    calc(100% - var(--notch)) 0, 100% var(--notch),
    100% calc(100% - var(--notch)), calc(100% - var(--notch)) 100%,
    var(--notch) 100%, 0 calc(100% - var(--notch)));
}
.frame-sm { --notch: var(--notch-sm); }
.frame-flat { clip-path: none; border-radius: var(--r-sm); } /* rows nested in a frame */
```

**Rules.** Notched frames do not nest. A `.frame` panel's children use `.frame-flat`
or no frame at all — stacked notches read as visual noise and the clip-path costs a
compositor layer each. `clip-path` clips `box-shadow`, so a frame that needs a glow
wraps in a plain `div` that carries the shadow.

### 2.1 Panel variants

All four share: `var(--panel-bg-*)` ground, `backdrop-filter: blur(4px)`, mono type,
an optional uppercase kicker header.

**a) Standard panel** — the default container in the rail and the center stage.

```css
.panel {
  background: var(--panel-bg-2);
  backdrop-filter: blur(4px);
  padding: var(--sp-5) var(--sp-6);
  display: flex; flex-direction: column; gap: var(--sp-3);
}
.panel-kicker {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);
  font-size: var(--fs-xs); letter-spacing: var(--track-kicker);
  text-transform: uppercase; color: var(--text-dim);
}
.panel-kicker .kicker-actions { display: flex; gap: var(--sp-2); }
.panel-body { font-size: var(--fs-base); line-height: var(--lh-base); color: var(--text); }
.panel-rule { height: 1px; background: var(--hairline); margin: var(--sp-3) 0; }
```

Apply `.frame` alongside `.panel` for the notched treatment. Rail panels get it;
dense sub-panels inside a card do not.

**b) Elevated modal** — centered, dims the HUD behind it.

```css
.scrim {
  position: fixed; inset: 0; z-index: var(--z-scrim);
  background: var(--scrim-bg); backdrop-filter: blur(3px);
  opacity: 0; pointer-events: none; transition: opacity var(--t-base) var(--ease-out);
}
.scrim.open { opacity: 1; pointer-events: auto; }

.modal {
  position: fixed; top: 50%; left: 50%; z-index: var(--z-modal);
  transform: translate(-50%, -50%) scale(0.985);
  width: min(720px, calc(100vw - var(--sp-10)));
  max-height: 84vh; display: flex; flex-direction: column;
  background: var(--panel-bg-3); border: 1px solid var(--border-strong);
  border-top-color: color-mix(in srgb, var(--blue) 40%, transparent);
  box-shadow: var(--shadow-modal), 0 0 20px color-mix(in srgb, var(--blue) 18%, transparent);
  opacity: 0; pointer-events: none;
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}
.modal.open { opacity: 1; transform: translate(-50%, -50%) scale(1); pointer-events: auto; }
.modal-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-7);
  padding: var(--sp-8) var(--sp-9) var(--sp-6);
  border-bottom: 1px solid var(--hairline);
}
.modal-head h2 {
  margin: 0; font-size: var(--fs-md); color: var(--blue);
  --glow-color: var(--blue); text-shadow: var(--glow-text-1);
}
.modal-body { flex: 1; overflow-y: auto; padding: var(--sp-7) var(--sp-9); }
.modal-actions {
  display: flex; justify-content: flex-end; gap: var(--sp-4);
  padding: var(--sp-6) var(--sp-9); border-top: 1px solid var(--hairline);
}
```

Modals do **not** get `.frame`. The notch belongs to embedded instruments; a modal is
an interruption and reads better as a clean rectangle. Escape closes; scrim click
closes; focus is trapped and returns to the invoking control on close.

**c) Slide-in drawer** — the existing `#panel` pattern, generalised.

```css
.drawer {
  position: fixed; top: 0; right: 0; height: 100%; z-index: var(--z-drawer);
  width: var(--drawer-w); transform: translateX(100%);
  background: var(--panel-bg); border-left: 1px solid var(--border);
  box-shadow: var(--shadow-drawer),
              inset 0 0 40px color-mix(in srgb, var(--blue) 3%, transparent);
  backdrop-filter: blur(6px);
  display: flex; flex-direction: column;
  transition: transform var(--t-slow) var(--ease-out);
}
.drawer.open { transform: translateX(0); }
```

`transform` rather than the current animated `right` — `right` triggers layout on every
frame, `transform` composites. This is a direct upgrade to `#panel`; keep `.open`.

Anatomy: `.drawer-head` (title + kicker + close), `.drawer-body` (scrolls,
`padding: var(--sp-7) var(--sp-9)`), optional `.drawer-foot` (related items, pinned).

**d) Toast** — see 2.12.

### 2.2 Data card

One component, three content shapes (project / automation / agent). The chassis is
identical; only the meta row differs. Category or status drives `--accent`.

```css
.card {
  --accent: var(--blue);
  position: relative;
  padding: var(--sp-6) var(--sp-6) var(--sp-5) calc(var(--sp-6) + 4px);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: transform var(--t-fast) var(--ease-out),
              border-color var(--t-fast) var(--ease-out),
              background var(--t-fast) var(--ease-out),
              box-shadow var(--t-fast) var(--ease-out);
}
/* accent spine — the single strongest identity cue, inherited from the DNA source */
.card::before {
  content: ''; position: absolute; inset: var(--sp-5) auto var(--sp-5) -1px;
  width: 3px; border-radius: 2px; background: var(--accent);
  box-shadow: 0 0 9px color-mix(in srgb, var(--accent) 35%, transparent);
}
.card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong));
  background: var(--surface-3);
}
.card:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.card.selected {
  border-color: color-mix(in srgb, var(--blue) 72%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--blue) 15%, transparent);
}
.card.is-live { --accent: var(--mint); }
.card.is-live::before { animation: spine-breathe 2.6s ease-in-out infinite; }
.card.alert { --accent: var(--red); border-color: color-mix(in srgb, var(--red) 30%, transparent); }
.card.alert::after {
  content: ''; position: absolute; top: var(--sp-5); right: var(--sp-5);
  width: 6px; height: 6px; border-radius: 50%; background: var(--red);
  box-shadow: 0 0 7px color-mix(in srgb, var(--red) 55%, transparent);
}
.card.is-idle { --accent: var(--gray); opacity: 0.82; }
.card.is-idle:hover { opacity: 1; }

@keyframes spine-breathe {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; }
}

.card-title  { font-size: var(--fs-base); line-height: var(--lh-tight); color: var(--text); margin: 0 0 var(--sp-4); }
.card-meta   { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
               font-size: var(--fs-mini); color: var(--text-dim); }
.card-metric { font-size: var(--fs-xl); line-height: 1; letter-spacing: -0.03em; color: var(--text); }
.card-foot   { display: flex; align-items: center; justify-content: space-between;
               gap: var(--sp-3); margin-top: var(--sp-5); }
```

Per-shape meta:

- **Project card** — title = repo name; meta = branch icon + branch, PR count, last
  commit age. `--accent` from the category table. Amber spine when the working tree
  is dirty; red dot when CI is failing.
- **Automation card** — title = automation name; meta = schedule (clock icon + cron
  in plain words), last run age, next run. `--accent`: mint while running, blue when
  scheduled and healthy, amber when the last run was late, red when the last run
  failed, gray when disabled. Foot carries the run button.
- **Agent card** — title = task summary (single line, ellipsised); meta = tier badge,
  elapsed time, token count. `--accent`: mint while running, blue on complete, red on
  error, gray when killed. A running agent card carries a 2px indeterminate bar
  (§2.8) flush to its bottom edge.

Grid: `display: grid; gap: var(--sp-6); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));`

### 2.3 List rows

Denser than cards; use when a surface shows more than ~10 items or when scanning
beats browsing.

```css
.row {
  --accent: var(--blue);
  display: grid; grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center; gap: var(--sp-5);
  padding: var(--sp-5) var(--sp-6);
  border-bottom: 1px solid var(--hairline);
  cursor: pointer;
  transition: background var(--t-fast) var(--ease-out);
}
.row:last-child { border-bottom: none; }
.row:hover  { background: color-mix(in srgb, var(--blue) 6%, transparent); }
.row:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.row.active { background: color-mix(in srgb, var(--blue) 10%, transparent); }
.row.critical { border-left: 3px solid var(--red); padding-left: calc(var(--sp-6) - 3px); }
.row.warn     { border-left: 3px solid var(--amber); padding-left: calc(var(--sp-6) - 3px); }
.row-dot {
  width: 7px; height: 7px; border-radius: 50%; justify-self: center;
  background: var(--accent); box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent);
}
.row-copy strong { display: block; font-size: var(--fs-base); font-weight: 500; color: var(--text);
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-copy small  { display: block; margin-top: 2px; font-size: var(--fs-mini);
                   color: var(--text-dim); letter-spacing: var(--track-ui); }
.row-value { font-size: var(--fs-sm); color: var(--text-soft); font-variant-numeric: tabular-nums; }
```

Always `font-variant-numeric: tabular-nums` on any column of numbers. Non-tabular
digits in a mono-adjacent HUD look broken when values tick.

### 2.4 Badges and pills

One component. `.badge` is the status chip; `.pill` adds a leading dot for state that
changes over time.

```css
.badge {
  --accent: var(--gray);
  display: inline-flex; align-items: center; gap: var(--sp-2);
  min-height: 18px; padding: 2px var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: var(--r-xs);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  color: var(--accent);
  font-size: var(--fs-mini); font-weight: 600;
  letter-spacing: var(--track-ui); text-transform: uppercase;
  white-space: nowrap;
}
.pill::before {
  content: ''; width: 5px; height: 5px; border-radius: 50%;
  background: currentColor; box-shadow: 0 0 6px currentColor;
}

.badge.live     { --accent: var(--mint); }
.badge.info     { --accent: var(--blue); }
.badge.warn     { --accent: var(--amber); }
.badge.critical { --accent: var(--red); }
.badge.idle     { --accent: var(--gray); }

/* Live is the only badge that moves — it means "right now". */
.badge.live.pill::before { animation: pulse-dot 1.8s ease-in-out infinite; }
@keyframes pulse-dot {
  0%, 100% { opacity: 1;   box-shadow: 0 0 6px currentColor; }
  50%      { opacity: 0.55; box-shadow: 0 0 2px currentColor; }
}

/* Agent tier badge — same chassis, tier drives the accent */
.badge.tier-fable  { --accent: var(--violet); }
.badge.tier-opus   { --accent: var(--blue); }
.badge.tier-sonnet { --accent: var(--mint); }
.badge.tier-haiku  { --accent: var(--amber); }
.badge.tier-intern { --accent: var(--gray); }
```

Tier colors are deliberately *not* the status colors on the same surface. When an
agent card shows both, the tier badge is left-aligned in the meta row and the status
badge is right-aligned in the foot — never adjacent.

### 2.5 Buttons

Primary action is mint with dark text, straight from the DNA source (`--action-bg`).
This is the one place a solid fill appears in the whole system, which is exactly why
it reads as *the* action.

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-4);
  min-height: 30px; padding: var(--sp-3) var(--sp-5);
  border: 1px solid var(--border-focusable); border-radius: var(--r-sm);
  background: transparent; color: var(--text-soft);
  font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600;
  letter-spacing: var(--track-ui); text-transform: uppercase;
  cursor: pointer; white-space: nowrap;
  transition: color var(--t-fast) var(--ease-out),
              border-color var(--t-fast) var(--ease-out),
              background var(--t-fast) var(--ease-out),
              box-shadow var(--t-fast) var(--ease-out),
              transform var(--t-instant) var(--ease-out);
}
.btn:hover  { color: var(--text); border-color: var(--blue); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

.btn.primary {
  --glow-color: var(--mint);
  color: var(--on-accent); background: var(--mint); border-color: var(--mint);
  box-shadow: var(--glow-1);
}
.btn.primary:hover {
  background: color-mix(in srgb, var(--mint) 84%, black);
  border-color: color-mix(in srgb, var(--mint) 84%, black);
  box-shadow: var(--glow-2);
}

.btn.ghost { border-color: transparent; color: var(--text-dim); }
.btn.ghost:hover { border-color: var(--border-focusable); color: var(--text); background: transparent; }

.btn.danger {
  color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, transparent);
  background: color-mix(in srgb, var(--red) 6%, transparent);
}
.btn.danger:hover {
  border-color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent);
}
.btn.danger:focus-visible { outline-color: var(--red); }

.btn.small { min-height: 24px; padding: 2px var(--sp-4); font-size: var(--fs-mini); }

.icon-btn {
  width: 28px; height: 28px; padding: 0; flex: 0 0 auto;
  display: inline-grid; place-items: center;
  border: 1px solid var(--border-focusable); border-radius: var(--r-sm);
  background: transparent; color: var(--text-dim); cursor: pointer;
  transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out),
              background var(--t-fast) var(--ease-out);
}
.icon-btn:hover { color: var(--blue); border-color: var(--blue); background: color-mix(in srgb, var(--blue) 8%, transparent); }
.icon-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.icon-btn.round { border-radius: 50%; }
```

**Placement rule.** One primary per surface. Destructive actions never sit adjacent to
the primary — put them at the opposite end of the action row or behind an overflow
menu. Anything that kills a running agent or deletes state confirms in a modal whose
confirm button is `.btn.danger`, not `.btn.primary`.

**Focus.** `:focus-visible` only — never `:focus`, which would ring the command bar on
every mouse click. The 2px blue outline at 2px offset clears the notched clip-path,
so it stays visible on `.frame` elements.

### 2.6 Tabs / segmented nav (4–5 tabs)

The current `#view-toggle` handles two. At five, evenly-flexed buttons squeeze labels
below the legibility floor. Fix: fixed padding, an active underline rail, and icons
that carry the meaning when labels truncate.

```css
.segmented {
  display: flex; align-items: stretch;
  background: var(--panel-bg-2); backdrop-filter: blur(4px);
  position: relative; overflow: hidden;
}
.seg-btn {
  flex: 1 1 0; min-width: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-3);
  border: 0; background: none; cursor: pointer;
  color: var(--text-dim); font-family: var(--font-mono); font-size: var(--fs-xs);
  letter-spacing: var(--track-kicker); text-transform: uppercase;
  transition: color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
}
.seg-btn .icon { width: 14px; height: 14px; flex: 0 0 auto; }
.seg-btn span  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg-btn:hover { color: var(--text); }
.seg-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: -3px; }
.seg-btn[aria-selected="true"] {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 12%, transparent);
}
/* sliding rail: JS sets --rail-x / --rail-w from the active button's offsetLeft/offsetWidth */
.segmented::after {
  content: ''; position: absolute; left: 0; bottom: 0; height: 2px;
  width: var(--rail-w, 0); transform: translateX(var(--rail-x, 0));
  background: var(--blue); box-shadow: 0 0 10px color-mix(in srgb, var(--blue) 65%, transparent);
  transition: transform var(--t-base) var(--ease-out), width var(--t-base) var(--ease-out);
}
/* below ~1080px the rail is icon-only */
.segmented.compact .seg-btn span { display: none; }
.segmented.compact .seg-btn { gap: 0; }
```

Markup: `role="tablist"` on `.segmented`, `role="tab"` + `aria-selected` +
`aria-controls` on each `.seg-btn`, `role="tabpanel"` + `aria-labelledby` on each view.
Left/Right arrows move between tabs, Home/End jump to the ends.

Tab panel entry uses the reveal convention in §3.

### 2.7 Charts and sparklines

Canvas, drawn in the same idiom as the gauges. Honest by construction.

**Non-negotiables.**
- Bar and area charts start the value axis at **zero**. Line charts of a bounded rate
  may use a non-zero baseline only when the axis is labelled with its actual minimum.
- No 3D, no bevels, no drop shadows on data marks. The only glow permitted on a data
  mark is `shadowBlur: 5` on the *current/live* series — the same treatment the gauge
  ring uses, and for the same reason: it marks "now".
- Gradients encode a value or nothing. A vertical fade under an area line is
  acceptable because it encodes distance from the axis; a decorative rainbow is not.
- One color per series, from the semantic palette. Two series maximum on a sparkline.
- Every chart states its window in the kicker ("TOKENS — LAST 14 DAYS"). A chart with
  no time window stated is a bug.
- Empty state renders the axis and a centred `NO DATA` at `--fs-mini` in
  `--text-faint`. Never an empty box.

**Canvas setup (mandatory — the existing gauges skip this and are soft on HiDPI).**

```js
function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w: r.width, h: r.height };
}
```

Retrofit `#gauge-left` / `#gauge-right` with this. Their current fixed `width="78"`
attribute against a 78px CSS box renders at 1× on a 150%-scaled Windows display.

**Sparkline** (run history, token burn — 100×28 typical, no axes, no labels):

```js
function sparkline(cv, values, color) {
  const { c, w, h } = fitCanvas(cv);
  c.clearRect(0, 0, w, h);
  if (!values.length) return;
  const max = Math.max(...values, 1), pad = 2;
  const x = i => (i / Math.max(values.length - 1, 1)) * (w - pad * 2) + pad;
  const y = v => h - pad - (v / max) * (h - pad * 2);   // zero-based
  // area fill: encodes distance from the zero axis
  c.beginPath();
  c.moveTo(x(0), h - pad);
  values.forEach((v, i) => c.lineTo(x(i), y(v)));
  c.lineTo(x(values.length - 1), h - pad);
  c.closePath();
  c.fillStyle = color + '1f';            // ~12% alpha
  c.fill();
  // line
  c.beginPath();
  values.forEach((v, i) => (i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))));
  c.strokeStyle = color; c.lineWidth = 1.5; c.lineJoin = 'round'; c.lineCap = 'round';
  c.stroke();
  // live endpoint — the only glow on the mark
  const lx = x(values.length - 1), ly = y(values[values.length - 1]);
  c.save(); c.shadowColor = color; c.shadowBlur = 5;
  c.fillStyle = color; c.beginPath(); c.arc(lx, ly, 2, 0, Math.PI * 2); c.fill();
  c.restore();
}
```

**Bar chart / usage-by-model** — do not reach for canvas. The DNA source's DOM bar row
is more accessible, selectable, and already matches:

```css
.bar-row { display: grid; grid-template-columns: 96px 1fr 44px; align-items: center;
           gap: var(--sp-5); margin: var(--sp-3) 0; }
.bar-row .name { font-size: var(--fs-mini); color: var(--text-dim);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-row .bar  { height: 6px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.bar-row .fill { height: 100%; min-width: 3px; border-radius: 4px;
                 background: var(--accent, var(--blue));
                 box-shadow: 0 0 10px color-mix(in srgb, var(--accent, var(--blue)) 25%, transparent);
                 transition: width var(--t-slow) var(--ease-out); }
.bar-row .val  { font-size: var(--fs-mini); color: var(--text-soft);
                 text-align: right; font-variant-numeric: tabular-nums; }
```

**Chart axes and gridlines** (when a chart is large enough to need them): gridlines
`color-mix(in srgb, var(--blue) 8%, transparent)`, 1px, horizontal only. Axis labels
`--fs-mini` / `--text-dim`. Maximum four gridlines. The axis line itself is
`--border-strong`.

**Tooltips on charts** reuse `#tooltip` (§ existing). Hover targets on a sparkline are
the full-height column, not the 2px dot.

### 2.8 Gauges, dials, progress

**Dial** — matches the in-flight `drawGaugeLeft`/`drawGaugeRight` exactly. Codify the
constants so new dials are identical:

| Constant | Value |
|---|---|
| canvas box | 78×78 CSS px (DPR-scaled per §2.7) |
| ring radius | 28 |
| track | `rgba(ACCENT_RGB, 0.14)`, `lineWidth 3` |
| value arc | `lineWidth 3`, `lineCap 'round'`, `shadowBlur 5`, start `-Math.PI/2`, clockwise |
| second (inner) arc | radius `r - 7`, `lineWidth 2` |
| tick ring | 24 ticks, from `-r-3` to `-r+2`, `rgba(ACCENT_RGB, 0.22)`, `lineWidth 1` |
| caption | `7px` mono, `rgba(217,226,236,0.7)`, at `cy - 5` |
| value | `9px` mono, `rgba(217,226,236,0.9)`, at `cy + 9` |
| threshold override | ring switches to `--amber` past warn, `--red` past critical; caption color follows |

Any new dial uses these numbers. A dial always shows its numeric value in the middle —
the ring is the glance, the number is the answer.

**Determinate progress bar:**

```css
.progress { height: 3px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
.progress > i {
  display: block; height: 100%; width: 0;
  background: var(--accent, var(--blue));
  box-shadow: 0 0 6px var(--accent, var(--blue));
  transition: width var(--t-slow) var(--ease-out);
}
```

**Indeterminate bar** (running agent, streaming response) — a travelling segment, not
a spinner. Spinners imply "wait"; this implies "working".

```css
.progress.indeterminate > i {
  width: 34%; animation: prog-sweep 1.15s var(--ease-out) infinite;
}
@keyframes prog-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(295%); }
}
```

**Loading shimmer** — from the DNA source, retinted:

```css
.skeleton { position: relative; overflow: hidden; background: var(--surface-3); border-radius: var(--r-sm); }
.skeleton::before {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent,
              color-mix(in srgb, var(--blue) 7%, transparent), transparent);
  animation: shimmer 1.4s var(--ease-linear) infinite;
}
@keyframes shimmer { to { transform: translateX(100%); } }
.skeleton-line { height: 8px; }
.skeleton-line.short { width: 62%; }
```

Skeletons only for content whose shape is known and whose load exceeds ~400ms.
Below that, show nothing — a flashed skeleton is worse than a beat of stillness.

### 2.9 Terminal / chat

Refinements to the existing `#claude-terminal`. The mode badge is the most important
element on the panel: it tells the CEO whether keystrokes reach a shell or a model.

```css
/* prompt line — mode-colored caret, the fastest read of "where am I typing" */
.ct-inputline { display: flex; align-items: center; gap: var(--sp-3); }
.ct-prompt {
  font-size: var(--fs-sm); color: var(--blue);
  --glow-color: var(--blue); text-shadow: var(--glow-text-1);
}
#claude-terminal.mode-chat .ct-prompt { color: var(--mint); --glow-color: var(--mint); }
#claude-terminal.mode-offline .ct-prompt { color: var(--red); --glow-color: var(--red); }

/* the caret blinks only while the input is focused and the session is live */
#ct-input:focus + .ct-caret { animation: caret 1.05s steps(1) infinite; }
@keyframes caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

/* tool-call summary row — one line, collapsed by default, never a wall of JSON */
.tool-row {
  display: grid; grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center; gap: var(--sp-3);
  padding: 2px 0 2px var(--sp-2);
  border-left: 2px solid color-mix(in srgb, var(--blue) 25%, transparent);
  font-size: var(--fs-sm); color: var(--text-dim);
}
.tool-row .tool-name { color: var(--text-soft); }
.tool-row .tool-arg  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                       opacity: 0.75; }
.tool-row .tool-ms   { font-size: var(--fs-mini); font-variant-numeric: tabular-nums; }
.tool-row.ok    { border-left-color: color-mix(in srgb, var(--mint) 45%, transparent); }
.tool-row.error { border-left-color: var(--red); color: var(--red); }
.tool-row[aria-expanded="true"] + .tool-detail { display: block; }
.tool-detail {
  display: none; margin: var(--sp-2) 0 var(--sp-4) var(--sp-5);
  padding: var(--sp-4); background: var(--well-bg);
  border: 1px solid var(--hairline); border-radius: var(--r-sm);
  font-size: var(--fs-sm); color: var(--text-dim); white-space: pre-wrap;
  max-height: 240px; overflow-y: auto;
}
```

Line-type colors stay as they are (`.l-input` blue, `.l-assistant` mint, `.l-system`
amber, `.l-error` red, `.l-tool` dimmed) — that mapping is already correct and matches
the status contract.

Two changes worth making to the existing panel: raise `#ct-scroll` from
`color: var(--text-dim)` to `var(--text-soft)` (shell output is primary content, not
metadata), and give the streaming assistant line a trailing block caret so the CEO can
tell "thinking" from "done" without watching for movement.

### 2.10 Toast / notification

```css
.toast-stack {
  position: fixed; right: var(--gutter); bottom: calc(var(--gutter) + 96px);
  z-index: var(--z-toast);
  display: flex; flex-direction: column-reverse; gap: var(--sp-4);
  pointer-events: none;
}
.toast {
  --accent: var(--mint);
  display: grid; grid-template-columns: 7px minmax(0, 1fr) auto;
  align-items: center; gap: var(--sp-5);
  max-width: 380px; padding: var(--sp-6) var(--sp-6);
  background: var(--panel-bg-3); backdrop-filter: blur(6px);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: var(--shadow-panel);
  color: var(--text-soft); font-size: var(--fs-sm); line-height: var(--lh-base);
  pointer-events: auto;
  opacity: 0; transform: translateX(16px);
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}
.toast.show { opacity: 1; transform: none; }
.toast::before {
  content: ''; width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 9px color-mix(in srgb, var(--accent) 65%, transparent);
}
.toast.warn     { --accent: var(--amber); }
.toast.critical { --accent: var(--red); }
.toast.info     { --accent: var(--blue); }
.toast strong   { display: block; color: var(--text); font-weight: 600; }
```

**Behaviour.** Bottom-right, stacking upward, newest nearest the bottom edge. Offset
above the command bar so it never covers the input. Maximum three visible; a fourth
collapses the oldest. Auto-dismiss: 4s info/success, 7s warn, **never** for critical —
critical requires a click. Hovering the stack pauses all timers. Container is
`aria-live="polite"`; critical toasts use `role="alert"`.

Toasts report events, not state. "Agent finished" is a toast. "3 agents running" is a
badge in the rail.

### 2.11 Long-form prose (drawer bodies, note rendering)

The one place mono steps aside. Reading a full vault note at 13px mono is fatiguing,
and the DNA source already makes this split (mono for kickers and data, sans for
prose).

```css
.prose {
  font-family: var(--font-ui);
  font-size: 14px; line-height: var(--lh-prose); color: var(--text-soft);
}
.prose h1, .prose h2, .prose h3 {
  font-family: var(--font-mono); color: var(--blue);
  font-size: var(--fs-md); letter-spacing: var(--track-ui);
  margin: var(--sp-8) 0 var(--sp-4);
}
.prose h1:first-child, .prose h2:first-child, .prose h3:first-child { margin-top: 0; }
.prose strong { color: var(--text); }
.prose code {
  font-family: var(--font-mono); font-size: 12px; color: var(--amber);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  padding: 1px 5px; border-radius: var(--r-xs);
}
.prose pre {
  font-family: var(--font-mono); background: var(--well-bg);
  border: 1px solid var(--hairline); border-radius: var(--r-sm);
  padding: var(--sp-5); overflow-x: auto;
}
.prose pre code { background: none; color: var(--text); padding: 0; }
.prose a { color: var(--blue); }
```

Everything outside `.prose` stays mono. This is a scoped exception, not a second
typeface for the app.

### 2.12 Inline SVG icon set

16×16 viewBox, `stroke: currentColor`, `fill: none`, `stroke-width: 1.5`, round caps
and joins. 1.5 at 16px is the HUD hairline weight — it sits between the 1px frame
border and the 2px active rail, which is where an icon belongs.

```css
.icon {
  width: 16px; height: 16px; flex: 0 0 auto;
  fill: none; stroke: currentColor; stroke-width: 1.5;
  stroke-linecap: round; stroke-linejoin: round;
}
.icon.sm { width: 14px; height: 14px; stroke-width: 1.6; }
.icon.lg { width: 20px; height: 20px; stroke-width: 1.4; }
```

Ship as one hidden `<svg class="icon-sprite">` of `<symbol id="i-*" viewBox="0 0 16 16">`
at the top of `<body>`; use `<svg class="icon"><use href="#i-project"/></svg>`.
Do not inline the same path repeatedly.

```html
<svg class="icon-sprite" aria-hidden="true" focusable="false"
     style="position:absolute;width:0;height:0;overflow:hidden">

  <symbol id="i-project" viewBox="0 0 16 16">
    <path d="M12.5 2h-8A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h8"/>
    <path d="M4.5 11h8"/><path d="M12.5 2v12"/>
  </symbol>

  <symbol id="i-branch" viewBox="0 0 16 16">
    <circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/>
    <circle cx="11.5" cy="4.5" r="1.5"/>
    <path d="M4.5 5v5.5"/>
    <path d="M11.5 6v1.5a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 0-2.5 2.5"/>
  </symbol>

  <symbol id="i-pr" viewBox="0 0 16 16">
    <circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/>
    <circle cx="11.5" cy="12.5" r="1.5"/>
    <path d="M4.5 5v6"/>
    <path d="M11.5 11V6.5A2.5 2.5 0 0 0 9 4H7"/>
    <path d="m8.5 2.5-1.5 1.5 1.5 1.5"/>
  </symbol>

  <symbol id="i-run" viewBox="0 0 16 16">
    <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z"/>
  </symbol>

  <symbol id="i-stop" viewBox="0 0 16 16">
    <rect x="3.5" y="3.5" width="9" height="9" rx="1"/>
  </symbol>

  <symbol id="i-pause" viewBox="0 0 16 16">
    <path d="M6 3v10M10 3v10"/>
  </symbol>

  <symbol id="i-schedule" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>
  </symbol>

  <symbol id="i-agent" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="2.25"/>
    <circle cx="8" cy="8" r="5.5" stroke-dasharray="2 2.4"/>
    <path d="M8 2.5V4M8 12v1.5M2.5 8H4M12 8h1.5"/>
  </symbol>

  <!-- rank chevron: repeat 1-4x for tier depth, stacked via translate -->
  <symbol id="i-rank" viewBox="0 0 16 16">
    <path d="m3.5 9 4.5-4.5L12.5 9"/><path d="m3.5 12.5 4.5-4.5 4.5 4.5"/>
  </symbol>

  <symbol id="i-business" viewBox="0 0 16 16">
    <rect x="2" y="5" width="12" height="8.5" rx="1.5"/>
    <path d="M5.5 5V3.75A1.25 1.25 0 0 1 6.75 2.5h2.5a1.25 1.25 0 0 1 1.25 1.25V5"/>
    <path d="M2 8.5h12"/>
  </symbol>

  <symbol id="i-brain" viewBox="0 0 16 16">
    <circle cx="4" cy="5" r="1.5"/><circle cx="12" cy="4.5" r="1.5"/>
    <circle cx="8" cy="9.5" r="1.75"/><circle cx="4.5" cy="13" r="1.25"/>
    <path d="m5.2 5.8 1.6 2.5M10.9 5.5 9.3 8.2M7 10.9l-1.7 1.2"/>
  </symbol>

  <symbol id="i-mic" viewBox="0 0 16 16">
    <rect x="6" y="2" width="4" height="7.5" rx="2"/>
    <path d="M3.5 8a4.5 4.5 0 0 0 9 0"/><path d="M8 12.5V14"/>
  </symbol>

  <symbol id="i-settings" viewBox="0 0 16 16">
    <path d="M3 4.5h4M11 4.5h2M3 11.5h2M9 11.5h4"/>
    <circle cx="9" cy="4.5" r="1.75"/><circle cx="7" cy="11.5" r="1.75"/>
  </symbol>

  <symbol id="i-terminal" viewBox="0 0 16 16">
    <rect x="2" y="3" width="12" height="10" rx="1.5"/>
    <path d="m5 6.5 2.25 2L5 10.5"/><path d="M8.75 10.5H11"/>
  </symbol>

  <symbol id="i-search" viewBox="0 0 16 16">
    <circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.6 3.6"/>
  </symbol>

  <symbol id="i-alert" viewBox="0 0 16 16">
    <path d="M7.13 2.9 1.9 11.6a1 1 0 0 0 .86 1.5h10.48a1 1 0 0 0 .86-1.5L8.87 2.9a1 1 0 0 0-1.74 0Z"/>
    <path d="M8 6.2v3M8 11.1h.01"/>
  </symbol>

  <symbol id="i-check" viewBox="0 0 16 16">
    <path d="m2.75 8.5 3.25 3.25L13.25 4.5"/>
  </symbol>

  <symbol id="i-close" viewBox="0 0 16 16">
    <path d="m4 4 8 8M12 4l-8 8"/>
  </symbol>

  <symbol id="i-chevron" viewBox="0 0 16 16">
    <path d="M6 3.5 10.5 8 6 12.5"/>
  </symbol>

  <symbol id="i-refresh" viewBox="0 0 16 16">
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.96"/>
    <path d="M13.7 2.5v3.2h-3.2"/>
  </symbol>

  <symbol id="i-external" viewBox="0 0 16 16">
    <path d="M9 3h4v4"/><path d="M13 3 7.5 8.5"/>
    <path d="M11.5 9.5v3A1.5 1.5 0 0 1 10 14H3.5A1.5 1.5 0 0 1 2 12.5V6a1.5 1.5 0 0 1 1.5-1.5h3"/>
  </symbol>

  <symbol id="i-bolt" viewBox="0 0 16 16">
    <path d="M8.9 1.75 3.4 9.1h4L7.1 14.25l5.5-7.35h-4l.3-5.15Z"/>
  </symbol>

  <symbol id="i-database" viewBox="0 0 16 16">
    <ellipse cx="8" cy="3.75" rx="5" ry="2.25"/>
    <path d="M3 3.75v8.5c0 1.24 2.24 2.25 5 2.25s5-1.01 5-2.25v-8.5"/>
    <path d="M3 8c0 1.24 2.24 2.25 5 2.25S13 9.24 13 8"/>
  </symbol>

  <symbol id="i-layers" viewBox="0 0 16 16">
    <path d="m8 1.5 6 3.25L8 8 2 4.75 8 1.5Z"/>
    <path d="m2 8.5 6 3.25 6-3.25"/><path d="m2 11.5 6 3.25 6-3.25"/>
  </symbol>

  <symbol id="i-plus" viewBox="0 0 16 16">
    <path d="M8 3v10M3 8h10"/>
  </symbol>
</svg>
```

**Accessibility.** Decorative icons (paired with a text label) get `aria-hidden="true"`
on the `<svg class="icon">`. An icon-only button gets `aria-label` on the *button*, and
the svg stays `aria-hidden`.

**Verified.** All 25 glyphs were rendered at 16px and 52px against `--bg` before this
spec shipped; the paths are known-good, not sketched. Two caveats from that check:
`i-agent` (dashed orbit + ticks + core) and `i-brain` (four-node synapse) are the
densest glyphs in the set and lose definition below 16px — never use them with
`.icon.sm`. Everything else holds at 14px.

---

## 3. Motion language

**What animates, and why.**

| Animates | Reason |
|---|---|
| State changes — hover, focus, press, selected, tab switch | Confirms the input registered |
| Arrival and departure — panels, drawers, toasts, modals | Explains where a thing came from |
| Live values — gauge rings, progress, the live badge dot | Continuous truth about a running system |
| Ambient HUD — grid drift, starfield, reactor spin, scanlines | Signals "the system is awake"; must never draw the eye |

**What does not animate.** Text content on refresh. Numbers do not count up — a token
count that animates from 0 is a lie for the duration of the animation. Cards do not
stagger on every data poll, only on first mount of a surface. Nothing bounces,
overshoots, or rubber-bands; the house easing `cubic-bezier(0.2, 0.8, 0.2, 1)` is fast
out and settled, with no overshoot, and that is the whole personality.

**Durations.**

| Token | Value | Used for |
|---|---|---|
| `--t-instant` | 80ms | press depth |
| `--t-fast` | 130ms | hover, color/border/tint |
| `--t-base` | 200ms | tab rail, toast, modal, tint-and-move together |
| `--t-slow` | 350ms | drawer slide, progress width, bar fill |
| `--t-reveal` | 900ms | initial HUD fade |

Ambient loops keep their existing periods: grid drift 70s, reactor rings 8/15/28/44s,
scanlines static, mic pulse 1.2s, waveform 0.9s. All `linear`, all infinite, all under
6% opacity contribution.

**Reveal stagger — the convention for any new surface.**

The entry stagger in `dismissLanding()` is the model: background first, content
second, dressing last, driven by JS delays rather than CSS `animation-delay` so it can
be tied to real load state. Every new tab reuses the shape at one-third the scale:

```js
// on tab activation — cheap, JS-driven, cancellable
const REVEAL_STEP = 45;            // ms between siblings
const REVEAL_MAX  = 8;             // stop staggering past 8 items; the rest appear together
panel.querySelectorAll('[data-reveal]').forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i, REVEAL_MAX) * REVEAL_STEP}ms`;
  requestAnimationFrame(() => el.classList.add('revealed'));
});
```

```css
[data-reveal] {
  opacity: 0; transform: translateY(4px);
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}
[data-reveal].revealed { opacity: 1; transform: none; }
```

Order within a surface: primary metrics → main content region → secondary panels →
decorative instruments. Clear `transitionDelay` when the surface is hidden so a
re-entry does not compound.

**Reduced motion.** See §5.4 — it is a hard requirement, not a nicety.

---

## 4. Layout system

### 4.1 Regions

The HUD is a fixed frame around a full-bleed center stage. Four regions, all already
established; every new tab composes from them rather than inventing a layout.

```
┌──────────────────────────────────────────────────────────────┐
│  ⌐            [ PAGE TITLE kicker ]                        ¬ │  brackets z7
│  ┌─────────┐                                  ┌────────────┐ │
│  │ LEFT    │                                  │  RIGHT     │ │
│  │ RAIL    │        CENTER STAGE              │  DRAWER    │ │  drawer z25
│  │ 250px   │        (full-bleed, z1)          │  420px     │ │  (slides in)
│  │ z20     │                                  │            │ │
│  │         │                                  │            │ │
│  └─────────┘                                  └────────────┘ │
│  ◯ gauge          ┌──────────────────┐             ◯ gauge   │  gauges z15
│  ⌊               │  COMMAND BAR 580  │                    ⌋ │  cmdbar z20
└──────────────────────────────────────────────────────────────┘
```

- **Left rail** (`--rail-w`, fixed at `--gutter` from top-left, `z-chrome`) — the
  system-readout column. Tab nav sits at the top, then per-tab control panels, then
  the terminal. Everything in the rail is `width: 100%` of the rail; nothing in the
  rail scrolls the page, each panel scrolls itself. Rail total height must stay under
  `100vh - 2*var(--gutter)`; a rail that overflows is a design error, not a scrollbar
  opportunity.
- **Center stage** (full viewport, `z-graph`) — owned by the active tab. Brain owns
  the force graph; new tabs render a scrollable content region inset by
  `calc(var(--rail-w) + var(--gutter) * 2)` on the left and `var(--gutter) * 2` on the
  right, with `padding-bottom: 140px` to clear the command bar.
- **Right drawer** (`--drawer-w`, `z-drawer`) — detail for a selected object. One
  drawer at a time, app-wide. Selecting a different object swaps content in place; it
  does not close and reopen. Opening the drawer does not reflow the center stage — it
  overlays, because the graph must not re-lay-out when a node is inspected.
- **Bottom command bar** (`--cmdbar-w`, centered, `z-chrome`) — global, present on
  every tab, always the same input. Results and answers grow *upward* from it (already
  implemented by putting the bar last in DOM order in a column flex container). Never
  give a tab its own search field; the command bar is the search field.
- **Instruments** — corner brackets, gauges, edge telemetry are viewport-fixed and
  persist across tabs. They report system state, not tab state, so they never re-mount
  on tab switch.

### 4.2 Center-stage content scaffold

```css
.stage {
  position: fixed; inset: var(--gutter);
  left: calc(var(--rail-w) + var(--gutter) * 2);
  z-index: var(--z-chrome);
  overflow-y: auto; overscroll-behavior: contain;
  padding-bottom: 140px;                      /* clears the command bar */
  display: flex; flex-direction: column; gap: var(--sp-7);
}
.stage-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-7);
}
.stage-head h1 {
  margin: 0; font-size: var(--fs-lg); color: var(--text);
  letter-spacing: var(--track-kicker); text-transform: uppercase;
}
.stage-grid { display: grid; gap: var(--sp-6); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.stage-split { display: grid; gap: var(--sp-6); grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.8fr); align-items: start; }
```

Tabs whose center stage is a canvas (Brain) simply do not mount `.stage`.

### 4.3 Responsive behaviour

Desktop-first — this is a mission-control HUD on a desktop, and it should be honest
about that. Two breakpoints matter, plus a floor.

```css
@media (max-width: 1400px) {
  :root { --drawer-w: 380px; --cmdbar-w: 520px; }
  .stage-split { grid-template-columns: 1fr; }
}

@media (max-width: 1080px) {
  :root { --rail-w: var(--rail-w-narrow); }        /* icon-only rail */
  .rail .panel-body, .rail .seg-btn span { display: none; }
  .segmented { flex-direction: column; }
  .segmented::after { display: none; }             /* vertical rail uses a left bar instead */
  .seg-btn[aria-selected="true"] { box-shadow: inset 2px 0 0 var(--blue); }
  #claude-terminal:not(.expanded) { display: none; } /* unusable at 56px; keep the expand button */
  #edge-telemetry { display: none; }
  .stage-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
}

@media (max-width: 820px) {
  :root { --gutter: 10px; --drawer-w: 100vw; --cmdbar-w: calc(100vw - 20px); }
  .rail { transform: translateX(-110%); transition: transform var(--t-base) var(--ease-out); }
  body.rail-open .rail { transform: none; width: min(280px, 86vw); }
  #gauge-left, #gauge-right { display: none; }
  .hud-corner { width: 28px; height: 28px; }
  #grid, #scanlines { display: none; }             /* ambient texture costs more than it gives here */
  .stage { left: var(--gutter); }
  .stage-grid { grid-template-columns: 1fr; }
}
```

Below 820px the HUD stops pretending. Instruments hide, the rail becomes a sheet, and
the surface becomes a plain scrolling list — because a 6px-tall gauge tick is not
information on a phone.

**Minimum supported viewport: 360×640.** Nothing below that is designed for.

---

## 5. Accessibility floor

### 5.1 Contrast — measured, not assumed

Every pair below was computed against the actual hex values. Ratios are WCAG 2.1
relative-luminance contrast.

**Text colors on the four surfaces** (`--bg` / `-1` / `-2` / `-3`):

| Token | on `--bg` | on `--surface-1` | on `--surface-2` | on `--surface-3` | Verdict |
|---|---|---|---|---|---|
| `--text` `#d9e2ec` | 15.05 | 14.66 | 13.86 | 13.09 | AAA everywhere |
| `--text-soft` `#b9c6d4` | 11.35 | 11.05 | 10.44 | 9.87 | AAA everywhere |
| `--text-dim` `#93a1b2` | 7.49 | 7.29 | 6.89 | 6.51 | AA everywhere, AAA on `--bg`/`-1` |
| `--text-faint` `#7d8b9c` | 5.67 | 5.52 | 5.22 | 4.93 | AA only — decorative use |
| `--blue` | 7.98 | 7.77 | 7.34 | 6.94 | AA everywhere, AAA except on `-3` |
| `--mint` | 12.68 | 12.35 | 11.68 | 11.03 | AAA everywhere |
| `--amber` | 10.60 | 10.33 | 9.76 | 9.22 | AAA everywhere |
| `--red` | 7.13 | 6.94 | 6.56 | 6.20 | AA everywhere |
| `--violet` | 7.48 | 7.29 | 6.89 | 6.51 | AA everywhere |
| `--orange` | 8.06 | 7.85 | 7.42 | 7.01 | AA everywhere |
| `--gray` `#93a1b2` | 7.49 | 7.29 | 6.89 | 6.51 | AA everywhere |

**Two required token changes, both verified:**

1. **`--gray` must move from `#7a8896` to `#93a1b2`.** The old value scored 4.73 on
   `--surface-3` and **4.45 on its own 10% badge tint** — a fail. Idle badges are
   exactly where a reader needs to distinguish "never ran" from "running", so this one
   matters. New value: 6.41 on `--surface-3`, 5.93 on its own tint. Pass.
2. **`--text-dim` moves from `#8b9bb0` to `#93a1b2`.** The old value passed AA (6.05
   worst case) but sits under AAA on every surface, and it is the color of every label
   and kicker in the HUD. The new value clears AAA on the two darkest surfaces at no
   perceptual cost. This is the legibility pass landing in the palette, not just in
   the type scale.

**Badge tints** — accent text on its own `color-mix(accent 10%, surface-2)` background,
which is the badge recipe: mint 9.48, amber 8.14, blue 6.27, orange 6.39, violet 5.93,
red 5.77, gray 5.93. All pass AA comfortably.

**Tint ceiling: 18%.** The recipe still passes at 18% (worst case red 5.09), which is
what `.cat-btn.active` already uses and why that control is fine as built. At 25% the
weakest three fall under AA — red 4.46, violet 4.44, gray 4.43. Never tint a
text-bearing chip past 18%. Tints above that are for non-text fills only.

**Solid fills** — `--on-accent` `#06111a` on mint 12.26, on blue 7.71, on amber 10.25,
on red 6.89. All pass AAA or near it. `--on-accent` is the only legal foreground on a
solid accent fill; white on mint fails.

**Non-text contrast (WCAG 1.4.11, 3:1).** This is where the current file has a real
gap: `--border` `#202b39` scores **1.38** against `--bg`. That is fine for a decorative
hairline, and wrong for the only visible edge of a button or input. Hence
`--border-focusable` `#556d8f` — 3.73 on `--bg`, 3.43 on `--surface-2`, 3.24 on
`--surface-3`. **Every interactive control's resting border uses
`--border-focusable`.** `--border` stays for panel edges, dividers, and decoration,
where the panel is identified by its background, not its outline.

The blue focus ring is 7.98 on `--bg` and 5.80 even against `--border` — safe anywhere.

### 5.2 Focus visibility

- `:focus-visible` only. Never `:focus` — the command bar takes focus on load and a
  permanent ring would read as an error state.
- Standard ring: `outline: 2px solid var(--blue); outline-offset: 2px;`. Danger
  controls swap to `--red`. Rows and segmented buttons use `outline-offset: -2px` so
  the ring stays inside a clipped or flush container.
- Never `outline: none` without an equivalent replacement. The one legitimate custom
  treatment is the terminal input, which shows focus as a border-bottom color change —
  keep it, and add `outline-offset: -1px` fallback for keyboard users who tab into it
  from elsewhere.
- Focus order follows visual order: command bar → rail nav → rail panels → stage
  content → drawer. Modals trap focus and return it to the invoker.
- Any hit target is at least 24×24 CSS px. The current `.cat-btn` at 34px and
  `#mic-btn` at 26px both clear it; `.badge` is not interactive and is exempt.

### 5.3 Semantics

- The command bar input needs a real `<label>` (visually hidden is fine) — a
  placeholder is not a label.
- Segmented nav uses `role="tablist"` / `role="tab"` / `aria-selected` /
  `aria-controls`, with arrow-key navigation.
- Live regions: the toast stack is `aria-live="polite"`; the terminal scrollback is
  `aria-live="polite" aria-atomic="false"`; a critical toast is `role="alert"`.
- Canvas instruments (gauges, sparklines, the graph) are `aria-hidden="true"` and are
  **always** accompanied by the same value in text. The gauge already prints its value
  in the canvas — that is not accessible. Add a visually-hidden `<span>` with the same
  string, updated on the same tick.
- Status is never conveyed by color alone. Every status badge carries a word; every
  status dot sits beside a label; the alert card carries an icon, not only a red dot.
- Icon-only buttons carry `aria-label`; their `<svg>` carries `aria-hidden="true"`.

### 5.4 Reduced motion

Non-negotiable. The ambient layer of this HUD — drifting grid, spinning reactor rings,
scanlines, starfield — is precisely the class of motion that triggers vestibular
symptoms.

```css
@media (prefers-reduced-motion: reduce) {
  /* kill ambient loops entirely */
  #grid, #starfield, #landing-reactor .ticks, #landing-reactor .ring,
  #landing-reactor .core, .badge.live.pill::before, .card.is-live::before {
    animation: none !important;
  }
  #scanlines { display: none; }

  /* keep state feedback, but instant and without travel */
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 120ms !important;
    scroll-behavior: auto !important;
  }
  [data-reveal] { transform: none; }
  .drawer { transition-duration: 120ms !important; }
  .progress.indeterminate > i { width: 100%; animation: none; opacity: 0.5; }
}
```

Note what survives: color and opacity transitions at 120ms. Removing *all* feedback
makes an interface feel broken; removing *travel and loops* makes it comfortable. The
indeterminate bar becomes a static half-opacity fill rather than disappearing, so
"working" is still visible.

The JS reveal stagger must also check the preference and set `REVEAL_STEP = 0`:

```js
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const REVEAL_STEP = reduce ? 0 : 45;
```

### 5.5 Other floors

- The whole UI must be operable at 200% browser zoom without horizontal scroll on the
  center stage. The fixed rail and command bar may overlap at that zoom; the 1080px
  breakpoint handles it.
- `color-scheme: dark` is declared so form controls, scrollbars, and the caret render
  dark natively.
- No content is conveyed only through the canvas graph. Every node reachable in the
  graph is also reachable through the command bar's search results.

---

## 6. Implementation checklist

Ordered so nothing breaks mid-way.

1. Replace the `:root` block with §1. Verify the HUD still renders — the only value
   changes are `--gray` and `--text-dim`, both lighter.
2. Add `--border-focusable` to every interactive control's resting border:
   `#mic-btn`, `.ct-iconbtn`, `.ct-actions button`, `.intern-btn`, `#mute-toggle`,
   `#panel-close`, `.cat-btn`.
3. Add the icon sprite to `<body>`; swap the text-glyph buttons for `<use>` icons.
4. Convert `#panel` from animated `right` to animated `transform`.
5. Add `fitCanvas()` and retrofit both gauges (fixes HiDPI blur).
6. Add the `.frame` variants, `.panel`, `.card`, `.row`, `.badge`, `.btn`, `.icon-btn`,
   `.segmented`, `.progress`, `.skeleton`, `.toast` blocks in one new commented
   section.
7. Add `[data-reveal]` plus the reveal helper.
8. Add the `@media (prefers-reduced-motion: reduce)` block **last** so its
   `!important` rules win.
9. Add the three responsive breakpoints.
10. Smoke test: entry stagger still sequences; drawer opens and closes; tab rail
    tracks; gauges are sharp; `Tab` through the whole UI shows a visible ring at every
    stop; toggle reduced motion in DevTools and confirm the grid and reactor stop.

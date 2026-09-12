---
name: project-trading-automation
description: "Trading is the priority workstream from 2026-08-15 — Pine authoring, backtesting, then automated paper trading on MNQ/MES futures"
metadata: 
  node_type: memory
  type: project
  originSessionId: d162dbe6-db71-4f10-8ae9-22f12246c5e5
  modified: 2026-08-16T03:13:30.355Z
---

From 2026-08-15, the trading side is the active priority "for the coming weeks" after roughly six months dormant (Pine repo last touched Feb 2026). Three goals, in order: author TradingView indicators/strategies, backtest them properly, then drive **live execution starting with paper trading** via automated triggers.

Pine repo: `C:\Users\dishi\OneDrive\Desktop\Deish\DP_TradingView_Scripts` (branch `main`, **no git remote** — local only). PineScript v5/v6, targeting **MNQ1!/MES1! Micro E-mini futures**, commission modelled at $0.62/contract to match NinjaTrader/AMP. Indicators and strategies live in separate files by deliberate convention. Note: this is a *different* project from [[project-tickr]] — no shared code.

The load-bearing constraint discovered while scoping this: **TradingView has no order-execution API.** The only sanctioned automation path is `alert → webhook POST → your endpoint → broker API`, and webhooks need a paid TradingView plan plus 2FA. Browser-driving TradingView's paper-trading UI (Playwright/Chrome) breaks its terms on automated access and is fragile — rejected, not merely deprioritised.

Broker gate worth remembering: **Tradovate requires a funded live account to issue an API key**, even for simulation, so its free 14-day demo cannot be automated. IBKR paper accounts are free and API-accessible (needs IBKR **Pro**, not Lite, plus TWS/Gateway running locally).

See also [[feedback-clipboard]] — TradingView script files always get copied to the clipboard after edits, since Pine has no package manager and code moves by paste.

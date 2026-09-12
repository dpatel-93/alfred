---
name: Mr. Tickr Phase 12 - Product Cohesion Overhaul
description: March 2026 strategic plan and execution status for Tickr subscription-worthy probability engine
type: project
---

Mr. Tickr (mrtickr.com) Phase 12 cohesion overhaul — COMPLETED (2026-03-15).

**Vision**: "All-knowing market butler" (Alfred from Batman). Gentleman persona = brand. Calibrated probability engine = product.

**What was built in Phase 12**:
- Probability calibration (Platt scaling, 70/15/15 split, Brier scores, ECE)
- Rolling prediction accuracy tracking (prediction_outcomes table, /accuracy endpoint)
- SHAP "why" explanations (TreeExplainer, top 5 features per timeframe)
- HMM market regime detection (BULL/BEAR/SIDEWAYS via hmmlearn, /regime endpoint)
- Regime banner on dashboard (RISK-ON/RISK-OFF/MIXED with F&G + breadth)
- Sector Relative Strength chart (replaced treemap)
- Calendar tab restored (economic events, filter buttons, week grouping)
- Options prediction alignment card
- Social signal alignment badges (ML + Reddit agree/diverge)
- COBE 3D globe removed, jsVectorMap flat map is primary
- Guide tab rewritten (user-focused, no tech docs)
- Legal disclaimer (SEC publisher exemption compliant)
- Switched from OpenAI GPT-4o to Anthropic Claude
- Azure Key Vault for all secrets

**Infrastructure**: Azure Container Apps, Key Vault (tickr-kv), managed identity, single AutoDeploy workflow

**Next priorities**: Stripe subscription (Free/Plus $12/Pro $39), email alerts, PDF reports, FinBERT sentiment upgrade

**Why:** Calibrated probabilities + accuracy tracking + SHAP explanations = subscription-worthy product
**How to apply:** All future work should reinforce the probability story and cohesion

---
name: firecrawl-build
description: Integrate Firecrawl into product code — credentials/SDK setup, and calling scrape, search, or interact from an application. Use when a project needs FIRECRAWL_API_KEY or an SDK installed, or when a feature must scrape a page, search the web, or drive a browser flow from code you are writing. Do NOT use for running Firecrawl yourself to research or fetch something — that is the firecrawl-cli plugin skill.
license: ISC
metadata:
  author: firecrawl
  version: "0.2.0"
  homepage: https://www.firecrawl.dev
  consolidates: firecrawl-build-onboarding, firecrawl-build-scrape, firecrawl-build-search, firecrawl-build-interact
---

# Firecrawl — building it into an app

For *using* Firecrawl to fetch something right now, stop: that is the `firecrawl-cli`
plugin skill. This skill is only for writing application code that calls Firecrawl.

## Route to what you need

| The task | Read |
|---|---|
| Project has no key or SDK yet | [references/onboarding.md](references/onboarding.md) |
| Feature has a URL, needs page content | [references/scrape.md](references/scrape.md) |
| Feature starts from a query, not a URL | [references/search.md](references/search.md) |
| Page needs clicks, forms, pagination, login | [references/interact.md](references/interact.md) |

Setup detail, referenced by onboarding:
[auth-flow](references/auth-flow.md) · [project-setup](references/project-setup.md) · [sdk-installation](references/sdk-installation.md)

## Order of operations

1. **Credentials first.** Nothing else works without `FIRECRAWL_API_KEY` in the project's
   environment. Never hardcode it, never commit it.
2. **Pick the narrowest endpoint that does the job.** `scrape` for a known URL, `search`
   for discovery, `interact` only when the page genuinely needs driving. Reaching for
   `interact` when `scrape` would do is the most common and most expensive mistake here.
3. **Handle the failure path at the boundary.** Every call is a network call against a
   third party: rate limits, credit exhaustion, and partial content are normal states,
   not exceptions. Fail explicitly.

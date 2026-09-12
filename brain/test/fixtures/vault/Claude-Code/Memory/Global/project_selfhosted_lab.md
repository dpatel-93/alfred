---
name: project-selfhosted-lab
description: "SelfHosted-Lab at _Projects\\SelfHosted-Lab — all stacks deleted 2026-08-25, compose files kept; Twenty/Chatwoot/Documenso/Plane/Penpot/NocoDB evaluated and deleted 2026-08-23."
metadata: 
  node_type: memory
  type: project
  originSessionId: ae7ff2ab-bff6-4132-9c14-47a43e2f9f6d
  modified: 2026-08-24T03:23:33.013Z
---

`C:\Users\dishi\_Projects\SelfHosted-Lab\` holds docker-compose stacks for self-hosted apps,
each in its own folder with generated local credentials. Evaluated 2026-08-23; the twelve-app
sweep ended with:

- **Kept, stopped, start on demand**: none — the lab is empty as of 2026-08-25.
- **Docker fully emptied 2026-08-25** — CEO instruction "delete anything I'm not using".
  InvokeAI, Listmonk, Postgres, PineForge MCP and an orphaned ai-learning-platform image all
  removed; ~17.8GB reclaimed; 0 images, 0 containers, 0 volumes remain. Every `docker-compose.yml`
  under `SelfHosted-Lab\` was KEPT, so any stack is one `docker compose up -d` from returning —
  but its data/credentials are gone and setup restarts from scratch.
- **InvokeAI deleted 2026-08-25** — set up 2026-08-24, ran 43 min, never used again, zero models
  ever downloaded. Reclaimed 15.7GB. `invokeai/docker-compose.yml` kept, so it is one
  `docker compose up -d` away if a real image-gen need appears.
- **Deleted (containers, volumes, folders, images)**: Twenty (no sales pipeline), Chatwoot
  (support = one inbox), Documenso (no contract flow), Plane (solo operator + vault), Penpot
  (design covered elsewhere), NocoDB (no dataset). Do not re-propose without a new concrete need.
- **Desktop/CLI keepers outside docker**: Cap (screen recording, winget), Crawl4AI (`crwl`),
  Open Design clone at `_Projects\open-design` (one evaluation session pending — pnpm deps
  installed, `pnpm tools-dev run web` to launch).
- Voicebox was installed and then rejected/uninstalled same day — see
  [[feedback-scraping-and-tooling-routing]].

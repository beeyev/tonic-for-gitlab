---
description: Required checks, extension tooling, and live GitLab lab workflow.
---

## Verification

- Run repository checks through package scripts and locked local binaries. `bun run check` stays read-only; `bun run fix` may apply safe fixes only.
- Run `bun run verify` before completion. Add focused live Chrome evidence when fake DOM or fake WebExtension APIs cannot prove the behavior.
- For extension work, read `.agents/skills/extension-dev/SKILL.md` and current Extension.js documentation. Prefer Extension.js MCP tools; otherwise use package scripts or `bunx --no-install extension`.
- For live GitLab checks, inspect `lab/Makefile`, `lab/compose.yaml`, and `lab/seed.ts`, then start the lab with `make -C lab up`. Stop every owned browser session when verification ends.

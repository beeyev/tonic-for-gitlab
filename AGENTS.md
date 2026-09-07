# Project rules

## Guardrails

- Build Tonic for GitLab as an independent MIT-licensed implementation. External projects may inform behavior and architecture, but never donate source code or CSS.
- Use `Tonic for GitLab` publicly and `tonic-for-gitlab` as the technical slug. Preserve the GitLab non-affiliation and trademark statements in `README.md` and store metadata.
- Use Extension.js, strict TypeScript, React, and Bun. Exact-pin repository runtime and build dependencies; development MCP packages and remote services follow the intentionally floating declarations in `apm.yml`. Do not add dependencies, permissions, runtime contexts, or abstractions without an implemented consumer.
- Treat GitLab DOM, URLs, stored values, and captured console output as untrusted input.
- Prefer live code and tests over prose. Git history owns retired decisions.

## Changes

- Inspect the closest feature and its tests before editing. Follow current contracts in `src/content/runtime`, `src/settings`, `src/storage`, and `src/host-access` instead of duplicating their shapes in documentation.
- Keep behavior, selectors, styles, and tests in the owning feature directory. Promote shared code only after real consumers establish a common contract.
- Keep features event-driven and abortable. Reuse the content runtime's observer, avoid polling, batch DOM work, read rendered GitLab data before requesting it, and never issue one request per row.
- Keep `src/manifest.json` authoritative and never edit `dist/`. Audit permissions against the source manifest because Extension.js may add generated entries.
- Use `.apm/skills/tonic-feature/SKILL.md` for feature, content-runtime, settings-panel, or feature-toggle work.

## Documentation

- `README.md` owns public project, setup, compatibility, privacy, and contribution information.
- Do not create feature specifications, backlogs, compatibility journals, decision histories, or mirrored code reference in Markdown unless the user explicitly asks for them.
- Put a concise comment next to code only when it preserves a non-obvious constraint, invariant, or browser behavior that names and tests do not explain.

## Verification

- Run repository checks through package scripts and locked local binaries. `bun run check` stays read-only; `bun run fix` may apply safe fixes only.
- Run `bun run verify` before completion. Add focused live Chrome evidence when fake DOM or fake WebExtension APIs cannot prove the behavior.
- For extension work, read `.agents/skills/extension-dev/SKILL.md` and current Extension.js documentation. Prefer Extension.js MCP tools; otherwise use package scripts or `bunx --no-install extension`.
- For live GitLab checks, inspect `lab/Makefile`, `lab/compose.yaml`, and `lab/seed.ts`, then start the lab with `make -C lab up`. Stop every owned browser session when verification ends.

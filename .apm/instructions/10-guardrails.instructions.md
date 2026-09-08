---
description: Non-negotiable licensing, naming, stack, and trust constraints for Tonic for GitLab.
---

## Guardrails

- Build Tonic for GitLab as an independent MIT-licensed implementation. External projects may inform behavior and architecture, but never donate source code or CSS.
- Use `Tonic for GitLab` publicly and `tonic-for-gitlab` as the technical slug. Preserve the GitLab non-affiliation and trademark statements in `README.md` and store metadata.
- Use Extension.js, strict TypeScript, React, and Bun. Exact-pin repository runtime and build dependencies; development MCP packages and remote services follow the intentionally floating declarations in `apm.yml`. Do not add dependencies, permissions, runtime contexts, or abstractions without an implemented consumer.
- Treat GitLab DOM, URLs, stored values, and captured console output as untrusted input.
- Prefer live code and tests over prose. Git history owns retired decisions.

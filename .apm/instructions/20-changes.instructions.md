---
description: Rules for editing features, the content runtime, and the extension manifest.
---

## Changes

- Inspect the closest feature and its tests before editing. Follow current contracts in `src/content/runtime`, `src/settings`, `src/storage`, and `src/host-access` instead of duplicating their shapes in documentation.
- Keep behavior, selectors, styles, and tests in the owning feature directory. Promote shared code only after real consumers establish a common contract.
- Keep features event-driven and abortable. Reuse the content runtime's observer, avoid polling, batch DOM work, read rendered GitLab data before requesting it, and never issue one request per row.
- Keep `src/manifest.json` authoritative and never edit `dist/`. Audit permissions against the source manifest because Extension.js may add generated entries.
- Use `.apm/skills/tonic-feature/SKILL.md` for feature, content-runtime, settings-panel, or feature-toggle work.

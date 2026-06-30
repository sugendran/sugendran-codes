---
description: "Run the opencode skeptic on the current working tree, or toggle it for this repo"
argument-hint: "[on | off]"
allowed-tools: ["Bash", "Read", "Write"]
---

# sugendran-skeptics (manual)

**Argument:** "$ARGUMENTS"

Decide based on the argument:

- **`off`** — Read `./.sugendran-skeptics.json` if it exists, set `"enabled": false` (preserving other keys), write it back, and report that the skeptic is disabled for this repo.
- **`on`** — Same, but set `"enabled": true`, and report it is enabled.
- **anything else / empty** — Run the skeptic against the current working tree and print its output verbatim:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/skeptic-gate.mjs" --manual
  ```

  If it lists findings, treat each as a checklist item: confirm the business logic is actually correct, or fix it. If it says nothing material, report that and stop.

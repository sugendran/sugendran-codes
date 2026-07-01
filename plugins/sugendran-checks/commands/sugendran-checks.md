---
description: "Run the opencode skeptic on the current working tree, or toggle it for this repo"
argument-hint: "[on | off]"
allowed-tools: ["Bash", "Read", "Write"]
---

# sugendran-checks (manual)

**Argument:** "$ARGUMENTS"

Decide based on the argument:

- **`off`** — Read `./.sugendran-checks.json` if it exists, set `"enabled": false` (preserving other keys), write it back, and report that the skeptic is disabled for this repo. If the file does not exist, start from an empty object `{}`.
- **`on`** — Same, but set `"enabled": true`, and report it is enabled. If the file does not exist, start from an empty object `{}`.
- **anything else / empty** — Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks-gate.mjs" --manual`. Surface each reported finding as a checklist item to confirm or address; if it reports nothing material, say so.

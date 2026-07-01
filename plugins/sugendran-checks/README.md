# sugendran-checks

A Claude Code Stop hook that runs a **second-model skeptic** (via the [opencode](https://opencode.ai) CLI) over the business logic Claude just wrote, and asks the question Claude can't ask itself: *are we doing the right thing, or just assuming it's right?*

It is separate from `sugendran-reviews` (the deep PR-time pass). It runs **in the loop**, advisory and non-blocking, and only engages when **business logic** changes.

## Requirements

- **[opencode](https://opencode.ai) installed and authenticated**, with your **default model set to a non-Claude model** — the plugin runs `opencode run` with no `-m`, so it uses that default. Without a working opencode default the hook silently does nothing. See [Model](#model).
- **Node.js on your `PATH`** — the Stop hook runs via `node` (Claude Code already needs Node). If `node` can't be resolved in the hook's environment, the hook silently no-ops.

## Install

```bash
/plugin marketplace add sugendran/sugendran-codes
/plugin install sugendran-checks@sugendran-codes
/reload-plugins        # activate now (or restart Claude Code)
```

**That's the whole setup — there is no manual hook wiring.** Installing the plugin registers the Stop hook automatically; after `/reload-plugins` it runs on every turn Claude finishes, reviewing your uncommitted changes.

Installed at **user scope** it runs across all your projects. Turn it off with `CHECKS_DISABLE=1` (environment), `/sugendran-checks off` (this repo), or `/plugin disable sugendran-checks@sugendran-codes` (everywhere); remove it with `/plugin uninstall sugendran-checks@sugendran-codes`.

## Configuration

The skeptic reads `./.sugendran-checks.json` with these keys:

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | Disable via config or `CHECKS_DISABLE=1` environment variable |
| `timeoutMs` | `90000` | Max time (ms) to wait for skeptic response |
| `maxDiffBytes` | `262144` | Diffs larger than this use stat-only mode (filename + change count, no content) |
| `minSeverity` | `medium` | Report findings at this severity or higher: `low`, `medium`, `high`, `critical` |
| `minConfidence` | `0.6` | Report findings with confidence at this threshold or higher (0.0–1.0) |
| `pathsIgnore` | `["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.min.js", "*.map", "dist/*", "build/*", "vendor/*"]` | Ignore lockfiles, minified files, sourcemaps, and build output |

## Model

The plugin runs `opencode run` with **no `-m`** — it uses *your* opencode default model. Set that to a non-Claude model for a genuine counter-view (Sugendran uses GLM-5.2 via Ollama Cloud). **The skeptic model is not configured here.** To get a truly adversarial second opinion, point your opencode default at a model different from Claude.

## Fail-open guarantee

Any failure — opencode missing, timeout, unparseable response — silently allows the turn to finish. The skeptic hook **never blocks Claude**. If you want to disable it entirely, set `CHECKS_DISABLE=1` or run `/sugendran-checks off`.

## How it works

On every Stop, the hook diffs your working tree, sends it to the skeptic, and — if the skeptic finds a material unverified assumption or logic bug — injects a terse action list back to Claude via `additionalContext`. Anything that goes wrong (opencode missing, timeout, unparseable) silently allows the turn to finish.

## Manual use

```bash
/sugendran-checks            # review the working tree now
/sugendran-checks off        # disable for this repo
/sugendran-checks on         # re-enable
```

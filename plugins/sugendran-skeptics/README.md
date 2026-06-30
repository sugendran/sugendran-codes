# sugendran-skeptics

A Claude Code Stop hook that runs a **second-model skeptic** (via the [opencode](https://opencode.ai) CLI) over the business logic Claude just wrote, and asks the question Claude can't ask itself: *are we doing the right thing, or just assuming it's right?*

It is separate from `sugendran-reviews` (the deep PR-time pass). Skeptics runs **in the loop**, advisory and non-blocking, and only engages when **business logic** changes.

## Install

```bash
/plugin marketplace add sugendran/sugendran-codes
/plugin install sugendran-skeptics@sugendran-codes
```

## Model

The plugin runs `opencode run` with **no `-m`** — it uses *your* opencode default model. Set that to a non-Claude model for a genuine counter-view (Sugendran uses GLM-5.2 via Ollama Cloud).

## How it works

On every Stop, the hook diffs your working tree, sends it to the skeptic, and — if the skeptic finds a material unverified assumption or logic bug — injects a terse action list back to Claude via `additionalContext`. Anything that goes wrong (opencode missing, timeout, unparseable) silently allows the turn to finish.

## Manual use

```bash
/sugendran-skeptics          # review the working tree now
/sugendran-skeptics off      # disable for this repo
/sugendran-skeptics on       # re-enable
```

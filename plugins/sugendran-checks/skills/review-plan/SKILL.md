---
name: review-plan
description: "Use before presenting a plan or design to the user for approval — e.g. before calling ExitPlanMode, or before asking the user to approve a brainstorming/writing-plans design. Sends the plan to the sugendran-checks opencode skeptic (a different model) for a critique of unverified assumptions, gaps, and risks, so the plan can be revised before approval."
---

# review-plan

When you have a plan or design ready and are about to ask the user to approve it, get a second-model critique first.

1. Put the full plan/design text through the skeptic on stdin. If the plan already exists as a file (e.g. a written spec/plan doc), pipe that file; otherwise write the plan text to a temporary file first:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-review.mjs" < /path/to/plan.md
   ```

2. Read the output:
   - A findings list (assumptions / gaps / risks) → treat each as something to resolve: verify the assumption, close the gap, or make a conscious decision that it is acceptable — and revise the plan accordingly.
   - `Plan review — no material concerns.` → continue.
   - `Plan review unavailable … proceeding without it.` or `… disabled.` → the skeptic could not run; continue.

3. Then present the (revised) plan to the user for approval.

This is advisory — incorporate material feedback using your judgement, and do not loop more than once or twice.

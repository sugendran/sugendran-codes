# sugendran-codes — project instructions

This repo is a **Claude Code plugin marketplace**. It hosts skills as installable plugins.

## How it fits together

```
.claude-plugin/marketplace.json   ← lists every plugin (the index)
plugins/<plugin>/
  .claude-plugin/plugin.json       ← one plugin's manifest
  skills/<name>/SKILL.md           ← the skill itself
```

In `marketplace.json` each plugin's `source` is an explicit relative path,
e.g. `"./plugins/my-plugin"`. (A bare directory name is rejected by the validator.)

A plugin can ship more than skills — it may contain `agents/*.md` (subagents) and
`commands/*.md` (slash commands) too. The `sugendran-reviews` plugin is built from
agents + an orchestrator command rather than skills.

## Adding a skill

1. Create `plugins/<plugin>/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "<plugin>",
     "description": "<one line>",
     "version": "0.1.0"
   }
   ```
2. Create `plugins/<plugin>/skills/<name>/SKILL.md` with frontmatter:
   ```markdown
   ---
   name: <name>
   description: <when Claude should use this skill>
   ---

   <instructions>
   ```
3. Register it in `marketplace.json` `plugins[]`:
   ```json
   { "name": "<plugin>", "source": "./plugins/<plugin>", "description": "<one line>" }
   ```
4. Add a row to the README table.
5. Validate before committing: `claude plugin validate ./plugins/<plugin>`

## Conventions

- Plugin and skill names: kebab-case.
- `SKILL.md` is case-sensitive and frontmatter `description` is required.
- One plugin per skill so they install independently — unless the pieces are
  tightly coupled and always used together (e.g. a toolkit of agents + a command).
- Agent/command/skill frontmatter is YAML: a `description` containing `: ` (colon
  then space) breaks the parser unless quoted. Either quote it or avoid colon-space.
- Small atomic commits; include the prompt and plan in the commit message.
- Bump a plugin's `version` when its behaviour changes — users only get
  updates when the version changes.

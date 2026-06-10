# sugendran-codes — project instructions

This repo is a **Claude Code plugin marketplace**. It hosts skills as installable plugins.

## How it fits together

```
.claude-plugin/marketplace.json   ← lists every plugin (the index)
plugins/<plugin>/
  .claude-plugin/plugin.json       ← one plugin's manifest
  skills/<name>/SKILL.md           ← the skill itself
```

`marketplace.json` has `metadata.pluginRoot: "./plugins"`, so a plugin's
`source` is just its directory name (e.g. `"my-plugin"`, not `"./plugins/my-plugin"`).

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
   { "name": "<plugin>", "source": "<plugin>", "description": "<one line>" }
   ```
4. Add a row to the README table.
5. Validate before committing: `claude plugin validate ./plugins/<plugin>`

## Conventions

- Plugin and skill names: kebab-case.
- `SKILL.md` is case-sensitive and frontmatter `description` is required.
- One plugin per skill so they install independently — unless skills are
  tightly coupled and always used together.
- Small atomic commits; include the prompt and plan in the commit message.
- Bump a plugin's `version` when its behaviour changes — users only get
  updates when the version changes.

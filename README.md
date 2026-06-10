# sugendran-codes

Personal [Claude Code](https://claude.com/claude-code) marketplace for skills Sugendran uses.

## Install

```bash
/plugin marketplace add sugendran/sugendran-codes
/plugin install <plugin>@sugendran-codes
```

## What's inside

Each skill ships as its own plugin under `plugins/`, so you install only what you want.

| Plugin | Description |
| ------ | ----------- |
| _none yet_ | — |

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest
plugins/<plugin>/                  one installable plugin per dir
  .claude-plugin/plugin.json       plugin manifest
  skills/<name>/SKILL.md           the skill
```

See [CLAUDE.md](./CLAUDE.md) for how to add a skill.

## Licence

[MIT](./LICENSE)

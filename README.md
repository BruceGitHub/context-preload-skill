<div align="center">

# context-preload

**Tell the agent what to read, not the whole repository.**

[![CI](https://github.com/BruceGitHub/context-preload-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/BruceGitHub/context-preload-skill/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-3ddc97.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-66b3ff.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-0-3ddc97.svg)](package.json)

A skill + a tiny CLI + a visual editor for **routing the context** of an AI agent.

</div>

---

## The problem

Your repository has a large knowledge base: source, tests, docs, ADRs,
schemas, fixtures, examples. On every task the agent reads too much — or the
wrong things — and the context window fills with material that does not matter
for the job at hand.

`context-preload` adds one file to the repo: [`routing-context-flow.md`](routing-context-flow.md).
It declares **flows**. Each flow says which files to read for a kind of task,
what to skip, in which order, and under which rules.

```markdown
## Flow: review

- description: Review a change without rewriting it.
- triggers: review, pr, diff, check
- read:
  - `docs/language.md`        | the contract to check against
  - `src/**/*.mjs`            | the implementation
  - `tests/**/*.test.mjs`     | existing expectations
- skip:
  - `tests/fixtures/**`
- steps:
  1. Read the diff.
  2. Report findings with file:line.
- done when:
  - Every finding has a severity and a proposed fix.
```

Then the prompt stays natural:

> review the `feature/dd-100` branch using **context-preload**

The skill selects the `review` flow, reads only those files, and performs the
review normally. Other flows (`coding`, `debug`, `docs`…) are not loaded.

<div align="center">
  <img src="docs/how-it-works.svg" alt="A task selects a flow; the flow selects files; everything else stays out of the context" width="900">
</div>

## Quick start

```bash
git clone https://github.com/BruceGitHub/context-preload-skill.git
cd context-preload-skill
npm link                 # optional: puts `context-preload` on your PATH
```

In the repository you want to route:

```bash
context-preload init              # creates a starter routing-context-flow.md
context-preload list              # shows the flows
context-preload show review       # expands globs and prints the reading plan
context-preload validate          # checks structure and paths
```

No dependencies, no build step for the CLI. Node.js >= 18.18.

This repository ships its own [`routing-context-flow.md`](routing-context-flow.md),
so right after cloning you can run `context-preload show review` and see the
router applied to itself.

## What a resolved flow looks like

```text
$ context-preload show review

context-preload · routing-context-flow.md
crf v1 · 6 flows · root /home/me/project

▸ review — Review a change without rewriting it.
  triggers  review, pr, diff, check
  includes  base
  budget    50k · ~12.4k estimated tokens
  order     first the contract, then the implementation, then the tests.

Read (4)
   1. docs/language.md              ✓ 1 file · the contract
   2. src/**/*.mjs                  ✓ 5 files · implementation
   3. tests/**/*.test.mjs           ✓ 4 files · expectations
   4. docs/legacy/**                · skipped by rule

Total: 10 files · ~12.4k tokens
```

The agent gets a deterministic reading plan instead of guessing.

## Choosing a flow

| Situation | Behaviour |
| --- | --- |
| `use context-preload, flow review` | The named flow is used. |
| `review the feature/dd-100 branch using context-preload` | The flow is inferred from triggers (`review`, `diff`, `pr`). |
| Ambiguous or no match | The agent asks, with a numbered list. Never a silent guess. |

The CLI exposes the same inference:

```bash
$ context-preload pick "review the feature/dd-100 branch"
→ review (8.7 · trigger "review")

$ context-preload interactive
  1. review    Review a change without rewriting it.
  2. coding    Implement a feature or a fix.
  3. debug     Find the cause of a bug.
Which flow? [enter = review]
```

## Multiple routing files

The skill takes the file as input, so you can keep one per team, service or
context:

```
routing-context-flow.md
.context/routing-context-flow.md
docs/routing-context-flow.backend.md
```

```bash
context-preload show review --file docs/routing-context-flow.backend.md
```

Boring on purpose: no global state, no cache, no daemon. One file, read every
time.

## Visual editor

`editor/index.html` is a single, offline page: forms for global rules and
flows, live canonical Markdown preview, structural validation, import by file
or drag & drop, download, copy, and a local autosave draft.

```bash
context-preload editor --open
```

No CDN, no server, no dependencies. It shares the parser with the CLI, so what
you see is what `validate` sees. See [docs/editor.md](docs/editor.md).

## Install as a skill

The repository root is a universal `SKILL.md` skill.

**OpenCode**

```bash
mkdir -p ~/.config/opencode/skills
ln -s "$PWD" ~/.config/opencode/skills/context-preload
```

Project-level: `.opencode/skills/context-preload`.

**Claude Code**

```bash
mkdir -p ~/.claude/skills
ln -s "$PWD" ~/.claude/skills/context-preload
```

Project-level: `.claude/skills/context-preload`.

The skill uses the CLI when it is on `PATH`, otherwise
`node <skill-dir>/bin/context-preload.mjs`.

## CLI

| Command | What it does |
| --- | --- |
| `context-preload list [file]` | List flows, triggers, includes and budgets. |
| `context-preload show <flow> [file]` | Resolve a flow and print the reading plan. |
| `context-preload show <flow> --paths` | Print only the required paths. |
| `context-preload resolve <flow>` | Same as `show`, as JSON. |
| `context-preload validate [file]` | Check syntax, ids, includes, cycles and paths. |
| `context-preload pick "<task>"` | Infer the best flow from a task description. |
| `context-preload interactive` | Numbered menu to choose a flow. |
| `context-preload init [file]` | Write a starter routing file. |
| `context-preload editor [--open]` | Print or open the visual editor. |

Useful flags: `--file`, `--root`, `--json`, `--pretty`, `--all`,
`--no-check`, `--no-paths`, `--strict`, `--no-color`.

## The routing language

A flow is a Markdown section with list keys:

| Key | Purpose |
| --- | --- |
| `description` | What the flow is for. |
| `triggers` | Phrases used to infer the flow. |
| `priority` | Tie-breaker among inferred flows. |
| `includes` | Merge another flow's context first. |
| `read` | Files to read, in order (`path | note`). |
| `optional` | Files only if needed. |
| `skip` | Globs removed from this flow. |
| `budget` | Soft token budget (`60k`). |
| `steps` | How to perform the task. |
| `rules` | Constraints on how to work. |
| `done when` | Completion criteria. |

`## Global` adds `ignore`, `read order`, `budget`, `root` and global `rules`.
Globs support `*`, `**`, `?`, `{a,b}` and `[abc]`. English key synonyms are
accepted (`use when`, `files`, `exclude`, `rule`, `step`…).

Full specification: [docs/language.md](docs/language.md).

## Repository layout

```
.
├── SKILL.md                      # the agent-facing skill
├── bin/context-preload.mjs       # CLI entry point
├── src/
│   ├── crf-core.mjs              # parser, serializer, validator, ranking
│   ├── glob.mjs                  # dependency-free glob matcher
│   ├── resolve.mjs               # includes, skip/ignore, token estimates
│   ├── cli.mjs                   # commands and output
│   └── template.mjs              # starter file written by `init`
├── editor/
│   ├── template.html             # layout + styles (source)
│   ├── editor.js                 # UI logic (source)
│   └── index.html                # generated, offline, committed
├── scripts/build-editor.mjs      # inlines the core into the editor
├── routing-context-flow.md       # this repository routes itself
├── examples/                     # starter and minimal routing files
├── schema/                       # JSON Schema of the parsed model
├── docs/                         # language, editor, diagram
└── tests/                        # node:test, fixtures, CLI smoke tests
```

## Development

```bash
npm test                 # unit + resolver + CLI tests
npm run build:editor     # regenerate editor/index.html
npm run validate:examples
npm run check            # all of the above
```

Zero runtime dependencies. The core is pure ESM with no Node APIs, which is why
the same code runs in the CLI and in the browser. CI runs the tests on Node 20
and 22 and fails if `editor/index.html` is stale.

## Design notes

- **Markdown, not YAML.** The routing file is read by an LLM first and by a
  parser second. Headings and lists are legible to both, and comments survive.
- **The file is the interface.** The skill, the CLI and the editor all consume
  the same artifact; nothing is configured elsewhere.
- **Deterministic expansion.** Globs, includes, skip and duplicates are
  resolved by code, not by the model's imagination.
- **The skill does the task.** Routing is a pre-step; the output is still a
  review, a patch or an explanation.
- **Small surface.** No daemon, no database, no tokens accounting service.

## License

[MIT](LICENSE) © 2026 BruceGitHub

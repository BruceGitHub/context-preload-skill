---
name: context-preload
description: Load only the context a task needs by following a routing-context-flow.md file. Use when the user asks for a review, implementation, debugging, refactor, documentation or onboarding in a repo that has a routing file, or says "use context-preload", "flow review", "load the context for X", "context preload", "what should I read". Selects a flow, reads only its declared files, then performs the task normally.
---

# Context Preload

A repository can have a large knowledge base. Reading all of it wastes the
context window and dilutes attention. This skill routes reading: the routing
file declares **flows** (review, coding, debug, docs, onboarding…), and each
flow lists exactly which files to read, in which order, with which rules.

Your job: pick the right flow, load its context, then **do the user's task
normally**. You are not a routing report generator.

## 1. Find the routing file

Search in this order:

1. A path the user named explicitly (`routing file: docs/routing.md`, a link,
   `--file …`).
2. `routing-context-flow.md` in the repository root.
3. `.context/routing-context-flow.md`.
4. Walk up from the current directory until a routing file is found.

If none exists, say so and offer to create one:

```bash
context-preload init
context-preload editor --open
```

Do not invent a routing file or silently fall back to reading the whole repo.

## 2. Choose the flow

Apply this precedence strictly:

### Explicit

The user names a flow or the intent maps unambiguously:

- "using context-preload, flow review"
- "use context-preload, coding"
- "context-preload: review the feature/dd-100 branch"

Use that flow if it exists. If it does not, list the available flows and ask.

### Inferred

The user asks for a task and the routing file has a matching flow:

- "review the feature/dd-100 branch using context-preload" → `review`
- "implement the date filter, use context-preload" → `coding`
- "why does checkout crash? context-preload" → `debug`

Match against the flow's `triggers` and `description` (case- and
accent-insensitive, word boundaries). Prefer one strong trigger over many weak
keyword overlaps. `priority` only breaks ties.

If the CLI is available, the ranking is deterministic:

```bash
context-preload pick "review the feature/dd-100 branch"
```

### Interactive

If no flow matches, or two flows are equally plausible, **ask**. Do not guess
silently.

Ask with a compact numbered list, including descriptions and the default:

```
Which flow should I use for this request?
  1. review   — Review a change without rewriting it (default)
  2. coding   — Implement a feature or a fix
  3. debug    — Find the cause of a bug
Reply with the number or the id.
```

Use the harness's question tool when it exists; otherwise ask in plain text.
`context-preload interactive` renders the same menu in a terminal.

### No flow requested at all

If the user did not mention context-preload and the task is ordinary
conversation, do not force a flow. If the task clearly needs repository
context and a routing file exists, you may apply the matching flow, but say
which one you used.

## 3. Load the context

Read the routing file once. Then follow this contract:

1. Read the **Global** section: `ignore`, `read order`, `rules`, `budget`.
2. Read the selected flow and its `includes`, recursively. Included flows come
   first.
3. Respect `read` order. Read each file **once**, even if several entries match
   it.
4. Never read anything matched by `skip` or by the global `ignore`.
5. Read `optional` entries only if the task actually needs them. If you do,
   say so in the final note.
6. Stay within the flow budget (`60k`, `120000`, …). If the budget is exceeded,
   read the most relevant files first and report what you left out.
7. If a `read` entry is a directory, open only the files inside it that the
   task needs — not the whole tree.

Prefer the CLI to expand globs instead of guessing:

```bash
context-preload show review            # human-readable plan
context-preload show review --paths    # one path per line
context-preload resolve review         # JSON with matches and token estimate
```

`show` reports `missing` and `no match` entries: treat them as warnings, not as
permission to read something else.

If the CLI is not installed, read the routing file and expand the globs with
your own file tools, applying the same rules.

## 4. Do the task normally

After loading, behave exactly as you would for that task, with the flow's
`rules`, `steps`, `done when` and global `read order` as constraints.

- **review** → inspect the diff/changes and report findings; do not rewrite.
- **coding** → implement the change, run the project's checks.
- **debug** → reproduce, find the cause, fix it.
- **docs** → write documentation that matches real behaviour.
- **onboarding** → explain the project using the loaded files.

The routing file decides *what you read*. It does not replace the task: still
run `git diff`, still run tests, still verify claims.

## 5. Report, briefly

End with one compact line, not a wall of text:

```
Context: flow review · 8 files · ~12.4k tokens · 1 optional read
```

Then the actual result of the task. Mention any deviation:

- extra files read beyond the flow (and why);
- files skipped because of budget;
- missing paths or empty globs;
- a flow that looked wrong for the task.

Do not paste the routing file or the list of files unless the user asks.

## 6. When the context is not enough

- Read the missing file, but **say that you are leaving the flow** and why.
- If the gap is structural, propose a new flow or an edit to the routing file.
- If the user changes task mid-conversation, re-resolve the flow instead of
  carrying the previous context.

Never bulk-load the repository to compensate for an incomplete flow.

## 7. Editing the routing file

When the user wants to change what gets read:

- suggest the minimal edit (a `read` entry, a `skip`, a new flow);
- for visual editing, point to `context-preload editor --open`;
- after editing, run `context-preload validate` and mention the result;
- keep the canonical shape described in `docs/language.md`.

Routing files are meant to be versioned with the repository.

## Quick reference

| Task | Command |
| --- | --- |
| List flows | `context-preload list` |
| Plan a flow | `context-preload show review` |
| Paths only | `context-preload show review --paths` |
| JSON for scripts | `context-preload resolve review` |
| Infer a flow | `context-preload pick "review the branch"` |
| Interactive menu | `context-preload interactive` |
| Validate | `context-preload validate --strict` |
| Starter file | `context-preload init` |
| Visual editor | `context-preload editor --open` |

Routing language, merge rules and validation codes: `docs/language.md`.
Editor and draft storage: `docs/editor.md`.

If `context-preload` is not on `PATH`, run it from this skill's directory:

```bash
node <skill-directory>/bin/context-preload.mjs show review
```

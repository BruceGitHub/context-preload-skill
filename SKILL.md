---
name: context-preload
description: Load only the context a task needs by following a generated routing build file (`<name>.build.md`). Use when the user asks for a review, implementation, debugging, refactor, documentation or onboarding in a repo that has a routing build, or says "use context-preload", "flow review", "load the context for X", "context preload", "what should I read". Selects a flow, reads only its declared files, then performs the task normally.
---

# Context Preload

A repository can have a large knowledge base. Reading all of it wastes the
context window and dilutes attention. This skill routes reading: the routing
file declares **flows** (review, coding, debug, docs, onboarding…), and each
flow lists exactly which files to read and in which order.

Your job: pick the right flow, load its context, then **do the user's task
normally**. You are not a routing report generator.

## 1. Find the build file

The skill reads the **generated build file**, never the master. Search in this
order:

1. A path the user named explicitly.
2. `routing-context-flow.build.md` in the repository root.
3. `.context/routing-context-flow.build.md`.
4. Walk up from the current directory until a build file is found.

If none exists, say so and stop:

```
No routing build file found. Run `context-preload build` (or use the editor's
Build button) and try again.
```

Do not read `routing-context-flow.md` instead, and do not read the whole repo.
The master is the source used by the editor and the CLI; the skill only consumes
the build.

## 2. Choose the flow

Apply this precedence strictly:

### Explicit

The user names a flow or the intent maps unambiguously:

- "using context-preload, flow review"
- "use context-preload, coding"
- "context-preload: review the feature/dd-100 branch"

Use that flow if it exists. If it does not, list the available flows and ask.

### Inferred

The user asks for a task and the build file has a matching flow:

- "review the feature/dd-100 branch using context-preload" → `review`
- "implement the date filter, use context-preload" → `coding`
- "why does checkout crash? context-preload" → `debug`

Match against the flow's `description` and id (case- and accent-insensitive).
Prefer a clear description match over weak keyword overlaps. Ties are broken by
flow id.

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

### No flow requested at all

If the user did not mention context-preload and the task is ordinary
conversation, do not force a flow. If the task clearly needs repository
context and a build file exists, you may apply the matching flow, but say
which one you used.

## 3. Load the context

Read the build file once. It is already resolved: includes are merged, there is
no `Global` section and each flow is a self-contained block.

1. Select the `## <id>` section (see section 2).
2. Read the **Read these paths, in order** list, top to bottom.
3. Expand globs with your file tools. Read each file **once**, even if several
   paths match it.
4. Never read anything listed under **Do not read**.
5. If a path is a directory, open only the files inside it that the task needs.

Missing paths and empty globs are warnings, not permission to read something
else. If the build has no flow sections, say so and stop.

## 4. Do the task normally

After loading, behave exactly as you would for that task, with the global
`read order` as a constraint.

- **review** → inspect the diff/changes and report findings; do not rewrite.
- **coding** → implement the change, run the project's checks.
- **debug** → reproduce, find the cause, fix it.
- **docs** → write documentation that matches real behaviour.
- **onboarding** → explain the project using the loaded files.

The build file decides *what you read*. It does not replace the task: still
run `git diff`, still run tests, still verify claims.

## 5. Report, briefly

End with one compact line, not a wall of text:

```
Context: flow review · 8 files
```

Then the actual result of the task. Mention any deviation:

- extra files read beyond the flow (and why);
- missing paths or empty globs;
- a flow that looked wrong for the task.

Do not paste the build file or the list of files unless the user asks.

## 6. When the context is not enough

- Read the missing file, but **say that you are leaving the flow** and why.
- If the gap is structural, propose a new flow or an edit to the master routing
  file, then rebuild.
- If the user changes task mid-conversation, re-resolve the flow instead of
  carrying the previous context.

Never bulk-load the repository to compensate for an incomplete flow.

## 7. Editing the master routing file

When the user wants to change what gets read:

- suggest the minimal edit (a `read` entry, a `skip`, a new flow);
- for visual editing, point to `context-preload editor`;
- after editing, run `context-preload validate` and `context-preload build`;
- keep the canonical shape described in `docs/language.md`.

The master and the generated `.build.md` are meant to be versioned with the
repository; the skill reads the build, not the master.

## Quick reference

| Task | Command |
| --- | --- |
| List flows | `context-preload list` |
| Validate | `context-preload validate --strict` |
| Build | `context-preload build` |
| Starter file | `context-preload init` |
| Visual editor | `context-preload editor` |

Routing language, merge rules and validation codes: `docs/language.md`.
Editor and draft storage: `docs/editor.md`.

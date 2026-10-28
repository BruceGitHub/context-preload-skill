---
crf: 1
name: context-preload
description: Context routing for this repository.
default_budget: 50k
---

## Global

- ignore:
  - node_modules/**
  - .git/**
- read order: first the language contract, then the implementation, then the tests.
- rules:
  - If you change the file format, update docs/language.md and the tests.
  - Do not edit the editor by hand: change editor/template.html and rebuild.

## Flow: base

- description: Minimum context shared by the other flows.
- triggers: base
- read:
  - `docs/language.md` | the CRL language contract
  - `src/crf-core.mjs` | parser, serializer and validation

## Flow: review

- description: Review a change or a pull request without rewriting it.
- triggers: review, code review, pr, pull request, diff, check
- priority: 20
- includes: base
- read:
  - `src/**/*.mjs` | implementation
  - `tests/**/*.test.mjs` | existing coverage
- skip:
  - `tests/fixtures/**`
- steps:
  1. Read the diff and identify the files it touches.
  2. Compare the change with the contract in docs/language.md.
  3. Look for regressions, edge cases and missing tests.
- rules:
  - Report only concrete problems, with file and line.
  - Do not rewrite the code: propose the change.
- done when:
  - Every finding has a severity, file:line and a proposed fix.

## Flow: coding

- description: Implement or fix code with the minimum context.
- triggers: coding, implement, develop, feature, fix, correct
- priority: 10
- includes: base
- read:
  - `src/**/*.mjs` | implementation
  - `bin/**/*.mjs` | CLI entry point
  - `package.json` | scripts and version
- steps:
  1. Find the entry point of the change.
  2. Read the files it touches and their tests.
  3. Implement the smallest change and verify with npm test.
- rules:
  - Zero runtime dependencies: Node built-in modules only.
  - Keep the core usable in the browser (no node:* imports in crf-core.mjs).
- done when:
  - npm run check passes and the diff stays within scope.

## Flow: editor

- description: Work on the single-file visual editor.
- triggers: editor, ui, form, preview, interface, browser
- priority: 20
- includes: base
- read:
  - `editor/template.html` | layout and styles
  - `editor/editor.js` | interface logic
  - `scripts/build-editor.mjs` | build that inlines the core
  - `docs/editor.md` | expected behaviour
- steps:
  1. Change the template and the logic, not editor/index.html (generated).
  2. Run npm run build:editor.
  3. Open editor/index.html and test import, editing and download.
- rules:
  - The editor must stay offline: no CDN, no remote fonts.
- done when:
  - editor/index.html is regenerated and npm run check is green.

## Flow: docs

- description: Write or update documentation and examples.
- triggers: docs, documentation, readme, guide, explain, example
- priority: 10
- read:
  - `README.md`
  - `docs/**/*.md`
  - `examples/**/*.md`
  - `SKILL.md`
- steps:
  1. Verify the real behaviour with the CLI before documenting it.
  2. Update the example if the format changes.
- rules:
  - Examples must be executable, not pseudocode.
- done when:
  - Every command mentioned has been run at least once.

## Flow: release

- description: Prepare a release or a changelog.
- triggers: release, version, changelog, publish, tag
- priority: 30
- includes: coding
- read:
  - `package.json`
  - `CHANGELOG.md`
  - `README.md`
  - `.github/workflows/ci.yml`
- steps:
  1. Check that npm run check is green.
  2. Update the version and the CHANGELOG.
  3. Verify that README and docs mention the right version.
- done when:
  - The tag is ready and CI is green.

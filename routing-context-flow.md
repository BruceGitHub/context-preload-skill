---
crf: 1
name: context-preload
description: Context routing for this repository.
---

## Global

- ignore:
  - node_modules/**
  - .git/**
- read order: first the language contract, then the implementation, then the tests.

## Flow: base

- description: Minimum context shared by the other flows.
- read:
  - `docs/language.md` | the CRL language contract
  - `src/crf-core.ts` | parser, serializer and validation
  - `src/types.ts` | shared model types

## Flow: review

- description: Review a change or a pull request without rewriting it.
- includes: base
- read:
  - `src/**/*.ts` | implementation
  - `tests/**/*.test.mjs` | existing coverage
- skip:
  - `tests/fixtures/**`

## Flow: coding

- description: Implement or fix code with the minimum context.
- includes: base
- read:
  - `src/**/*.ts` | implementation
  - `bin/**/*.ts` | CLI entry point
  - `package.json` | scripts and version
  - `tsconfig.json` | compiler options

## Flow: editor

- description: Work on the single-file visual editor.
- includes: base
- read:
  - `editor/template.html` | layout and styles
  - `editor/editor.js` | interface logic
  - `scripts/build-editor.mjs` | build that inlines the core
  - `docs/editor.md` | expected behaviour

## Flow: docs

- description: Write or update documentation and examples.
- read:
  - `README.md`
  - `docs/**/*.md`
  - `examples/**/*.md`
  - `SKILL.md`

## Flow: release

- description: Prepare a release or a changelog.
- includes: coding
- read:
  - `package.json`
  - `CHANGELOG.md`
  - `README.md`
  - `.github/workflows/ci.yml`

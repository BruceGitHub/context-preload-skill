---
crf: 1
name: fixture
description: Small repository used by the test suite.
---

## Global

- ignore:
  - node_modules/**

## Flow: base

- description: Base context for every flow.
- read:
  - `src/core/**/*.ts` | core implementation

## Flow: review

- description: Review changes without rewriting them.
- includes: base
- read:
  - `src/api/**/*.ts` | public api
  - `spec/**/*.spec.ts`
  - `docs/**/*.md`
- skip:
  - `docs/legacy/**`

## Flow: coding

- description: Implement a feature or fix a bug.
- read:
  - `src/**/*.ts`

## Flow: broken

- description: Flow with a path that does not exist.
- read:
  - `does-not-exist.md`

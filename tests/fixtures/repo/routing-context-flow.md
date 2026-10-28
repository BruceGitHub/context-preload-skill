---
crf: 1
name: fixture
description: Small repository used by the test suite.
default_budget: 60k
---

## Global

- ignore:
  - node_modules/**
- rules:
  Fixture global rule.

## Flow: base

- description: Base context for every flow.
- read:
  - `src/core/**/*.ts` | core implementation

## Flow: review

- description: Review changes without rewriting them.
- triggers: review, pr, diff
- priority: 20
- includes: base
- read:
  - `src/api/**/*.ts` | public api
  - `spec/**/*.spec.ts`
  - `docs/**/*.md`
- optional:
  - `CHANGELOG.md`
- skip:
  - `docs/legacy/**`
- steps:
  1. Read the diff.
  2. Report findings.
- rules:
  - Concrete findings only.
- done when:
  - Findings have file:line.

## Flow: coding

- description: Implement a feature or fix a bug.
- triggers: coding, implement, feature, fix
- priority: 10
- read:
  - `src/**/*.ts`
- done when:
  - Tests pass.

## Flow: broken

- description: Flow with a path that does not exist.
- triggers: broken
- read:
  - `does-not-exist.md`

---
crf: 1
name: minimal
description: Minimal example with three flows.
root: ..
---

## Global

- ignore:
  - node_modules/**

## Flow: explain

- description: Explain the project to a newcomer.
- read:
  - `README.md`
  - `SKILL.md`

## Flow: review

- description: Check a change.
- read:
  - `src/**/*.ts`
  - `tests/**/*.test.mjs`

## Flow: docs

- description: Update the documentation.
- read:
  - `docs/**/*.md`
  - `README.md`

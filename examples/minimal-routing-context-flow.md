---
crf: 1
name: minimal
description: Minimal example with three flows.
default_budget: 40k
root: ..
---

## Global

- ignore:
  - node_modules/**

## Flow: explain

- description: Explain the project to a newcomer.
- triggers: explain, onboarding, understand, overview
- read:
  - `README.md`
  - `SKILL.md`
- done when:
  - You can answer "what is this for" and "how do I use it".

## Flow: review

- description: Check a change.
- triggers: review, pr, diff
- read:
  - `src/**/*.mjs`
  - `tests/**/*.test.mjs`
- rules:
  - Report only concrete problems.
- done when:
  - You listed the findings with file:line.

## Flow: docs

- description: Update the documentation.
- triggers: docs, documentation, readme
- read:
  - `docs/**/*.md`
  - `README.md`
- done when:
  - The documentation describes the real behaviour.

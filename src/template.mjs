/**
 * Starter routing file written by `context-preload init`.
 */
export const STARTER_TEMPLATE = `---
crf: 1
name: my-project
description: Context routing for my-project.
default_budget: 60k
---

## Global

- ignore:
  - node_modules/**
  - dist/**
  - .git/**
- read order: first the files touched by the task, then the tests, then the surrounding code.
- rules:
  - Read only what the selected flow declares; if you need more, say so before reading it.

## Flow: review

- description: Review a change or a pull request without rewriting code.
- triggers: review, code review, pr, pull request, diff, check
- priority: 20
- read:
  - \`src/**\` | code under review
  - \`tests/**\` | existing expectations
- skip:
  - \`docs/legacy/**\`
- steps:
  1. Identify the base branch and the diff.
  2. Read the files touched by the change first.
  3. Look for regressions, edge cases and missing tests.
- rules:
  - Report only concrete problems, with file and line.
  - Do not rewrite the code: propose the change.
- done when:
  - Every finding has a severity, file:line and a proposed fix.

## Flow: coding

- description: Implement or change a feature with the minimum context.
- triggers: coding, implement, develop, feature, fix, bug
- priority: 10
- includes: review
- read:
  - \`src/**\`
  - \`package.json\`
- steps:
  1. Find the entry point of the feature.
  2. Read the files it touches and their tests.
  3. Implement the smallest change and verify with the tests.
- rules:
  - Follow the style of the surrounding code.
  - Update the tests together with the code.
- done when:
  - The tests pass and the diff is limited to the scope.

## Flow: debug

- description: Find the cause of a bug starting from the symptom.
- triggers: debug, bug, error, crash, not working, stack trace
- priority: 30
- read:
  - \`src/**\`
  - \`tests/**\`
- steps:
  1. Reproduce the symptom with the smallest possible test or command.
  2. Walk back from the error to its causes.
  3. Fix the cause, not the symptom.
- done when:
  - There is a test that fails before the fix and passes after it.
`;

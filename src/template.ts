/**
 * CRC · template
 *
 * Scopo: testo del routing file iniziale scritto da `context-preload init`.
 * Collaboratori: nessuno.
 * Consumatori: src/cli.ts (comando `init`).
 */
export const STARTER_TEMPLATE = `---
crf: 1
name: my-project
description: Context routing for my-project.
---

## Global

- ignore:
  - node_modules/**
  - dist/**
  - .git/**
- read order: first the files touched by the task, then the tests, then the surrounding code.

## Flow: review

- description: Review a change or a pull request without rewriting code.
- read:
  - \`src/**\` | code under review
  - \`tests/**\` | existing expectations
- skip:
  - \`docs/legacy/**\`

## Flow: coding

- description: Implement or change a feature with the minimum context.
- includes: review
- read:
  - \`src/**\`
  - \`package.json\`

## Flow: debug

- description: Find the cause of a bug starting from the symptom.
- read:
  - \`src/**\`
  - \`tests/**\`
`;

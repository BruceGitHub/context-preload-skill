import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRF_VERSION,
  createEmptyModel,
  createFlow,
  formatReadEntry,
  getFlow,
  parseBudget,
  parseFlowFile,
  parseReadEntry,
  rankFlows,
  serializeFlowFile,
  validateModel,
} from '../src/crf-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'repo', 'routing-context-flow.md');
const SOURCE = fs.readFileSync(FIXTURE, 'utf8');

test('parses front matter and flows', () => {
  const { model, issues } = parseFlowFile(SOURCE);
  assert.equal(issues.filter((issue) => issue.level === 'error').length, 0);
  assert.equal(model.meta.crf, CRF_VERSION);
  assert.equal(model.meta.name, 'fixture');
  assert.equal(model.meta.defaultBudget, '60k');
  assert.deepEqual(
    model.flows.map((flow) => flow.id),
    ['base', 'review', 'coding', 'broken'],
  );
});

test('parses global section', () => {
  const { model } = parseFlowFile(SOURCE);
  assert.deepEqual(model.global.ignore, ['node_modules/**']);
  assert.equal(model.global.rules, 'Fixture global rule.');
});

test('parses nested and inline lists', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: review
- triggers:
  - review
  - pull request
- includes: base, shared
- read:
  - \`src/a.ts\` | first
  - src/b.ts — second
`);
  const flow = getFlow(model, 'review');
  assert.deepEqual(flow.triggers, ['review', 'pull request']);
  assert.deepEqual(flow.includes, ['base', 'shared']);
  assert.deepEqual(flow.read, [
    { path: 'src/a.ts', note: 'first' },
    { path: 'src/b.ts', note: 'second' },
  ]);
});

test('parses steps and done-when lists', () => {
  const { model } = parseFlowFile(SOURCE);
  const flow = getFlow(model, 'review');
  assert.deepEqual(flow.steps, ['Read the diff.', 'Report findings.']);
  assert.deepEqual(flow.doneWhen, ['Findings have file:line.']);
});

test('parses multi-line rule blocks and keeps markdown', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: x
- rules:
  First rule.

  - bullet markdown
  - second line
`);
  const flow = getFlow(model, 'x');
  assert.equal(flow.rules, 'First rule.\n\n- bullet markdown\n- second line');
});

test('supports key synonyms', () => {
  const { model } = parseFlowFile(`
---
crf: 1
name: project
description: A project.
---
## Flow: review
- use when: Review a change.
- trigger words: review, check
- files:
  - \`src/**\`
- exclude:
  - \`vendor/**\`
- rule: Only concrete problems.
- step: Read the diff.
- definition of done:
  - Findings are listed.
`);
  assert.equal(model.meta.name, 'project');
  const flow = getFlow(model, 'review');
  assert.equal(flow.description, 'Review a change.');
  assert.deepEqual(flow.triggers, ['review', 'check']);
  assert.equal(flow.read[0].path, 'src/**');
  assert.deepEqual(flow.skip, ['vendor/**']);
  assert.equal(flow.rules, 'Only concrete problems.');
  assert.deepEqual(flow.steps, ['Read the diff.']);
  assert.deepEqual(flow.doneWhen, ['Findings are listed.']);
});

test('ignores level-2 headings inside fenced code blocks', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: docs
- rules:
  \`\`\`md
  ## Flow: not-a-flow
  \`\`\`
- done when:
  - Rules kept.
`);
  assert.deepEqual(
    model.flows.map((flow) => flow.id),
    ['docs'],
  );
  assert.match(getFlow(model, 'docs').rules, /## Flow: not-a-flow/);
});

test('read entry parsing handles notes and separators', () => {
  assert.deepEqual(parseReadEntry('`src/a.ts` | why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('`src/a.ts` — why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('src/a.ts | why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('`src/a.ts`'), { path: 'src/a.ts', note: '' });
  assert.equal(formatReadEntry({ path: 'src/a.ts', note: 'why' }), '`src/a.ts` | why');
});

test('budget parsing', () => {
  assert.equal(parseBudget('60k'), 60_000);
  assert.equal(parseBudget('80K tokens'), 80_000);
  assert.equal(parseBudget('1.5M'), 1_500_000);
  assert.equal(parseBudget('120000'), 120_000);
  assert.equal(parseBudget('nope'), null);
  assert.equal(parseBudget(''), null);
});

test('serializer round-trips the fixture', () => {
  const { model } = parseFlowFile(SOURCE);
  const canonical = serializeFlowFile(model);
  const { model: reparsed, issues } = parseFlowFile(canonical);
  assert.deepEqual(reparsed, model);
  assert.equal(serializeFlowFile(reparsed), canonical);
  assert.equal(issues.filter((issue) => issue.level === 'error').length, 0);
  assert.match(canonical, /- rules:\n {2}- Concrete findings only\./);
});

test('serializer keeps pre-existing markdown bullets in rules', () => {
  const model = createEmptyModel({
    flows: [createFlow('x', { rules: '- first\n- second', read: [{ path: 'a', note: '' }] })],
  });
  const text = serializeFlowFile(model);
  assert.match(text, /- rules:\n {2}- first\n {2}- second/);
  assert.equal(getFlow(parseFlowFile(text).model, 'x').rules, '- first\n- second');
});

test('validation catches structural problems', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: a
- triggers: review
- includes: b, missing
- read:
  - /absolute/path.ts
## Flow: b
- triggers: review
- includes: a
## Flow: Bad Id
- read:
  - \`x\`
`);
  const issues = validateModel(model);
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes('include.unknown'));
  assert.ok(codes.includes('include.cycle'));
  assert.ok(codes.includes('trigger.duplicate'));
  assert.ok(codes.includes('flow.id'));
  assert.ok(codes.includes('path.absolute'));
});

test('validation flags an empty model and bad budgets', () => {
  const model = createEmptyModel();
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('flows.empty'));

  model.flows.push(createFlow('x', { budget: 'many', read: [{ path: 'a', note: '' }] }));
  assert.ok(validateModel(model).some((issue) => issue.code === 'budget.invalid'));
});

test('ranks flows from a natural language task', () => {
  const { model } = parseFlowFile(SOURCE);
  const review = rankFlows(model, 'review the feature/dd-100 branch');
  assert.equal(review[0].flow.id, 'review');

  const coding = rankFlows(model, 'implement a checkout feature');
  assert.equal(coding[0].flow.id, 'coding');

  assert.deepEqual(rankFlows(model, ''), []);
  assert.deepEqual(rankFlows(model, 'zzz qqq'), []);
});

test('unknown front matter keys are warnings, not errors', () => {
  const { issues } = parseFlowFile(`
---
crf: 1
weird: value
---
## Flow: x
- read:
  - \`a\`
`);
  assert.ok(issues.some((issue) => issue.code === 'frontmatter.key' && issue.level === 'warning'));
});

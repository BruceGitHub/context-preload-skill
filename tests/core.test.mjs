/**
 * CRC · tests/core
 *
 * Scopo: test di parser, serializer, validatore e ranking del linguaggio CRL.
 * Collaboratori: src/crf-core.ts.
 * Consumatori: node --test, CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRF_VERSION,
  createEmptyModel,
  formatReadEntry,
  getFlow,
  parseFlowFile,
  parseReadEntry,
  rankFlows,
  serializeBuildFile,
  serializeFlowFile,
  validateModel,
} from '../src/crf-core.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'repo', 'routing-context-flow.md');
const SOURCE = fs.readFileSync(FIXTURE, 'utf8');

test('parses front matter and flows', () => {
  const { model, issues } = parseFlowFile(SOURCE);
  assert.equal(issues.filter((issue) => issue.level === 'error').length, 0);
  assert.equal(model.meta.crf, CRF_VERSION);
  assert.equal(model.meta.name, 'fixture');
  assert.deepEqual(
    model.flows.map((flow) => flow.id),
    ['base', 'review', 'coding', 'broken'],
  );
});

test('parses global section', () => {
  const { model } = parseFlowFile(SOURCE);
  assert.deepEqual(model.global.ignore, ['node_modules/**']);
});

test('parses nested and inline lists', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: review
- includes: base, shared
- read:
  - \`src/a.ts\` | first
  - src/b.ts — second
`);
  const flow = getFlow(model, 'review');
  assert.deepEqual(flow.includes, ['base', 'shared']);
  assert.deepEqual(flow.read, [
    { path: 'src/a.ts', note: 'first' },
    { path: 'src/b.ts', note: 'second' },
  ]);
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
- files:
  - \`src/**\`
- exclude:
  - \`vendor/**\`
`);
  assert.equal(model.meta.name, 'project');
  const flow = getFlow(model, 'review');
  assert.equal(flow.description, 'Review a change.');
  assert.equal(flow.read[0].path, 'src/**');
  assert.deepEqual(flow.skip, ['vendor/**']);
});

test('read entry parsing handles notes and separators', () => {
  assert.deepEqual(parseReadEntry('`src/a.ts` | why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('`src/a.ts` — why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('src/a.ts | why'), { path: 'src/a.ts', note: 'why' });
  assert.deepEqual(parseReadEntry('`src/a.ts`'), { path: 'src/a.ts', note: '' });
  assert.equal(formatReadEntry({ path: 'src/a.ts', note: 'why' }), '`src/a.ts` | why');
});

test('serializer round-trips the fixture', () => {
  const { model } = parseFlowFile(SOURCE);
  const canonical = serializeFlowFile(model);
  const { model: reparsed, issues } = parseFlowFile(canonical);
  assert.deepEqual(reparsed, model);
  assert.equal(serializeFlowFile(reparsed), canonical);
  assert.equal(issues.filter((issue) => issue.level === 'error').length, 0);
});

test('build expands includes and collects skip/ignore', () => {
  const { model } = parseFlowFile(SOURCE);
  const text = serializeBuildFile(model, 'routing-context-flow.md');

  assert.match(text, /# Built routing — fixture/);
  assert.match(text, /## review/);
  assert.doesNotMatch(text, /## base/);
  assert.match(text, /1\. `src\/core\/\*\*\/\*\.ts`/);
  assert.match(text, /`src\/api\/\*\*\/\*\.ts`/);
  assert.match(text, /Do not read:/);
  assert.match(text, /`node_modules\/\*\*`/);
  assert.match(text, /`docs\/legacy\/\*\*`/);
  assert.doesNotMatch(text, /- includes:/);
});

test('validation catches structural problems', () => {
  const { model } = parseFlowFile(`
---
crf: 1
---
## Flow: a
- includes: b, missing
- read:
  - /absolute/path.ts
## Flow: b
- includes: a
## Flow: Bad Id
- read:
  - \`x\`
`);
  const issues = validateModel(model);
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes('include.unknown'));
  assert.ok(codes.includes('include.cycle'));
  assert.ok(codes.includes('flow.id'));
  assert.ok(codes.includes('path.absolute'));
});

test('validation flags an empty model', () => {
  const model = createEmptyModel();
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('flows.empty'));
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

test('treats a prose file as free-text routing', () => {
  const { model, issues } = parseFlowFile(`
# Context routing

When I am doing a review, read these files:
- docs/language.md
- src/**/*.ts

Skip tests/fixtures. Report concrete problems.
`);
  assert.equal(model.flows.length, 0);
  assert.ok(issues.some((issue) => issue.code === 'flows.empty' && issue.level === 'warning'));
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

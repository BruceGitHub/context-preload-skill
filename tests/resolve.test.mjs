import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmptyModel, createFlow, parseFlowFile } from '../src/crf-core.mjs';
import { loadRoutingFile, resolveFlow } from '../src/resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures', 'repo');
const FIXTURE = path.join(FIXTURE_DIR, 'routing-context-flow.md');

test('merges includes before the flow itself', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const result = resolveFlow(loaded.model, 'review', { root: loaded.root });

  assert.equal(result.found, true);
  assert.equal(result.entries[0].pattern, 'src/core/**/*.ts');
  assert.deepEqual(result.entries[0].matches, ['src/core/db.ts']);
  assert.deepEqual(result.entries[1].matches, ['src/api/orders.ts', 'src/api/users.ts']);
  assert.equal(result.budget, 60_000);
  assert.ok(result.totals.tokens > 0);
  assert.equal(result.overBudget, false);
});

test('applies skip rules and global ignores', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const result = resolveFlow(loaded.model, 'review', { root: loaded.root });
  const all = [...result.entries, ...result.optionalEntries].flatMap((entry) => entry.matches);

  assert.ok(all.includes('docs/guide.md'));
  assert.ok(!all.includes('docs/legacy/old.md'));
  assert.ok(!all.some((file) => file.startsWith('node_modules/')));
  assert.equal(result.totals.files, 6);
  assert.equal(result.optionalEntries[0].pattern, 'CHANGELOG.md');
  assert.equal(result.optionalEntries[0].status, 'ok');
});

test('reports missing paths as warnings', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const result = resolveFlow(loaded.model, 'broken', { root: loaded.root });

  assert.equal(result.entries[0].status, 'missing');
  assert.ok(result.issues.some((issue) => issue.code === 'read.missing'));
  assert.ok(result.issues.every((issue) => issue.level === 'warning'));
});

test('unknown flows are reported without throwing', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const result = resolveFlow(loaded.model, 'nope', { root: loaded.root });
  assert.equal(result.found, false);
  assert.equal(result.issues[0].code, 'flow.unknown');
});

test('check:false does not touch the filesystem', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const result = resolveFlow(loaded.model, 'review', { root: loaded.root, check: false });
  assert.ok(result.entries.every((entry) => entry.status === 'unchecked'));
  assert.equal(result.totals.files, 0);
});

test('literal directories are marked as directories', () => {
  const model = createEmptyModel({
    flows: [
      createFlow('x', {
        read: [{ path: 'src/api', note: 'api folder' }],
      }),
    ],
  });
  const result = resolveFlow(model, 'x', { root: FIXTURE_DIR });
  assert.equal(result.entries[0].status, 'directory');
  assert.equal(result.entries[0].isDirectory, true);
  assert.equal(result.entries[0].note, 'api folder');
});

test('loadRoutingFile resolves relative roots', () => {
  const nested = path.join(FIXTURE_DIR, 'nested-routing.md');
  fs.writeFileSync(
    nested,
    `---\ncrf: 1\nroot: .\n---\n\n## Flow: x\n- read:\n  - \`src/**/*.ts\`\n`,
    'utf8',
  );
  try {
    const loaded = loadRoutingFile(nested);
    assert.equal(loaded.root, FIXTURE_DIR);
    assert.ok(fs.existsSync(loaded.root));
  } finally {
    fs.unlinkSync(nested);
  }
});

test('root overrides and outside-root paths are rejected', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const model = createEmptyModel({
    flows: [createFlow('escape', { read: [{ path: '../../etc/passwd', note: '' }] })],
  });
  const result = resolveFlow(model, 'escape', { root: FIXTURE_DIR });
  assert.equal(result.entries[0].status, 'outside');
  assert.ok(result.issues.some((issue) => issue.level === 'error'));

  const overridden = resolveFlow(loaded.model, 'review', { root: path.dirname(FIXTURE_DIR) });
  assert.equal(overridden.root, path.dirname(FIXTURE_DIR));
});

test('duplicate read entries are collapsed when includes overlap', () => {
  const loaded = loadRoutingFile(FIXTURE);
  const model = parseFlowFile(`
---
crf: 1
---
## Flow: base
- read:
  - \`src/api/users.ts\`
## Flow: child
- includes: base
- read:
  - \`src/api/users.ts\`
`).model;
  const result = resolveFlow(model, 'child', { root: FIXTURE_DIR });
  assert.equal(result.entries.length, 1);
  assert.equal(loaded.model.flows.length, 4);
});

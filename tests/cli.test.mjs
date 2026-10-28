import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'context-preload.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'repo', 'routing-context-flow.md');

function run(args) {
  return execFileSync(process.execPath, [BIN, ...args, '--no-color'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('list prints every flow', () => {
  const output = run(['list', FIXTURE]);
  assert.match(output, /review/);
  assert.match(output, /coding/);
  assert.match(output, /4 flows/);
});

test('list --json is machine readable', () => {
  const payload = JSON.parse(run(['list', FIXTURE, '--json']));
  assert.equal(payload.name, 'fixture');
  assert.deepEqual(
    payload.flows.map((flow) => flow.id),
    ['base', 'review', 'coding', 'broken'],
  );
});

test('show resolves files and hides skipped ones', () => {
  const output = run(['show', 'review', FIXTURE]);
  assert.match(output, /src\/api\/users\.ts/);
  assert.match(output, /docs\/guide\.md/);
  assert.doesNotMatch(output, /docs\/legacy\/old\.md/);
  assert.doesNotMatch(output, /node_modules/);
  assert.match(output, /6 file/);
});

test('show --paths prints only paths', () => {
  const output = run(['show', 'review', FIXTURE, '--paths']);
  const lines = output.trim().split('\n');
  assert.ok(lines.includes('src/core/db.ts'));
  assert.ok(lines.includes('docs/guide.md'));
  assert.ok(!lines.includes('CHANGELOG.md'), 'optional entries are not required paths');
});

test('show fails on unknown flows', () => {
  const result = spawnSync(process.execPath, [BIN, 'show', 'nope', FIXTURE], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown flow/);
});

test('resolve prints structured JSON', () => {
  const payload = JSON.parse(run(['resolve', 'coding', FIXTURE]));
  assert.equal(payload.flow, 'coding');
  assert.equal(payload.entries.length, 1);
  assert.ok(payload.entries[0].matches.length >= 3);
  assert.equal(payload.budget, 60_000);
});

test('validate accepts a file with warnings only', () => {
  const output = run(['validate', FIXTURE]);
  assert.match(output, /0 errors/);
  assert.match(output, /warning/);
});

test('validate exits 1 on structural errors', () => {
  const result = spawnSync(
    process.execPath,
    [BIN, 'validate', 'routing-context-flow.md', '--no-paths'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const broken = spawnSync(
    process.execPath,
    [BIN, 'validate', path.join(HERE, 'does-not-exist.md')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(broken.status, 1);
});

test('pick infers a flow from a task', () => {
  const output = run(['pick', 'review the feature/dd-100 branch', '--file', FIXTURE]);
  assert.match(output, /→ review/);

  const json = JSON.parse(
    run(['pick', 'implement a feature', '--file', FIXTURE, '--json']),
  );
  assert.equal(json.matches[0].id, 'coding');
});

test('pick exits 2 when nothing matches', () => {
  const result = spawnSync(
    process.execPath,
    [BIN, 'pick', 'zzz qqq', '--file', FIXTURE, '--no-color'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
});

test('init creates a valid starter file', () => {
  const target = path.join(ROOT, 'tests', 'fixtures', 'generated-routing.md');
  try {
    const output = run(['init', target, '--force']);
    assert.match(output, /created/);
    const validation = run(['validate', target, '--no-paths']);
    assert.match(validation, /0 errors/);
    assert.match(validation, /3 flows/);
  } finally {
    try {
      execFileSync('rm', ['-f', target]);
    } catch {
      /* ignore */
    }
  }
});

test('editor prints a path', () => {
  const output = run(['editor']);
  assert.match(output, /editor\/index\.html/);
});

/**
 * CRC · tests/cli
 *
 * Scopo: smoke test della CLI (comandi, output, exit code, server editor).
 * Collaboratori: bin/context-preload.ts, tests/fixtures/repo.
 * Consumatori: node --test, CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'context-preload.ts');
const FIXTURE = path.join(HERE, 'fixtures', 'repo', 'routing-context-flow.md');

process.env.NO_COLOR = '1';

function run(args) {
  return execFileSync(process.execPath, [BIN, ...args], {
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

test('validate accepts a file with warnings only', () => {
  const output = run(['validate', FIXTURE]);
  assert.match(output, /0 errors/);
  assert.match(output, /warning/);
});

test('validate exits 1 on structural errors', () => {
  const result = spawnSync(
    process.execPath,
    [BIN, 'validate', 'routing-context-flow.md'],
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

test('build writes the index and one file per flow', () => {
  const dir = path.dirname(FIXTURE);
  const index = path.join(dir, 'routing-context-flow.build.md');
  const review = path.join(dir, 'routing-context-flow.review.build.md');
  try {
    const output = run(['build', FIXTURE]);
    assert.match(output, /built/);

    const indexText = fs.readFileSync(index, 'utf8');
    assert.match(indexText, /- `review`/);
    assert.doesNotMatch(indexText, /`src\//);

    const flowText = fs.readFileSync(review, 'utf8');
    assert.match(flowText, /## review/);
    assert.match(flowText, /Do not read:/);
    assert.match(flowText, /STOP — end of flow `review`/);
    assert.doesNotMatch(flowText, /## coding/);
  } finally {
    fs.rmSync(index, { force: true });
    for (const id of ['base', 'review', 'coding', 'broken']) {
      fs.rmSync(path.join(dir, `routing-context-flow.${id}.build.md`), { force: true });
    }
  }
});

test('init creates a valid starter file', () => {
  const target = path.join(ROOT, 'tests', 'fixtures', 'generated-routing.md');
  try {
    execFileSync('rm', ['-f', target]);
    const output = run(['init', target]);
    assert.match(output, /created/);
    const validation = run(['validate', target]);
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

test('editor serves a reachable local URL by default', async () => {
  const child = spawn(
    process.execPath,
    [BIN, 'editor', FIXTURE, '--port', '0'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server did not start: ${output}${errors}`)),
      5000,
    );
    child.stdout.on('data', () => {
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`editor exited with ${code}: ${output}${errors}`));
    });
  });

  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /window\.__CRF_BOOTSTRAP__/);
    assert.match(html, /routing-context-flow\.md/);
    assert.match(html, /name: fixture/);
  } finally {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(resolve, 1000).unref();
    });
  }
});



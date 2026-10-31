/**
 * CRC · tests/glob
 *
 * Scopo: test del matcher glob e dell'espansione delle graffe.
 * Collaboratori: src/glob.ts.
 * Consumatori: node --test, CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMatcher,
  expandBraces,
  hasMagic,
  literalPrefix,
  matchGlob,
} from '../src/glob.ts';

test('detects magic', () => {
  assert.equal(hasMagic('src/a.ts'), false);
  assert.equal(hasMagic('src/**/*.ts'), true);
  assert.equal(hasMagic('src/{a,b}.ts'), true);
});

test('star does not cross directories', () => {
  assert.equal(matchGlob('src/*.ts', 'src/a.ts'), true);
  assert.equal(matchGlob('src/*.ts', 'src/nested/a.ts'), false);
});

test('double star crosses directories', () => {
  assert.equal(matchGlob('src/**/*.ts', 'src/a.ts'), true);
  assert.equal(matchGlob('src/**/*.ts', 'src/nested/deep/a.ts'), true);
  assert.equal(matchGlob('**/*.test.ts', 'tests/users.test.ts'), true);
  assert.equal(matchGlob('**/*.test.ts', 'a/b/users.test.ts'), true);
});

test('question mark matches one character', () => {
  assert.equal(matchGlob('src/?.ts', 'src/a.ts'), true);
  assert.equal(matchGlob('src/?.ts', 'src/ab.ts'), false);
});

test('braces expand alternatives', () => {
  assert.deepEqual(expandBraces('src/*.{ts,tsx}'), ['src/*.ts', 'src/*.tsx']);
  assert.equal(matchGlob('src/*.{ts,tsx}', 'src/a.tsx'), true);
  assert.equal(matchGlob('src/*.{ts,tsx}', 'src/a.js'), false);
  assert.equal(matchGlob('src/{a,b}/x.ts', 'src/b/x.ts'), true);
});

test('dots are literal, not regex wildcards', () => {
  assert.equal(matchGlob('src/a.ts', 'src/abts'), false);
});

test('matcher prunes directories', () => {
  const ignored = createMatcher(['node_modules/**', '.git/**']);
  assert.equal(ignored('node_modules', true), true);
  assert.equal(ignored('node_modules/pkg/index.js'), true);
  assert.equal(ignored('src/index.js'), false);
});

test('literal prefix stops at the first magic segment', () => {
  assert.equal(literalPrefix('src/api/**/*.ts'), 'src/api');
  assert.equal(literalPrefix('src/{a,b}/*.ts'), 'src');
  assert.equal(literalPrefix('src/a.ts'), 'src/a.ts');
});

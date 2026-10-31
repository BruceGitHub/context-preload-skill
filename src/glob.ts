/**
 * CRC · glob
 *
 * Scopo: matcher glob senza dipendenze per espandere read/skip/ignore;
 * supporta `*`, `**`, `?`, `{a,b}` e `[abc]`.
 * Collaboratori: nessuno.
 * Consumatori: src/resolve.ts, tests/glob.test.mjs.
 */

const MAGIC = /[*?[{]/;
const REGEX_SPECIAL = /[.+^$()|[\]\\]/;

export function normalizePath(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

export function hasMagic(pattern: unknown): boolean {
  return MAGIC.test(String(pattern));
}

/** Expand `{a,b}` groups (including nested ones) into plain patterns. */
export function expandBraces(pattern: unknown): string[] {
  const text = normalizePath(pattern);
  const open = text.indexOf('{');
  if (open === -1) return [text];

  let depth = 0;
  let close = -1;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1) return [text];

  const before = text.slice(0, open);
  const body = text.slice(open + 1, close);
  const after = text.slice(close + 1);

  return splitTopLevel(body).flatMap((alternative) => expandBraces(`${before}${alternative}${after}`));
}

function splitTopLevel(body: string): string[] {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Compile a single brace-free glob into a RegExp anchored at both ends. */
export function compileGlob(pattern: unknown): RegExp {
  const text = normalizePath(pattern);
  let source = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '*') {
      if (text[index + 1] === '*') {
        while (text[index + 1] === '*') index += 1;
        if (text[index + 1] === '/') {
          index += 1;
          source += '(?:[^/]+/)*';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    if (char === '[') {
      const end = text.indexOf(']', index + 1);
      if (end !== -1) {
        source += text.slice(index, end + 1).replace(/^\[!/, '[^');
        index = end;
        continue;
      }
    }

    source += REGEX_SPECIAL.test(char) ? `\\${char}` : char;
  }

  return new RegExp(`^${source}$`);
}

const cache = new Map<string, RegExp>();

/** Test whether `value` matches a glob pattern (with brace support). */
export function matchGlob(pattern: unknown, value: unknown): boolean {
  const target = normalizePath(value);
  return expandBraces(pattern).some((expanded) => {
    let regex = cache.get(expanded);
    if (!regex) {
      regex = compileGlob(expanded);
      cache.set(expanded, regex);
    }
    return regex.test(target);
  });
}

/** Build a matcher from a list of patterns. */
export function createMatcher(
  patterns: string[] = [],
): (value: string, isDirectory?: boolean) => boolean {
  const regexes = patterns.flatMap((pattern) =>
    expandBraces(pattern).map((expanded) => {
      let regex = cache.get(expanded);
      if (!regex) {
        regex = compileGlob(expanded);
        cache.set(expanded, regex);
      }
      return regex;
    }),
  );

  return (value, isDirectory = false) => {
    const target = normalizePath(value);
    return regexes.some((regex) => regex.test(target) || (isDirectory && regex.test(`${target}/`)));
  };
}

/** Longest literal prefix of a pattern (used as walk root). */
export function literalPrefix(pattern: unknown): string {
  const segments = normalizePath(pattern).split('/');
  const literal = [];
  for (const segment of segments) {
    if (MAGIC.test(segment)) break;
    literal.push(segment);
  }
  return literal.join('/');
}

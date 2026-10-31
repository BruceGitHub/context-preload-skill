/**
 * CRC · resolve
 *
 * Scopo: espandere un flusso in file reali su disco: merge degli includes,
 * skip/ignore, glob, stima token e segnalazione dei gap.
 * Collaboratori: src/crf-core.ts (modello), src/glob.ts (matcher),
 * src/types.ts (contratti), node:fs e node:path.
 * Consumatori: src/cli.ts, tests/resolve.test.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFlowFile, getFlow } from './crf-core.ts';
import {
  createMatcher,
  hasMagic,
  literalPrefix,
  normalizePath,
} from './glob.ts';
import type {
  EntryStatus,
  Issue,
  LoadedRoutingFile,
  Model,
  ReadEntry,
  ResolvedEntry,
  ResolveResult,
  ResolveTotals,
} from './types.ts';

const BUILTIN_IGNORE = ['.git/**'];

interface FileInfo {
  path: string;
  size: number;
}

interface Merged {
  read: ReadEntry[];
  skip: string[];
  description: string;
  includes: string[];
}

interface MergeSource {
  read?: ReadEntry[];
  skip?: string[];
  description?: string;
  includes?: string[];
}

interface EvalContext {
  root: string;
  isSkipped: (value: string, isDirectory?: boolean) => boolean;
  isPruned: (value: string, isDirectory?: boolean) => boolean;
}

export function estimateTokens(bytes: unknown): number {
  return Math.ceil((Number(bytes) || 0) / 4);
}

/** Read and parse a routing file, resolving its root directory. */
export function loadRoutingFile(file: string): LoadedRoutingFile {
  const absolute = path.resolve(file);
  const text = fs.readFileSync(absolute, 'utf8');
  const { model, issues } = parseFlowFile(text);
  const baseDir = path.dirname(absolute);
  const rootRelative = model.global?.root || model.meta?.root || '';
  const root = path.resolve(baseDir, rootRelative || '.');
  return { file: absolute, baseDir, root, text, model, issues };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkFiles(
  baseAbs: string,
  prefix: string,
  isPruned: (relative: string, isDirectory: boolean) => boolean,
): FileInfo[] {
  const files: FileInfo[] = [];

  const visit = (abs: string, rel: string): void => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const isDirectory = entry.isDirectory();
      if (isPruned(childRel, isDirectory)) continue;
      if (entry.isSymbolicLink()) continue;

      const childAbs = path.join(abs, entry.name);
      if (isDirectory) visit(childAbs, childRel);
      else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(childAbs).size;
        } catch {
          size = 0;
        }
        files.push({ path: childRel, size });
      }
    }
  };

  visit(baseAbs, prefix);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function emptyMerged(): Merged {
  return {
    read: [],
    skip: [],
    description: '',
    includes: [],
  };
}

function mergeInto(target: Merged, source: MergeSource): void {
  target.read.push(...(source.read ?? []));
  target.skip.push(...(source.skip ?? []));
  if (source.description) target.description = source.description;
  target.includes.push(...(source.includes ?? []));
}

function collectFlow(model: Model, id: string, stack: string[], issues: Issue[]): Merged {
  const flow = getFlow(model, id);
  if (!flow) {
    issues.push({
      level: 'error',
      code: 'include.unknown',
      message: `Cannot resolve unknown flow "${id}".`,
      flow: id,
    });
    return emptyMerged();
  }

  if (stack.includes(id)) {
    issues.push({
      level: 'error',
      code: 'include.cycle',
      message: `Include cycle detected: ${[...stack, id].join(' → ')}.`,
      flow: id,
    });
    return emptyMerged();
  }

  const merged = emptyMerged();
  for (const include of flow.includes ?? []) {
    mergeInto(merged, collectFlow(model, include, [...stack, id], issues));
  }

  mergeInto(merged, {
    read: flow.read ?? [],
    skip: flow.skip ?? [],
    description: flow.description,
    includes: flow.includes ?? [],
  });

  return merged;
}

function dedupe(entries: ReadEntry[]): ReadEntry[] {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = normalizePath(entry.path ?? entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function evaluateEntry(entry: ReadEntry, context: EvalContext): ResolvedEntry {
  const pattern = normalizePath(entry.path);
  const base: ResolvedEntry = {
    pattern,
    note: entry.note ?? '',
    matches: [],
    tokens: 0,
    status: 'empty',
    isDirectory: false,
  };

  if (!pattern) return { ...base, status: 'empty' };

  if (!hasMagic(pattern)) {
    const absolute = path.resolve(context.root, pattern);

    if (!isInside(context.root, absolute)) {
      return { ...base, status: 'outside' };
    }

    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      stat = null;
    }

    if (!stat) return { ...base, status: 'missing' };

    const relative = normalizePath(path.relative(context.root, absolute));

    if (stat.isDirectory()) {
      return {
        ...base,
        status: context.isSkipped(relative, true) ? 'skipped' : 'directory',
        isDirectory: true,
        matches: context.isSkipped(relative, true) ? [] : [relative],
      };
    }

    if (!stat.isFile()) return { ...base, status: 'missing' };
    if (context.isSkipped(relative)) return { ...base, status: 'skipped' };

    return {
      ...base,
      status: 'ok',
      matches: [relative],
      tokens: estimateTokens(stat.size),
    };
  }

  const prefix = literalPrefix(pattern);
  const baseAbs = path.resolve(context.root, prefix || '.');

  if (!isInside(context.root, baseAbs)) return { ...base, status: 'outside' };
  if (!fs.existsSync(baseAbs)) return { ...base, status: 'missing' };

  const matcher = createMatcher([pattern]);
  const raw = walkFiles(baseAbs, prefix, context.isPruned)
    .filter((file) => matcher(file.path))
    .map((file) => normalizePath(file.path));

  if (!raw.length) return { ...base, status: 'empty' };

  const kept = raw.filter((file) => !context.isSkipped(file));
  if (!kept.length) return { ...base, status: 'skipped' };

  return {
    ...base,
    status: 'ok',
    matches: kept,
    tokens: kept.reduce((sum, file) => {
      try {
        return sum + estimateTokens(fs.statSync(path.resolve(context.root, file)).size);
      } catch {
        return sum;
      }
    }, 0),
  };
}

function dedupeReadFiles(entries: ResolvedEntry[], root: string): ResolvedEntry[] {
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.matches?.length) continue;
    const before = entry.matches.length;
    entry.matches = entry.matches.filter((file) => {
      if (seen.has(file)) return false;
      seen.add(file);
      return true;
    });
    if (entry.matches.length === before) continue;

    entry.duplicateCount = before - entry.matches.length;
    entry.tokens = entry.matches.reduce((sum, file) => {
      if (entry.isDirectory) return 0;
      try {
        return sum + estimateTokens(fs.statSync(path.resolve(root, file)).size);
      } catch {
        return sum;
      }
    }, 0);
    if (!entry.matches.length && entry.status === 'ok') entry.status = 'duplicate';
  }

  return entries;
}

/**
 * Resolve a flow to concrete read entries and totals.
 *
 * @param {object} model
 * @param {string} flowId
 * @param {{root?: string, check?: boolean}} options
 */
export function resolveFlow(
  model: Model,
  flowId: string,
  options: { root?: string; check?: boolean } = {},
): ResolveResult {
  const root = path.resolve(options.root ?? process.cwd());
  const check = options.check !== false;
  const issues: Issue[] = [];

  const flow = getFlow(model, flowId);
  if (!flow) {
    return {
      flow: flowId,
      found: false,
      error: `Unknown flow "${flowId}".`,
      issues: [
        {
          level: 'error',
          code: 'flow.unknown',
          message: `Unknown flow "${flowId}".`,
          flow: flowId,
        },
      ],
    };
  }

  const merged = collectFlow(model, flowId, [], issues);
  const skipPatterns = [
    ...(model.global?.ignore ?? []),
    ...BUILTIN_IGNORE,
    ...merged.skip,
  ];
  const isSkipped = createMatcher(skipPatterns);
  const isPruned = createMatcher([...(model.global?.ignore ?? []), ...BUILTIN_IGNORE]);
  const context = { root, isSkipped, isPruned };

  const evaluate = (entries: ReadEntry[]): ResolvedEntry[] =>
    entries.map((entry) => {
      if (!check) {
        return {
          pattern: normalizePath(entry.path),
          note: entry.note ?? '',
          matches: [],
          tokens: 0,
          status: 'unchecked' as EntryStatus,
          isDirectory: false,
        };
      }
      return evaluateEntry(entry, context);
    });

  const readEntries = evaluate(dedupe(merged.read));

  if (check) {
    dedupeReadFiles(readEntries, root);
  }

  if (check) {
    for (const entry of readEntries) {
      if (entry.status === 'missing') {
        issues.push({
          level: 'warning',
          code: 'read.missing',
          message: `Flow "${flowId}": nothing found for "${entry.pattern}".`,
          flow: flowId,
        });
      } else if (entry.status === 'empty') {
        issues.push({
          level: 'warning',
          code: 'read.empty',
          message: `Flow "${flowId}": glob "${entry.pattern}" matched no files.`,
          flow: flowId,
        });
      } else if (entry.status === 'outside') {
        issues.push({
          level: 'error',
          code: 'path.outside',
          message: `Flow "${flowId}": "${entry.pattern}" resolves outside the routing root.`,
          flow: flowId,
        });
      }
    }
  }

  const allMatches = readEntries.flatMap((entry) => entry.matches);
  const totals: ResolveTotals = {
    files: allMatches.length,
    tokens: readEntries.reduce((sum, entry) => sum + entry.tokens, 0),
    required: readEntries.reduce((sum, entry) => sum + entry.matches.length, 0),
    missing: readEntries.filter((entry) => entry.status === 'missing').length,
    empty: readEntries.filter((entry) => entry.status === 'empty').length,
    skipped: readEntries.filter((entry) => entry.status === 'skipped').length,
  };

  return {
    flow: flowId,
    found: true,
    description: merged.description || flow.description || '',
    includes: merged.includes,
    readOrder: model.global?.readOrder ?? '',
    skip: merged.skip,
    entries: readEntries,
    totals,
    root,
    issues,
  };
}

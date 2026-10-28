/**
 * context-preload · resolver
 * Expands a flow into concrete files on disk: merges includes, applies
 * skip/ignore rules, expands globs, estimates tokens and reports gaps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFlowFile, parseBudget, getFlow } from './crf-core.mjs';
import {
  createMatcher,
  hasMagic,
  literalPrefix,
  normalizePath,
} from './glob.mjs';

const BUILTIN_IGNORE = ['.git/**'];

export function estimateTokens(bytes) {
  return Math.ceil((Number(bytes) || 0) / 4);
}

/** Read and parse a routing file, resolving its root directory. */
export function loadRoutingFile(file) {
  const absolute = path.resolve(file);
  const text = fs.readFileSync(absolute, 'utf8');
  const { model, issues } = parseFlowFile(text);
  const baseDir = path.dirname(absolute);
  const rootRelative = model.global?.root || model.meta?.root || '';
  const root = path.resolve(baseDir, rootRelative || '.');
  return { file: absolute, baseDir, root, text, model, issues };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkFiles(baseAbs, prefix, isPruned) {
  const files = [];

  const visit = (abs, rel) => {
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

function emptyMerged() {
  return {
    read: [],
    optional: [],
    skip: [],
    rules: [],
    steps: [],
    doneWhen: [],
    budget: null,
    description: '',
    triggers: [],
    includes: [],
  };
}

function mergeInto(target, source) {
  target.read.push(...source.read);
  target.optional.push(...source.optional);
  target.skip.push(...source.skip);
  if (Array.isArray(source.rules)) target.rules.push(...source.rules);
  else if (source.rules && String(source.rules).trim()) target.rules.push(String(source.rules).trim());
  target.steps.push(...source.steps);
  target.doneWhen.push(...source.doneWhen);
  if (source.budget) target.budget = source.budget;
  if (source.description) target.description = source.description;
  if (source.triggers?.length) target.triggers = [...source.triggers];
  target.includes.push(...(source.includes ?? []));
}

function collectFlow(model, id, stack, issues) {
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
    optional: flow.optional ?? [],
    skip: flow.skip ?? [],
    rules: flow.rules,
    steps: flow.steps ?? [],
    doneWhen: flow.doneWhen ?? [],
    budget: flow.budget,
    description: flow.description,
    triggers: flow.triggers ?? [],
    includes: flow.includes ?? [],
  });

  return merged;
}

function dedupe(entries) {
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

function evaluateEntry(entry, context, optional) {
  const pattern = normalizePath(entry.path);
  const base = {
    pattern,
    note: entry.note ?? '',
    optional: Boolean(optional),
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

function dedupeReadFiles(entries, root) {
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
export function resolveFlow(model, flowId, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const check = options.check !== false;
  const issues = [];

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

  const evaluate = (entries, optional) =>
    entries.map((entry) => {
      if (!check) {
        return {
          pattern: normalizePath(entry.path),
          note: entry.note ?? '',
          optional: Boolean(optional),
          matches: [],
          tokens: 0,
          status: 'unchecked',
          isDirectory: false,
        };
      }
      return evaluateEntry(entry, context, optional);
    });

  const readEntries = evaluate(dedupe(merged.read), false);
  const optionalEntries = evaluate(
    dedupe(merged.optional).filter(
      (entry) => !merged.read.some((read) => normalizePath(read.path) === normalizePath(entry.path)),
    ),
    true,
  );

  if (check) {
    dedupeReadFiles(readEntries, root);
    dedupeReadFiles(optionalEntries, root);
  }

  if (check) {
    for (const entry of [...readEntries, ...optionalEntries]) {
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

  const allMatches = [...readEntries, ...optionalEntries].flatMap((entry) => entry.matches);
  const totals = {
    files: allMatches.length,
    tokens: [...readEntries, ...optionalEntries].reduce((sum, entry) => sum + entry.tokens, 0),
    required: readEntries.reduce((sum, entry) => sum + entry.matches.length, 0),
    optional: optionalEntries.reduce((sum, entry) => sum + entry.matches.length, 0),
    missing: [...readEntries, ...optionalEntries].filter((entry) => entry.status === 'missing').length,
    empty: [...readEntries, ...optionalEntries].filter((entry) => entry.status === 'empty').length,
    skipped: [...readEntries, ...optionalEntries].filter((entry) => entry.status === 'skipped').length,
  };

  const budgetRaw = merged.budget || model.global?.budget || model.meta?.defaultBudget || '';
  const budget = parseBudget(budgetRaw);

  return {
    flow: flowId,
    found: true,
    description: merged.description || flow.description || '',
    triggers: merged.triggers,
    includes: merged.includes,
    rules: merged.rules.join('\n\n'),
    globalRules: model.global?.rules ?? '',
    readOrder: model.global?.readOrder ?? '',
    steps: merged.steps,
    doneWhen: merged.doneWhen,
    skip: merged.skip,
    budgetRaw,
    budget,
    overBudget: budget !== null && totals.tokens > budget,
    entries: readEntries,
    optionalEntries,
    totals,
    root,
    issues,
  };
}

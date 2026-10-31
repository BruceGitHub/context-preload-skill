/**
 * CRC · crf-core
 *
 * Scopo: parser, serializer, validatore e ranking dei flussi per il linguaggio
 * routing-context-flow (CRL).
 * Collaboratori: src/types.ts (contratti); nessuna API Node, così lo stesso
 * codice gira nella CLI e nell'editor browser.
 * Consumatori: src/cli.ts, src/resolve.ts, scripts/build-editor.mjs,
 * tests/core.test.mjs, tests/resolve.test.mjs.
 */

import type {
  Block,
  Flow,
  GlobalConfig,
  Issue,
  Model,
  ModelMeta,
  ParsedFile,
  RankedFlow,
  ReadEntry,
  Section,
} from './types.ts';

export const CRF_VERSION = 1;

const FLOW_KEYS = new Map([
  // description
  ['description', 'description'],
  ['use when', 'description'],
  ['when to use', 'description'],
  // includes
  ['includes', 'includes'],
  ['include', 'includes'],
  ['extends', 'includes'],
  // read
  ['read', 'read'],
  ['files', 'read'],
  // skip
  ['skip', 'skip'],
  ['exclude', 'skip'],
]);

const GLOBAL_KEYS: Map<string, keyof GlobalConfig> = new Map([
  ['ignore', 'ignore'],
  ['exclude', 'ignore'],
  ['read order', 'readOrder'],
  ['order', 'readOrder'],
  ['root', 'root'],
]);

const META_ALIASES: Map<string, keyof ModelMeta> = new Map([
  ['crf', 'crf'],
  ['version', 'crf'],
  ['name', 'name'],
  ['description', 'description'],
  ['root', 'root'],
]);

const FLOW_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const oneLine = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

function normalizeKey(raw: unknown): string {
  return String(raw).toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

function dedent(lines: string[]): string[] {
  const nonBlank = lines.filter((line) => line.trim());
  const indent = nonBlank.reduce(
    (min, line) => Math.min(min, line.match(/^[ \t]*/)?.[0].length ?? 0),
    Infinity,
  );
  const cut = Number.isFinite(indent) ? indent : 0;
  return lines.map((line) => (line.trim() ? line.slice(cut) : ''));
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function splitInlineList(value: unknown): string[] {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripListMarker(line: string): string | null {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
  return match ? match[1] : null;
}

function unquote(value: unknown): string {
  const text = String(value).trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1);
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Read entries                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse a single read entry line into `{ path, note }`.
 * Accepted forms: `src/**` · `src/** | why` · `src/** — why`
 */
export function parseReadEntry(raw: unknown): ReadEntry {
  let text = String(raw ?? '').trim();
  let path = '';
  let note = '';

  const backticked = text.match(/^`([^`]+)`\s*(.*)$/);
  if (backticked) {
    path = backticked[1].trim();
    note = backticked[2]
      .replace(/^\s*(?:\||—|–|-{1,2}|:)\s*/, '')
      .trim();
  } else {
    const split = text.match(/^(.*?)\s+(?:\||—|–)\s+(.*)$/) || text.match(/^(.*?)\s+--\s+(.*)$/);
    if (split) {
      path = split[1].trim();
      note = split[2].trim();
    } else {
      path = text;
    }
  }

  path = path.replace(/^\.\//, '').trim();
  return { path, note };
}

/** Format a read entry the way the canonical file expects it. */
export function formatReadEntry(entry: ReadEntry | string): string {
  const record = typeof entry === 'object' && entry !== null ? entry : null;
  const path = String(record?.path ?? entry ?? '').trim();
  const note = String(record?.note ?? '').trim();
  return note ? `\`${path}\` | ${note}` : `\`${path}\``;
}

/* ------------------------------------------------------------------ */
/* Section scanning                                                    */
/* ------------------------------------------------------------------ */

/**
 * Split the document body into sections on level-2 headings, ignoring
 * headings that live inside fenced code blocks.
 */
function splitSections(
  lines: string[],
  issues: Issue[],
): { sections: Section[]; preamble: string[] } {
  const sections: Section[] = [];
  const preamble: string[] = [];
  let current: Section | null = null;
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      fence = fence ? null : (fenceMatch[1]?.[0] ?? null);
    }

    if (!fence) {
      const heading = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const title = heading[1].trim();
        const flow = title.match(/^flow\s*:\s*(.+)$/i);
        if (flow) {
          current = { kind: 'flow', id: flow[1].trim(), lines: [] };
          sections.push(current);
        } else if (/^global$/i.test(title)) {
          current = { kind: 'global', lines: [] };
          sections.push(current);
        } else {
          current = null;
          issues.push({
            level: 'warning',
            code: 'section.unknown',
            message: `Unknown section "## ${title}" ignored (expected "## Global" or "## Flow: <id>").`,
          });
        }
        continue;
      }
      if (/^#\s/.test(line)) continue;
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  return { sections, preamble };
}

/**
 * Turn a section body into raw blocks: `{ key, inline, lines }`.
 * Key lines must start at column 0 with "- key:" and are not inside fences.
 */
function scanBlocks(lines: string[], issues: Issue[], sectionLabel: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      fence = fence ? null : (fenceMatch[1]?.[0] ?? null);
    }

    if (!fence && !/^\s/.test(line)) {
      const match = line.match(/^[-*+]\s+([A-Za-z][^:]*?)\s*:\s*(.*)$/);
      if (match) {
        current = { key: match[1], inline: match[2].trim(), lines: [] };
        blocks.push(current);
        continue;
      }
    }

    if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      issues.push({
        level: 'warning',
        code: 'syntax.orphan',
        message: `${sectionLabel}: ignored line "${line.trim()}".`,
      });
    }
  }

  return blocks;
}

function blockText(block: Block): string {
  const lines = dedent(trimBlankEdges(block.lines));
  const parts = block.inline ? [block.inline, ...lines] : lines;
  return trimBlankEdges(parts).join('\n').trim();
}

function blockList(block: Block, issues: Issue[], label: string): string[] {
  const items = [];
  if (block.inline) items.push(block.inline);

  for (const line of block.lines) {
    if (!line.trim()) continue;
    const item = stripListMarker(line);
    if (item === null) {
      issues.push({
        level: 'warning',
        code: 'syntax.list',
        message: `${label}: expected a list item, got "${line.trim()}".`,
      });
      continue;
    }
    if (item.trim()) items.push(item.trim());
  }

  return items;
}

function blockPathList(block: Block, issues: Issue[], label: string): ReadEntry[] {
  return blockList(block, issues, label).map(parseReadEntry).filter((entry) => entry.path);
}

/* ------------------------------------------------------------------ */
/* Model factories                                                     */
/* ------------------------------------------------------------------ */

export function createFlow(id = '', patch: Partial<Flow> = {}): Flow {
  return {
    id,
    description: '',
    includes: [],
    read: [],
    skip: [],
    ...patch,
  };
}

export function createEmptyModel(
  patch: {
    meta?: Partial<ModelMeta>;
    global?: Partial<GlobalConfig>;
    flows?: Flow[];
  } = {},
): Model {
  return {
    meta: {
      crf: CRF_VERSION,
      name: '',
      description: '',
      root: '',
      ...(patch.meta ?? {}),
    },
    global: {
      ignore: [],
      readOrder: '',
      root: '',
      ...(patch.global ?? {}),
    },
    flows: patch.flows ?? [],
  };
}

export function slugifyFlowId(value: unknown): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

/** Parse a routing-context-flow markdown file. */
export function parseFlowFile(source: unknown): ParsedFile {
  const issues: Issue[] = [];
  const text = String(source ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const meta: ModelMeta = {
    crf: CRF_VERSION,
    name: '',
    description: '',
    root: '',
  };
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;

  if (lines[cursor]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > cursor && line.trim() === '---');
    if (end === -1) {
      issues.push({
        level: 'error',
        code: 'frontmatter.unclosed',
        message: 'Front matter opened with "---" but never closed.',
      });
    } else {
      for (let index = cursor + 1; index < end; index += 1) {
        const line = lines[index];
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
        if (!match) {
          issues.push({
            level: 'warning',
            code: 'frontmatter.line',
            message: `Front matter line ignored: "${line.trim()}".`,
          });
          continue;
        }
        const key = META_ALIASES.get(normalizeKey(match[1]).replace(/ /g, '-'));
        if (!key) {
          issues.push({
            level: 'warning',
            code: 'frontmatter.key',
            message: `Unknown front matter key "${match[1]}".`,
          });
          continue;
        }
        if (key === 'crf') {
          meta.crf = Number(unquote(match[2])) || CRF_VERSION;
        } else {
          meta[key] = unquote(match[2]);
        }
      }
      cursor = end + 1;
    }
  }

  const { sections } = splitSections(lines.slice(cursor), issues);
  const global: GlobalConfig = { ignore: [], readOrder: '', root: '' };
  const flows: Flow[] = [];
  const seenIds = new Set<string>();

  for (const section of sections) {
    if (section.kind === 'global') {
      const blocks = scanBlocks(section.lines, issues, 'Global');
      for (const block of blocks) {
        const key = GLOBAL_KEYS.get(normalizeKey(block.key));
        if (!key) {
          issues.push({
            level: 'warning',
            code: 'global.key',
            message: `Global: unknown key "${block.key.trim()}" ignored.`,
          });
          continue;
        }
        if (key === 'ignore') {
          global.ignore.push(...blockPathList(block, issues, 'Global · ignore').map((entry) => entry.path));
          global.ignore = [...new Set(global.ignore)];
        } else if (key === 'readOrder') {
          global.readOrder = blockText(block);
        } else if (key === 'root') {
          global.root = blockText(block);
        }
      }
      continue;
    }

    const label = `Flow "${section.id ?? ''}"`;
    const id = (section.id ?? '').trim();

    if (!FLOW_ID_RE.test(id)) {
      issues.push({
        level: 'error',
        code: 'flow.id',
        message: `${label}: invalid id. Use lowercase letters, numbers, "-" and "_".`,
      });
    }
    if (seenIds.has(id)) {
      issues.push({
        level: 'error',
        code: 'flow.duplicate',
        message: `${label}: duplicate flow id.`,
      });
    }
    seenIds.add(id);

    const flow = createFlow(id);
    const blocks = scanBlocks(section.lines, issues, label);
    const seenKeys = new Set();

    for (const block of blocks) {
      const normalized = normalizeKey(block.key);
      const key = FLOW_KEYS.get(normalized);
      if (!key) {
        issues.push({
          level: 'warning',
          code: 'flow.key',
          message: `${label}: unknown key "${block.key.trim()}" ignored.`,
        });
        continue;
      }
      if (seenKeys.has(key)) {
        issues.push({
          level: 'warning',
          code: 'flow.key.duplicate',
          message: `${label}: key "${block.key.trim()}" repeated, the last one wins.`,
        });
      }
      seenKeys.add(key);

      switch (key) {
        case 'description':
          flow.description = blockText(block);
          break;
        case 'includes':
          flow.includes = [...new Set(blockList(block, issues, `${label} · includes`).flatMap(splitInlineList))];
          break;
        case 'read':
          flow.read = blockPathList(block, issues, `${label} · read`);
          break;
        case 'skip':
          flow.skip = blockPathList(block, issues, `${label} · skip`).map((entry) => entry.path);
          break;
        default:
          break;
      }
    }

    flows.push(flow);
  }

  if (Number(meta.crf) !== CRF_VERSION) {
    issues.push({
      level: 'error',
      code: 'frontmatter.crf',
      message: `Unsupported crf version "${meta.crf}" (expected ${CRF_VERSION}).`,
    });
  }

  const model = {
    meta,
    global: {
      ignore: global.ignore,
      readOrder: global.readOrder,
      root: global.root || meta.root || '',
    },
    flows,
  };

  return { model, issues: [...issues, ...validateModel(model)] };
}

/* ------------------------------------------------------------------ */
/* Serializer                                                          */
/* ------------------------------------------------------------------ */

function pushList<T>(
  out: string[],
  key: string,
  items: T[] | undefined,
  formatter?: (item: T) => string,
): void {
  if (!items?.length) return;
  out.push(`- ${key}:`);
  for (const item of items) out.push(`  - ${formatter ? formatter(item) : String(item)}`);
}

/** Serialize a model into the canonical routing-context-flow markdown. */
export function serializeFlowFile(model: Model): string {
  const meta = model.meta;
  const global = model.global;
  const out: string[] = [];

  out.push('---');
  out.push(`crf: ${meta.crf ?? CRF_VERSION}`);
  if (oneLine(meta.name)) out.push(`name: ${oneLine(meta.name)}`);
  if (oneLine(meta.description)) out.push(`description: ${oneLine(meta.description)}`);
  if (oneLine(meta.root)) out.push(`root: ${oneLine(meta.root)}`);
  out.push('---', '');

  const globalHasContent = global.ignore?.length || global.readOrder || global.root;

  if (globalHasContent) {
    out.push('## Global', '');
    if (global.ignore?.length) pushList(out, 'ignore', global.ignore);
    if (global.readOrder) out.push(`- read order: ${oneLine(global.readOrder)}`);
    if (global.root) out.push(`- root: ${oneLine(global.root)}`);
    out.push('');
  }

  for (const flow of model.flows ?? []) {
    out.push(`## Flow: ${flow.id}`, '');
    if (oneLine(flow.description)) out.push(`- description: ${oneLine(flow.description)}`);
    if (flow.includes?.length) out.push(`- includes: ${flow.includes.join(', ')}`);
    pushList(out, 'read', flow.read, formatReadEntry);
    pushList(out, 'skip', flow.skip);
    out.push('');
  }

  return `${trimBlankEdges(out).join('\n').trimEnd()}\n`;
}

function normalizeBuildPath(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function mergeBuildFlow(
  model: Model,
  id: string,
  stack: string[],
): { description: string; read: ReadEntry[]; skip: string[] } {
  const flow = model.flows.find((item) => item.id === id);
  if (!flow || stack.includes(id)) return { description: '', read: [], skip: [] };

  const merged = { description: flow.description, read: [], skip: [] } as {
    description: string;
    read: ReadEntry[];
    skip: string[];
  };
  for (const include of flow.includes ?? []) {
    const included = mergeBuildFlow(model, include, [...stack, id]);
    merged.read.push(...included.read);
    merged.skip.push(...included.skip);
  }
  merged.read.push(...(flow.read ?? []));
  merged.skip.push(...(flow.skip ?? []));
  return merged;
}

function uniqueBuildReads(entries: ReadEntry[]): ReadEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = normalizeBuildPath(entry.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueBuildStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeBuildPath(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Render a model as a linear, self-contained build file: one section per flow,
 * includes already merged, globs preserved, skip/ignore collected.
 */
export function serializeBuildFile(
  model: Model,
  sourceName = 'routing-context-flow.md',
): string {
  const out: string[] = [];
  out.push(`# Built routing${model.meta.name ? ` — ${model.meta.name}` : ''}`);
  out.push(`# Generated from ${sourceName}. Do not edit.`);
  out.push('');

  if (!model.flows.length) {
    out.push('_No flows._');
    return `${out.join('\n').trimEnd()}\n`;
  }

  const includedIds = new Set(model.flows.flatMap((flow) => flow.includes ?? []));

  for (const flow of model.flows) {
    // `base` is the conventional include-only helper: its content is already
    // merged into every flow that includes it, so it needs no own section.
    if (flow.id === 'base' && includedIds.has('base')) continue;

    const merged = mergeBuildFlow(model, flow.id, []);
    const read = uniqueBuildReads(merged.read);
    const skip = uniqueBuildStrings([...(model.global?.ignore ?? []), ...merged.skip]);

    out.push(`## ${flow.id}`);
    if (flow.description) out.push(flow.description);
    out.push('');
    out.push('Read these paths, in order:');
    out.push('');
    if (read.length) {
      read.forEach((entry, index) => out.push(`${index + 1}. \`${entry.path}\``));
    } else {
      out.push('_Nothing._');
    }
    out.push('');
    if (skip.length) {
      out.push('Do not read:');
      out.push('');
      for (const pattern of skip) out.push(`- \`${pattern}\``);
      out.push('');
    }
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function collectIncludes(model: Model, id: string): string[] {
  const flow = model.flows.find((item) => item.id === id);
  return flow?.includes ?? [];
}

function hasCycle(model: Model, start: string): boolean {
  const state = new Map<string, 'visiting' | 'done'>();

  function visit(id: string, stack: string[]): boolean {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'visiting') return stack.includes(id);
    state.set(id, 'visiting');
    for (const next of collectIncludes(model, id)) {
      if (visit(next, [...stack, id])) return true;
    }
    state.set(id, 'done');
    return false;
  }

  return visit(start, []);
}

/**
 * Validate a parsed model. Structural checks only; path checks live in the
 * resolver because they need the filesystem.
 */
export function validateModel(model: Model): Issue[] {
  const issues: Issue[] = [];
  const flows = model.flows ?? [];
  const ids = new Set<string>();

  for (const flow of flows) {
    if (!FLOW_ID_RE.test(flow.id)) {
      issues.push({
        level: 'error',
        code: 'flow.id',
        message: `Flow "${flow.id}": invalid id (lowercase letters, numbers, "-" and "_").`,
        flow: flow.id,
      });
    }
    if (ids.has(flow.id)) {
      issues.push({
        level: 'error',
        code: 'flow.duplicate',
        message: `Flow "${flow.id}" is declared more than once.`,
        flow: flow.id,
      });
    }
    ids.add(flow.id);

    for (const include of flow.includes ?? []) {
      if (!ids.has(include) && !flows.some((item) => item.id === include)) {
        issues.push({
          level: 'error',
          code: 'include.unknown',
          message: `Flow "${flow.id}" includes unknown flow "${include}".`,
          flow: flow.id,
        });
      }
    }

    if (!(flow.read ?? []).length && !(flow.includes ?? []).length) {
      issues.push({
        level: 'warning',
        code: 'flow.read.empty',
        message: `Flow "${flow.id}" does not read anything (no read entries, no includes).`,
        flow: flow.id,
      });
    }

    const seenPaths = new Set();
    for (const entry of flow.read ?? []) {
      if (seenPaths.has(entry.path)) {
        issues.push({
          level: 'warning',
          code: 'read.duplicate',
          message: `Flow "${flow.id}": "${entry.path}" is listed more than once.`,
          flow: flow.id,
        });
      }
      seenPaths.add(entry.path);
      if (/^([A-Za-z]:[\\/]|\/)/.test(entry.path)) {
        issues.push({
          level: 'warning',
          code: 'path.absolute',
          message: `Flow "${flow.id}": "${entry.path}" is absolute; paths should be relative to the routing root.`,
          flow: flow.id,
        });
      }
      if (entry.path.split('/').includes('..')) {
        issues.push({
          level: 'warning',
          code: 'path.escape',
          message: `Flow "${flow.id}": "${entry.path}" walks outside the root.`,
          flow: flow.id,
        });
      }
    }
  }

  for (const id of ids) {
    if (hasCycle(model, id)) {
      issues.push({
        level: 'error',
        code: 'include.cycle',
        message: `Flow "${id}" is part of an include cycle.`,
        flow: id,
      });
      break;
    }
  }

  if (!flows.length) {
    issues.push({
      level: 'warning',
      code: 'flows.empty',
      message: 'The routing file declares no flows.',
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Lookup and ranking                                                  */
/* ------------------------------------------------------------------ */

export function getFlow(model: Model, id: string): Flow | null {
  return (model.flows ?? []).find((flow) => flow.id === id) ?? null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rank flows against a free-form task description.
 * Used by the skill to resolve ambiguous intents.
 */
export function rankFlows(model: Model, task: unknown): RankedFlow[] {
  const query = normalizeText(task);
  if (!query) return [];
  const words = new Set(query.split(/[^a-z0-9]+/).filter((word) => word.length > 2));

  return (model.flows ?? [])
    .map((flow) => {
      let score = 0;
      const reasons = [];

      if (query === normalizeText(flow.id)) {
        score += 100;
        reasons.push('flow id');
      }

      const description = normalizeText(flow.description);
      let overlap = 0;
      for (const word of words) {
        if (description.includes(word)) overlap += 1;
      }
      if (overlap) {
        score += Math.min(overlap, 5);
        reasons.push(`${overlap} description keyword(s)`);
      }

      if (normalizeText(flow.id).includes(query) || query.includes(normalizeText(flow.id))) {
        score += 2;
        reasons.push('flow id match');
      }

      return { flow, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.flow.id.localeCompare(b.flow.id));
}



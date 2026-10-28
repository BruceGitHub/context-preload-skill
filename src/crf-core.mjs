/**
 * context-preload · core
 *
 * Parser, serializer, validator and flow ranking for the
 * routing-context-flow language (CRL).
 *
 * This module is intentionally free of Node.js APIs: the same code powers
 * the CLI and the offline browser editor.
 */

export const CRF_VERSION = 1;

const FLOW_KEYS = new Map([
  // description
  ['description', 'description'],
  ['use when', 'description'],
  ['when to use', 'description'],
  // triggers
  ['triggers', 'triggers'],
  ['trigger', 'triggers'],
  ['trigger words', 'triggers'],
  // priority
  ['priority', 'priority'],
  // includes
  ['includes', 'includes'],
  ['include', 'includes'],
  ['extends', 'includes'],
  // read
  ['read', 'read'],
  ['files', 'read'],
  // optional
  ['optional', 'optional'],
  ['read if needed', 'optional'],
  // skip
  ['skip', 'skip'],
  ['exclude', 'skip'],
  // budget
  ['budget', 'budget'],
  ['token budget', 'budget'],
  // rules
  ['rules', 'rules'],
  ['rule', 'rules'],
  // steps
  ['steps', 'steps'],
  ['step', 'steps'],
  // done when
  ['done when', 'doneWhen'],
  ['done', 'doneWhen'],
  ['definition of done', 'doneWhen'],
]);

const GLOBAL_KEYS = new Map([
  ['ignore', 'ignore'],
  ['exclude', 'ignore'],
  ['read order', 'readOrder'],
  ['order', 'readOrder'],
  ['budget', 'budget'],
  ['default budget', 'budget'],
  ['rules', 'rules'],
  ['rule', 'rules'],
  ['root', 'root'],
]);

const META_ALIASES = new Map([
  ['crf', 'crf'],
  ['version', 'crf'],
  ['name', 'name'],
  ['description', 'description'],
  ['default_budget', 'defaultBudget'],
  ['default-budget', 'defaultBudget'],
  ['defaultbudget', 'defaultBudget'],
  ['budget', 'defaultBudget'],
  ['root', 'root'],
]);

const FLOW_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const oneLine = (value) => String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();

function normalizeKey(raw) {
  return String(raw).toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

function dedent(lines) {
  const nonBlank = lines.filter((line) => line.trim());
  const indent = nonBlank.reduce(
    (min, line) => Math.min(min, line.match(/^[ \t]*/)[0].length),
    Infinity,
  );
  const cut = Number.isFinite(indent) ? indent : 0;
  return lines.map((line) => (line.trim() ? line.slice(cut) : ''));
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function splitInlineList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripListMarker(line) {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
  return match ? match[1] : null;
}

function unquote(value) {
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
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

/** Parse a human budget ("80k", "2M", "80000 tokens") into a number. */
export function parseBudget(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2];
  const multiplier = unit === 'k' ? 1000 : unit === 'm' ? 1_000_000 : 1;
  return Math.round(amount * multiplier);
}

/* ------------------------------------------------------------------ */
/* Read entries                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse a single read entry line into `{ path, note }`.
 * Accepted forms: `src/**` · `src/** | why` · `src/** — why`
 */
export function parseReadEntry(raw) {
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
export function formatReadEntry(entry) {
  const path = String(entry?.path ?? entry ?? '').trim();
  const note = String(entry?.note ?? '').trim();
  return note ? `\`${path}\` | ${note}` : `\`${path}\``;
}

/* ------------------------------------------------------------------ */
/* Section scanning                                                    */
/* ------------------------------------------------------------------ */

/**
 * Split the document body into sections on level-2 headings, ignoring
 * headings that live inside fenced code blocks.
 */
function splitSections(lines, issues) {
  const sections = [];
  let preamble = [];
  let current = null;
  let fence = null;

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      fence = fence ? null : fenceMatch[1][0];
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
function scanBlocks(lines, issues, sectionLabel) {
  const blocks = [];
  let current = null;
  let fence = null;

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(```+|~~~+)/);
    if (fenceMatch) {
      fence = fence ? null : fenceMatch[1][0];
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

function blockText(block) {
  const lines = dedent(trimBlankEdges(block.lines));
  const parts = block.inline ? [block.inline, ...lines] : lines;
  return trimBlankEdges(parts).join('\n').trim();
}

function blockList(block, issues, label) {
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

function blockPathList(block, issues, label) {
  return blockList(block, issues, label).map(parseReadEntry).filter((entry) => entry.path);
}

/* ------------------------------------------------------------------ */
/* Model factories                                                     */
/* ------------------------------------------------------------------ */

export function createFlow(id = '', patch = {}) {
  return {
    id,
    description: '',
    triggers: [],
    priority: 0,
    includes: [],
    read: [],
    optional: [],
    skip: [],
    budget: '',
    rules: '',
    steps: [],
    doneWhen: [],
    ...patch,
  };
}

export function createEmptyModel(patch = {}) {
  return {
    meta: {
      crf: CRF_VERSION,
      name: '',
      description: '',
      defaultBudget: '',
      root: '',
      ...(patch.meta ?? {}),
    },
    global: {
      ignore: [],
      rules: '',
      readOrder: '',
      budget: '',
      ...(patch.global ?? {}),
    },
    flows: patch.flows ?? [],
  };
}

export function slugifyFlowId(value) {
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

/**
 * Parse a routing-context-flow markdown file.
 * @returns {{ model: object, issues: Array<object> }}
 */
export function parseFlowFile(source) {
  const issues = [];
  const text = String(source ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const meta = { crf: CRF_VERSION, name: '', description: '', defaultBudget: '', root: '' };
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
        meta[key] = unquote(match[2]);
      }
      cursor = end + 1;
    }
  }

  if (meta.crf !== '' && Number.isFinite(Number(meta.crf))) meta.crf = Number(meta.crf);

  const { sections } = splitSections(lines.slice(cursor), issues);
  const global = { ignore: [], rules: '', readOrder: '', budget: '', root: '' };
  const flows = [];
  const seenIds = new Set();

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
        } else if (key === 'rules') {
          global.rules = blockText(block);
        } else if (key === 'readOrder') {
          global.readOrder = blockText(block);
        } else if (key === 'budget') {
          global.budget = blockText(block);
        } else if (key === 'root') {
          global.root = blockText(block);
        }
      }
      continue;
    }

    const label = `Flow "${section.id}"`;
    const id = section.id.trim();

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
        case 'triggers':
          flow.triggers = [...new Set(blockList(block, issues, `${label} · triggers`).flatMap(splitInlineList))];
          break;
        case 'priority': {
          const raw = blockText(block);
          const number = Number.parseInt(raw, 10);
          if (Number.isFinite(number)) flow.priority = number;
          else if (raw) {
            issues.push({
              level: 'warning',
              code: 'flow.priority',
              message: `${label}: priority "${raw}" is not a number, using 0.`,
            });
          }
          break;
        }
        case 'includes':
          flow.includes = [...new Set(blockList(block, issues, `${label} · includes`).flatMap(splitInlineList))];
          break;
        case 'read':
          flow.read = blockPathList(block, issues, `${label} · read`);
          break;
        case 'optional':
          flow.optional = blockPathList(block, issues, `${label} · optional`);
          break;
        case 'skip':
          flow.skip = blockPathList(block, issues, `${label} · skip`).map((entry) => entry.path);
          break;
        case 'budget':
          flow.budget = blockText(block);
          break;
        case 'rules':
          flow.rules = blockText(block);
          break;
        case 'steps':
          flow.steps = blockList(block, issues, `${label} · steps`);
          break;
        case 'doneWhen':
          flow.doneWhen = blockList(block, issues, `${label} · done when`);
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
      rules: global.rules,
      readOrder: global.readOrder,
      budget: global.budget,
      root: global.root || meta.root || '',
    },
    flows,
  };

  return { model, issues: [...issues, ...validateModel(model)] };
}

/* ------------------------------------------------------------------ */
/* Serializer                                                          */
/* ------------------------------------------------------------------ */

function pushList(out, key, items, formatter = (item) => item) {
  if (!items?.length) return;
  out.push(`- ${key}:`);
  for (const item of items) out.push(`  - ${formatter(item)}`);
}

function pushBlock(out, key, value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return;
  const lines = text.split('\n');
  const inline = lines.length === 1 && !lines[0].startsWith('- ');
  if (inline) {
    out.push(`- ${key}: ${lines[0]}`);
    return;
  }
  out.push(`- ${key}:`);
  for (const line of lines) {
    out.push(line.trim() ? `  ${line}` : '');
  }
}

/** Serialize a model into the canonical routing-context-flow markdown. */
export function serializeFlowFile(model) {
  const meta = model.meta ?? {};
  const global = model.global ?? {};
  const out = [];

  out.push('---');
  out.push(`crf: ${meta.crf ?? CRF_VERSION}`);
  if (oneLine(meta.name)) out.push(`name: ${oneLine(meta.name)}`);
  if (oneLine(meta.description)) out.push(`description: ${oneLine(meta.description)}`);
  if (oneLine(meta.defaultBudget)) out.push(`default_budget: ${oneLine(meta.defaultBudget)}`);
  if (oneLine(meta.root)) out.push(`root: ${oneLine(meta.root)}`);
  out.push('---', '');

  const globalHasContent =
    global.ignore?.length || global.rules || global.readOrder || global.budget || global.root;

  if (globalHasContent) {
    out.push('## Global', '');
    if (global.ignore?.length) pushList(out, 'ignore', global.ignore);
    if (global.readOrder) out.push(`- read order: ${oneLine(global.readOrder)}`);
    if (global.budget) out.push(`- budget: ${oneLine(global.budget)}`);
    if (global.root) out.push(`- root: ${oneLine(global.root)}`);
    if (global.rules) pushBlock(out, 'rules', global.rules);
    out.push('');
  }

  for (const flow of model.flows ?? []) {
    out.push(`## Flow: ${flow.id}`, '');
    if (oneLine(flow.description)) out.push(`- description: ${oneLine(flow.description)}`);
    if (flow.triggers?.length) out.push(`- triggers: ${flow.triggers.join(', ')}`);
    if (Number(flow.priority)) out.push(`- priority: ${Number(flow.priority)}`);
    if (flow.includes?.length) out.push(`- includes: ${flow.includes.join(', ')}`);
    if (oneLine(flow.budget)) out.push(`- budget: ${oneLine(flow.budget)}`);
    pushList(out, 'read', flow.read, formatReadEntry);
    pushList(out, 'optional', flow.optional, formatReadEntry);
    pushList(out, 'skip', flow.skip);
    pushList(out, 'steps', flow.steps, (step) => step);
    if (flow.rules) pushBlock(out, 'rules', flow.rules);
    pushList(out, 'done when', flow.doneWhen);
    out.push('');
  }

  return `${trimBlankEdges(out).join('\n').trimEnd()}\n`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function collectIncludes(model, id) {
  const flow = model.flows.find((item) => item.id === id);
  return flow?.includes ?? [];
}

function hasCycle(model, start) {
  const state = new Map();

  function visit(id, stack) {
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
 * @returns {Array<{level: string, code: string, message: string, flow?: string}>}
 */
export function validateModel(model) {
  const issues = [];
  const flows = model.flows ?? [];
  const ids = new Set();
  const triggerOwners = new Map();

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

    for (const trigger of flow.triggers ?? []) {
      const key = normalizeText(trigger);
      if (!key) continue;
      const owner = triggerOwners.get(key);
      if (owner && owner !== flow.id) {
        issues.push({
          level: 'warning',
          code: 'trigger.duplicate',
          message: `Trigger "${trigger}" is used by both "${owner}" and "${flow.id}"; inference will be ambiguous.`,
          flow: flow.id,
        });
      } else {
        triggerOwners.set(key, flow.id);
      }
    }

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

    if (flow.budget && parseBudget(flow.budget) === null) {
      issues.push({
        level: 'warning',
        code: 'budget.invalid',
        message: `Flow "${flow.id}": budget "${flow.budget}" is not understood (use e.g. 60k or 120000).`,
        flow: flow.id,
      });
    }

    if (Number.isNaN(Number(flow.priority))) {
      issues.push({
        level: 'warning',
        code: 'flow.priority',
        message: `Flow "${flow.id}": priority is not a number.`,
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

  if (model.global?.budget && parseBudget(model.global.budget) === null) {
    issues.push({
      level: 'warning',
      code: 'budget.invalid',
      message: `Global budget "${model.global.budget}" is not understood.`,
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Lookup and ranking                                                  */
/* ------------------------------------------------------------------ */

export function getFlow(model, id) {
  return (model.flows ?? []).find((flow) => flow.id === id) ?? null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rank flows against a free-form task description.
 * Used by the CLI (`pick`) and by the skill to resolve ambiguous intents.
 * @returns {Array<{flow: object, score: number, reasons: string[]}>}
 */
export function rankFlows(model, task) {
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

      for (const trigger of flow.triggers ?? []) {
        const normalized = normalizeText(trigger);
        if (!normalized) continue;
        if (new RegExp(`(^|[^a-z0-9])${escapeRegex(normalized)}([^a-z0-9]|$)`).test(query)) {
          score += 6 + Math.min(normalized.length, 18) / 3;
          reasons.push(`trigger "${trigger}"`);
        }
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

      if (score > 0) score += Number(flow.priority || 0) / 1000;

      return { flow, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.flow.id.localeCompare(b.flow.id));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

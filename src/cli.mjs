#!/usr/bin/env node
/**
 * context-preload · CLI
 *
 * Commands:
 *   list / show / resolve / validate / pick / interactive / init / editor
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import {
  CRF_VERSION,
  createEmptyModel,
  getFlow,
  parseFlowFile,
  rankFlows,
  serializeFlowFile,
} from './crf-core.mjs';
import { loadRoutingFile, resolveFlow } from './resolve.mjs';
import { STARTER_TEMPLATE } from './template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

// Writing to a closed pipe (e.g. `context-preload show review | head`) is not
// an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const FLAGS = new Set();
const OPTIONS = {};
const POSITIONAL = [];

const ARGS = process.argv.slice(2);

for (let index = 0; index < ARGS.length; index += 1) {
  const arg = ARGS[index];
  if (arg === '--') {
    POSITIONAL.push(...ARGS.slice(index + 1));
    break;
  }
  if (arg.startsWith('--')) {
    const [name, inline] = arg.slice(2).split('=');
    if (name === 'file' || name === 'root' || name === 'task') {
      OPTIONS[name] = inline ?? ARGS[++index];
    } else {
      FLAGS.add(name);
    }
  } else if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
    FLAGS.add(arg.slice(1));
  } else {
    POSITIONAL.push(arg);
  }
}

const USE_COLOR =
  !FLAGS.has('no-color') &&
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));

const paint = (code) => (value) => (USE_COLOR ? `\x1b[${code}m${value}\x1b[0m` : String(value));
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const magenta = paint('35');

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`${red('error:')} ${message}\n`);
  process.exit(code);
}

function formatTokens(tokens) {
  if (tokens === null || tokens === undefined) return '?';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function displayPath(target) {
  const relative = path.relative(process.cwd(), target);
  return relative && !relative.startsWith('..') ? relative : target;
}

const DEFAULT_FILES = ['routing-context-flow.md', path.join('.context', 'routing-context-flow.md')];

function findRoutingFile(explicit) {
  if (explicit) {
    const absolute = path.resolve(explicit);
    if (!fs.existsSync(absolute)) fail(`routing file not found: ${explicit}`);
    return absolute;
  }

  let directory = process.cwd();
  for (;;) {
    for (const candidate of DEFAULT_FILES) {
      const absolute = path.join(directory, candidate);
      if (fs.existsSync(absolute)) return absolute;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  fail(
    'no routing-context-flow.md found.\n' +
      'Run "context-preload init" to create one, or pass a path explicitly.',
  );
}

function load(file) {
  try {
    return loadRoutingFile(file);
  } catch (error) {
    fail(`cannot read ${displayPath(file)}: ${error.message}`);
  }
}

function printIssues(issues, { showInfo = false } = {}) {
  for (const issue of issues) {
    if (issue.level === 'info' && !showInfo) continue;
    const icon =
      issue.level === 'error' ? red('✖') : issue.level === 'info' ? cyan('ℹ') : yellow('⚠');
    out(`  ${icon} ${issue.message}`);
  }
}

function statusIcon(entry) {
  switch (entry.status) {
    case 'ok':
      return green('✓');
    case 'directory':
      return cyan('▸');
    case 'missing':
      return red('!');
    case 'empty':
      return yellow('∅');
    case 'skipped':
      return dim('·');
    case 'duplicate':
      return dim('=');
    default:
      return dim('?');
  }
}

function describeEntry(entry) {
  if (entry.status === 'unchecked') return dim('not checked');
  if (entry.status === 'missing') return red('missing');
  if (entry.status === 'empty') return yellow('no match');
  if (entry.status === 'skipped') return dim('skipped by rule');
  if (entry.status === 'duplicate') return dim('already included');
  if (entry.status === 'outside') return red('outside root');
  if (entry.status === 'directory') return cyan('directory');
  if (!entry.matches.length) return dim('empty');
  return `${green(String(entry.matches.length))} file${entry.matches.length === 1 ? '' : 's'}`;
}

function printEntry(entry, index, { all = false } = {}) {
  const label = entry.optional ? dim('optional') : '';
  const note = entry.note ? dim(` · ${entry.note}`) : '';
  const head =
    `  ${String(index).padStart(2)}. ${bold(entry.pattern)}  ` +
    `${statusIcon(entry)} ${describeEntry(entry)}${label ? ` ${label}` : ''}${note}`;
  out(head);

  if (!entry.matches.length) return;
  const limit = all ? entry.matches.length : 8;
  for (const file of entry.matches.slice(0, limit)) {
    out(`      ${dim(file)}`);
  }
  if (entry.matches.length > limit) {
    out(`      ${dim(`+${entry.matches.length - limit} more (use --all)`)}`);
  }
}

function renderShow(loaded, result) {
  const { model, file, root } = loaded;
  const meta = model.meta ?? {};

  out('');
  out(`${bold(meta.name || path.basename(file))} ${dim(`· ${displayPath(file)}`)}`);
  const bits = [
    `crf v${meta.crf ?? CRF_VERSION}`,
    `${model.flows.length} flows`,
    `root ${displayPath(root)}`,
  ];
  out(dim(bits.join(' · ')));
  out('');

  out(`${magenta('▸')} ${bold(result.flow)}${result.description ? ` — ${result.description}` : ''}`);

  if (result.triggers?.length) {
    out(`  ${dim('triggers')}  ${result.triggers.join(', ')}`);
  }
  if (result.includes?.length) {
    out(`  ${dim('includes')}  ${result.includes.join(', ')}`);
  }

  const budget = result.budget ? result.budgetRaw : 'no budget';
  const estimate = `~${formatTokens(result.totals.tokens)} estimated tokens`;
  const budgetLine = result.overBudget
    ? `${red(`over budget — ${estimate} > ${budget}`)}`
    : `${budget} · ${estimate}`;
  out(`  ${dim('budget')}    ${budgetLine}`);
  if (result.readOrder) out(`  ${dim('order')}     ${result.readOrder}`);
  out('');

  if (result.globalRules) {
    out(dim('Global rules'));
    for (const line of result.globalRules.split('\n')) out(`  ${line}`);
    out('');
  }

  if (result.rules) {
    out(dim('Rules'));
    for (const line of result.rules.split('\n')) out(`  ${line}`);
    out('');
  }

  if (result.steps?.length) {
    out(dim('Steps'));
    result.steps.forEach((step, index) => out(`  ${index + 1}. ${step}`));
    out('');
  }

  if (result.doneWhen?.length) {
    out(dim('Done when'));
    for (const item of result.doneWhen) out(`  ${green('✓')} ${item}`);
    out('');
  }

  out(dim(`Read (${result.entries.length})`));
  if (!result.entries.length) out(dim('  nothing declared'));
  result.entries.forEach((entry, index) => printEntry(entry, index + 1, { all: FLAGS.has('all') }));
  out('');

  if (result.optionalEntries.length) {
    out(dim(`Optional (${result.optionalEntries.length})`));
    result.optionalEntries.forEach((entry, index) =>
      printEntry(entry, index + 1, { all: FLAGS.has('all') }),
    );
    out('');
  }

  if (result.skip?.length) {
    out(`${dim('Skip')} ${result.skip.map((pattern) => `\`${pattern}\``).join(', ')}`);
    out('');
  }

  const totals = result.totals;
  out(
    dim(
      `Total: ${totals.files} file${totals.files === 1 ? '' : 's'} · ~${formatTokens(totals.tokens)} tokens` +
        (totals.missing ? ` · ${totals.missing} missing` : '') +
        (totals.empty ? ` · ${totals.empty} empty` : ''),
    ),
  );

  if (loaded.issues.length || result.issues.length) {
    out('');
    out(dim('Notes'));
    printIssues(loaded.issues.filter((issue) => issue.code !== 'flows.empty'));
    printIssues(result.issues);
  }
  out('');
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

function commandList() {
  const loaded = load(findRoutingFile(OPTIONS.file ?? POSITIONAL[0]));
  const { model } = loaded;

  if (FLAGS.has('json')) {
    out(
      JSON.stringify(
        {
          file: loaded.file,
          root: loaded.root,
          name: model.meta?.name ?? '',
          crf: model.meta?.crf ?? CRF_VERSION,
          flows: model.flows.map((flow) => ({
            id: flow.id,
            description: flow.description,
            triggers: flow.triggers,
            includes: flow.includes,
            priority: flow.priority,
            budget: flow.budget,
            read: flow.read.length,
            optional: flow.optional.length,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  out('');
  out(
    `${bold(model.meta?.name || path.basename(loaded.file))} ${dim(
      `· ${displayPath(loaded.file)} · ${model.flows.length} flows`,
    )}`,
  );
  out('');
  const width = Math.max(...model.flows.map((flow) => flow.id.length), 8);
  for (const flow of model.flows) {
    const description = flow.description ? flow.description : dim('no description');
    out(`  ${cyan(flow.id.padEnd(width))}  ${description}`);
    const meta = [];
    if (flow.triggers.length) meta.push(`triggers: ${flow.triggers.join(', ')}`);
    if (flow.includes.length) meta.push(`includes: ${flow.includes.join(', ')}`);
    if (flow.budget) meta.push(`budget: ${flow.budget}`);
    if (meta.length) out(`  ${' '.repeat(width + 2)}${dim(meta.join(' · '))}`);
  }
  out('');
  if (loaded.issues.some((issue) => issue.level === 'error')) {
    printIssues(loaded.issues.filter((issue) => issue.level === 'error'));
    out('');
  }
}

function commandShow() {
  const flowId = POSITIONAL[0];
  if (!flowId) fail('usage: context-preload show <flow> [routing-file]');
  const file = findRoutingFile(OPTIONS.file ?? POSITIONAL[1]);
  const loaded = load(file);
  const result = resolveFlow(loaded.model, flowId, {
    root: OPTIONS.root ? path.resolve(OPTIONS.root) : loaded.root,
    check: !FLAGS.has('no-check'),
  });

  if (!result.found) {
    const ids = loaded.model.flows.map((flow) => flow.id);
    fail(`unknown flow "${flowId}". Available: ${ids.join(', ') || '(none)'}`);
  }

  if (FLAGS.has('paths')) {
    for (const entry of result.entries) {
      for (const match of entry.matches) out(match);
    }
    return;
  }

  renderShow(loaded, result);
}

function commandResolve() {
  const flowId = POSITIONAL[0];
  if (!flowId) fail('usage: context-preload resolve <flow> [routing-file] [--pretty]');
  const file = findRoutingFile(OPTIONS.file ?? POSITIONAL[1]);
  const loaded = load(file);
  const result = resolveFlow(loaded.model, flowId, {
    root: OPTIONS.root ? path.resolve(OPTIONS.root) : loaded.root,
    check: !FLAGS.has('no-check'),
  });

  if (!result.found) fail(`unknown flow "${flowId}".`);

  if (FLAGS.has('pretty')) {
    renderShow(loaded, result);
    return;
  }

  out(
    JSON.stringify(
      {
        file: loaded.file,
        root: loaded.root,
        flow: result.flow,
        description: result.description,
        triggers: result.triggers,
        includes: result.includes,
        budget: result.budget,
        budgetRaw: result.budgetRaw,
        overBudget: result.overBudget,
        rules: result.rules,
        globalRules: result.globalRules,
        readOrder: result.readOrder,
        steps: result.steps,
        doneWhen: result.doneWhen,
        skip: result.skip,
        totals: result.totals,
        entries: result.entries,
        optionalEntries: result.optionalEntries,
        issues: [...loaded.issues, ...result.issues],
      },
      null,
      2,
    ),
  );
}

function commandValidate() {
  const loaded = load(findRoutingFile(OPTIONS.file ?? POSITIONAL[0]));
  const issues = [...loaded.issues];

  if (!FLAGS.has('no-paths')) {
    for (const flow of loaded.model.flows) {
      const result = resolveFlow(loaded.model, flow.id, {
        root: OPTIONS.root ? path.resolve(OPTIONS.root) : loaded.root,
        check: true,
      });
      issues.push(...result.issues);
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  if (FLAGS.has('json')) {
    out(
      JSON.stringify(
        {
          file: loaded.file,
          flows: loaded.model.flows.length,
          errors: errors.length,
          warnings: warnings.length,
          issues,
        },
        null,
        2,
      ),
    );
  } else {
    const status = errors.length ? red('✖') : warnings.length ? yellow('⚠') : green('✔');
    out(
      `${status} ${bold(displayPath(loaded.file))} — ${loaded.model.flows.length} flows · ` +
        `${errors.length} error${errors.length === 1 ? '' : 's'} · ` +
        `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
    );
    if (issues.length) {
      out('');
      printIssues(issues);
      out('');
    }
  }

  if (errors.length || (FLAGS.has('strict') && warnings.length)) process.exit(1);
}

function commandPick() {
  const task = POSITIONAL.join(' ').trim();
  if (!task) fail('usage: context-preload pick "review the feature/dd-100 branch" [--file <path>]');

  const loaded = load(findRoutingFile(OPTIONS.file));
  const ranked = rankFlows(loaded.model, task);

  if (FLAGS.has('json')) {
    out(
      JSON.stringify(
        {
          task,
          matches: ranked.map(({ flow, score, reasons }) => ({
            id: flow.id,
            score: Number(score.toFixed(2)),
            reasons,
            description: flow.description,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!ranked.length) {
    out(yellow('No flow matches that description.'));
    out(dim(`Available: ${loaded.model.flows.map((flow) => flow.id).join(', ')}`));
    process.exit(2);
  }

  const [best, ...rest] = ranked;
  out(
    `${green('→')} ${bold(best.flow.id)} ${dim(`(${best.score.toFixed(1)} · ${best.reasons.join(', ')})`)}`,
  );
  if (best.flow.description) out(`  ${best.flow.description}`);
  if (rest.length) {
    out('');
    out(dim('Alternatives'));
    for (const match of rest.slice(0, 5)) {
      out(`  ${cyan(match.flow.id)} ${dim(`(${match.score.toFixed(1)})`)}`);
    }
  }
  out('');
}

async function commandInteractive() {
  const file = findRoutingFile(OPTIONS.file ?? POSITIONAL[0]);
  const loaded = load(file);
  const { model } = loaded;

  if (!model.flows.length) fail('the routing file declares no flows.');

  const hint = OPTIONS.task ?? '';
  const ranked = hint ? rankFlows(model, hint) : [];
  const preferred = ranked[0]?.flow.id ?? model.flows[0]?.id;

  out('');
  out(`${bold(model.meta?.name || path.basename(file))} ${dim(`· ${model.flows.length} flows`)}`);
  if (hint) out(dim(`task: ${hint}`));
  out('');

  model.flows.forEach((flow, index) => {
    const marker = flow.id === preferred ? green('●') : dim('○');
    const description = flow.description || dim('no description');
    out(`  ${marker} ${String(index + 1).padStart(2)}. ${cyan(flow.id.padEnd(12))} ${description}`);
    if (flow.triggers.length) out(`        ${dim(`triggers: ${flow.triggers.join(', ')}`)}`);
  });
  out('');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await rl.question(
      `Which flow? ${dim(`[enter = ${preferred}, number or id]`)} `,
    );
  } finally {
    rl.close();
  }

  const trimmed = answer.trim();
  let selected = preferred;
  if (trimmed) {
    const index = Number.parseInt(trimmed, 10);
    if (Number.isInteger(index) && String(index) === trimmed) {
      selected = model.flows[index - 1]?.id;
      if (!selected) fail(`no flow at position ${index}.`);
    } else {
      selected = getFlow(model, trimmed) ? trimmed : undefined;
      if (!selected) fail(`unknown flow "${trimmed}".`);
    }
  }

  const result = resolveFlow(model, selected, {
    root: OPTIONS.root ? path.resolve(OPTIONS.root) : loaded.root,
    check: !FLAGS.has('no-check'),
  });
  renderShow(loaded, result);
}

function commandInit() {
  const target = path.resolve(OPTIONS.file ?? POSITIONAL[0] ?? 'routing-context-flow.md');
  if (fs.existsSync(target) && !FLAGS.has('force')) {
    fail(`${displayPath(target)} already exists (use --force to overwrite).`);
  }
  fs.writeFileSync(target, STARTER_TEMPLATE, 'utf8');

  const { model, issues } = parseFlowFile(STARTER_TEMPLATE);
  if (issues.some((issue) => issue.level === 'error')) {
    fail('the starter template is invalid, please report this bug.');
  }

  out(`${green('✔')} created ${bold(displayPath(target))} ${dim(`(${model.flows.length} flows)`)}`);
  out(dim('Edit it by hand or with: context-preload editor --open'));
  out(dim('Then: context-preload list && context-preload show review'));
}

function commandEditor() {
  const editorPath = path.resolve(HERE, '..', 'editor', 'index.html');
  if (!fs.existsSync(editorPath)) fail(`editor not found at ${editorPath}`);
  out(displayPath(editorPath));
  if (FLAGS.has('open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', editorPath] : [editorPath];
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => out(dim('Could not open a browser; open the path above manually.')));
    child.unref();
  }
}

function commandHelp() {
  out(`
${bold('context-preload')} ${dim(`v${pkg.version}`)} — route what an AI agent reads.

${bold('Usage')}
  context-preload <command> [options]

${bold('Commands')}
  list [file]                List flows in the routing file
  show <flow> [file]         Resolve a flow and print what to read
  resolve <flow> [file]      Same, as JSON (use --pretty for humans)
  validate [file]            Check the file, its paths and its includes
  pick "<task>"              Infer the best flow from a task description
  interactive [file]         Menu: choose a flow and show its context
  init [file]                Create a starter routing-context-flow.md
  editor [--open]            Print (and optionally open) the visual editor

${bold('Options')}
  --file <path>              Routing file (default: nearest routing-context-flow.md)
  --root <path>              Override the routing root directory
  --task "<text>"            Preselect a flow from a task (interactive)
  --json                     Machine-readable output (list, validate, pick)
  --pretty                   Human output for resolve
  --paths                    Print only file paths (show)
  --all                      List every matched file (show)
  --no-check                 Do not touch the filesystem (show, resolve, interactive)
  --no-paths                 Skip path checks (validate)
  --strict                   Exit 1 on warnings too (validate)
  --force                    Overwrite an existing file (init)
  --no-color                 Disable colors

${bold('Examples')}
  context-preload list
  context-preload show review
  context-preload show coding --paths
  context-preload pick "review the feature/dd-100 branch"
  context-preload validate --strict
  context-preload interactive
`);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const command = FLAGS.has('help')
  ? 'help'
  : FLAGS.has('version') || FLAGS.has('v')
    ? 'version'
    : (POSITIONAL.shift() ?? 'help');

switch (command) {
  case 'list':
  case 'ls':
    commandList();
    break;
  case 'show':
    commandShow();
    break;
  case 'resolve':
    commandResolve();
    break;
  case 'validate':
  case 'check':
    commandValidate();
    break;
  case 'pick':
  case 'which':
    commandPick();
    break;
  case 'interactive':
  case 'menu':
    await commandInteractive();
    break;
  case 'init':
    commandInit();
    break;
  case 'editor':
    commandEditor();
    break;
  case 'version':
  case '--version':
  case '-v':
    out(pkg.version);
    break;
  case 'help':
  case '--help':
  case '-h':
    commandHelp();
    break;
  default:
    fail(`unknown command "${command}". Run "context-preload help".`);
}

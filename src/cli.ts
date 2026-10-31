#!/usr/bin/env node
/**
 * CRC · cli
 *
 * Scopo: interfaccia a riga di comando: parsing degli argomenti, comandi
 * list/validate/init/editor, output e server locale dell'editor.
 * Collaboratori: src/crf-core.ts, src/resolve.ts, src/template.ts,
 * src/types.ts; node:fs, node:path, node:http, node:crypto, node:os,
 * node:process, node:child_process.
 * Consumatori: bin/context-preload.ts, il comando `context-preload`,
 * tests/cli.test.mjs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildableFlows,
  parseFlowFile,
  serializeBuildFlow,
  serializeBuildIndex,
} from './crf-core.ts';
import { loadRoutingFile, resolveFlow } from './resolve.ts';
import { STARTER_TEMPLATE } from './template.ts';
import type { Issue, LoadedRoutingFile } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

// Writing to a closed pipe (e.g. `context-preload list | head`) is not
// an error worth a stack trace.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const FLAGS = new Set<string>();
const OPTIONS: {
  file?: string;
  root?: string;
  port?: string;
} = {};
const POSITIONAL: string[] = [];

const ARGS = process.argv.slice(2);

for (let index = 0; index < ARGS.length; index += 1) {
  const arg = ARGS[index];
  if (arg === '--') {
    POSITIONAL.push(...ARGS.slice(index + 1));
    break;
  }
  if (arg.startsWith('--')) {
    const [name, inline] = arg.slice(2).split('=');
    if (name === 'file' || name === 'root' || name === 'port') {
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
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));

const paint =
  (code: string) =>
  (value: unknown): string =>
    USE_COLOR ? `\x1b[${code}m${value}\x1b[0m` : String(value);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const magenta = paint('35');

function out(line: unknown = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${red('error:')} ${message}\n`);
  process.exit(code);
}

function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative && !relative.startsWith('..') ? relative : target;
}

const DEFAULT_FILES = ['routing-context-flow.md', path.join('.context', 'routing-context-flow.md')];

function findRoutingFile(explicit?: string): string {
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

function load(file: string): LoadedRoutingFile {
  try {
    return loadRoutingFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read ${displayPath(file)}: ${message}`);
  }
}

function printIssues(issues: Issue[], { showInfo = false }: { showInfo?: boolean } = {}): void {
  for (const issue of issues) {
    if (issue.level === 'info' && !showInfo) continue;
    const icon =
      issue.level === 'error' ? red('✖') : issue.level === 'info' ? cyan('ℹ') : yellow('⚠');
    out(`  ${icon} ${issue.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

function commandList() {
  const loaded = load(findRoutingFile(OPTIONS.file ?? POSITIONAL[0]));
  const { model } = loaded;

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
    if (flow.includes.length) meta.push(`includes: ${flow.includes.join(', ')}`);
    if (meta.length) out(`  ${' '.repeat(width + 2)}${dim(meta.join(' · '))}`);
  }
  out('');
  if (loaded.issues.some((issue) => issue.level === 'error')) {
    printIssues(loaded.issues.filter((issue) => issue.level === 'error'));
    out('');
  }
}

function commandValidate() {
  const loaded = load(findRoutingFile(OPTIONS.file ?? POSITIONAL[0]));
  const issues = [...loaded.issues];

  for (const flow of loaded.model.flows) {
    const result = resolveFlow(loaded.model, flow.id, {
      root: OPTIONS.root ? path.resolve(OPTIONS.root) : loaded.root,
      check: true,
    });
    issues.push(...result.issues);
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

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

  if (errors.length || (FLAGS.has('strict') && warnings.length)) process.exit(1);
}

function buildPath(file: string): string {
  const extension = path.extname(file);
  const base = extension ? file.slice(0, -extension.length) : file;
  return `${base}.build.md`;
}

function flowBuildPath(file: string, flowId: string): string {
  const extension = path.extname(file);
  const base = extension ? file.slice(0, -extension.length) : file;
  return `${base}.${flowId}.build.md`;
}

function commandBuild() {
  const source = findRoutingFile(OPTIONS.file ?? POSITIONAL[0]);
  const loaded = load(source);
  const sourceName = path.basename(source);
  const target = buildPath(source);

  fs.writeFileSync(target, serializeBuildIndex(loaded.model, sourceName), 'utf8');
  const flows = buildableFlows(loaded.model);
  for (const flow of flows) {
    fs.writeFileSync(
      flowBuildPath(source, flow.id),
      serializeBuildFlow(loaded.model, flow.id, sourceName),
      'utf8',
    );
  }

  out(
    `${green('✔')} built ${bold(displayPath(target))} ${dim(
      `(${flows.length} flow file${flows.length === 1 ? '' : 's'})`,
    )}`,
  );
}

function commandInit() {
  const target = path.resolve(OPTIONS.file ?? POSITIONAL[0] ?? 'routing-context-flow.md');
  if (fs.existsSync(target)) {
    fail(`${displayPath(target)} already exists.`);
  }
  fs.writeFileSync(target, STARTER_TEMPLATE, 'utf8');

  const { model, issues } = parseFlowFile(STARTER_TEMPLATE);
  if (issues.some((issue) => issue.level === 'error')) {
    fail('the starter template is invalid, please report this bug.');
  }

  out(`${green('✔')} created ${bold(displayPath(target))} ${dim(`(${model.flows.length} flows)`)}`);
  out(dim('Edit it by hand or with: context-preload editor'));
  out(dim('Then: context-preload list && context-preload validate'));
}

function isWSL() {
  return (
    process.platform === 'linux' &&
    (Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(os.release()))
  );
}

function wslBrowser() {
  const candidates = [
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Mozilla Firefox/firefox.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function launchBrowser(opener: string, args: string[]) {
  // Not detached: we want to see whether the opener actually starts, and we
  // do not want a stray child outliving the command unnoticed.
  const child = spawn(opener, args, { stdio: 'ignore' });
  const hint = () => out(dim('Could not open a browser; open the address above manually.'));
  child.on('error', hint);
  child.on('exit', (code) => {
    if (code !== 0) hint();
  });
  return child;
}

function openInBrowser(target: string): void {
  if (isWSL()) {
    // xdg-open on WSL often resolves .html to Vim and has no Linux browser.
    // Launch a Windows browser directly when we can find one; the URL is
    // printed either way.
    const browser = wslBrowser();
    if (browser) {
      launchBrowser(browser, [target]);
      return;
    }
    launchBrowser('cmd.exe', ['/c', 'start', '', target]);
    return;
  }

  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  launchBrowser(opener, args);
}

function buildEditorForFile(editorPath: string, filePath: string, text: string): string {
  const html = fs.readFileSync(editorPath, 'utf8');
  const payload = JSON.stringify({
    fileName: path.basename(filePath),
    path: filePath,
    text,
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const marker = '<script type="module">';
  const index = html.indexOf(marker);
  if (index === -1) fail('editor build is invalid: module script not found');

  const bootstrap = `<script>window.__CRF_BOOTSTRAP__ = ${payload};</script>\n`;
  return `${html.slice(0, index)}${bootstrap}${html.slice(index)}`;
}

function editorForFile(editorPath: string, file: string): string {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) fail(`routing file not found: ${file}`);
  if (!fs.statSync(absolute).isFile()) fail(`not a file: ${file}`);

  const text = fs.readFileSync(absolute, 'utf8');
  const html = buildEditorForFile(editorPath, absolute, text);
  const directory = path.join(os.tmpdir(), 'context-preload-editor');
  fs.mkdirSync(directory, { recursive: true });

  const digest = crypto
    .createHash('sha1')
    .update(absolute)
    .update('\0')
    .update(text)
    .digest('hex')
    .slice(0, 12);
  const target = path.join(directory, `editor-${digest}.html`);
  fs.writeFileSync(target, html, 'utf8');
  return target;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail(`invalid port: ${value} (use 0-65535, 0 picks a free port)`);
  }
  return port;
}

function serveEditor(
  target: string,
  portValue: string | undefined,
  shouldOpen: boolean,
): void {
  const port = parsePort(portValue);
  const html = fs.readFileSync(target, 'utf8');

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed');
      return;
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });

  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      fail(`port ${port} is already in use; try --port 0 for a free port`);
    }
    fail(`cannot start the editor server: ${error.message}`);
  });

  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    const url = `http://127.0.0.1:${actual}/`;
    out(`${green('✔')} editor available at ${bold(url)}`);
    out(dim('Press Ctrl+C to stop the server.'));
    if (shouldOpen) openInBrowser(url);
  });

  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function commandEditor() {
  const editorPath = path.resolve(HERE, '..', 'editor', 'index.html');
  if (!fs.existsSync(editorPath)) fail(`editor not found at ${editorPath}`);

  const file = OPTIONS.file ?? POSITIONAL[0];
  const target = file ? editorForFile(editorPath, file) : editorPath;

  const autoOpen = Boolean(process.stdout.isTTY) && !process.env.CI;
  serveEditor(target, OPTIONS.port, autoOpen);
}

function commandHelp() {
  out(`
${bold('context-preload')} ${dim(`v${pkg.version}`)} — route what an AI agent reads.

${bold('Usage')}
  context-preload <command> [options]

${bold('Commands')}
  list [file]                List flows in the routing file
  validate [file]            Check the file, its paths and its includes
  build [file]               Write the index and one build file per flow
  init [file]                Create a starter routing-context-flow.md
  editor [file]              Serve the visual editor and print a local URL

${bold('Options')}
  --file <path>              Routing file (default: nearest routing-context-flow.md)
  --root <path>              Override the routing root directory
  --strict                   Exit 1 on warnings too (validate)
  --port <n>                 Editor server port (0 = random, default 0)

${bold('Examples')}
  context-preload list
  context-preload validate --strict
  context-preload build
  context-preload editor
  context-preload editor routing-context-flow.md --port 8765
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
  case 'validate':
  case 'check':
    commandValidate();
    break;
  case 'build':
    commandBuild();
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

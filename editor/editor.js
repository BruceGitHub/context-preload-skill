/* CRC · editor/editor.js
 *
 * Scopo: logica della UI browser dell'editor: form Global/flussi, modalità
 * Raw/Visual, preview, import/export, tema e autosave.
 * Collaboratori: editor/template.html (markup e stili), core crf-core.ts
 * inlinato da scripts/build-editor.mjs, API browser (DOM, localStorage,
 * clipboard).
 * Consumatori: editor/index.html (generato).
 */

const STORAGE_KEY = 'context-preload-editor-v1';
const THEME_KEY = 'context-preload-theme';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const escAttr = (value) => esc(value).replace(/"/g, '&quot;');

const toLines = (value) =>
  String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const toCommaList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toEntries = (value) =>
  toLines(value)
    .map(parseReadEntry)
    .filter((entry) => entry.path);

const entriesToText = (entries) => (entries ?? []).map(formatReadEntry).join('\n');

function starterModel() {
  return createEmptyModel({
    meta: {
      name: 'my-project',
      description: 'Context routing for my-project.',
      root: '',
    },
    global: {
      ignore: ['node_modules/**', 'dist/**', '.git/**'],
      readOrder: 'first the files touched by the task, then the tests, then the surrounding code.',
    },
    flows: [
      createFlow('review', {
        description: 'Review a change without rewriting it.',
        read: [
          { path: 'src/**', note: 'code under review' },
          { path: 'tests/**', note: 'existing expectations' },
        ],
      }),
      createFlow('coding', {
        description: 'Implement a feature or a fix.',
        read: [{ path: 'src/**', note: '' }],
      }),
    ],
  });
}

const state = {
  fileName: 'routing-context-flow.md',
  model: starterModel(),
  selected: 'global',
  dirty: false,
  raw: false,
  rawText: '',
};

state.rawText = serializeFlowFile(state.model);

function currentText() {
  return state.raw ? state.rawText : serializeFlowFile(state.model);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  $('#filename').value = state.fileName;
  $('#btn-mode').textContent = state.raw ? 'Visual' : 'Raw';
  $('#btn-mode').title = state.raw
    ? 'Switch to the structured editor'
    : 'Edit the file as free text';
  document.body.classList.toggle('is-raw', state.raw);
  renderSidebar();
  renderForm();
  renderPreview();
  renderStatus();
}

function renderSidebar() {
  $('#flow-count').textContent = String(state.model.flows.length);
  $('#btn-global').classList.toggle('active', !state.raw && state.selected === 'global');

  $('#flow-list').innerHTML = state.model.flows
    .map(
      (flow) => `
      <li>
        <button type="button" class="flow-item ${!state.raw && state.selected === flow.id ? 'active' : ''}"
                data-flow="${escAttr(flow.id)}">
          <span class="flow-id">${esc(flow.id)}</span>
          <span class="flow-desc">${esc(flow.description || 'no description')}</span>
        </button>
      </li>`,
    )
    .join('');
}

function field(label, key, value, options = {}) {
  const classes = `field${options.full ? ' full' : ''}`;
  const hint = options.hint ? `<small>${options.hint}</small>` : '';
  const placeholder = options.placeholder
    ? ` placeholder="${escAttr(options.placeholder)}"`
    : '';

  if (options.rows) {
    return `<label class="${classes}">
      <span class="label">${label}</span>
      <textarea data-key="${escAttr(key)}" rows="${options.rows}"${placeholder} spellcheck="false">${esc(value)}</textarea>
      ${hint}
    </label>`;
  }

  const type = options.type || 'text';
  const list = options.list ? ` list="${escAttr(options.list)}"` : '';
  return `<label class="${classes}">
    <span class="label">${label}</span>
    <input data-key="${escAttr(key)}" type="${escAttr(type)}" value="${escAttr(value)}"${placeholder}${list} spellcheck="false">
    ${hint}
  </label>`;
}

function globalTemplate() {
  const meta = state.model.meta;
  const global = state.model.global;

  return `
    <div class="panel-head">
      <div>
        <h2>Global</h2>
        <p>Paths and read order that apply to every flow.</p>
      </div>
    </div>
    <div class="form-grid">
      ${field('Project name', 'name', meta.name, { placeholder: 'my-project' })}
      ${field('Root', 'root', meta.root, {
        placeholder: 'empty = folder of the routing file',
        hint: 'Relative to the location of the routing file.',
      })}
      ${field('Description', 'description', meta.description, { full: true })}
      ${field('Always ignore', 'ignore', (global.ignore ?? []).join('\n'), {
        rows: 4,
        full: true,
        hint: 'One glob per line. These files are never read.',
      })}
      ${field('Read order', 'readOrder', global.readOrder, {
        full: true,
        placeholder: 'first the files touched by the task, then the tests',
      })}
    </div>`;
}

function flowTemplate(flow) {
  const others = state.model.flows.filter((item) => item.id !== flow.id);
  const datalist = `<datalist id="flow-ids">${others
    .map((item) => `<option value="${escAttr(item.id)}"></option>`)
    .join('')}</datalist>`;

  return `
    <div class="panel-head">
      <div>
        <h2><span class="hash">#</span> Flow</h2>
        <p>${esc(flow.description || 'Define what this flow reads.')}</p>
      </div>
      <div class="row-actions">
        <button class="btn icon" type="button" data-action="up" title="Move up" aria-label="Move up">↑</button>
        <button class="btn icon" type="button" data-action="down" title="Move down" aria-label="Move down">↓</button>
        <button class="btn" type="button" data-action="duplicate">Duplicate</button>
        <button class="btn danger" type="button" data-action="delete">Delete</button>
      </div>
    </div>
    ${datalist}
    <div class="form-grid">
      ${field('ID', 'id', flow.id, {
        placeholder: 'review',
        hint: 'Lowercase letters, numbers, <code>-</code> and <code>_</code>.',
      })}
      ${field('Description', 'description', flow.description, { full: true })}
      ${field('Includes', 'includes', (flow.includes ?? []).join(', '), {
        list: 'flow-ids',
        hint: 'Inherits read and skip from other flows.',
      })}
      ${field('Read', 'read', entriesToText(flow.read), {
        rows: 7,
        full: true,
        hint: 'One path per line: <code>`src/**/*.ts | note`</code>. Globs: <code>*</code>, <code>**</code>, <code>?</code>, <code>{a,b}</code>.',
      })}
      ${field('Skip', 'skip', (flow.skip ?? []).join('\n'), {
        rows: 3,
        full: true,
        hint: 'Globs excluded from this flow, even if read includes them.',
      })}
    </div>`;
}

function rawTemplate() {
  return `
    <div class="panel-head">
      <div>
        <h2>Free text</h2>
        <p>The skill reads this file as instructions. Structured flows are optional.</p>
      </div>
    </div>
    <div class="form-grid">
      <label class="field full">
        <span class="label">Routing file</span>
        <textarea id="raw-text" rows="26" spellcheck="false">${esc(state.rawText)}</textarea>
        <small>Example: <code>When I am doing a review, read these files:</code> followed by the list. Switch to <b>Visual</b> when the file uses <code>## Flow:</code> sections.</small>
      </label>
    </div>`;
}

function renderForm() {
  const panel = $('#form-panel');

  if (state.raw) {
    panel.innerHTML = rawTemplate();
    const raw = $('#raw-text');
    raw.addEventListener('input', () => {
      state.rawText = raw.value;
      state.dirty = true;
      renderPreview();
      renderStatus();
      scheduleSave();
    });
    return;
  }

  const flow = getFlow(state.model, state.selected);

  if (state.selected === 'global' || !flow) {
    state.selected = 'global';
    panel.innerHTML = globalTemplate();
  } else {
    panel.innerHTML = flowTemplate(flow);
  }

  $$('[data-key]', panel).forEach((input) => {
    const flow = state.selected === 'global' ? null : getFlow(state.model, state.selected);
    input.addEventListener('input', () => onField(input, flow));
    if (input.dataset.key === 'id') {
      input.addEventListener('blur', () => onIdBlur(input, flow));
    }
  });
}

function renderPreview() {
  const preview = $('#preview');
  const text = currentText();
  const scrollTop = preview.scrollTop;
  preview.textContent = text;
  preview.scrollTop = scrollTop;

  const issues = state.raw
    ? parseFlowFile(state.rawText).issues.filter((issue) => issue.level === 'error')
    : validateModel(state.model);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;

  const badge = $('#issues-badge');
  badge.textContent = state.raw
    ? errors
      ? `${errors} error${errors === 1 ? '' : 's'}`
      : 'free text'
    : errors
      ? `${errors} error${errors === 1 ? '' : 's'}${warnings ? ` · ${warnings} warning` : ''}`
      : warnings
        ? `${warnings} warning`
        : 'no issues';
  badge.className = `badge ${errors ? 'bad' : state.raw ? 'ok' : warnings ? 'warn' : 'ok'}`;

  if (!issues.length) {
    $('#issues').innerHTML = state.raw
      ? '<p class="muted">Free text: the skill interprets it directly. Use structured <code>## Flow:</code> sections if you want <code>context-preload validate</code> and glob expansion.</p>'
      : '<p class="muted">Valid structure. Paths are checked by <code>context-preload validate</code>.</p>';
    return;
  }

  $('#issues').innerHTML = `<ul class="issues">${issues
    .map(
      (issue) =>
        `<li class="${issue.level}"><strong>${issue.level === 'error' ? 'error' : 'warning'}</strong> ${esc(issue.message)}</li>`,
    )
    .join('')}</ul>`;
}

function renderStatus() {
  const lines = currentText().split('\n').length;
  $('#status-left').textContent = state.raw
    ? `free text · ${lines} lines`
    : `${state.model.flows.length} flows · ${lines} lines`;
  $('#status-right').textContent = state.dirty ? 'draft updated' : 'ready';
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function onField(input, flow) {
  const key = input.dataset.key;
  const value = input.type === 'number' ? Number(input.value || 0) : input.value;

  if (!flow) {
    if (key === 'ignore') state.model.global.ignore = toLines(value);
    else if (key === 'readOrder') state.model.global[key] = value;
    else if (key === 'name' || key === 'description' || key === 'root') {
      state.model.meta[key] = value;
    }
  } else {
    switch (key) {
      case 'id':
        flow.id = value;
        state.selected = value;
        break;
      case 'includes':
        flow.includes = toCommaList(value);
        break;
      case 'read':
        flow.read = toEntries(value);
        break;
      case 'skip':
        flow.skip = toLines(value);
        break;
      case 'description':
        flow[key] = value;
        break;
      default:
        break;
    }
  }

  state.dirty = true;
  renderSidebar();
  renderPreview();
  renderStatus();
  scheduleSave();
}

function onIdBlur(input, flow) {
  if (!flow) return;

  const base = slugifyFlowId(input.value) || 'flow';
  const taken = new Set(
    state.model.flows.filter((item) => item !== flow).map((item) => item.id),
  );
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }

  if (id !== flow.id) {
    flow.id = id;
    state.selected = id;
    state.dirty = true;
    renderAll();
    scheduleSave();
  } else if (input.value !== id) {
    input.value = id;
  }
}

function uniqueFlowId(base) {
  const taken = new Set(state.model.flows.map((flow) => flow.id));
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

function addFlow() {
  const id = uniqueFlowId('flow');
  state.model.flows.push(createFlow(id, { description: 'New flow.' }));
  state.selected = id;
  state.dirty = true;
  renderAll();
  scheduleSave();
  const input = $('[data-key="id"]');
  if (input) {
    input.focus();
    input.select();
  }
}

function onAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const flow = getFlow(state.model, state.selected);
  if (!flow) return;

  const index = state.model.flows.indexOf(flow);
  const action = button.dataset.action;

  if (action === 'delete') {
    if (!confirm(`Delete flow "${flow.id}"?`)) return;
    state.model.flows.splice(index, 1);
    state.selected = state.model.flows[Math.max(0, index - 1)]?.id ?? 'global';
  } else if (action === 'duplicate') {
    const copy = JSON.parse(JSON.stringify(flow));
    copy.id = uniqueFlowId(`${flow.id}-copy`);
    state.model.flows.splice(index + 1, 0, copy);
    state.selected = copy.id;
  } else if (action === 'up' && index > 0) {
    [state.model.flows[index - 1], state.model.flows[index]] = [
      state.model.flows[index],
      state.model.flows[index - 1],
    ];
  } else if (action === 'down' && index < state.model.flows.length - 1) {
    [state.model.flows[index + 1], state.model.flows[index]] = [
      state.model.flows[index],
      state.model.flows[index + 1],
    ];
  } else {
    return;
  }

  state.dirty = true;
  renderAll();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download() {
  const raw = state.fileName.trim() || 'routing-context-flow.md';
  const fileName = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
  downloadText(currentText(), fileName);
  toast(`Downloaded ${fileName}`);
}

function downloadBuild() {
  let model = state.model;
  if (state.raw) {
    const parsed = parseFlowFile(state.rawText);
    if (parsed.issues.some((issue) => issue.level === 'error')) {
      toast('Fix the errors before building');
      return;
    }
    model = parsed.model;
  }
  const raw = state.fileName.trim() || 'routing-context-flow.md';
  const base = raw.toLowerCase().endsWith('.md') ? raw.slice(0, -3) : raw;
  const fileName = `${base}.build.md`;
  downloadText(serializeBuildFile(model, raw), fileName);
  toast(`Downloaded ${fileName}`);
}

async function copyText() {
  const text = currentText();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('Markdown copied');
  } catch {
    toast('Copy unavailable: use Download');
  }
}

async function importFile(file) {
  try {
    const text = await file.text();
    loadFileText(text, file.name);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}

function loadFileText(text, name, message) {
  const { model, issues } = parseFlowFile(text);
  state.model = model;
  state.rawText = text;
  if (name) state.fileName = name;

  const hasProse = issues.some(
    (issue) => issue.code === 'syntax.orphan' || issue.code === 'section.unknown',
  );
  state.raw = model.flows.length === 0 || hasProse;
  state.selected = model.flows[0]?.id ?? 'global';
  state.dirty = false;
  renderAll();
  scheduleSave();

  if (message) {
    toast(message);
    return;
  }

  const errors = issues.filter((issue) => issue.level === 'error').length;
  toast(
    errors
      ? `Imported with ${errors} error${errors === 1 ? '' : 's'} to fix`
      : `Imported ${name || 'file'}`,
  );
}

function ensureVisualMode() {
  if (!state.raw) return true;

  const { model, issues } = parseFlowFile(state.rawText);
  if (!model.flows.length) {
    toast('No structured flows found; staying in free text mode');
    return false;
  }
  if (issues.some((issue) => issue.level === 'error')) {
    toast('Fix the errors in the free text first');
    return false;
  }
  if (serializeFlowFile(model).trim() !== state.rawText.trim()) {
    if (!confirm('Visual mode normalizes the file and may drop free-form text. Continue?')) {
      return false;
    }
  }

  state.model = model;
  state.raw = false;
  return true;
}

function toggleMode() {
  if (!state.raw) {
    state.rawText = serializeFlowFile(state.model);
    state.raw = true;
  } else if (ensureVisualMode()) {
    state.selected = state.model.flows[0]?.id ?? 'global';
  } else {
    return;
  }

  renderAll();
  scheduleSave();
}

function resetModel() {
  if (state.dirty && !confirm('Replace the current content with a new file?')) return;
  state.model = starterModel();
  state.rawText = serializeFlowFile(state.model);
  state.raw = false;
  state.fileName = 'routing-context-flow.md';
  state.selected = 'global';
  state.dirty = false;
  renderAll();
  scheduleSave();
  toast('New routing file');
}

/* ------------------------------------------------------------------ */
/* Persistence and feedback                                            */
/* ------------------------------------------------------------------ */

function scheduleSave() {
  clearTimeout(scheduleSave.timer);
  scheduleSave.timer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          fileName: state.fileName,
          model: state.model,
          selected: state.selected,
          raw: state.raw,
          rawText: state.rawText,
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* storage might be disabled: the editor still works */
    }
  }, 250);
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.model || !Array.isArray(data.model.flows)) return false;
    state.model = data.model;
    state.fileName = data.fileName || state.fileName;
    state.raw = Boolean(data.raw);
    state.rawText =
      typeof data.rawText === 'string' ? data.rawText : serializeFlowFile(state.model);
    state.selected =
      data.selected === 'global' || getFlow(state.model, data.selected)
        ? data.selected
        : 'global';
    return true;
  } catch {
    return false;
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function renderTheme() {
  const button = $('#btn-theme');
  if (!button) return;
  const light = currentTheme() === 'light';
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';
  button.textContent = light ? '☾' : '☀';
  button.title = label;
  button.setAttribute('aria-label', label);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage might be disabled: the in-memory theme still works */
  }
  renderTheme();
}

let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  $('#filename').addEventListener('input', (event) => {
    state.fileName = event.target.value;
    state.dirty = true;
    renderStatus();
    scheduleSave();
  });

  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importFile(file);
  });

  $('#btn-new').addEventListener('click', resetModel);
  $('#btn-download').addEventListener('click', download);
  $('#btn-build').addEventListener('click', downloadBuild);
  $('#btn-copy').addEventListener('click', copyText);
  $('#btn-mode').addEventListener('click', toggleMode);

  $('#btn-global').addEventListener('click', () => {
    if (!ensureVisualMode()) return;
    state.selected = 'global';
    renderAll();
    scheduleSave();
  });

  $('#btn-add-flow').addEventListener('click', () => {
    if (!ensureVisualMode()) return;
    addFlow();
  });

  $('#flow-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-flow]');
    if (!button) return;
    if (!ensureVisualMode()) return;
    state.selected = button.dataset.flow;
    renderAll();
    scheduleSave();
  });

  $('#form-panel').addEventListener('click', onAction);

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      download();
    }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    $('#dropzone').hidden = false;
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      $('#dropzone').hidden = true;
    }
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    $('#dropzone').hidden = true;
    const file = event.dataTransfer?.files?.[0];
    if (file) await importFile(file);
  });
}

function init() {
  wire();
  renderTheme();

  const bootstrap = window.__CRF_BOOTSTRAP__;
  if (bootstrap && typeof bootstrap.text === 'string') {
    loadFileText(
      bootstrap.text,
      bootstrap.fileName,
      `Opened ${bootstrap.fileName || 'routing file'}`,
    );
    return;
  }

  const restored = restoreDraft();
  renderAll();
  if (restored) toast('Local draft restored');
}

init();

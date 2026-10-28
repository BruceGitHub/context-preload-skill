/* context-preload · editor UI
 * Loaded after the core (inlined by scripts/build-editor.mjs).
 * Everything here is offline: no network, no external assets.
 */

const STORAGE_KEY = 'context-preload-editor-v1';

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
      defaultBudget: '60k',
      root: '',
    },
    global: {
      ignore: ['node_modules/**', 'dist/**', '.git/**'],
      readOrder: 'first the files touched by the task, then the tests, then the surrounding code.',
      rules: '- Read only what the flow declares; if you need more, say so before reading it.',
    },
    flows: [
      createFlow('review', {
        description: 'Review a change without rewriting it.',
        triggers: ['review', 'pr', 'diff'],
        read: [
          { path: 'src/**', note: 'code under review' },
          { path: 'tests/**', note: 'existing expectations' },
        ],
        steps: ['Read the diff.', 'Look for regressions and missing tests.'],
        rules: '- Report only concrete problems, with file and line.',
        doneWhen: ['Every finding has file:line and a proposed fix.'],
      }),
      createFlow('coding', {
        description: 'Implement a feature or a fix.',
        triggers: ['coding', 'implement', 'fix'],
        read: [{ path: 'src/**', note: '' }],
        doneWhen: ['I test passano.'],
      }),
    ],
  });
}

const state = {
  fileName: 'routing-context-flow.md',
  model: starterModel(),
  selected: 'global',
  dirty: false,
};

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAll() {
  $('#filename').value = state.fileName;
  renderSidebar();
  renderForm();
  renderPreview();
  renderStatus();
}

function renderSidebar() {
  $('#flow-count').textContent = String(state.model.flows.length);
  $('#btn-global').classList.toggle('active', state.selected === 'global');

  $('#flow-list').innerHTML = state.model.flows
    .map(
      (flow) => `
      <li>
        <button type="button" class="flow-item ${state.selected === flow.id ? 'active' : ''}"
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
        <p>Rules and paths that apply to every flow.</p>
      </div>
    </div>
    <div class="form-grid">
      ${field('Project name', 'name', meta.name, { placeholder: 'my-project' })}
      ${field('Root', 'root', meta.root, {
        placeholder: 'empty = folder of the routing file',
        hint: 'Relative to the location of the routing file.',
      })}
      ${field('Global budget', 'budget', global.budget, {
        placeholder: 'e.g. 60k',
        hint: 'Overridden by a flow budget.',
      })}
      ${field('Fallback budget', 'defaultBudget', meta.defaultBudget, {
        placeholder: 'e.g. 60k',
        hint: 'Used only when both the flow and the global budget are empty.',
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
      ${field('Global rules', 'rules', global.rules, {
        rows: 4,
        full: true,
        hint: 'Free-form Markdown, valid for every flow.',
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
      ${field('Priority', 'priority', flow.priority, {
        type: 'number',
        hint: 'Used when several flows are compatible.',
      })}
      ${field('Description', 'description', flow.description, { full: true })}
      ${field('Triggers', 'triggers', (flow.triggers ?? []).join(', '), {
        full: true,
        placeholder: 'review, pr, diff, check',
        hint: 'Comma separated: the skill uses them to infer the flow.',
      })}
      ${field('Includes', 'includes', (flow.includes ?? []).join(', '), {
        list: 'flow-ids',
        hint: 'Inherits read, rules and steps from other flows.',
      })}
      ${field('Budget', 'budget', flow.budget, {
        placeholder: 'empty = global',
        hint: 'E.g. <code>60k</code> or <code>120000</code>.',
      })}
      ${field('Read', 'read', entriesToText(flow.read), {
        rows: 7,
        full: true,
        hint: 'One path per line: <code>`src/**/*.ts | note`</code>. Globs: <code>*</code>, <code>**</code>, <code>?</code>, <code>{a,b}</code>.',
      })}
      ${field('Optional', 'optional', entriesToText(flow.optional), {
        rows: 3,
        full: true,
        hint: 'Like read, but the skill loads them only if needed.',
      })}
      ${field('Skip', 'skip', (flow.skip ?? []).join('\n'), {
        rows: 3,
        full: true,
        hint: 'Globs excluded from this flow, even if read includes them.',
      })}
      ${field('Steps', 'steps', (flow.steps ?? []).join('\n'), {
        rows: 5,
        full: true,
        hint: 'One step per line, in order.',
      })}
      ${field('Rules', 'rules', flow.rules, {
        rows: 5,
        full: true,
        hint: 'Free-form Markdown: constraints on how to work.',
      })}
      ${field('Done when', 'doneWhen', (flow.doneWhen ?? []).join('\n'), {
        rows: 4,
        full: true,
        hint: 'One completion criterion per line.',
      })}
    </div>`;
}

function renderForm() {
  const panel = $('#form-panel');
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
  const text = serializeFlowFile(state.model);
  const scrollTop = preview.scrollTop;
  preview.textContent = text;
  preview.scrollTop = scrollTop;

  const issues = validateModel(state.model);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;

  const badge = $('#issues-badge');
  badge.textContent = errors
    ? `${errors} error${errors === 1 ? 'e' : 'i'}${warnings ? ` · ${warnings} warning` : ''}`
    : warnings
      ? `${warnings} warning`
      : 'no issues';
  badge.className = `badge ${errors ? 'bad' : warnings ? 'warn' : 'ok'}`;

  $('#issues').innerHTML = issues.length
    ? `<ul class="issues">${issues
        .map(
          (issue) =>
            `<li class="${issue.level}"><strong>${issue.level === 'error' ? 'error' : 'warning'}</strong> ${esc(issue.message)}</li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">Valid structure. Paths are checked by <code>context-preload validate</code>.</p>';
}

function renderStatus() {
  const lines = serializeFlowFile(state.model).split('\n').length;
  $('#status-left').textContent = `${state.model.flows.length} flows · ${lines} lines`;
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
    else if (key === 'readOrder' || key === 'rules' || key === 'budget') state.model.global[key] = value;
    else if (key === 'name' || key === 'description' || key === 'defaultBudget' || key === 'root') {
      state.model.meta[key] = value;
    }
  } else {
    switch (key) {
      case 'id':
        flow.id = value;
        state.selected = value;
        break;
      case 'triggers':
        flow.triggers = toCommaList(value);
        break;
      case 'includes':
        flow.includes = toCommaList(value);
        break;
      case 'priority':
        flow.priority = Number(value) || 0;
        break;
      case 'read':
        flow.read = toEntries(value);
        break;
      case 'optional':
        flow.optional = toEntries(value);
        break;
      case 'skip':
        flow.skip = toLines(value);
        break;
      case 'steps':
        flow.steps = toLines(value);
        break;
      case 'doneWhen':
        flow.doneWhen = toLines(value);
        break;
      case 'description':
      case 'budget':
      case 'rules':
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

function download() {
  const text = serializeFlowFile(state.model);
  const raw = state.fileName.trim() || 'routing-context-flow.md';
  const fileName = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`;
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Scaricato ${fileName}`);
}

async function copyText() {
  const text = serializeFlowFile(state.model);
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
    toast('Markdown copiato');
  } catch {
    toast('Copy unavailable: use Download');
  }
}

async function importFile(file) {
  try {
    const text = await file.text();
    importText(text, file.name);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}

function importText(text, name) {
  const { model, issues } = parseFlowFile(text);
  state.model = model;
  if (name) state.fileName = name;
  state.selected = model.flows[0]?.id ?? 'global';
  state.dirty = false;
  renderAll();
  scheduleSave();

  const errors = issues.filter((issue) => issue.level === 'error').length;
  toast(
    errors
      ? `Imported with ${errors} error${errors === 1 ? '' : 's'} to fix`
      : `Imported ${name || 'file'}`,
  );
}

function resetModel() {
  if (state.dirty && !confirm('Replace the current content with a new file?')) return;
  state.model = starterModel();
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
    state.selected =
      data.selected === 'global' || getFlow(state.model, data.selected)
        ? data.selected
        : 'global';
    return true;
  } catch {
    return false;
  }
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

  $('#btn-import').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importFile(file);
  });

  $('#btn-new').addEventListener('click', resetModel);
  $('#btn-download').addEventListener('click', download);
  $('#btn-copy').addEventListener('click', copyText);

  $('#btn-global').addEventListener('click', () => {
    state.selected = 'global';
    renderAll();
  });

  $('#btn-add-flow').addEventListener('click', addFlow);

  $('#flow-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-flow]');
    if (!button) return;
    state.selected = button.dataset.flow;
    renderAll();
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
  const restored = restoreDraft();
  wire();
  renderAll();
  if (restored) toast('Local draft restored');
}

init();

const SETTINGS_KEY = 'settings';
const FIELD_TYPE = document.body.dataset.fieldType;

const DEFAULT_FIELD_CONFIG = {
  singleWord: [
    {
      id: 'translation',
      key: 'translation',
      title: '释义',
      prompt: '将该英文单词翻译为简洁的中文释义。',
      required: false
    },
    {
      id: 'ipa',
      key: 'ipa',
      title: '音标',
      prompt: '给出该英文单词的 IPA（国际音标）。',
      required: false
    },
    {
      id: 'etymology',
      key: 'etymology',
      title: '单词溯源',
      prompt: '说明该英文单词的语言学起源与演变历程，中文简洁表述。',
      required: false
    }
  ],
  paragraph: [
    {
      id: 'translation',
      key: 'translation',
      title: '释义',
      prompt: '将文本翻译为简体中文，保持简洁清晰。',
      required: false
    }
  ]
};

const DEFAULT_RULES = {
  singleWord:
    'You are a bilingual assistant. Follow the field prompts and respond concisely in Simplified Chinese unless a field asks otherwise.',
  paragraph:
    'You are a bilingual assistant. Follow the field prompts and respond concisely in Simplified Chinese unless a field asks otherwise.'
};

const rulesInput = document.getElementById('rules-input');
const jsonFormatEl = document.getElementById('json-format');
const rulesStatusEl = document.getElementById('rules-status');
const fieldsStatusEl = document.getElementById('fields-status');
const fieldListEl = document.getElementById('field-list');
const searchInput = document.getElementById('search');
const addFieldBtn = document.getElementById('add-field');
const deleteBtn = document.getElementById('delete-selected');
const saveFieldsBtn = document.getElementById('save-fields');
const saveRulesBtn = document.getElementById('save-rules');
const resetDefaultsBtn = document.getElementById('reset-defaults');

let fields = [];
let selected = new Set();
let originalRules = '';
let settingsCache = null;

init();

function init() {
  if (!FIELD_TYPE) {
    rulesStatusEl.textContent = '缺少字段类型参数。';
    return;
  }
  loadSettings();
  searchInput.addEventListener('input', renderFields);
  addFieldBtn.addEventListener('click', addField);
  deleteBtn.addEventListener('click', deleteSelected);
  saveFieldsBtn.addEventListener('click', saveFields);
  saveRulesBtn.addEventListener('click', saveRules);
  resetDefaultsBtn.addEventListener('click', resetDefaults);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) {
      loadSettings();
    }
  });
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get(SETTINGS_KEY);
  settingsCache = settings || {};
  const rules = settingsCache.rules?.[FIELD_TYPE] || DEFAULT_RULES[FIELD_TYPE];
  rulesInput.value = rules;
  originalRules = rules;

  const rawFields = settingsCache.fieldConfig?.[FIELD_TYPE];
  fields = normalizeFields(rawFields, DEFAULT_FIELD_CONFIG[FIELD_TYPE]);
  renderFields();
  updateJsonFormat();
}

function normalizeFields(list, defaults) {
  const output = [];
  const seen = new Set();
  const items = Array.isArray(list) ? list : [];
  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = sanitizeKey(item.key);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push({
      id: item.id || key,
      key,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : key,
      prompt: typeof item.prompt === 'string' ? item.prompt.trim() : '',
      required: false
    });
  });

  return output.length ? output : defaults.map((item) => ({ ...item, required: false }));
}

function renderFields() {
  const query = (searchInput.value || '').toLowerCase().trim();
  fieldListEl.innerHTML = '';

  const visible = fields.filter((field) => {
    if (!query) return true;
    const text = `${field.title} ${field.key} ${field.prompt}`.toLowerCase();
    return text.includes(query);
  });

  if (!visible.length) {
    fieldListEl.innerHTML = '<div class="empty">暂无字段</div>';
    deleteBtn.disabled = true;
    return;
  }

  const frag = document.createDocumentFragment();
  visible.forEach((field) => {
    const card = document.createElement('div');
    card.className = 'field-card';
    card.dataset.id = field.id;

    const isChecked = selected.has(field.id);
    card.innerHTML = `
      <div class="field-card__header">
        <label class="checkbox-wrap">
          <input class="checkbox field-check" type="checkbox" data-id="${field.id}" ${
      isChecked ? 'checked' : ''
    } />
          <span class="muted">选择删除</span>
        </label>
      </div>
      <div class="field-card__body">
        <label class="field">
          <span>字段名称</span>
          <input class="field-title" data-id="${field.id}" type="text" value="${escapeHTML(
      field.title
    )}" />
        </label>
        <label class="field">
          <span>变量名（JSON Key）</span>
          <div class="field-key-row">
            <input class="field-key" data-id="${field.id}" type="text" value="${escapeHTML(
      field.key
    )}" />
            <button class="ghost generate-key" data-id="${field.id}" type="button">生成变量名</button>
          </div>
        </label>
        <label class="field field--full">
          <span>字段提示词</span>
          <textarea class="field-prompt" data-id="${field.id}" rows="3">${escapeHTML(
      field.prompt
    )}</textarea>
        </label>
      </div>
    `;

    frag.appendChild(card);
  });
  fieldListEl.appendChild(frag);

  fieldListEl.querySelectorAll('.field-check').forEach((checkbox) => {
    checkbox.addEventListener('change', onToggleSelect);
  });
  fieldListEl.querySelectorAll('.field-title').forEach((input) => {
    input.addEventListener('input', onTitleChange);
  });
  fieldListEl.querySelectorAll('.field-key').forEach((input) => {
    input.addEventListener('blur', onKeyBlur);
    input.addEventListener('input', onKeyChange);
  });
  fieldListEl.querySelectorAll('.field-prompt').forEach((input) => {
    input.addEventListener('input', onPromptChange);
  });
  fieldListEl.querySelectorAll('.generate-key').forEach((btn) => {
    btn.addEventListener('click', onGenerateKey);
  });

  updateDeleteButton();
}

function addField() {
  const id = `field_${Date.now()}`;
  fields.push({
    id,
    key: '',
    title: '',
    prompt: '',
    required: false
  });
  renderFields();
  updateJsonFormat();
}

function onToggleSelect(event) {
  const id = event.target.dataset.id;
  if (!id) return;
  if (event.target.checked) {
    selected.add(id);
  } else {
    selected.delete(id);
  }
  updateDeleteButton();
}

function onTitleChange(event) {
  const id = event.target.dataset.id;
  updateField(id, { title: event.target.value });
  updateJsonFormat();
}

function onKeyChange(event) {
  const id = event.target.dataset.id;
  updateField(id, { key: event.target.value });
  updateJsonFormat();
}

function onKeyBlur(event) {
  const id = event.target.dataset.id;
  const sanitized = sanitizeKey(event.target.value);
  event.target.value = sanitized;
  updateField(id, { key: sanitized });
  updateJsonFormat();
}

function onPromptChange(event) {
  const id = event.target.dataset.id;
  updateField(id, { prompt: event.target.value });
  updateJsonFormat();
}

async function onGenerateKey(event) {
  const id = event.target.dataset.id;
  const field = fields.find((item) => item.id === id);
  if (!field) return;
  event.target.disabled = true;
  fieldsStatusEl.textContent = '生成变量名中...';

  chrome.runtime.sendMessage(
    {
      type: 'GENERATE_FIELD_KEY',
      payload: {
        title: field.title,
        prompt: field.prompt
      }
    },
    (response) => {
      event.target.disabled = false;
      if (chrome.runtime.lastError || response?.error) {
        fieldsStatusEl.textContent = response?.error || '生成失败，请重试。';
        return;
      }
      if (response?.key) {
        updateField(id, { key: response.key });
        renderFields();
        updateJsonFormat();
        fieldsStatusEl.textContent = '已生成变量名。';
      } else {
        fieldsStatusEl.textContent = '未生成有效变量名。';
      }
    }
  );
}

function updateField(id, patch) {
  fields = fields.map((item) => {
    if (item.id !== id) return item;
    return { ...item, ...patch };
  });
}

function updateDeleteButton() {
  deleteBtn.disabled = selected.size === 0;
}

function deleteSelected() {
  if (!selected.size) return;
  const ok = window.confirm('确认删除所选字段吗？');
  if (!ok) return;
  fields = fields.filter((item) => !selected.has(item.id) || item.required);
  selected.clear();
  renderFields();
  updateJsonFormat();
}

async function saveFields() {
  const validation = validateFields(fields);
  if (!validation.ok) {
    fieldsStatusEl.textContent = validation.error;
    return;
  }
  const updated = {
    ...settingsCache,
    fieldConfig: {
      ...(settingsCache.fieldConfig || {}),
      [FIELD_TYPE]: validation.cleaned
    }
  };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: updated });
  settingsCache = updated;
  fields = validation.cleaned;
  fieldsStatusEl.textContent = '字段已保存。';
  setTimeout(() => (fieldsStatusEl.textContent = ''), 1500);
  updateJsonFormat();
}

async function resetDefaults() {
  const ok = window.confirm('确认恢复默认字段和规则吗？此操作会覆盖当前配置。');
  if (!ok) return;

  const defaults = DEFAULT_FIELD_CONFIG[FIELD_TYPE].map((item) => ({ ...item, required: false }));
  const updated = {
    ...(settingsCache || {}),
    rules: {
      ...(settingsCache?.rules || {}),
      [FIELD_TYPE]: DEFAULT_RULES[FIELD_TYPE]
    },
    fieldConfig: {
      ...(settingsCache?.fieldConfig || {}),
      [FIELD_TYPE]: defaults
    }
  };

  await chrome.storage.sync.set({ [SETTINGS_KEY]: updated });
  settingsCache = updated;
  fields = defaults;
  selected.clear();
  rulesInput.value = DEFAULT_RULES[FIELD_TYPE];
  originalRules = DEFAULT_RULES[FIELD_TYPE];
  renderFields();
  updateJsonFormat();
  fieldsStatusEl.textContent = '已恢复默认配置。';
  setTimeout(() => (fieldsStatusEl.textContent = ''), 1500);
}

async function saveRules() {
  const nextRules = (rulesInput.value || '').trim();
  if (nextRules !== originalRules) {
    const ok = window.confirm('确认保存总体规则吗？');
    if (!ok) {
      rulesInput.value = originalRules;
      return;
    }
  }
  const updated = {
    ...settingsCache,
    rules: {
      ...(settingsCache.rules || {}),
      [FIELD_TYPE]: nextRules || DEFAULT_RULES[FIELD_TYPE]
    }
  };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: updated });
  settingsCache = updated;
  originalRules = nextRules;
  rulesStatusEl.textContent = '规则已保存。';
  setTimeout(() => (rulesStatusEl.textContent = ''), 1500);
}

function updateJsonFormat() {
  const draft = fields.map((field) => {
    const key = sanitizeKey(field.key) || 'field';
    const title = (field.title || '字段').trim() || '字段';
    return { key, title };
  });
  const seen = new Set();
  const safe = draft.map((field) => {
    let key = field.key;
    let index = 2;
    while (seen.has(key)) {
      key = `${field.key}_${index}`;
      index += 1;
    }
    seen.add(key);
    return { ...field, key };
  });
  const jsonExample = `{ ${safe.map((field) => `"${field.key}": "<${field.title}>"`).join(', ')} }`;
  jsonFormatEl.textContent = jsonExample;
}

function validateFields(list) {
  if (!list.length) {
    return { ok: false, error: '请至少保留一个字段。' };
  }
  const cleaned = [];
  const seen = new Set();
  for (const item of list) {
    const key = sanitizeKey(item.key);
    if (!key) {
      return { ok: false, error: '变量名不能为空，且只能包含小写字母、数字或下划线。' };
    }
    if (seen.has(key)) {
      return { ok: false, error: `变量名重复：${key}` };
    }
    seen.add(key);
    const title = (item.title || '').trim();
    if (!title) {
      return { ok: false, error: '字段名称不能为空。' };
    }
    const prompt = (item.prompt || '').trim();
    if (!prompt) {
      return { ok: false, error: `字段「${title}」的提示词不能为空。` };
    }
    cleaned.push({
      id: item.id || key,
      key,
      title,
      prompt,
      required: Boolean(item.required)
    });
  }
  return { ok: true, cleaned };
}

function sanitizeKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (char) => {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escapeMap[char] || char;
  });
}

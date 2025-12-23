const DEFAULT_FIELD_CONFIG = {
  singleWord: [
    {
      key: 'translation',
      title: '释义',
      prompt: '将该英文单词翻译为简洁的中文释义。',
      required: false
    },
    {
      key: 'ipa',
      title: '音标',
      prompt: '给出该英文单词的 IPA（国际音标）。',
      required: false
    },
    {
      key: 'etymology',
      title: '单词溯源',
      prompt: '说明该英文单词的语言学起源与演变历程，中文简洁表述。',
      required: false
    }
  ],
  paragraph: [
    {
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

const DEFAULT_SETTINGS = {
  hotkey: 'Ctrl+Shift+L',
  model: 'gemini-2.5-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '{llm_api_key}',
  historyLimit: 500,
  rules: DEFAULT_RULES,
  fieldConfig: DEFAULT_FIELD_CONFIG
};

const FETCH_TIMEOUT_MS = 12000;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  API_KEY: 'apiKey',
  HISTORY: 'history'
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' }, () => {
      if (chrome.runtime.lastError) {
        openManualTranslateTab();
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TRANSLATE_SELECTION') {
    handleTranslationRequest(message.payload?.text)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('Translation error:', error);
        sendResponse({ error: '翻译失败，请稍后重试。' });
      });
    return true; // keep the message channel open for async response
  }
  if (message?.type === 'TEST_API') {
    testApiAvailability(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('Test API error:', error);
        sendResponse({ error: '测速失败，请检查配置或网络。' });
      });
    return true;
  }
  if (message?.type === 'GENERATE_FIELD_KEY') {
    generateFieldKey(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('Generate key error:', error);
        sendResponse({ error: '生成变量名失败，请检查网络或配置。' });
      });
    return true;
  }
});

async function ensureDefaults() {
  const [{ settings }, { apiKey }] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.SETTINGS),
    chrome.storage.local.get(STORAGE_KEYS.API_KEY)
  ]);

  if (!settings) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  } else {
    const normalized = normalizeSettings(settings);
    if (JSON.stringify(normalized) !== JSON.stringify(settings)) {
      await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: normalized });
    }
  }
  if (!apiKey) {
    await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: DEFAULT_SETTINGS.apiKey });
  }
}

async function getSettings() {
  const [{ settings }, { apiKey }] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.SETTINGS),
    chrome.storage.local.get(STORAGE_KEYS.API_KEY)
  ]);
  const normalized = normalizeSettings(settings);
  if (settings && JSON.stringify(settings) !== JSON.stringify(normalized)) {
    chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: normalized });
  }
  return { ...normalized, apiKey: apiKey || normalized.apiKey };
}

function normalizeSettings(settings) {
  const base = settings || {};
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...base
  };
  const rules = {
    ...DEFAULT_RULES,
    ...(base.rules || {})
  };
  if (base.systemPrompt && !base.rules?.singleWord) {
    rules.singleWord = base.systemPrompt;
  }
  if (base.systemPrompt && !base.rules?.paragraph) {
    rules.paragraph = base.systemPrompt;
  }

  const singleRaw = base.fieldConfig?.singleWord;
  const paragraphRaw = base.fieldConfig?.paragraph;
  const singleList =
    singleRaw === undefined ? DEFAULT_FIELD_CONFIG.singleWord : normalizeFieldList(singleRaw);
  const paragraphList =
    paragraphRaw === undefined ? DEFAULT_FIELD_CONFIG.paragraph : normalizeFieldList(paragraphRaw);

  normalized.rules = rules;
  normalized.fieldConfig = {
    singleWord: singleList,
    paragraph: paragraphList
  };

  return normalized;
}

function normalizeFieldList(list) {
  const output = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const field = normalizeField(item);
    if (!field || seen.has(field.key)) return;
    seen.add(field.key);
    output.push(field);
  });
  return output;
}

function normalizeField(field) {
  if (!field || typeof field !== 'object') return null;
  const key = sanitizeFieldKey(field.key);
  if (!key) return null;
  const title = typeof field.title === 'string' && field.title.trim() ? field.title.trim() : key;
  const prompt = typeof field.prompt === 'string' ? field.prompt.trim() : '';
  return {
    id: field.id || key,
    key,
    title,
    prompt,
    required: Boolean(field.required)
  };
}

function sanitizeFieldKey(key) {
  if (!key || typeof key !== 'string') return '';
  const normalized = key
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized || !FIELD_KEY_PATTERN.test(normalized)) return '';
  return normalized;
}

function getFieldDefs(settings, isSingleWord) {
  const config = settings.fieldConfig || DEFAULT_SETTINGS.fieldConfig;
  return isSingleWord ? config.singleWord : config.paragraph;
}

async function handleTranslationRequest(rawText) {
  const text = sanitizeText(rawText);
  if (!text) {
    return { error: '请先选择需要翻译的内容。' };
  }

  const isSingleWord = checkIsSingleWord(text);
  const settings = await getSettings();

  if (!settings.apiKey || settings.apiKey === '{llm_api_key}') {
    return { error: '请在设置中填写有效的 API Key。' };
  }

  const translationResult = await translateViaLLM(text, isSingleWord, settings);
  if (translationResult.error) {
    return translationResult;
  }

  const displayFields = translationResult.displayFields || [];

  const historyEntry = {
    text,
    translation: translationResult.translation || displayFields[0]?.value || '',
    ipa: isSingleWord ? translationResult.ipa : null,
    imagery: isSingleWord ? translationResult.imagery : null,
    etymology: isSingleWord ? translationResult.etymology : null,
    isSingleWord,
    timestamp: Date.now()
  };

  await persistHistory(historyEntry, settings.historyLimit);

  return translationResult;
}

async function translateViaLLM(text, isSingleWord, settings) {
  const fieldDefs = getFieldDefs(settings, isSingleWord);
  if (!fieldDefs || fieldDefs.length === 0) {
    return { error: '尚未配置字段，请先在翻译输出配置中添加字段。' };
  }
  const prompt = buildPrompt(text, isSingleWord, settings, fieldDefs);
  const url = `${settings.endpoint}/models/${settings.model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LLM response error:', response.status, errorText);
      return { error: '翻译接口调用失败，请检查网络或 Key。' };
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const combined = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('')
      .trim();
    if (!combined) {
      return { error: '未收到可用的翻译结果。' };
    }

    const parsed = safeParseJSON(combined);
    if (!parsed || typeof parsed !== 'object') {
      return { error: '翻译结果解析失败。' };
    }
    const { fields: displayFields, hasValue } = buildDisplayFields(parsed, fieldDefs);
    if (!hasValue) {
      return { error: '翻译结果为空，请调整字段或提示词。' };
    }
    const translation =
      typeof parsed?.translation === 'string' && parsed.translation.trim()
        ? parsed.translation.trim()
        : displayFields[0]?.value || '';

    return {
      translation,
      ipa: typeof parsed?.ipa === 'string' ? parsed.ipa.trim() : null,
      imagery: typeof parsed?.imagery === 'string' ? parsed.imagery.trim() : null,
      etymology: typeof parsed?.etymology === 'string' ? parsed.etymology.trim() : null,
      isSingleWord,
      displayFields
    };
  } catch (err) {
    console.error('LLM fetch error:', err);
    if (err.name === 'AbortError') {
      return { error: '请求超时，请检查网络或稍后重试。' };
    }
    return { error: '翻译出错，请稍后重试。' };
  } finally {
    clearTimeout(timer);
  }
}

async function testApiAvailability(payload) {
  const settings = await getSettings();
  const model = payload?.model || settings.model;
  const endpoint = payload?.endpoint || settings.endpoint;
  const apiKey = payload?.apiKey || settings.apiKey;

  if (!apiKey || apiKey === '{llm_api_key}') {
    return { error: '请填写有效的 API Key。' };
  }

  const url = `${endpoint}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with {"status":"ok"}' }] }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Test API status', res.status, text);
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const combined = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('')
      .trim();
    const parsed = safeParseJSON(combined);
    const ok = parsed?.status === 'ok' || combined.includes('"ok"');
    return ok
      ? { ok: true, latencyMs: Date.now() - start }
      : { error: '接口响应异常，请检查模型/Key。' };
  } catch (err) {
    console.error('Test API fetch error', err);
    if (err.name === 'AbortError') {
      return { error: '测速超时，请检查网络。' };
    }
    return { error: '测速失败，请检查网络或配置。' };
  } finally {
    clearTimeout(timer);
  }
}

async function generateFieldKey(payload) {
  const settings = await getSettings();
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';

  if (!title && !prompt) {
    return { error: '请先填写字段名称或提示词。' };
  }
  if (!settings.apiKey || settings.apiKey === '{llm_api_key}') {
    return { error: '请先填写有效的 API Key。' };
  }

  const url = `${settings.endpoint}/models/${settings.model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const fixedPrompt = [
    'You are a naming assistant for JSON keys.',
    'Given a field title and prompt, return JSON only in the format: {"key":"snake_case_key"}',
    'Rules:',
    '- key must be lowercase snake_case, ASCII only.',
    '- start with a letter, length 2-24.',
    '- do not add extra commentary.',
    `Title: "${title || ''}"`,
    `Prompt: "${prompt || ''}"`
  ].join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: fixedPrompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Generate key status', res.status, text);
      return { key: fallbackKey(title || prompt) };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const combined = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('')
      .trim();
    const parsed = safeParseJSON(combined);
    const key = sanitizeFieldKey(parsed?.key || '');
    if (!key) {
      return { key: fallbackKey(title || prompt) };
    }
    return { key };
  } catch (err) {
    console.error('Generate key fetch error', err);
    if (err.name === 'AbortError') {
      return { error: '生成超时，请检查网络。' };
    }
    return { key: fallbackKey(title || prompt) };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackKey(text) {
  const cleaned = sanitizeFieldKey(text);
  if (cleaned) return cleaned;
  const base = `field_${Date.now()}`;
  return sanitizeFieldKey(base) || 'custom_field';
}

function buildPrompt(text, isSingleWord, settings, fieldDefs) {
  const trimmed = text.trim();
  const rules = isSingleWord ? settings.rules?.singleWord : settings.rules?.paragraph;
  const fields = Array.isArray(fieldDefs) ? fieldDefs : [];
  const fieldLines = fields.map((field) => `- ${field.key}: ${field.prompt || field.title}`);
  const jsonExample = `{ ${fields.map((field) => `"${field.key}": "<${field.title}>"`).join(', ')} }`;
  return [
    rules || '',
    'Rules:',
    '- Output JSON only, no commentary.',
    '- Follow the field prompts to populate each key. If a field is not applicable, return null or an empty string for that key.',
    ...fieldLines,
    'Output JSON format (fixed, do not change):',
    jsonExample,
    `Text: """${trimmed}"""`
  ].join('\n');
}

function buildDisplayFields(parsed, fieldDefs) {
  const fields = Array.isArray(fieldDefs) ? fieldDefs : [];
  let hasValue = false;
  const result = fields.map((field) => {
    const value = extractFieldValue(parsed?.[field.key]);
    if (value) {
      hasValue = true;
    }
    return {
      key: field.key,
      title: field.title,
      value: value || '—'
    };
  });
  return { fields: result, hasValue };
}

function extractFieldValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

function openManualTranslateTab() {
  const url = chrome.runtime.getURL('manual.html');
  chrome.tabs.create({ url });
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/{[\s\S]*}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        console.warn('Failed to parse inner JSON', e);
      }
    }
    console.warn('JSON parse failed for text:', text);
    return null;
  }
}

function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 500 ? cleaned.slice(0, 500) : cleaned;
}

const WORD_PATTERN = /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/;

function checkIsSingleWord(text) {
  const normalized = text.trim();
  return normalized.split(/\s+/).length === 1 && WORD_PATTERN.test(normalized);
}

async function persistHistory(entry, limit = DEFAULT_SETTINGS.historyLimit) {
  const existingWrapper = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  const history = existingWrapper[STORAGE_KEYS.HISTORY] || [];
  const idx = history.findIndex((item) => item.text === entry.text);
  if (idx >= 0) {
    const existingId = history[idx].id || history[idx].timestamp || Date.now();
    history[idx] = {
      ...history[idx],
      id: existingId,
      translation: entry.translation,
      ipa: entry.ipa,
      isSingleWord: entry.isSingleWord,
      timestamp: entry.timestamp,
      count: (history[idx].count || 1) + 1
    };
  } else {
    const entryId = entry.timestamp || Date.now();
    history.unshift({
      ...entry,
      count: 1,
      id: entryId,
      timestamp: entryId
    });
  }

  if (history.length > limit) {
    history.length = limit;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

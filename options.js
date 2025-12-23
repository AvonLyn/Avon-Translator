const DEFAULTS = {
  hotkey: 'Ctrl+Shift+L',
  model: 'gemini-2.5-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '{llm_api_key}'
};

const SETTINGS_KEY = 'settings';
const API_KEY = 'apiKey';

const statusEl = document.getElementById('status');
const hotkeyInput = document.getElementById('hotkey');
const testApiBtn = document.getElementById('test-api');

document.getElementById('save-settings').addEventListener('click', saveSettings);
testApiBtn.addEventListener('click', testApi);
hotkeyInput.addEventListener('keydown', captureHotkey);
hotkeyInput.addEventListener('focus', (e) => e.target.select());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) {
    loadSettings();
  }
});

init();

async function init() {
  await loadSettings();
}

async function loadSettings() {
  const [{ settings }, local] = await Promise.all([
    chrome.storage.sync.get(SETTINGS_KEY),
    chrome.storage.local.get(API_KEY)
  ]);
  const merged = { ...DEFAULTS, ...(settings || {}) };
  document.getElementById('hotkey').value = merged.hotkey;
  document.getElementById('model').value = merged.model;
  document.getElementById('endpoint').value = merged.endpoint;
  document.getElementById('apiKey').value = local[API_KEY] || DEFAULTS.apiKey;
}

async function saveSettings(event) {
  event.preventDefault();
  const hotkey = normalizeHotkeyInput(hotkeyInput.value) || DEFAULTS.hotkey;
  const model = document.getElementById('model').value.trim() || DEFAULTS.model;
  const endpoint = document.getElementById('endpoint').value.trim() || DEFAULTS.endpoint;
  const apiKey = document.getElementById('apiKey').value.trim() || DEFAULTS.apiKey;

  const { settings } = await chrome.storage.sync.get(SETTINGS_KEY);
  const merged = { ...(settings || {}), hotkey, model, endpoint };

  await Promise.all([
    chrome.storage.sync.set({ [SETTINGS_KEY]: merged }),
    chrome.storage.local.set({ [API_KEY]: apiKey })
  ]);

  setStatus('已保存。');
  setTimeout(() => setStatus(''), 1800);
  updateCommandShortcut(hotkey);
}

function setLoading(isLoading, message = '') {
  testApiBtn.disabled = isLoading;
  if (isLoading) {
    setStatus(message || '测试中...');
  } else if (!message) {
    setStatus('');
  } else {
    setStatus(message);
  }
}

function getFormValues() {
  return {
    hotkey: normalizeHotkeyInput(hotkeyInput.value) || DEFAULTS.hotkey,
    model: document.getElementById('model').value.trim() || DEFAULTS.model,
    endpoint: document.getElementById('endpoint').value.trim() || DEFAULTS.endpoint,
    apiKey: document.getElementById('apiKey').value.trim() || DEFAULTS.apiKey
  };
}

function testApi() {
  const { model, endpoint, apiKey } = getFormValues();
  if (!apiKey || apiKey === DEFAULTS.apiKey) {
    setStatus('请先填写有效的 API Key。');
    return;
  }
  setLoading(true, '测试中...');
  chrome.runtime.sendMessage(
    {
      type: 'TEST_API',
      payload: { model, endpoint, apiKey }
    },
    (response) => {
      setLoading(false);
      if (chrome.runtime.lastError) {
        setStatus('扩展未响应，请重试。');
        return;
      }
      if (!response || response.error) {
        setStatus(response?.error || '测速失败，请检查配置。');
        return;
      }
      const ms = response.latencyMs != null ? `${response.latencyMs} ms` : '未知';
      setStatus(`接口可用，延迟 ${ms}`);
    }
  );
}

function updateCommandShortcut(hotkey) {
  if (!chrome.commands || !chrome.commands.update) {
    return;
  }
  chrome.commands.update({ name: 'translate-selection', shortcut: hotkey }, () => {
    if (chrome.runtime.lastError) {
      setStatus('已保存，但全局快捷键更新失败，请到 chrome://extensions/shortcuts 设置。');
      return;
    }
    setStatus('已保存，快捷键已同步。');
    setTimeout(() => setStatus(''), 1800);
  });
}
function captureHotkey(event) {
  if (event.key === 'Tab') return; // allow tab navigation
  event.preventDefault();
  if (event.key === 'Backspace') {
    hotkeyInput.value = '';
    return;
  }
  const formatted = formatHotkeyEvent(event);
  hotkeyInput.value = formatted;
}

function formatHotkeyEvent(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const mainKey = normalizeKey(event.key);
  if (mainKey && !['Control', 'Shift', 'Alt', 'Meta'].includes(mainKey)) {
    parts.push(mainKey);
  }

  return parts.join('+');
}

function normalizeKey(key) {
  if (!key) return '';
  const map = {
    ' ': 'Space',
    Escape: 'Esc',
    Esc: 'Esc',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Enter: 'Enter',
    Return: 'Enter',
    Tab: 'Tab'
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function normalizeHotkeyInput(value) {
  return (value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+');
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
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

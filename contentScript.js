const DEFAULT_HOTKEY = 'Ctrl+Shift+L';

let currentSettings = {
  hotkey: DEFAULT_HOTKEY
};

let tooltipEl = null;
let anchorRect = null;
let anchorScrollX = 0;
let anchorScrollY = 0;

init();

function init() {
  loadSettings();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'TRIGGER_TRANSLATE') {
      translateSelection();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (changes.settings?.newValue) {
      currentSettings = { ...currentSettings, ...changes.settings.newValue };
    }
  });
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  currentSettings = { ...currentSettings, ...(settings || {}) };
}

function onKeydown(event) {
  if (!matchesHotkey(event, currentSettings.hotkey || DEFAULT_HOTKEY)) {
    return;
  }
  event.preventDefault();
  translateSelection();
}

function matchesHotkey(event, hotkey) {
  if (!hotkey) return false;
  const parts = hotkey.toLowerCase().split('+').map((p) => p.trim());
  const key = event.key.toLowerCase();
  const hasCtrl = parts.includes('ctrl');
  const hasShift = parts.includes('shift');
  const hasAlt = parts.includes('alt');
  const hasMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
  const mainKey = parts.find((p) => !['ctrl', 'shift', 'alt', 'meta', 'cmd', 'command'].includes(p));

  if ((hasCtrl && !event.ctrlKey) || (!hasCtrl && event.ctrlKey)) return false;
  if ((hasShift && !event.shiftKey) || (!hasShift && event.shiftKey)) return false;
  if ((hasAlt && !event.altKey) || (!hasAlt && event.altKey)) return false;
  if ((hasMeta && !event.metaKey) || (!hasMeta && event.metaKey)) return false;
  if (mainKey && key !== mainKey) return false;
  return true;
}

function translateSelection() {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  if (!text) {
    showTooltip('请先选择文字。');
    return;
  }

  const rect = getSelectionRect();

  showTooltip('翻译中...', rect, true);
  let timeoutId = setTimeout(() => {
    showTooltip('响应超时，请检查网络或刷新页面后重试。', rect);
  }, 15000);

  chrome.runtime.sendMessage(
    {
      type: 'TRANSLATE_SELECTION',
      payload: { text }
    },
    (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        showTooltip('扩展未响应，请重试。', rect);
        return;
      }
      if (!response || response.error) {
        showTooltip(response?.error || '翻译失败，请重试。', rect);
        return;
      }
      const latestRect = getSelectionRect() || rect;
      const fields = Array.isArray(response.displayFields)
        ? response.displayFields
        : buildLegacyFields(response);
      const html = fields
        .map((field) => {
          const keyAttr = field.key ? ` data-key="${escapeHTML(field.key)}"` : '';
          return `
            <div class="avon-field"${keyAttr}>
              <div class="avon-field-title">${escapeHTML(field.title || field.key || '')}</div>
              <div class="avon-field-value">${renderMarkdown(field.value || '')}</div>
            </div>
          `;
        })
        .join('');
      showTooltip(html, latestRect, false, true);
    }
  );
}

function showTooltip(content, rect = null, loading = false, isHTML = false) {
  removeTooltip();

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'avon-tooltip';

  const inner = document.createElement('div');
  inner.className = 'avon-tooltip-inner';
  if (loading) inner.classList.add('loading');
  if (isHTML) {
    inner.innerHTML = content;
  } else {
    inner.textContent = content;
  }
  tooltipEl.appendChild(inner);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'avon-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', removeTooltip);
  tooltipEl.appendChild(closeBtn);

  document.body.appendChild(tooltipEl);
  setAnchorRect(rect);
  positionTooltip(anchorRect || rect);

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick, { once: true });
  }, 0);
}

function positionTooltip(rect) {
  const spacing = 8;
  const tooltipRect = tooltipEl.getBoundingClientRect();

  let top = window.scrollY + 20;
  let left = window.scrollX + 20;
  let arrowLeft = 24;

  if (rect) {
    top = window.scrollY + rect.bottom + spacing;
    left = window.scrollX + rect.left;
    const selectionCenter = window.scrollX + rect.left + rect.width / 2;
    arrowLeft = selectionCenter - left;
  }

  // Clamp within viewport
  const maxLeft = window.scrollX + document.documentElement.clientWidth - tooltipRect.width - spacing;
  left = Math.max(window.scrollX + spacing, Math.min(left, maxLeft));
  if (rect) {
    const selectionCenter = window.scrollX + rect.left + rect.width / 2;
    arrowLeft = selectionCenter - left;
  }
  arrowLeft = Math.max(12, Math.min(tooltipRect.width - 20, arrowLeft));

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.setProperty('--avon-arrow-left', `${arrowLeft}px`);
}

function setAnchorRect(rect) {
  if (!rect) {
    anchorRect = null;
    return;
  }
  anchorRect = {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
  anchorScrollX = window.scrollX;
  anchorScrollY = window.scrollY;
}

function updateRectFromSelection() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.toString().trim()) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  setAnchorRect(rect);
  return true;
}

function onViewportChange() {
  if (!tooltipEl || !anchorRect) return;
  if (!updateRectFromSelection()) {
    const deltaX = window.scrollX - anchorScrollX;
    const deltaY = window.scrollY - anchorScrollY;
    if (deltaX || deltaY) {
      anchorRect = {
        ...anchorRect,
        top: anchorRect.top - deltaY,
        bottom: anchorRect.bottom - deltaY,
        left: anchorRect.left - deltaX
      };
      anchorScrollX = window.scrollX;
      anchorScrollY = window.scrollY;
    }
  }
  positionTooltip(anchorRect);
}

function removeTooltip() {
  if (tooltipEl?.parentNode) {
    tooltipEl.parentNode.removeChild(tooltipEl);
  }
  tooltipEl = null;
  anchorRect = null;
}

function handleOutsideClick(event) {
  if (!tooltipEl) return;
  if (!tooltipEl.contains(event.target)) {
    removeTooltip();
  }
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (char) => {
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

function buildLegacyFields(response) {
  const fields = [];
  if (response.ipa) {
    fields.push({ key: 'ipa', title: '音标', value: `[${response.ipa}]` });
  }
  if (response.translation) {
    fields.push({ key: 'translation', title: '释义', value: response.translation });
  }
  if (response.etymology) {
    fields.push({ key: 'etymology', title: '单词溯源', value: response.etymology });
  } else if (response.imagery) {
    fields.push({ key: 'imagery', title: '单词意象', value: response.imagery });
  }
  return fields;
}

function getSelectionRect() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  return range.getBoundingClientRect();
}

function renderMarkdown(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!raw) return '';
  const codeBlocks = [];
  let temp = raw.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const html = `<pre class="avon-code"><code>${escapeHTML(code)}</code></pre>`;
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(html);
    return `\n${token}\n`;
  });

  temp = escapeHTML(temp);
  temp = temp.replace(/`([^`]+)`/g, '<code class="avon-inline-code">$1</code>');
  temp = temp.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  temp = temp.replace(/__(.+?)__/g, '<strong>$1</strong>');
  temp = temp.replace(/\*(.+?)\*/g, '<em>$1</em>');
  temp = temp.replace(/_(.+?)_/g, '<em>$1</em>');

  const lines = temp.split('\n');
  let html = '';
  let paragraph = [];
  let inList = false;
  let listType = '';

  const flushParagraph = () => {
    if (paragraph.length) {
      html += `<p>${paragraph.join('<br>')}</p>`;
      paragraph = [];
    }
  };

  const closeList = () => {
    if (inList) {
      html += `</${listType}>`;
      inList = false;
      listType = '';
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const codeMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (codeMatch) {
      flushParagraph();
      closeList();
      html += codeBlocks[Number(codeMatch[1])] || '';
      return;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      html += `<div class="avon-md-h${level}">${headingMatch[2]}</div>`;
      return;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (olMatch || ulMatch) {
      flushParagraph();
      const type = olMatch ? 'ol' : 'ul';
      if (!inList || listType !== type) {
        closeList();
        html += `<${type}>`;
        inList = true;
        listType = type;
      }
      html += `<li>${(olMatch || ulMatch)[1]}</li>`;
      return;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      return;
    }
    paragraph.push(line);
  });

  flushParagraph();
  closeList();
  return html;
}

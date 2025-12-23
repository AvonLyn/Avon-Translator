const translateBtn = document.getElementById('manual-translate');
const textInput = document.getElementById('manual-text');
const statusEl = document.getElementById('manual-status');
const resultEl = document.getElementById('manual-result');

translateBtn.addEventListener('click', runTranslate);

function runTranslate() {
  const text = (textInput.value || '').trim();
  if (!text) {
    setStatus('请先输入要翻译的内容。');
    return;
  }
  setStatus('翻译中...');
  translateBtn.disabled = true;
  resultEl.innerHTML = '';

  chrome.runtime.sendMessage(
    {
      type: 'TRANSLATE_SELECTION',
      payload: { text }
    },
    (response) => {
      translateBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus('扩展未响应，请重试。');
        return;
      }
      if (!response || response.error) {
        setStatus(response?.error || '翻译失败，请重试。');
        return;
      }
      setStatus('已完成。');
      renderResult(response);
    }
  );
}

function renderResult(response) {
  const fields = Array.isArray(response.displayFields)
    ? response.displayFields
    : buildLegacyFields(response);
  if (!fields.length) {
    resultEl.innerHTML = '<div class="empty">暂无结果</div>';
    return;
  }
  resultEl.innerHTML = fields
    .map((field) => {
      return `
        <div class="avon-field">
          <div class="avon-field-title">${escapeHTML(field.title || field.key || '')}</div>
          <div class="avon-field-value">${renderMarkdown(field.value || '')}</div>
        </div>
      `;
    })
    .join('');
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
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

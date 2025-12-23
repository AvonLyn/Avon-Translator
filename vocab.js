const HISTORY_KEY = 'history';

const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort-vocab');
const vocabBodyEl = document.getElementById('vocab-body');
const selectAllEl = document.getElementById('select-all');
const deleteBtn = document.getElementById('delete-selected');

let historyData = [];
let vocabData = [];
let filtered = [];
let selectedWords = new Set();

init();

function init() {
  loadData();
  searchInput.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  selectAllEl.addEventListener('change', toggleSelectAll);
  deleteBtn.addEventListener('click', deleteSelected);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[HISTORY_KEY]) {
      historyData = changes[HISTORY_KEY].newValue || [];
      vocabData = buildVocab(historyData);
      applyFilters();
    }
  });
}

async function loadData() {
  const local = await chrome.storage.local.get(HISTORY_KEY);
  historyData = local[HISTORY_KEY] || [];
  vocabData = buildVocab(historyData);
  applyFilters();
}

function buildVocab(history) {
  return (history || []).filter((item) => item.isSingleWord);
}

function applyFilters() {
  const q = (searchInput.value || '').toLowerCase().trim();
  const sortBy = sortSelect.value;

  filtered = vocabData.filter((item) => {
    if (!q) return true;
    const text = `${item.text || ''} ${item.translation || ''} ${item.ipa || ''}`.toLowerCase();
    return text.includes(q);
  });

  if (sortBy === 'count') {
    filtered.sort((a, b) => (b.count || 1) - (a.count || 1));
  } else {
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  renderTable();
}

function renderTable() {
  vocabBodyEl.innerHTML = '';
  if (!filtered.length) {
    vocabBodyEl.innerHTML = '<div class="empty">暂无生词</div>';
    deleteBtn.disabled = true;
    selectAllEl.checked = false;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((item) => {
    const word = item.text;
    const checked = selectedWords.has(word);
    const id = item.id || item.timestamp || word;
    const row = document.createElement('div');
    row.className = 'table__row';
    row.innerHTML = `
      <span><input class="checkbox row-check" type="checkbox" data-word="${escapeHTML(word)}" ${checked ? 'checked' : ''}></span>
      <span title="${escapeHTML(word)}">${escapeHTML(word)}</span>
      <span>${item.ipa ? '[' + escapeHTML(item.ipa) + ']' : '-'}</span>
      <span title="${escapeHTML(item.translation || '')}">${escapeHTML(truncate(item.translation || '', 70))}</span>
      <span>${item.count || 1}</span>
      <span>${formatDate(item.timestamp)}</span>
    `;
    frag.appendChild(row);
  });
  vocabBodyEl.appendChild(frag);

  vocabBodyEl.querySelectorAll('.row-check').forEach((cb) => {
    cb.addEventListener('change', onSelectRow);
  });

  updateDeleteState();
}

function onSelectRow(event) {
  const word = event.target.dataset.word;
  if (!word) return;
  if (event.target.checked) {
    selectedWords.add(word);
  } else {
    selectedWords.delete(word);
    selectAllEl.checked = false;
  }
  updateDeleteState();
}

function toggleSelectAll(event) {
  if (!filtered.length) return;
  const checked = event.target.checked;
  filtered.forEach((item) => {
    const word = item.text;
    if (checked) {
      selectedWords.add(word);
    } else {
      selectedWords.delete(word);
    }
  });
  renderTable();
}

async function deleteSelected() {
  if (!selectedWords.size) return;
  const ok = window.confirm('确认删除所选生词吗？');
  if (!ok) return;

  const words = new Set(selectedWords);
  historyData = historyData.filter((item) => !(item.isSingleWord && words.has(item.text)));
  vocabData = buildVocab(historyData);
  selectedWords.clear();
  await chrome.storage.local.set({ [HISTORY_KEY]: historyData });
  applyFilters();
}

function updateDeleteState() {
  deleteBtn.disabled = selectedWords.size === 0;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
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

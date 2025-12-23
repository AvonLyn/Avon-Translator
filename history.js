const HISTORY_KEY = 'history';

const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort-history');
const historyBodyEl = document.getElementById('history-body');
const selectAllEl = document.getElementById('select-all');
const deleteBtn = document.getElementById('delete-selected');

let historyData = [];
let filtered = [];
let selectedIds = new Set();

init();

function init() {
  loadHistory();
  searchInput.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  selectAllEl.addEventListener('change', toggleSelectAll);
  deleteBtn.addEventListener('click', deleteSelected);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[HISTORY_KEY]) {
      historyData = changes[HISTORY_KEY].newValue || [];
      applyFilters();
    }
  });
}

async function loadHistory() {
  const local = await chrome.storage.local.get(HISTORY_KEY);
  historyData = local[HISTORY_KEY] || [];
  applyFilters();
}

function applyFilters() {
  const q = (searchInput.value || '').toLowerCase().trim();
  const sortBy = sortSelect.value;

  filtered = historyData.filter((item) => {
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
  historyBodyEl.innerHTML = '';
  if (!filtered.length) {
    historyBodyEl.innerHTML = '<div class="empty">暂无记录</div>';
    deleteBtn.disabled = true;
    selectAllEl.checked = false;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'table__row';

    const id = getItemId(item);
    const checked = selectedIds.has(id);

    row.innerHTML = `
      <span><input class="checkbox row-check" type="checkbox" data-id="${id}" ${checked ? 'checked' : ''}></span>
      <span title="${escapeHTML(item.text)}">${escapeHTML(truncate(item.text, 60))}</span>
      <span>${item.ipa ? '[' + escapeHTML(item.ipa) + ']' : '-'}</span>
      <span title="${escapeHTML(item.translation || '')}">${escapeHTML(truncate(item.translation || '', 70))}</span>
      <span>${item.count || 1}</span>
      <span>${formatDate(item.timestamp)}</span>
    `;
    frag.appendChild(row);
  });
  historyBodyEl.appendChild(frag);

  historyBodyEl.querySelectorAll('.row-check').forEach((cb) => {
    cb.addEventListener('change', onSelectRow);
  });

  updateDeleteState();
}

function onSelectRow(event) {
  const id = event.target.dataset.id;
  if (!id) return;
  if (event.target.checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
    selectAllEl.checked = false;
  }
  updateDeleteState();
}

function toggleSelectAll(event) {
  if (!filtered.length) return;
  const checked = event.target.checked;
  filtered.forEach((item) => {
    const id = getItemId(item);
    if (checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
  });
  renderTable();
}

async function deleteSelected() {
  if (!selectedIds.size) return;
  const ok = window.confirm('确认删除所选记录吗？');
  if (!ok) return;

  const ids = new Set(selectedIds);
  historyData = historyData.filter((item) => {
    const id = getItemId(item);
    return !ids.has(id);
  });
  selectedIds.clear();
  await chrome.storage.local.set({ [HISTORY_KEY]: historyData });
  applyFilters();
}

function updateDeleteState() {
  deleteBtn.disabled = selectedIds.size === 0;
}

function getItemId(item) {
  const raw = item.id || item.timestamp || `${item.text}-${item.translation || ''}`;
  return String(raw);
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

// Minimalist ShopList Client JS

const API = {
  getLists: () => fetch('/api/lists').then(r => r.json()),
  createList: (data) => fetch('/api/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  updateList: (id, data) => fetch(`/api/lists/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  deleteList: (id) => fetch(`/api/lists/${id}`, { method: 'DELETE' }).then(r => r.json()),

  getItems: (listId, query = {}) => {
    const params = new URLSearchParams(query);
    return fetch(`/api/lists/${listId}/items?${params}`).then(r => r.json());
  },
  addItem: (listId, data) => fetch(`/api/lists/${listId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  updateItem: (id, data) => fetch(`/api/items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  deleteItem: (id) => fetch(`/api/items/${id}`, { method: 'DELETE' }).then(r => r.json()),
  clearCompleted: (listId) => fetch(`/api/lists/${listId}/clear-completed`, { method: 'POST' }).then(r => r.json()),
  resetList: (listId) => fetch(`/api/lists/${listId}/reset`, { method: 'POST' }).then(r => r.json()),
  importItems: (listId, items) => fetch(`/api/lists/${listId}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }).then(r => r.json()),
  exportAll: () => fetch('/api/export').then(r => r.json()),
  importAll: (data) => fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  reorderItems: (listId, orderedIds) => fetch(`/api/lists/${listId}/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedIds }) }).then(r => r.json())
};

const state = {
  lists: [],
  activeListId: null,
  items: [],
  searchQuery: '',
  theme: localStorage.getItem('shoplist_theme') || 'dark'
};

document.documentElement.setAttribute('data-theme', state.theme);

// US units for the Unit dropdowns (add form + edit modal). '' = no unit.
const UNITS = {
  'Count': ['pcs', 'pack', 'box', 'bag', 'bottle', 'can', 'jar', 'carton', 'dozen', 'bunch', 'loaf'],
  'Weight': ['oz', 'lb'],
  'Liquid': ['fl oz', 'cup', 'pt', 'qt', 'gal']
};

function fillUnitSelect(select) {
  if (!select) return;
  select.innerHTML = '<option value="">—</option>' + Object.entries(UNITS).map(([group, units]) =>
    `<optgroup label="${group}">${units.map(u => `<option value="${u}">${u}</option>`).join('')}</optgroup>`
  ).join('');
}

// Select a unit, adding it as an option first if it isn't in UNITS
// (items saved before the dropdown existed may have e.g. "tubs").
function setUnitSelect(select, unit) {
  if (unit && ![...select.options].some(o => o.value === unit)) {
    select.add(new Option(unit, unit));
  }
  select.value = unit || '';
}

document.addEventListener('DOMContentLoaded', async () => {
  fillUnitSelect(document.getElementById('itemUnitInput'));
  fillUnitSelect(document.getElementById('editItemUnit'));
  initEventListeners();
  setupSSE();
  await loadLists();
});

function setupSSE() {
  const evtSource = new EventSource('/api/events');
  evtSource.addEventListener('ITEM_ADDED', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('ITEM_UPDATED', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('ITEM_DELETED', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('LIST_CLEARED', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('LIST_RESET', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('ITEMS_REORDERED', (e) => handleSSEUpdate(e));
  evtSource.addEventListener('LIST_CREATED', () => loadLists());
  evtSource.addEventListener('LIST_UPDATED', () => loadLists());
  evtSource.addEventListener('LIST_DELETED', () => loadLists());

  // Events sent while the phone slept or the VPN dropped are lost, so
  // re-fetch whenever the stream (re)connects or the tab comes back.
  evtSource.addEventListener('open', () => refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

function handleSSEUpdate(e) {
  const data = JSON.parse(e.data);
  if (data.listId === state.activeListId) refresh();
}

// Reload items + list counts. Debounced so an action on this device and
// the SSE echo of that same action cause one reload, not two.
let refreshTimer = null;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadItems(state.activeListId, false);
    loadLists(false);
  }, 150);
}

async function loadLists(switchActive = true) {
  const res = await API.getLists();
  if (res.success) {
    state.lists = res.data;
    renderListSelector();
    renderListManager();

    if (switchActive && state.lists.length > 0) {
      const savedListId = parseInt(localStorage.getItem('shoplist_active_list'));
      const targetList = state.lists.find(l => l.id === savedListId) || state.lists[0];
      setActiveList(targetList.id);
    }
  }
}

async function loadItems(listId, showLoading = true) {
  if (!listId) return;

  const res = await API.getItems(listId);
  if (res.success) {
    state.items = res.data;
    renderItems();
    updateProgress();
  }
}

function setActiveList(listId) {
  state.activeListId = listId;
  localStorage.setItem('shoplist_active_list', listId);

  const select = document.getElementById('activeListSelect');
  if (select) select.value = listId;

  loadItems(listId);
}

// Settings modal: one row per list with rename / delete
function renderListManager() {
  const container = document.getElementById('listManagerContainer');
  if (!container) return;

  container.innerHTML = `<div class="items-list">${state.lists.map(l => `
    <div class="item-card">
      <div class="item-title">${escapeHtml(l.name)}</div>
      <div class="item-actions">
        <button class="btn-edit" onclick="renameList(${l.id})" title="Rename">✎</button>
        <button class="btn-delete" onclick="deleteList(${l.id})" title="Delete">✕</button>
      </div>
    </div>
  `).join('')}</div>`;
}

async function renameList(listId) {
  const list = state.lists.find(l => l.id === listId);
  const name = prompt('Rename list', list?.name || '')?.trim();
  if (!name) return;

  await API.updateList(listId, { name });
  loadLists(false);
}

async function deleteList(listId) {
  if (state.lists.length <= 1) {
    alert('You need at least one list.');
    return;
  }
  const list = state.lists.find(l => l.id === listId);
  if (!confirm(`Delete "${list?.name}"?`)) return;

  // Server archives the list (rows stay in the DB) rather than deleting it.
  await API.deleteList(listId);
  loadLists(); // switches to another list if the active one was deleted
}

function renderListSelector() {
  const select = document.getElementById('activeListSelect');
  if (!select) return;

  select.innerHTML = state.lists.map(l => `
    <option value="${l.id}">${escapeHtml(l.name)} (${l.checked_items || 0}/${l.total_items || 0})</option>
  `).join('');

  if (state.activeListId) select.value = state.activeListId;
}

function renderItems() {
  const container = document.getElementById('itemsContainer');
  if (!container) return;

  // Search filters locally; state.items always holds the whole list.
  const query = state.searchQuery.toLowerCase();
  const visible = query
    ? state.items.filter(i => i.name.toLowerCase().includes(query))
    : state.items;

  if (visible.length === 0) {
    // Rendered here, not toggled on a static node: the innerHTML below
    // would destroy that node (the old #emptyState never reappeared).
    container.innerHTML = `<div class="empty-state">${query ? 'No matches' : 'List is empty'}</div>`;
    return;
  }

  // Reordering a filtered view would drop the hidden items' positions,
  // so drag-and-drop is only offered when not searching.
  const canDrag = !query;

  container.innerHTML = visible.map(item => {
    const isChecked = item.is_checked === 1;
    const priceText = item.estimated_price > 0 ? `$${(item.estimated_price * item.quantity).toFixed(2)}` : '';
    const metaParts = [];
    if (item.quantity > 1 || item.unit) metaParts.push(`Qty: ${item.quantity} ${escapeHtml(item.unit || '')}`);
    if (priceText) metaParts.push(`Est: ${priceText}`);

    return `
      <div class="item-card ${isChecked ? 'checked' : ''}" data-id="${item.id}" draggable="${canDrag}">
        ${canDrag ? '<div class="drag-handle" title="Drag to reorder">⠿</div>' : ''}
        <div class="item-left">
          <div class="custom-checkbox ${isChecked ? 'checked' : ''}" onclick="toggleCheck(${item.id}, ${!isChecked})">
            ${isChecked ? '✓' : ''}
          </div>
          <div>
            <div class="item-title" onclick="toggleCheck(${item.id}, ${!isChecked})">${escapeHtml(item.name)}</div>
            ${metaParts.length > 0 ? `<div class="item-meta">${metaParts.join(' • ')}</div>` : ''}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn-edit" onclick="openEditModal(${item.id})" title="Edit">✎</button>
          <button class="btn-delete" onclick="deleteItem(${item.id})" title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('');

  setupDragAndDrop();
}

function updateProgress() {
  const total = state.items.length;
  const checked = state.items.filter(i => i.is_checked === 1).length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;

  const progressSummary = document.getElementById('progressSummary');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');

  if (progressSummary) progressSummary.textContent = `${checked} OF ${total} ITEMS CHECKED`;
  if (progressPercent) progressPercent.textContent = `${percent}%`;
  if (progressBarFill) progressBarFill.style.width = `${percent}%`;
}

async function toggleCheck(itemId, isChecked) {
  const item = state.items.find(i => i.id === itemId);
  if (item) item.is_checked = isChecked ? 1 : 0;
  renderItems();
  updateProgress();

  await API.updateItem(itemId, { is_checked: isChecked });
  refresh();
}

async function deleteItem(itemId) {
  state.items = state.items.filter(i => i.id !== itemId);
  renderItems();
  updateProgress();

  await API.deleteItem(itemId);
  refresh();
}

function openEditModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;

  document.getElementById('editItemId').value = item.id;
  document.getElementById('editItemName').value = item.name;
  document.getElementById('editItemQty').value = item.quantity || 1;
  setUnitSelect(document.getElementById('editItemUnit'), item.unit);
  document.getElementById('editItemPrice').value = item.estimated_price || '';

  openModal('editItemModal');
  document.getElementById('editItemName').focus();
}

function initEventListeners() {
  // Theme Toggle
  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('shoplist_theme', state.theme);
  });

  document.getElementById('activeListSelect')?.addEventListener('change', (e) => {
    setActiveList(parseInt(e.target.value));
  });

  // Toggle Advanced Add Options
  document.getElementById('btnToggleAdvanced')?.addEventListener('click', () => {
    const adv = document.getElementById('advancedOptions');
    if (!adv) return;
    const isHidden = adv.style.display === 'none';
    adv.style.display = isHidden ? 'flex' : 'none';
    document.getElementById('btnToggleAdvanced').textContent = isHidden ? '- Advanced' : '+ Advanced';
  });

  // Single & Advanced Add Form
  document.getElementById('addForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('itemNameInput');
    const name = input.value.trim();
    if (!name || !state.activeListId) return;

    const qty = parseFloat(document.getElementById('itemQtyInput')?.value) || 1;
    const unit = document.getElementById('itemUnitInput')?.value?.trim() || '';
    const price = parseFloat(document.getElementById('itemPriceInput')?.value) || 0;

    input.value = '';
    if (document.getElementById('itemPriceInput')) document.getElementById('itemPriceInput').value = '';

    await API.addItem(state.activeListId, { name, quantity: qty, unit, estimated_price: price });
    refresh();
  });

  // Search
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderItems();
  });

  // Actions
  document.getElementById('btnClearCompleted')?.addEventListener('click', async () => {
    const listId = state.activeListId;
    if (!listId) return;
    const cleared = state.items.filter(i => i.is_checked === 1);
    if (!cleared.length) return;

    await API.clearCompleted(listId);
    refresh();

    // The server deletes the rows, so undo re-adds this copy through the
    // import endpoint (same name/qty/unit/price/notes; new ids).
    showUndo(`Cleared ${cleared.length} item(s)`, async () => {
      await API.importItems(listId, cleared);
      refresh();
    });
  });

  document.getElementById('btnResetChecked')?.addEventListener('click', async () => {
    if (!state.activeListId) return;
    await API.resetList(state.activeListId);
    refresh();
  });

  // Edit Item Modal
  document.getElementById('btnCloseEditModal')?.addEventListener('click', () => closeModal('editItemModal'));
  document.getElementById('btnCancelEditModal')?.addEventListener('click', () => closeModal('editItemModal'));
  document.getElementById('editItemModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'editItemModal') closeModal('editItemModal');
  });

  document.getElementById('editItemForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('editItemId').value);
    const name = document.getElementById('editItemName').value.trim();
    const quantity = parseFloat(document.getElementById('editItemQty').value) || 1;
    const unit = document.getElementById('editItemUnit').value.trim();
    const estimated_price = parseFloat(document.getElementById('editItemPrice').value) || 0;

    if (!name) return;

    closeModal('editItemModal');
    await API.updateItem(id, { name, quantity, unit, estimated_price });
    refresh();
  });

  // Modals
  document.getElementById('btnNewList')?.addEventListener('click', () => openModal('listModal'));
  document.getElementById('btnOpenMenu')?.addEventListener('click', () => openModal('menuModal'));
  document.getElementById('btnCreateListFromMenu')?.addEventListener('click', () => {
    closeModal('menuModal');
    openModal('listModal');
  });

  document.getElementById('listForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('listNameInput').value.trim();
    if (!name) return;

    closeModal('listModal');
    const res = await API.createList({ name });
    if (res.success) {
      await loadLists(false);
      setActiveList(res.data.id);
    }
  });

  document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.classList.contains('modal-close')) {
        const backdrop = el.closest('.modal-backdrop');
        if (backdrop) backdrop.style.display = 'none';
      }
    });
  });

  const updateExportContent = async () => {
    const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'current';
    if (scope === 'all') {
      const res = await API.exportAll();
      if (res.success) {
        document.getElementById('exportPreview').value = JSON.stringify(res.data, null, 2);
      }
    } else {
      let text = `SHOPLIST\n---------------------\n`;
      state.items.forEach(i => {
        text += `${i.is_checked ? '[x]' : '[ ]'} ${i.name}${i.quantity > 1 ? ` (${i.quantity})` : ''}\n`;
      });
      document.getElementById('exportPreview').value = text;
    }
  };

  document.querySelectorAll('input[name="exportScope"]').forEach(r => {
    r.addEventListener('change', updateExportContent);
  });

  document.getElementById('btnExportList')?.addEventListener('click', () => {
    updateExportContent();

    // Reset to Export tab by default
    document.getElementById('tabExportBtn')?.classList.add('active');
    document.getElementById('tabImportBtn')?.classList.remove('active');
    document.getElementById('exportTabContent').style.display = 'block';
    document.getElementById('importTabContent').style.display = 'none';

    openModal('exportModal');
  });

  // Tab Switching
  const tabExportBtn = document.getElementById('tabExportBtn');
  const tabImportBtn = document.getElementById('tabImportBtn');
  const exportTabContent = document.getElementById('exportTabContent');
  const importTabContent = document.getElementById('importTabContent');

  tabExportBtn?.addEventListener('click', () => {
    tabExportBtn.classList.add('active');
    tabImportBtn.classList.remove('active');
    exportTabContent.style.display = 'block';
    importTabContent.style.display = 'none';
  });

  tabImportBtn?.addEventListener('click', () => {
    tabImportBtn.classList.add('active');
    tabExportBtn.classList.remove('active');
    importTabContent.style.display = 'block';
    exportTabContent.style.display = 'none';
  });

  document.getElementById('btnCopyFormatted')?.addEventListener('click', () => {
    const text = document.getElementById('exportPreview').value;
    navigator.clipboard.writeText(text);
    alert('List copied');
  });

  document.getElementById('btnDownloadJSON')?.addEventListener('click', async () => {
    const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'current';
    let dataToDownload;
    let filename;

    if (scope === 'all') {
      const res = await API.exportAll();
      dataToDownload = res.success ? res.data : { lists: [] };
      filename = `shoplist-full-backup.json`;
    } else {
      dataToDownload = state.items;
      filename = `shoplist-backup-${state.activeListId}.json`;
    }

    const json = JSON.stringify(dataToDownload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  });

  // Submit Import
  document.getElementById('btnSubmitImport')?.addEventListener('click', async () => {
    const rawInput = document.getElementById('importInput')?.value?.trim();
    if (!rawInput || !state.activeListId) return;

    // 1. Try parsing JSON
    try {
      const parsed = JSON.parse(rawInput);

      // Case A: Full multi-list backup ({ lists: [ ... ] })
      if (parsed && Array.isArray(parsed.lists)) {
        const res = await API.importAll(parsed);
        if (res.success) {
          alert(`Full backup restored! Created ${res.listsCreated} lists with ${res.itemsImported} items.`);
          document.getElementById('importInput').value = '';
          closeModal('exportModal');
          await loadLists(true);
          return;
        }
      }

      // Case B: Array of items for current list
      if (Array.isArray(parsed)) {
        const res = await API.importItems(state.activeListId, parsed);
        if (res.success) {
          alert(`Successfully imported ${res.count || res.itemsImported} items!`);
          document.getElementById('importInput').value = '';
          closeModal('exportModal');
          refresh();
          return;
        }
      }
    } catch (e) {
      // 2. Parse plain text line by line into current list
      const lines = rawInput.split('\n');
      const itemsToImport = [];
      lines.forEach(line => {
        let clean = line.trim();
        if (!clean) return;

        let isChecked = false;
        if (clean.startsWith('[x]') || clean.startsWith('[X]') || clean.startsWith('✓')) {
          isChecked = true;
          clean = clean.replace(/^(\[x\]|\[X\]|✓)\s*/, '');
        } else if (clean.startsWith('[ ]') || clean.startsWith('- ')) {
          clean = clean.replace(/^(\[ \]|-\s*)\s*/, '');
        }

        if (clean) {
          itemsToImport.push({ name: clean, quantity: 1, is_checked: isChecked });
        }
      });

      if (itemsToImport.length > 0) {
        const res = await API.importItems(state.activeListId, itemsToImport);
        if (res.success) {
          alert(`Successfully imported ${res.count || res.itemsImported} items!`);
          document.getElementById('importInput').value = '';
          closeModal('exportModal');
          refresh();
          return;
        }
      }
    }

    alert('Import failed. Please check the backup data format.');
  });
}

// Bottom bar with an Undo button that disappears after 6 seconds.
let undoTimer = null;
function showUndo(message, onUndo) {
  document.getElementById('undoText').textContent = message;
  document.getElementById('btnUndo').onclick = () => {
    hideUndo();
    onUndo();
  };
  document.getElementById('undoToast').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 6000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  document.getElementById('undoToast').hidden = true;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Drag-and-Drop Reordering ────────────────────────────────────────────────

function setupDragAndDrop() {
  const container = document.getElementById('itemsContainer');
  if (!container) return;

  let dragSrc = null;        // card being dragged (HTML5)
  let touchDragCard = null;  // card being dragged (touch)
  let touchClone = null;     // visual ghost for touch
  let touchOffsetX = 0;
  let touchOffsetY = 0;
  let saveTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getCards() {
    return [...container.querySelectorAll('.item-card[data-id]')];
  }

  function cardFromPoint(x, y) {
    // Temporarily hide clone so elementFromPoint works
    if (touchClone) touchClone.style.display = 'none';
    const el = document.elementFromPoint(x, y)?.closest('.item-card[data-id]');
    if (touchClone) touchClone.style.display = '';
    return el;
  }

  function insertAfter(ref, node) {
    if (ref.nextSibling) ref.parentNode.insertBefore(node, ref.nextSibling);
    else ref.parentNode.appendChild(node);
  }

  function saveOrder() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const orderedIds = getCards().map(c => parseInt(c.dataset.id));
      // Reflect new order in state (no re-render, avoids resetting DOM)
      const byId = Object.fromEntries(state.items.map(i => [i.id, i]));
      state.items = orderedIds.map(id => byId[id]).filter(Boolean);
      API.reorderItems(state.activeListId, orderedIds);
    }, 300);
  }

  // ── HTML5 Drag API (desktop) ───────────────────────────────────────────────

  getCards().forEach(card => {
    card.addEventListener('dragstart', e => {
      dragSrc = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });

    card.addEventListener('dragend', () => {
      dragSrc?.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      dragSrc = null;
      saveOrder();
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragSrc || card === dragSrc) return;

      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');

      if (e.clientY < midY) {
        container.insertBefore(dragSrc, card);
      } else {
        insertAfter(card, dragSrc);
      }
    });
  });

  // ── Touch / Pointer API (mobile) ───────────────────────────────────────────

  getCards().forEach(card => {
    const handle = card.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchDragCard = card;

      const rect = card.getBoundingClientRect();
      touchOffsetX = touch.clientX - rect.left;
      touchOffsetY = touch.clientY - rect.top;

      // Create floating ghost
      touchClone = card.cloneNode(true);
      touchClone.classList.add('drag-ghost');
      touchClone.style.cssText = `
        position: fixed;
        z-index: 9999;
        width: ${rect.width}px;
        left: ${rect.left}px;
        top: ${rect.top}px;
        pointer-events: none;
        opacity: 0.85;
      `;
      document.body.appendChild(touchClone);
      card.classList.add('dragging');
      e.preventDefault();
    }, { passive: false });

    handle.addEventListener('touchmove', e => {
      if (!touchDragCard || e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];

      // Move ghost
      touchClone.style.left = `${touch.clientX - touchOffsetX}px`;
      touchClone.style.top  = `${touch.clientY - touchOffsetY}px`;

      // Find target card
      const target = cardFromPoint(touch.clientX, touch.clientY);
      if (!target || target === touchDragCard) return;

      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      target.classList.add('drag-over');

      if (touch.clientY < midY) {
        container.insertBefore(touchDragCard, target);
      } else {
        insertAfter(target, touchDragCard);
      }
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      if (!touchDragCard) return;
      touchClone?.remove();
      touchClone = null;
      touchDragCard.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      touchDragCard = null;
      saveOrder();
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

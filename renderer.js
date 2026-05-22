const { ipcRenderer } = require('electron');
const path = require('path');

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  left:  { path: '', items: [], selected: new Set(), cursor: 0 },
  right: { path: '', items: [], selected: new Set(), cursor: 0 },
  active: 'left'
};

const panels = { left: document.getElementById('panel-left'), right: document.getElementById('panel-right') };

// ── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  const drives = await ipcRenderer.invoke('list-drives');
  const home   = await ipcRenderer.invoke('home-dir');

  for (const side of ['left', 'right']) {
    const sel = panels[side].querySelector('.drive-select');
    drives.forEach(d => { const o = document.createElement('option'); o.value = o.textContent = d; sel.appendChild(o); });
    const startPath = side === 'left' ? home : (drives[0] || home);
    await navigate(side, startPath);
  }
  focusPanel('left');
}

// ── Navigation ────────────────────────────────────────────────────────────────
async function navigate(side, dirPath) {
  const res = await ipcRenderer.invoke('list-dir', dirPath);
  if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }

  const s = state[side];
  s.path = dirPath;
  s.items = res.items;
  s.selected.clear();
  s.cursor = 0;

  panels[side].querySelector('.panel-path').textContent = dirPath;

  // Sync drive selector
  const driveRoot = path.parse(dirPath).root;
  const sel = panels[side].querySelector('.drive-select');
  for (const opt of sel.options) { if (opt.value.toLowerCase() === driveRoot.toLowerCase()) { sel.value = opt.value; break; } }

  renderPanel(side);
  updateStatus(side);
}

function renderPanel(side) {
  const s = state[side];
  const tbody = panels[side].querySelector('.file-list');
  tbody.innerHTML = '';

  // Parent ".." row
  if (path.parse(s.path).root !== s.path) {
    const tr = makeRow('..', null, side, -1);
    tbody.appendChild(tr);
  }

  s.items.forEach((item, idx) => {
    tbody.appendChild(makeRow(item.name, item, side, idx));
  });

  highlightCursor(side);
}

function makeRow(name, item, side, idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  if (item) {
    tr.dataset.name = item.name;
    tr.dataset.isdir = item.isDir ? '1' : '0';
  } else {
    tr.dataset.parent = '1';
  }

  const tdName = document.createElement('td');
  tdName.className = 'col-name';
  tdName.textContent = (item?.isDir ? '📁 ' : '   ') + name;

  const tdSize = document.createElement('td');
  tdSize.className = 'col-size';
  tdSize.textContent = item ? (item.isDir ? '<DIR>' : fmtSize(item.size)) : '';

  const tdDate = document.createElement('td');
  tdDate.className = 'col-date';
  tdDate.textContent = item?.mtime ? fmtDate(item.mtime) : '';

  tr.appendChild(tdName); tr.appendChild(tdSize); tr.appendChild(tdDate);

  tr.addEventListener('click', (e) => onRowClick(e, side, idx));
  tr.addEventListener('dblclick', () => onRowDblClick(side, idx));

  return tr;
}

function highlightCursor(side) {
  const s = state[side];
  const tbody = panels[side].querySelector('.file-list');
  const rows = tbody.querySelectorAll('tr');
  rows.forEach(r => {
    const idx = parseInt(r.dataset.idx);
    r.classList.toggle('cursor', idx === s.cursor);
    r.classList.toggle('selected', s.selected.has(idx));
    r.classList.toggle('panel-active', side === state.active);
  });
  // Scroll into view
  const curRow = tbody.querySelector(`tr[data-idx="${s.cursor}"]`);
  if (curRow) curRow.scrollIntoView({ block: 'nearest' });
}

// ── Row Events ────────────────────────────────────────────────────────────────
function onRowClick(e, side, idx) {
  focusPanel(side);
  const s = state[side];
  if (e.ctrlKey) {
    s.selected.has(idx) ? s.selected.delete(idx) : s.selected.add(idx);
  } else if (e.shiftKey && s.cursor !== idx) {
    const lo = Math.min(s.cursor, idx), hi = Math.max(s.cursor, idx);
    for (let i = lo; i <= hi; i++) s.selected.add(i);
  } else {
    s.selected.clear();
  }
  s.cursor = idx;
  highlightCursor(side);
  updateStatus(side);
}

async function onRowDblClick(side, idx) {
  const s = state[side];
  if (idx === -1) { // ".."
    await navigate(side, path.dirname(s.path));
    return;
  }
  const item = s.items[idx];
  if (!item) return;
  if (item.isDir) {
    await navigate(side, path.join(s.path, item.name));
  } else {
    const res = await ipcRenderer.invoke('open-file', path.join(s.path, item.name));
    if (!res.ok) await ipcRenderer.invoke('show-error', res.error);
  }
}

function onDriveChange(sel) {
  const side = sel.closest('.panel').dataset.side;
  navigate(side, sel.value);
}

// ── Panel Focus ───────────────────────────────────────────────────────────────
function focusPanel(side) {
  state.active = side;
  panels.left.classList.toggle('active', side === 'left');
  panels.right.classList.toggle('active', side === 'right');
  highlightCursor('left');
  highlightCursor('right');
}

function otherSide(side) { return side === 'left' ? 'right' : 'left'; }

// ── Commands ──────────────────────────────────────────────────────────────────
function getSelectedPaths(side) {
  const s = state[side];
  const idxs = s.selected.size ? [...s.selected] : (s.cursor >= 0 ? [s.cursor] : []);
  return idxs.map(i => s.items[i]).filter(Boolean).map(item => path.join(s.path, item.name));
}

async function cmdCopy() {
  const src = state.active;
  const dst = otherSide(src);
  const paths = getSelectedPaths(src);
  if (!paths.length) return;
  for (const p of paths) {
    const res = await ipcRenderer.invoke('copy-item', p, state[dst].path);
    if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }
  }
  await navigate(dst, state[dst].path);
}

async function cmdMove() {
  const src = state.active;
  const dst = otherSide(src);
  const paths = getSelectedPaths(src);
  if (!paths.length) return;
  for (const p of paths) {
    const res = await ipcRenderer.invoke('move-item', p, state[dst].path);
    if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }
  }
  await navigate(src, state[src].path);
  await navigate(dst, state[dst].path);
}

async function cmdDelete() {
  const side = state.active;
  const paths = getSelectedPaths(side);
  if (!paths.length) return;
  const names = paths.map(p => path.basename(p)).join('\n');
  if (!confirm(`Delete ${paths.length} item(s)?\n\n${names}`)) return;
  for (const p of paths) {
    const res = await ipcRenderer.invoke('delete-item', p);
    if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }
  }
  await navigate(side, state[side].path);
}

async function cmdRename() {
  const side = state.active;
  const s = state[side];
  if (s.cursor < 0 || !s.items[s.cursor]) return;
  const item = s.items[s.cursor];
  const newName = await showModal('Rename', item.name);
  if (!newName || newName === item.name) return;
  const res = await ipcRenderer.invoke('rename-item', path.join(s.path, item.name), newName);
  if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }
  await navigate(side, s.path);
}

async function cmdMkdir() {
  const side = state.active;
  const name = await showModal('New Folder', 'NewFolder');
  if (!name) return;
  const res = await ipcRenderer.invoke('mkdir', state[side].path, name);
  if (!res.ok) { await ipcRenderer.invoke('show-error', res.error); return; }
  await navigate(side, state[side].path);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal(title, value) {
  return new Promise(resolve => {
    document.getElementById('modal-title').textContent = title;
    const input = document.getElementById('modal-input');
    input.value = value;
    document.getElementById('modal-overlay').classList.remove('hidden');
    input.focus();
    input.select();

    const finish = (result) => {
      document.getElementById('modal-overlay').classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(input.value.trim()); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    };
    document.getElementById('modal-ok').onclick     = () => finish(input.value.trim());
    document.getElementById('modal-cancel').onclick = () => finish(null);
    document.addEventListener('keydown', onKey);
  });
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', async (e) => {
  if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;

  const side = state.active;
  const s = state[side];
  const tbody = panels[side].querySelector('.file-list');
  const rowCount = tbody.querySelectorAll('tr').length;

  switch (e.key) {
    case 'Tab':
      e.preventDefault();
      focusPanel(otherSide(side));
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveCursor(side, -1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveCursor(side, 1);
      break;
    case 'PageUp':
      e.preventDefault();
      moveCursor(side, -15);
      break;
    case 'PageDown':
      e.preventDefault();
      moveCursor(side, 15);
      break;
    case 'Enter': {
      e.preventDefault();
      const rows = tbody.querySelectorAll('tr');
      for (const r of rows) {
        if (parseInt(r.dataset.idx) === s.cursor) {
          if (r.dataset.parent) await navigate(side, path.dirname(s.path));
          else if (r.dataset.isdir === '1') await navigate(side, path.join(s.path, r.dataset.name));
          else {
            const res = await ipcRenderer.invoke('open-file', path.join(s.path, r.dataset.name));
            if (!res.ok) await ipcRenderer.invoke('show-error', res.error);
          }
          break;
        }
      }
      break;
    }
    case 'Backspace':
      e.preventDefault();
      if (path.parse(s.path).root !== s.path) await navigate(side, path.dirname(s.path));
      break;
    case ' ':
      e.preventDefault();
      if (s.cursor >= 0) {
        s.selected.has(s.cursor) ? s.selected.delete(s.cursor) : s.selected.add(s.cursor);
        moveCursor(side, 1);
      }
      break;
    case 'F2':
      e.preventDefault(); cmdRename(); break;
    case 'F5':
      e.preventDefault(); cmdCopy(); break;
    case 'F6':
      e.preventDefault(); cmdMove(); break;
    case 'F7':
      e.preventDefault(); cmdMkdir(); break;
    case 'F8':
      e.preventDefault(); cmdDelete(); break;
  }
});

function moveCursor(side, delta) {
  const s = state[side];
  const tbody = panels[side].querySelector('.file-list');
  const rowCount = tbody.querySelectorAll('tr').length;
  const hasDotDot = path.parse(s.path).root !== s.path;
  const minIdx = hasDotDot ? -1 : 0;
  const maxIdx = s.items.length - 1;

  let next;
  if (s.cursor === -1) next = delta > 0 ? Math.min(delta - 1, maxIdx) : -1;
  else next = Math.max(minIdx, Math.min(maxIdx, s.cursor + delta));

  s.cursor = next;
  highlightCursor(side);
  updateStatus(side);
}

// ── Status Bar ────────────────────────────────────────────────────────────────
function updateStatus(side) {
  const s = state[side];
  const total = s.items.length;
  const sel = s.selected.size;
  const el = document.getElementById(`status-${side}`);
  el.textContent = `[${side.toUpperCase()}] ${s.path}   |   ${total} items${sel ? `   ${sel} selected` : ''}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();

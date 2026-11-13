// Leaderboard webview. Filtering and sorting mirror src/leaderboardModel.ts (the unit-tested reference).
(function () {
  const vscode = acquireVsCodeApi();
  const PAGE = 300;
  const GLYPH = { class: 'C', function: 'ƒ', method: 'm', object: '◆' };

  const saved = vscode.getState() || {};
  const state = {
    groups: new Set(saved.groups || []),
    query: saved.query || '',
    direction: saved.direction === 'asc' ? 'asc' : 'desc',
    limit: PAGE,
  };
  let entries = [];
  let scanning = false;
  let summary = null;
  let progress = { done: 0, total: 0 };

  const $ = (id) => document.getElementById(id);
  const search = $('search');
  const list = $('list');
  const status = $('status');
  const chips = [...document.querySelectorAll('.chip')];

  const persist = () =>
    vscode.setState({ groups: [...state.groups], query: state.query, direction: state.direction });

  const displayName = (e) => (e.container ? e.container + '.' + e.name : e.name);

  function filterAndSort() {
    const q = state.query.trim().toLowerCase();
    const sign = state.direction === 'asc' ? -1 : 1;
    const rows = entries.filter(
      (e) =>
        (state.groups.size === 0 || state.groups.has(e.group)) &&
        (!q || displayName(e).toLowerCase().includes(q) || e.file.toLowerCase().includes(q)),
    );
    rows.sort(
      (a, b) =>
        sign * (b.project - a.project) ||
        sign * (b.inFile - a.inFile) ||
        displayName(a).localeCompare(displayName(b)) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );
    let prev = null;
    return rows.map((e, i) => {
      const rank = prev && prev.project === e.project && prev.inFile === e.inFile ? prev.rank : i + 1;
      prev = { project: e.project, inFile: e.inFile, rank };
      return { e, rank };
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function highlight(parent, text) {
    const q = state.query.trim().toLowerCase();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) {
      parent.append(text);
      return;
    }
    parent.append(text.slice(0, i), el('mark', '', text.slice(i, i + q.length)), text.slice(i + q.length));
  }

  function countButton(e, scope) {
    const n = scope === 'file' ? e.inFile : e.project;
    const b = el('button', 'num count' + (n === 0 ? ' zero' : ''), String(n));
    b.title = `Show ${scope === 'file' ? 'in-file' : 'project'} usages of ${displayName(e)}`;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      vscode.postMessage({ type: 'usages', id: e.id, scope });
    });
    return b;
  }

  function render() {
    chips.forEach((c) => {
      const g = c.dataset.group;
      c.setAttribute('aria-pressed', String(g ? state.groups.has(g) : state.groups.size === 0));
    });
    $('direction').textContent = state.direction === 'desc' ? '↓ Most used' : '↑ Least used';
    $('scan').hidden = scanning;
    $('stop').hidden = !scanning;

    const rows = filterAndSort();
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const { e, rank } of rows.slice(0, state.limit)) {
      const li = el('li', 'item');
      li.tabIndex = 0;
      li.title = `${e.kind} ${displayName(e)} — ${e.file}:${e.line + 1}\nClick to open the definition`;
      const open = () => vscode.postMessage({ type: 'open', id: e.id });
      li.addEventListener('click', open);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
      const sym = el('span', 'sym');
      const glyph = el('span', 'glyph g-' + e.group, GLYPH[e.group] || '◆');
      glyph.title = e.kind;
      const name = el('span', 'name');
      highlight(name, displayName(e));
      const file = el('span', 'file');
      highlight(file, e.file);
      sym.append(glyph, name, file);
      li.append(el('span', 'rank', String(rank)), sym, countButton(e, 'file'), countButton(e, 'project'));
      frag.append(li);
    }
    list.append(frag);
    if (rows.length > state.limit) {
      const more = el('li', 'more');
      const b = el('button', 'link', `Show ${Math.min(PAGE, rows.length - state.limit)} more (${rows.length - state.limit} hidden)`);
      b.addEventListener('click', () => {
        state.limit += PAGE;
        render();
      });
      more.append(b);
      list.append(more);
    }
    renderStatus(rows.length);
  }

  function renderStatus(shown) {
    const parts = [];
    if (scanning) {
      parts.push(progress.total ? `Scanning ${progress.done}/${progress.total} files…` : 'Finding files…');
    } else if (summary) {
      parts.push(
        shown === entries.length
          ? `${entries.length} symbols in ${summary.files} files`
          : `${shown} of ${entries.length} symbols`,
      );
      if (summary.cancelled) parts.push('Scan stopped early.');
      if (summary.truncated) parts.push('File limit reached (usageLens.leaderboard.maxFiles).');
      if (summary.filesWithoutSymbols)
        parts.push(`${summary.filesWithoutSymbols} files had no symbols; the language server may still be loading.`);
      if (summary.failed) parts.push(`${summary.failed} counts failed.`);
    }
    status.textContent = parts.join(' ');
    if (!scanning && summary && entries.length === 0 && summary.files === 0) {
      status.textContent = 'No files matched usageLens.leaderboard.include (after exclusions).';
    }
  }

  // --- events -------------------------------------------------------------------------------
  search.value = state.query;
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = search.value;
      state.limit = PAGE;
      persist();
      render();
    }, 80);
  });
  chips.forEach((c) =>
    c.addEventListener('click', () => {
      const g = c.dataset.group;
      if (!g) state.groups.clear();
      else if (state.groups.has(g)) state.groups.delete(g);
      else state.groups.add(g);
      if (state.groups.size === 4) state.groups.clear();
      state.limit = PAGE;
      persist();
      render();
    }),
  );
  $('direction').addEventListener('click', () => {
    state.direction = state.direction === 'desc' ? 'asc' : 'desc';
    persist();
    render();
  });
  const rescan = () => vscode.postMessage({ type: 'scan' });
  $('scan').addEventListener('click', rescan);
  $('staleScan').addEventListener('click', rescan);
  $('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));

  let renderQueued = false;
  const queueRender = () => {
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        render();
      });
    }
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'reset':
        entries = [];
        summary = null;
        scanning = true;
        progress = { done: 0, total: 0 };
        $('stale').hidden = true;
        break;
      case 'entries':
        entries.push(...m.entries);
        break;
      case 'progress':
        progress = { done: m.done, total: m.total };
        break;
      case 'done':
        scanning = false;
        summary = m.summary;
        break;
      case 'stale':
        $('staleText').textContent = m.reason;
        $('stale').hidden = false;
        break;
    }
    queueRender();
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();

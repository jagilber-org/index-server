/* eslint-disable */
// Extracted instruction management from admin.html
(function(){
  'use strict';

  // Helper: safe global references (these live on page scope)
  const globals = window;
  const escapeHtml = window.adminUtils.escapeHtml;

  function sanitizeHtmlFragment(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll('script, iframe, object, embed, link, meta, style, form, input, button, textarea, select').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          return;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      });
    });
    return template.content;
  }

  function replaceWithSanitizedHtml(element, html) {
    element.replaceChildren(sanitizeHtmlFragment(html));
  }

  // Defensive defaults so first render has a valid page context even if loadInstructions
  // has not executed yet (prevents slice(NaN, NaN) -> empty list artifact).
  if (globals.instructionPage == null || Number.isNaN(globals.instructionPage)) globals.instructionPage = 1;
  if (globals.instructionPageSize == null || (globals.instructionPageSize !== 'All' && !Number.isFinite(globals.instructionPageSize))) globals.instructionPageSize = 25;

  // Usage snapshot cache (loaded once per loadInstructions call)
  let usageSnapshot = {};

  // Canonical copy-button label. The handle of a pending label reset lives on the
  // button itself (see flashCopyResult) rather than in one module-level slot, so a
  // rapid second click cannot capture the transient "✓ Copied" text as the label to
  // restore, and two simultaneously open preview panes cannot cancel each other's
  // reset.
  const COPY_BTN_LABEL = '📋 Copy';

  // Monotonically increasing id for detail-pane loads, and the instruction name
  // that `globals.instructionPreviewBody` currently holds. Together these keep a
  // late response from overwriting a newer selection and stop the copy action
  // from emitting a body that belongs to a different entry.
  let instructionPreviewRequestSeq = 0;
  let instructionPreviewBodyName = null;
  let instructionLoadInFlight = null;
  async function fetchUsageSnapshot() {
    try {
      const res = await adminAuth.adminFetch('/api/usage/snapshot');
      if (!res.ok) return {};
      const data = await res.json();
      return data.snapshot || {};
    } catch { return {}; }
  }

  function getSignalBadge(signal) {
    if (!signal) return '';
    const colors = { 'outdated': '#f2495c', 'not-relevant': '#ff9830', 'helpful': '#73bf69', 'applied': '#5794f2' };
    const color = colors[signal] || '#888';
    return '<span class="signal-badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;">' + escapeHtml(signal) + '</span>';
  }

  function wireInstructionListActions(listEl) {
    if (!listEl) return;
    listEl.querySelectorAll('[data-instruction-action]').forEach((button) => {
      if (button.__instructionActionBound) return;
      button.addEventListener('click', () => {
        const action = button.getAttribute('data-instruction-action');
        const instructionName = button.getAttribute('data-instruction-name') || '';
        if (action === 'edit') editInstruction(instructionName);
        if (action === 'edit-archived') editArchivedInstruction(instructionName);
        if (action === 'delete') deleteInstruction(instructionName);
        if (action === 'archive') promptArchiveInstruction(instructionName);
        if (action === 'preview') toggleFlatPreview(instructionName, button);
        if (action === 'restore') promptRestoreInstruction(instructionName);
        if (action === 'purge') promptPurgeArchivedInstruction(instructionName);
      });
      button.__instructionActionBound = true;
    });
  }

  async function loadInstructionCategories() {
    try {
      const res = await adminAuth.adminFetch('/api/instructions_categories');
      if(!res.ok) throw new Error('http '+res.status);
      const data = await res.json();
      let cats = data.categories || data.data?.categories || [];
      if(Array.isArray(cats) && cats.length && typeof cats[0] === 'string') {
        cats = cats.map(n=>({ name:n, count: undefined }));
      }
      if(!Array.isArray(cats)) cats = [];
      const select = document.getElementById('instruction-category-filter');
      if(select){
        const selected = select.value;
        select.innerHTML = '<option value="">All Categories</option>';
        cats.forEach(cat => {
          if(!cat || !cat.name) return;
          const option = document.createElement('option');
          option.value = cat.name;
          option.textContent = cat.count != null ? `${cat.name} (${cat.count})` : cat.name;
          select.appendChild(option);
        });
        if (selected && cats.some(cat => cat && cat.name === selected)) select.value = selected;
      }
      return cats.map(c=>c.name);
    } catch (e) {
      console.warn('Failed to load instruction categories:', e);
      return [];
    }
  }

  function getFilteredInstructions(list) {
    const nameFilter = (document.getElementById('instruction-filter').value || '');
    const isRegex = document.getElementById('instruction-regex-toggle')?.checked || false;
    const categoryFilter = (document.getElementById('instruction-category-filter')?.value || '');
    const sizeFilter = (document.getElementById('instruction-size-filter')?.value || '');
    const filterInput = document.getElementById('instruction-filter');
    let filtered;
    if (isRegex && nameFilter) {
      try {
        const re = new RegExp(nameFilter, 'i');
        filtered = list.filter(i => re.test(i.name || ''));
        if (filterInput) filterInput.style.borderColor = '';
      } catch (e) {
        filtered = [];
        if (filterInput) filterInput.style.borderColor = '#f2495c';
      }
    } else {
      if (filterInput) filterInput.style.borderColor = '';
      filtered = list.filter(i => (i.name||'').toLowerCase().includes(nameFilter.toLowerCase()));
    }
    if (categoryFilter) {
      filtered = filtered.filter(i => {
        if (i.category === categoryFilter) return true;
        if (Array.isArray(i.categories) && i.categories.includes(categoryFilter)) return true;
        return false;
      });
    }
    if (sizeFilter) filtered = filtered.filter(i => i.sizeCategory === sizeFilter);
    const sortSelect = document.getElementById('instruction-sort');
    const sortVal = sortSelect ? sortSelect.value : 'name-asc';
    const cmp = (a,b, key, dir='asc') => {
      if (a[key] === b[key]) return 0;
      return (a[key] < b[key] ? -1 : 1) * (dir === 'asc' ? 1 : -1);
    };
    switch(sortVal) {
      case 'name-desc': filtered.sort((a,b)=>cmp(a,b,'name','desc')); break;
      case 'size-asc': filtered.sort((a,b)=>cmp(a,b,'size','asc')); break;
      case 'size-desc': filtered.sort((a,b)=>cmp(a,b,'size','desc')); break;
      case 'mtime-asc': filtered.sort((a,b)=>cmp(a,b,'mtime','asc')); break;
      case 'mtime-desc': filtered.sort((a,b)=>cmp(a,b,'mtime','desc')); break;
      case 'category': filtered.sort((a,b)=>cmp(a,b,'category','asc') || cmp(a,b,'name','asc')); break;
      case 'usage-desc': filtered.sort((a,b)=> {
        const ua = (usageSnapshot[a.name]?.usageCount ?? 0);
        const ub = (usageSnapshot[b.name]?.usageCount ?? 0);
        return ub - ua || cmp(a,b,'name','asc');
      }); break;
      case 'signal': filtered.sort((a,b)=> {
        const sa = usageSnapshot[a.name]?.lastSignal || '';
        const sb = usageSnapshot[b.name]?.lastSignal || '';
        return sa.localeCompare(sb) || cmp(a,b,'name','asc');
      }); break;
      default:
        filtered.sort((a,b)=>cmp(a,b,'name','asc'));
    }
    return filtered;
  }

  function highlightMatch(text, filter, isRegex) {
    if (!filter || !text) return text;
    try {
      const re = isRegex ? new RegExp('(' + filter + ')', 'gi') : new RegExp('(' + filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return text.replace(re, '<mark class="search-highlight">$1</mark>');
    } catch { return text; }
  }

  function buildInstructionPaginationControls(totalFiltered) {
    const container = document.getElementById('instruction-pagination');
    if (!container) return;
    const total = totalFiltered;
    const pageSize = globals.instructionPageSize === 'All' ? total : globals.instructionPageSize;
    const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
    if (globals.instructionPage > totalPages) globals.instructionPage = totalPages;
    const disablePrev = globals.instructionPage <= 1;
    const disableNext = globals.instructionPage >= totalPages;
    const sizeOptions = [10,25,50,100,'All'].map(s => `<option value="${s}" ${s===globals.instructionPageSize? 'selected':''}>${s}</option>`).join('');
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <label style="display:flex; align-items:center; gap:4px;">Page Size:
          <select id="instruction-page-size" class="form-input" style="width:auto; padding:4px;">${sizeOptions}</select>
        </label>
        <div style="display:flex; align-items:center; gap:4px;">
          <button class="action-btn" onclick="changeInstructionPage('first')" ${disablePrev?'disabled':''}>⏮ First</button>
          <button class="action-btn" onclick="changeInstructionPage('prev')" ${disablePrev?'disabled':''}>◀ Prev</button>
          <span style="font-size:12px;">Page ${globals.instructionPage} / ${totalPages}</span>
          <button class="action-btn" onclick="changeInstructionPage('next')" ${disableNext?'disabled':''}>Next ▶</button>
          <button class="action-btn" onclick="changeInstructionPage('last')" ${disableNext?'disabled':''}>Last ⏭</button>
        </div>
        <span style="margin-left:auto; font-size:12px; opacity:0.8;">Filtered: ${total} total</span>
      </div>`;
    const sizeSelect = document.getElementById('instruction-page-size');
    if(sizeSelect) sizeSelect.onchange = () => {
      globals.instructionPageSize = sizeSelect.value === 'All' ? 'All' : parseInt(sizeSelect.value,10);
      globals.instructionPage = 1;
      renderCurrentInstructionView();
    };
  }

  function getCurrentInstructionList() {
    return globals.instructionView === 'archived'
      ? (globals.allArchivedInstructions || [])
      : (globals.allInstructions || []);
  }

  function renderCurrentInstructionView() {
    if (globals.instructionView === 'archived') {
      renderArchivedList(globals.allArchivedInstructions || []);
      return;
    }
    if (getInstructionViewMode() === 'tree') {
      renderInstructionTree(globals.allInstructions || []);
      return;
    }
    renderInstructionList(globals.allInstructions || []);
  }

  // ── #449: Tree view + master-detail markdown preview ────────────────────
  // Adds a category-grouped, collapsible tree with a master-detail preview pane
  // (rendered markdown by default, raw JSON toggle). The flat list remains
  // available via the view-mode toggle. View preferences persist in localStorage.
  const INSTR_VIEW_MODE_KEY = 'instr.viewMode';       // 'tree' | 'flat'  (default 'tree')
  const INSTR_EXPANDED_KEY = 'instr.expandedCats';    // JSON array of expanded category names
  const INSTR_PREVIEW_RAW_KEY = 'instr.previewRaw';   // legacy persisted pref — cleared on load

  // Detail pane render mode. Rendered markdown ("Preview") is always the default
  // when the panel opens; "Raw" is an in-session toggle only, so a previously
  // persisted raw preference can never make the panel open in JSON view.
  let instructionDetailRaw = false;
  function getInstructionDetailRaw() { return instructionDetailRaw; }
  function setInstructionDetailRaw(value) { instructionDetailRaw = !!value; }
  try { localStorage.removeItem(INSTR_PREVIEW_RAW_KEY); } catch { /* ignore */ }

  function getInstructionViewMode() {
    try { return localStorage.getItem(INSTR_VIEW_MODE_KEY) === 'flat' ? 'flat' : 'tree'; }
    catch { return 'tree'; }
  }
  function setInstructionViewMode(mode) {
    const m = mode === 'flat' ? 'flat' : 'tree';
    try { localStorage.setItem(INSTR_VIEW_MODE_KEY, m); } catch { /* ignore */ }
    syncViewModeButtons(m);
    renderCurrentInstructionView();
  }
  function syncViewModeButtons(mode) {
    const t = document.getElementById('instruction-mode-tree');
    const f = document.getElementById('instruction-mode-flat');
    if (t) t.classList.toggle('btn-active', mode === 'tree');
    if (f) f.classList.toggle('btn-active', mode === 'flat');
  }
  function getExpandedCategories() {
    try { const a = JSON.parse(localStorage.getItem(INSTR_EXPANDED_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); }
    catch { return new Set(); }
  }
  function setExpandedCategories(set) {
    try { localStorage.setItem(INSTR_EXPANDED_KEY, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
  }
  function instructionCategoryOf(instr) {
    return instr.primaryCategory || instr.category || (Array.isArray(instr.categories) && instr.categories[0]) || 'uncategorized';
  }

  // Pure: group instructions into sorted category buckets with counts. Exposed for tests.
  function buildInstructionTree(instructions) {
    const groups = new Map();
    (instructions || []).forEach((instr) => {
      const cat = instructionCategoryOf(instr);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(instr);
    });
    return Array.from(groups.entries())
      .map(([category, items]) => ({
        category,
        count: items.length,
        items: items.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  function renderInstructionTree(instructions) {
    const host = document.getElementById('instructions-list');
    if (!host) return;
    // #486: preserve the tree pane's scroll offset across re-renders (e.g. the
    // 30s background auto-refresh) so the view doesn't jump back to the top
    // while a user is browsing/reading further down the list.
    const prevTreeEl = document.getElementById('instruction-tree');
    const preservedTreeScroll = prevTreeEl ? prevTreeEl.scrollTop : 0;
    const filtered = getFilteredInstructions(instructions || []);
    if (filtered.length === 0) {
      host.innerHTML = '<div class="instr-md-empty">No instructions found</div>';
      buildInstructionPaginationControls(0);
      return;
    }
    const tree = buildInstructionTree(filtered);
    const expanded = getExpandedCategories();
    const nameFilter = (document.getElementById('instruction-filter')?.value || '').trim();
    const forceExpand = nameFilter.length > 0; // auto-expand so matches are visible when filtering

    const treeHtml = tree.map((group) => {
      const isOpen = forceExpand || expanded.has(group.category);
      const leaves = group.items.map((instr) => {
        const escapedName = escapeHtml(instr.name);
        const selected = globals.instructionPreviewSelected === instr.name ? ' selected' : '';
        return `<button type="button" class="instr-tree-leaf${selected}" data-tree-leaf="${escapedName}" title="${escapedName}">${escapedName}</button>`;
      }).join('');
      return `
        <div class="instr-tree-group${isOpen ? ' open' : ''}">
          <button type="button" class="instr-tree-toggle" data-tree-toggle="${escapeHtml(group.category)}" aria-expanded="${isOpen}">
            <span class="instr-tree-caret">${isOpen ? '▾' : '▸'}</span>
            <span class="instr-tree-cat">${escapeHtml(group.category)}</span>
            <span class="instr-tree-count">${group.count}</span>
          </button>
          <div class="instr-tree-leaves"${isOpen ? '' : ' hidden'}>${leaves}</div>
        </div>`;
    }).join('');

    host.innerHTML = `
      <div class="instr-master-detail">
        <div class="instr-tree" id="instruction-tree">${treeHtml}</div>
        <div class="instr-detail" id="instruction-detail">
          <div class="instr-detail-header">
            <span id="instruction-detail-title" class="instr-detail-title">Select an instruction</span>
            <div class="instr-detail-actions">
              <button type="button" id="instruction-detail-preview-btn" class="action-btn btn-green btn-active" data-detail-mode="preview">📖 Preview</button>
              <button type="button" id="instruction-detail-raw-btn" class="action-btn" data-detail-mode="raw">{} Raw</button>
              <button type="button" id="instruction-detail-copy-btn" class="action-btn" title="Copy instruction body to clipboard" data-detail-copy>📋 Copy</button>
              <button type="button" id="instruction-detail-edit-btn" class="action-btn btn-info" data-detail-edit>✏ Edit</button>
            </div>
          </div>
          <div id="instruction-detail-body" class="instr-detail-body instr-preview-content"><div class="instr-detail-hint">Pick an instruction from the tree to preview its content.</div></div>
        </div>
      </div>`;
    wireInstructionTree(host);
    buildInstructionPaginationControls(0); // tree view is not paginated
    if (globals.instructionPreviewSelected && filtered.some((i) => i.name === globals.instructionPreviewSelected)) {
      selectInstructionPreview(globals.instructionPreviewSelected);
    } else if (globals.instructionPreviewSelected) {
      // The selected entry is gone (deleted/filtered out) — drop the selection and
      // its cached body so Copy cannot still emit the removed instruction.
      globals.instructionPreviewSelected = null;
      globals.instructionPreviewBody = '';
      instructionPreviewBodyName = null;
    }
    const newTreeEl = document.getElementById('instruction-tree');
    if (newTreeEl && preservedTreeScroll) newTreeEl.scrollTop = preservedTreeScroll;
  }

  function wireInstructionTree(host) {
    host.querySelectorAll('[data-tree-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-tree-toggle');
        const expanded = getExpandedCategories();
        if (expanded.has(cat)) expanded.delete(cat); else expanded.add(cat);
        setExpandedCategories(expanded);
        renderCurrentInstructionView();
      });
    });
    host.querySelectorAll('[data-tree-leaf]').forEach((btn) => {
      btn.addEventListener('click', () => selectInstructionPreview(btn.getAttribute('data-tree-leaf')));
    });
    const previewBtn = host.querySelector('#instruction-detail-preview-btn');
    const rawBtn = host.querySelector('#instruction-detail-raw-btn');
    const copyBtn = host.querySelector('#instruction-detail-copy-btn');
    const editBtn = host.querySelector('#instruction-detail-edit-btn');
    if (previewBtn) previewBtn.addEventListener('click', () => { setInstructionDetailRaw(false); if (globals.instructionPreviewSelected) selectInstructionPreview(globals.instructionPreviewSelected); });
    if (rawBtn) rawBtn.addEventListener('click', () => { setInstructionDetailRaw(true); if (globals.instructionPreviewSelected) selectInstructionPreview(globals.instructionPreviewSelected); });
    if (copyBtn) copyBtn.addEventListener('click', () => { copySelectedInstructionBody(); });
    if (editBtn) editBtn.addEventListener('click', () => { if (globals.instructionPreviewSelected) editInstruction(globals.instructionPreviewSelected); });
  }

  // Clipboard write with a legacy execCommand fallback for non-secure contexts
  // where navigator.clipboard is unavailable.
  async function writeClipboardText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to legacy path */ }
    // The textarea is removed in `finally` so a throw from select()/execCommand
    // cannot leak a hidden node into the document.
    let ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      return document.execCommand('copy');
    } catch { return false; }
    finally { if (ta) ta.remove(); }
  }

  // Flash the copy outcome on `btn` and restore the canonical label afterwards.
  // The reset handle is stored on the button so each copy button owns its own
  // timer — cancelling one pane's reset can never strand another pane's label.
  function flashCopyResult(btn, ok) {
    if (!btn) return;
    if (btn.__copyResetTimer) clearTimeout(btn.__copyResetTimer);
    btn.textContent = ok ? '✓ Copied' : '✗ Copy failed';
    btn.__copyResetTimer = setTimeout(() => { btn.textContent = COPY_BTN_LABEL; btn.__copyResetTimer = null; }, 1500);
  }

  // Shared instruction-body fetch used by both the preview renderer and the copy
  // action so the response-unwrap shape lives in exactly one place.
  async function fetchInstructionBody(name) {
    const res = await adminAuth.adminFetch('/api/instructions/' + encodeURIComponent(name));
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const content = data.content || data.data?.content || {};
    return { content, body: String(content.body || '') };
  }

  // Copy the selected instruction's markdown body (not the JSON envelope) to the clipboard.
  async function copySelectedInstructionBody() {
    const name = globals.instructionPreviewSelected;
    const btn = document.getElementById('instruction-detail-copy-btn');
    if (!name) { globals.showError && globals.showError('Select an instruction first'); return; }
    // Only trust the cache when it demonstrably belongs to the selected entry —
    // otherwise a body cached for a previous selection could be copied silently.
    let body = instructionPreviewBodyName === name ? (globals.instructionPreviewBody || '') : '';
    let loadFailed = false;
    if (!body) {
      try {
        body = (await fetchInstructionBody(name)).body;
      } catch { loadFailed = true; }
    }
    if (loadFailed) { globals.showError && globals.showError('Failed to load instruction body'); return; }
    if (!body) { globals.showError && globals.showError('No instruction body to copy'); return; }
    const ok = await writeClipboardText(body);
    flashCopyResult(btn, ok);
    if (!ok) globals.showError && globals.showError('Clipboard copy failed');
  }

  function syncDetailModeButtons(raw) {
    const p = document.getElementById('instruction-detail-preview-btn');
    const r = document.getElementById('instruction-detail-raw-btn');
    if (p) p.classList.toggle('btn-active', !raw);
    if (r) r.classList.toggle('btn-active', raw);
  }

  // Load the selected instruction and render its body as sanitized markdown
  // (default) or raw JSON. Reuses the same sanitize pipeline as the editor preview.
  async function selectInstructionPreview(name) {
    if (!name) return;
    globals.instructionPreviewSelected = name;
    // Monotonic token: a response that resolves after a newer selection has been
    // made is discarded, so neither the cache nor the DOM can be overwritten by a
    // stale in-flight request.
    const token = ++instructionPreviewRequestSeq;
    document.querySelectorAll('.instr-tree-leaf').forEach((el) => el.classList.toggle('selected', el.getAttribute('data-tree-leaf') === name));
    const titleEl = document.getElementById('instruction-detail-title');
    const bodyEl = document.getElementById('instruction-detail-body');
    if (titleEl) titleEl.textContent = name;
    if (!bodyEl) return;
    const raw = getInstructionDetailRaw();
    syncDetailModeButtons(raw);
    bodyEl.innerHTML = '<div class="instr-detail-hint">Loading…</div>';
    try {
      const { content, body } = await fetchInstructionBody(name);
      if (token !== instructionPreviewRequestSeq) return;
      globals.instructionPreviewBody = body;
      instructionPreviewBodyName = name;
      if (raw) {
        const pre = document.createElement('pre');
        pre.className = 'instr-detail-raw';
        pre.textContent = JSON.stringify(content, null, 2);
        bodyEl.replaceChildren(pre);
      } else {
        if (typeof marked !== 'undefined' && marked.parse) {
          replaceWithSanitizedHtml(bodyEl, marked.parse(body, { breaks: false, gfm: true }));
        } else {
          const pre = document.createElement('pre');
          pre.className = 'instr-detail-raw';
          pre.textContent = body;
          bodyEl.replaceChildren(pre);
        }
      }
    } catch (e) {
      if (token !== instructionPreviewRequestSeq) return;
      globals.instructionPreviewBody = '';
      instructionPreviewBodyName = null;
      bodyEl.innerHTML = '<div class="error">Failed to load instruction preview</div>';
    }
  }

  // #552: copy the markdown body a flat-view preview pane is currently showing.
  // The body is the exact string that pane rendered, so the clipboard can never
  // disagree with what the operator is looking at.
  async function copyFlatPreviewBody(body, btn) {
    if (!body) { globals.showError && globals.showError('No instruction body to copy'); return; }
    const ok = await writeClipboardText(body);
    flashCopyResult(btn, ok);
    if (!ok) globals.showError && globals.showError('Clipboard copy failed');
  }

  async function toggleFlatPreview(name, button) {
    const itemEl = button.closest('.instruction-item');
    if (!itemEl) return;
    const existing = itemEl.querySelector('.flat-preview-pane');
    if (existing) { existing.remove(); button.textContent = '👁 Preview'; return; }
    button.textContent = '⏳ Loading…';
    try {
      const { body } = await fetchInstructionBody(name);
      const pane = document.createElement('div');
      pane.className = 'flat-preview-pane';

      // Header is built with DOM APIs (not innerHTML) so the instruction name can
      // be carried on the button without another escaping hop, and the click
      // handler is attached directly — no inline handler for CSP to reject.
      const header = document.createElement('div');
      header.className = 'flat-preview-header';
      const label = document.createElement('span');
      label.className = 'flat-preview-label';
      label.textContent = 'Body Preview (Markdown)';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'action-btn';
      copyBtn.title = 'Copy instruction body to clipboard';
      copyBtn.setAttribute('data-flat-copy', name);
      copyBtn.textContent = COPY_BTN_LABEL;
      copyBtn.addEventListener('click', () => { copyFlatPreviewBody(body, copyBtn); });
      header.appendChild(label);
      header.appendChild(copyBtn);

      const content = document.createElement('div');
      content.className = 'flat-preview-body instr-preview-content';
      if (!body) {
        content.innerHTML = '<div class="instr-md-empty">No body content</div>';
      } else if (typeof marked !== 'undefined' && marked.parse) {
        replaceWithSanitizedHtml(content, marked.parse(body, { breaks: false, gfm: true }));
      } else {
        const pre = document.createElement('pre');
        pre.className = 'instr-detail-raw';
        pre.textContent = body;
        content.appendChild(pre);
      }

      pane.appendChild(header);
      pane.appendChild(content);
      itemEl.appendChild(pane);
      button.textContent = '👁 Hide';
    } catch (e) {
      button.textContent = '👁 Preview';
      globals.showError && globals.showError('Failed to load preview: ' + (e.message || e));
    }
  }

  function changeInstructionPage(dir) {
    const totalFiltered = getFilteredInstructions(getCurrentInstructionList()).length;
    const pageSizeVal = globals.instructionPageSize === 'All' ? totalFiltered : globals.instructionPageSize;
    const totalPages = pageSizeVal === 0 ? 1 : Math.max(1, Math.ceil(totalFiltered / pageSizeVal));
    if (dir === 'first') globals.instructionPage = 1;
    else if (dir === 'prev' && globals.instructionPage > 1) globals.instructionPage--;
    else if (dir === 'next' && globals.instructionPage < totalPages) globals.instructionPage++;
    else if (dir === 'last') globals.instructionPage = totalPages;
    renderCurrentInstructionView();
  }

  function renderInstructionList(instructions) {
    const filtered = getFilteredInstructions(instructions || []);
    try { console.debug('[admin.instructions] renderInstructionList: filteredCount=', filtered.length, 'pageSize=', globals.instructionPageSize, 'page=', globals.instructionPage); } catch(e){}
    if (filtered.length === 0) {
      const el = document.getElementById('instructions-list'); if(el) el.innerHTML = '<p>No instructions found</p>';
      buildInstructionPaginationControls(0);
      try { console.debug('[admin.instructions] renderInstructionList: no items rendered'); } catch(e){}
      try { const dbg = document.getElementById('admin-debug'); if(dbg) dbg.textContent = JSON.stringify({ stage:'renderInstructionList', filtered:0, page: globals.instructionPage }, null, 2); } catch(e){}
      return;
    }
    const totalFiltered = filtered.length;
    let pageItems = filtered;
    if (globals.instructionPageSize !== 'All') {
      const totalPages = Math.max(1, Math.ceil(totalFiltered / globals.instructionPageSize));
      if (globals.instructionPage > totalPages) globals.instructionPage = totalPages;
      if (globals.instructionPage < 1) globals.instructionPage = 1;
      const start = (globals.instructionPage - 1) * globals.instructionPageSize;
      const end = start + globals.instructionPageSize;
      pageItems = filtered.slice(start, end);
    }
    const nameFilter = (document.getElementById('instruction-filter')?.value || '').trim();
    const isRegex = document.getElementById('instruction-regex-toggle')?.checked || false;
    const rows = pageItems.map(instr => {
      const rawSummary = (instr.semanticSummary || '').trim();
      let short = rawSummary.slice(0, 200);
      if (rawSummary.length > 200) short += '…';
      const safeSummary = escapeHtml(short);
      const safeCat = escapeHtml(instr.category || (Array.isArray(instr.categories) && instr.categories[0]) || '—');
      const escapedName = escapeHtml(instr.name);
      const highlightedName = nameFilter ? highlightMatch(escapedName, nameFilter, isRegex) : escapedName;
      const highlightedSummary = nameFilter ? highlightMatch(safeSummary, nameFilter, isRegex) : safeSummary;
      const usage = usageSnapshot[instr.name] || {};
      const usageCount = usage.usageCount ?? 0;
      const signal = usage.lastSignal || '';
      const comment = usage.lastComment || '';
      const signalHtml = signal ? getSignalBadge(signal) : '<span style="opacity:.4;font-size:10px;">none</span>';
      const commentTip = comment ? ' title="Last comment: ' + escapeHtml(comment.slice(0, 200)) + '"' : '';
      const safeSize = escapeHtml(String(instr.size ?? '0'));
      const safeSizeCategory = escapeHtml(String(instr.sizeCategory || 'unknown'));
      const safeModified = escapeHtml(new Date(instr.mtime).toLocaleString());
      return `
        <div class="instruction-item" data-instruction="${escapedName}">
          <div class="instruction-item-header">
            <div class="instruction-name">${highlightedName}</div>
            <div class="instruction-actions">
              <button class="action-btn btn-green" data-instruction-action="preview" data-instruction-name="${escapedName}">👁 Preview</button>
              <button class="action-btn" data-instruction-action="edit" data-instruction-name="${escapedName}">✏ Edit</button>
              <button class="action-btn btn-info" data-instruction-action="archive" data-instruction-name="${escapedName}">📦 Archive</button>
              <button class="action-btn danger" data-instruction-action="delete" data-instruction-name="${escapedName}">🗑 Delete</button>
            </div>
          </div>
          <div class="instruction-meta">
            <div class="meta-chip" title="Category"><span class="chip-label">CAT</span><span class="chip-value">${safeCat}</span></div>
            <div class="meta-chip" title="Size"><span class="chip-label">SIZE</span><span class="chip-value">${safeSize}</span><span class="chip-sub">(${safeSizeCategory})</span></div>
            <div class="meta-chip" title="Last Modified"><span class="chip-label">MTIME</span><span class="chip-value">${safeModified}</span></div>
            <div class="meta-chip" title="Usage Count"><span class="chip-label">USES</span><span class="chip-value">${usageCount}</span></div>
            <div class="meta-chip"${commentTip}><span class="chip-label">SIGNAL</span><span class="chip-value">${signalHtml}</span></div>
          </div>
          <div class="instruction-summary">${highlightedSummary || '<span class="summary-empty">No summary</span>'}</div>
        </div>`;
    }).join('');
    const listEl = document.getElementById('instructions-list'); if(listEl) { listEl.innerHTML = rows; wireInstructionListActions(listEl); }
    buildInstructionPaginationControls(totalFiltered);
    try { console.debug('[admin.instructions] renderInstructionList: rendered rows=', pageItems.length); } catch(e){}
    try { const dbg = document.getElementById('admin-debug'); if(dbg) dbg.textContent = JSON.stringify({ stage:'renderInstructionList', filtered: totalFiltered, rendered: pageItems.length, page: globals.instructionPage }, null, 2); } catch(e){}
  }

  function filterInstructions(){ globals.instructionPage = 1; renderCurrentInstructionView(); }

  function showCreateInstruction(){
    globals.instructionEditing = null;
    globals.instructionEditingArchived = false;
    const title = document.getElementById('instruction-editor-title'); if(title) title.textContent = 'New Instruction';
    const filename = document.getElementById('instruction-filename'); if(filename){ filename.value=''; filename.disabled=false; }
    const content = document.getElementById('instruction-content'); if(content) content.value = '';
    applyInstructionTemplate();
    globals.ensureInstructionEditorAtTop && globals.ensureInstructionEditorAtTop();
    const ed = document.getElementById('instruction-editor'); if(ed) ed.classList.remove('hidden');
    try { ed.scrollIntoView({ behavior:'smooth', block:'start' }); } catch {}
    const fn = document.getElementById('instruction-filename'); if(fn) fn.focus();
    globals.instructionOriginalContent = document.getElementById('instruction-content').value;
    updateInstructionEditorDiagnostics();
  }

  async function editInstruction(name){
    const editor = document.getElementById('instruction-editor');
    const filenameEl = document.getElementById('instruction-filename');
    const contentEl = document.getElementById('instruction-content');
    globals.instructionEditingArchived = false;
    let attempts = 0; const maxAttempts = 2; let lastError;
    while(attempts < maxAttempts){
      try{
        attempts++;
        if(contentEl && attempts===1) contentEl.value = '// Loading ' + name + '...';
        const res = await adminAuth.adminFetch('/api/instructions/' + encodeURIComponent(name));
        if(!res.ok) throw new Error('http ' + Number(res.status));
        const data = await res.json();
        if(data.success === false && !data.content && !data.data?.content) throw new Error('server reported failure');
        if(!data.content && data.data?.content) data.content = data.data.content;
        if(!data.content) throw new Error('missing content');
        globals.instructionEditing = name;
        const title = document.getElementById('instruction-editor-title'); if(title) title.textContent = 'Edit Instruction: ' + name;
        if(filenameEl){ filenameEl.value = name; filenameEl.disabled = true; }
        const pretty = JSON.stringify(data.content, null, 2);
        if(contentEl) contentEl.value = pretty;
        globals.ensureInstructionEditorAtTop && globals.ensureInstructionEditorAtTop();
        if(editor) editor.classList.remove('hidden');
        try { editor.scrollIntoView({ behavior:'smooth', block:'start' }); } catch {}
        globals.instructionOriginalContent = pretty;
        updateInstructionEditorDiagnostics();
        return;
      } catch(e){ lastError = e; if(attempts < maxAttempts) await new Promise(r=>setTimeout(r,120)); }
    }
    console.warn('editInstruction failed after retries', lastError);
    globals.showError && globals.showError('Failed to load instruction');
  }

  function cancelEditInstruction(){ const ed = document.getElementById('instruction-editor'); if(ed) ed.classList.add('hidden'); const diff = document.getElementById('instruction-diff-container'); if(diff) diff.classList.add('hidden'); const preview = document.getElementById('instruction-preview-container'); if(preview) preview.classList.add('hidden'); globals.instructionOriginalContent=''; globals.instructionPreviewVisible = false; globals.instructionEditingArchived = false; const btn = document.getElementById('instruction-preview-btn'); if(btn) btn.textContent = '📖 Preview'; }

  // Open the standard instruction editor against an archived row (#390).
  // Save routes to PUT /api/instructions_archived/:name via the
  // instructionEditingArchived flag (see saveInstruction).
  async function editArchivedInstruction(name){
    if(!name) return;
    const editor = document.getElementById('instruction-editor');
    const filenameEl = document.getElementById('instruction-filename');
    const contentEl = document.getElementById('instruction-content');
    try {
      if(contentEl) contentEl.value = '// Loading archived ' + name + '...';
      const res = await adminAuth.adminFetch('/api/instructions_archived/' + encodeURIComponent(name));
      if(!res.ok) throw new Error('http ' + Number(res.status));
      const data = await res.json();
      const entry = data.entry || data.data?.entry;
      if(!entry) throw new Error('missing archived entry');
      if(entry.restoreEligible === false){
        globals.showError && globals.showError('Cannot edit: archived entry is locked (restoreEligible=false).');
        if(contentEl) contentEl.value = '';
        return;
      }
      globals.instructionEditing = name;
      globals.instructionEditingArchived = true;
      const title = document.getElementById('instruction-editor-title'); if(title) title.textContent = 'Edit Archived Instruction: ' + name;
      if(filenameEl){ filenameEl.value = name; filenameEl.disabled = true; }
      const pretty = JSON.stringify(entry, null, 2);
      if(contentEl) contentEl.value = pretty;
      globals.ensureInstructionEditorAtTop && globals.ensureInstructionEditorAtTop();
      if(editor) editor.classList.remove('hidden');
      try { editor.scrollIntoView({ behavior:'smooth', block:'start' }); } catch {}
      globals.instructionOriginalContent = pretty;
      updateInstructionEditorDiagnostics();
    } catch(e){
      console.warn('editArchivedInstruction failed', e);
      globals.showError && globals.showError('Failed to load archived instruction');
    }
  }

  function safeParseInstruction(raw){ try { return JSON.parse(raw); } catch { return null; } }

  function updateInstructionEditorDiagnostics(){
    const ta = document.getElementById('instruction-content');
    const diag = document.getElementById('instruction-diagnostics');
    if(!ta||!diag) return;
    const raw = ta.value;
    if(!raw.trim()){ diag.textContent = 'Empty.'; return; }
    const parsed = safeParseInstruction(raw);
    if(!parsed){ diag.textContent = 'Invalid JSON'; }
    else {
      const size = raw.length;
      const cats = Array.isArray(parsed.categories)? parsed.categories.length : 0;
      const schemaVer = parsed.schemaVersion || parsed.schema || '?';
      const changed = globals.instructionOriginalContent && raw !== globals.instructionOriginalContent;
      diag.textContent = `Size: ${size} chars • Categories: ${cats} • Schema: ${schemaVer}`; // lgtm[js/xss-through-dom]
      if (changed) {
        const modified = document.createElement('span');
        modified.style.color = '#ff9830';
        modified.textContent = '(modified)';
        diag.append(' ');
        diag.appendChild(modified);
      }
    }
    if(globals.instructionDiffVisible) refreshInstructionDiff();
    if(globals.instructionPreviewVisible) refreshInstructionPreview();
  }

  function refreshInstructionDiff(){
    const diffWrap = document.getElementById('instruction-diff-container');
    const diffPre = document.getElementById('instruction-diff');
    const ta = document.getElementById('instruction-content');
    if(!diffWrap||!diffPre||!ta) return;
    if(!globals.instructionOriginalContent){ diffPre.textContent='(no baseline)'; return; }
    if(ta.value === globals.instructionOriginalContent){ diffPre.textContent='(no changes)'; return; }
    const before = globals.instructionOriginalContent.split(/\r?\n/);
    const after = ta.value.split(/\r?\n/);
    const max = Math.max(before.length, after.length);
    const out = [];
    for(let i=0;i<max;i++){ const a = before[i]; const b = after[i]; if(a === b){ if(a !== undefined) out.push('  ' + a); } else { if(a !== undefined) out.push('- ' + a); if(b !== undefined) out.push('+ ' + b); } }
    diffPre.textContent = out.join('\n');
  }

  function toggleInstructionDiff(){ globals.instructionDiffVisible = !globals.instructionDiffVisible; const wrap = document.getElementById('instruction-diff-container'); if(!wrap) return; if(globals.instructionDiffVisible){ wrap.classList.remove('hidden'); refreshInstructionDiff(); } else { wrap.classList.add('hidden'); } }

  function toggleInstructionPreview(){
    globals.instructionPreviewVisible = !globals.instructionPreviewVisible;
    const wrap = document.getElementById('instruction-preview-container');
    const btn = document.getElementById('instruction-preview-btn');
    if(!wrap) return;
    if(globals.instructionPreviewVisible){
      wrap.classList.remove('hidden');
      if(btn) btn.textContent = '📖 Hide Preview';
      refreshInstructionPreview();
    } else {
      wrap.classList.add('hidden');
      if(btn) btn.textContent = '📖 Preview';
    }
  }

  function refreshInstructionPreview(){
    const previewEl = document.getElementById('instruction-preview');
    const ta = document.getElementById('instruction-content');
    if(!previewEl || !ta) return;
    const raw = ta.value;
    const parsed = safeParseInstruction(raw);
    if(!parsed){ previewEl.textContent = 'Cannot preview: invalid JSON'; return; }
    const body = parsed.body || '';
    if(!body.trim()){ previewEl.textContent = 'No body content to preview'; return; }
    try {
      if(typeof marked !== 'undefined' && marked.parse){
        replaceWithSanitizedHtml(previewEl, marked.parse(body, { breaks: false, gfm: true }));
      } else {
        previewEl.textContent = body;
      }
    } catch(e){
      previewEl.textContent = body;
    }
  }

  async function saveInstruction(){
    const nameEl = document.getElementById('instruction-filename');
    const ta = document.getElementById('instruction-content');
    if(!nameEl||!ta) return;
    const raw = ta.value;
    const parsed = safeParseInstruction(raw);
    if(!parsed){ globals.showError && globals.showError('Cannot save: invalid JSON'); return; }
    if(parsed && parsed.schemaVersion && /^1(\.|$)/.test(String(parsed.schemaVersion))){ parsed.schemaVersion = '2'; }
    const body = { content: parsed };
    let url = '/api/instructions'; let method = 'POST';
    if(globals.instructionEditing){
      if(globals.instructionEditingArchived){
        url = '/api/instructions_archived/' + encodeURIComponent(globals.instructionEditing);
        method = 'PUT';
      } else {
        url += '/' + encodeURIComponent(globals.instructionEditing); method = 'PUT';
      }
    }
    else { body.name = nameEl.value.trim(); if(!body.name){ globals.showError && globals.showError('Provide file name'); return; } }
    try{
      const res = await adminAuth.adminFetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
      const data = await res.json();
      if(!res.ok || !data.success){ throw new Error(data.error || data.message || 'Save failed'); }
      const successMsg = globals.instructionEditingArchived
        ? 'Archived instruction updated'
        : (globals.instructionEditing ? 'Instruction updated' : 'Instruction created');
      globals.showSuccess && globals.showSuccess(successMsg);
      globals.instructionOriginalContent = JSON.stringify(parsed, null, 2);
      ta.value = globals.instructionOriginalContent;
      if(!globals.instructionEditing) globals.instructionEditing = body.name;
      updateInstructionEditorDiagnostics();
      if(globals.instructionEditingArchived){ loadArchivedInstructions(); } else { loadInstructions(); }
    } catch(e){ globals.showError && globals.showError(e.message || 'Save failed'); }
  }

  // #486: lightweight fingerprint used to detect whether the instruction list
  // actually changed between silent background refreshes, so we can skip a
  // needless full tree re-render (which reset scroll position / interrupted
  // in-progress interactions every 30s even when nothing had changed).
  function instructionsSnapshotKey(list) {
    try { return JSON.stringify((list || []).map((i) => [i.name, i.updatedAt || i.version || ''])); }
    catch { return String((list || []).length); }
  }

  async function loadInstructions(options = {}) {
    if (instructionLoadInFlight) return instructionLoadInFlight;
    const silent = !!options.silent;
    const preservePage = !!options.preservePage;
    const requestedPage = globals.instructionPage;
    if (globals.instructionView === 'archived') {
      return loadArchivedInstructions();
    }
    const run = (async () => {
      const listEl = document.getElementById('instructions-list'); if(listEl && !silent) listEl.innerHTML = 'Loading...';
      // create hidden debug sink so Playwright can read client diagnostics from DOM
      try {
        let dbg = document.getElementById('admin-debug');
        if(!dbg){ dbg = document.createElement('div'); dbg.id = 'admin-debug'; dbg.style.display='none'; dbg.style.whiteSpace='pre'; document.body.appendChild(dbg); }
      } catch(e){}
      try{
        try { console.debug('[admin.instructions] loadInstructions: start'); } catch(e){}
        const [catNames, snapData] = await Promise.all([loadInstructionCategories(), fetchUsageSnapshot()]);
        usageSnapshot = snapData;
        const res = await adminAuth.adminFetch('/api/instructions'); if(!res.ok) throw new Error('http '+res.status);
        const data = await res.json();
        if (!('success' in data) && !('data' in data) && !('instructions' in data)) throw new Error('unrecognized instructions payload');
        const rawList = data.instructions || data.data?.instructions || [];
        const nextInstructions = Array.isArray(rawList) ? rawList : [];
        // #486: on a silent background refresh (preservePage), skip the render
        // entirely when the fetched list is identical to what's already shown —
        // this is what previously caused the instructions tab tree/scroll
        // position to reset every ~30s even though nothing had changed.
        const unchanged = silent && preservePage
          && instructionsSnapshotKey(globals.allInstructions) === instructionsSnapshotKey(nextInstructions);
        globals.allInstructions = nextInstructions;
        try { console.log('[admin.instructions] fetched instructions:', globals.allInstructions.length); } catch {}
    try { console.debug('[admin.instructions] loadInstructions: sampleNames=', (globals.allInstructions||[]).slice(0,6).map(i=>i.name)); } catch(e){}
    try { const dbg = document.getElementById('admin-debug'); if(dbg) dbg.textContent = JSON.stringify({ stage:'loadInstructions', count: (globals.allInstructions||[]).length, sample: (globals.allInstructions||[]).slice(0,6).map(i=>i.name) }, null, 2); } catch(e){}
        if(!catNames.length){ try { const select = document.getElementById('instruction-category-filter'); if(select){ const selected = select.value; select.innerHTML = '<option value="">All Categories</option>'; const derived = Array.from(new Set(globals.allInstructions.flatMap(i=> [i.category, ...(Array.isArray(i.categories)? i.categories: [])]).filter(Boolean))).sort(); derived.forEach(n=>{ const opt = document.createElement('option'); opt.value = n; opt.textContent = n; select.appendChild(opt); }); if (selected && derived.includes(selected)) select.value = selected; } } catch(_){} }
        if (!unchanged) {
          globals.instructionPage = preservePage ? requestedPage : 1;
          renderCurrentInstructionView();
        }
      } catch(e){ console.warn('loadInstructions error', e); if(listEl && !silent) listEl.innerHTML = '<div class="error">Failed to load instructions</div>'; }
    })();
    instructionLoadInFlight = run.finally(() => { instructionLoadInFlight = null; });
    return instructionLoadInFlight;
  }

  function refreshInstructionsIfVisible() {
    const instructionSection = document.getElementById('instructions-section');
    const visibleByDom = !!instructionSection && !instructionSection.classList.contains('hidden');
    if (globals.currentSection !== 'instructions' && !visibleByDom) return;
    return loadInstructions({ silent: true, preservePage: true });
  }

  function formatInstructionJson(){ const ta = document.getElementById('instruction-content'); if(!ta) return; try{ const parsed = JSON.parse(ta.value); ta.value = JSON.stringify(parsed, null, 2); updateInstructionEditorDiagnostics(); } catch { globals.showError && globals.showError('Cannot format: invalid JSON'); } }

  function applyInstructionTemplate(){ const ta = document.getElementById('instruction-content'); if(!ta) return; if(ta.value.trim() && !confirm('Replace current content with template?')) return; const now = new Date().toISOString(); const template = { id:'sample-instruction', title:'Sample Instruction', body:'Detailed instruction content here.\nAdd multi-line guidance and steps.', contentType:'instruction', priority:50, audience:'all', requirement:'optional', categories:['general'], primaryCategory:'general', schemaVersion:'6', status:'draft', owner:'you@example.com', version:'1.0.0', reviewIntervalDays:180, semanticSummary:'Brief summary of what this instruction covers.', createdAt: now, updatedAt: now }; ta.value = JSON.stringify(template, null, 2); updateInstructionEditorDiagnostics(); }

  async function deleteInstruction(name) {
    if (!confirm('Delete instruction ' + name + '?')) return;
    try {
      const res = await adminAuth.adminFetch('/api/instructions/' + encodeURIComponent(name), { method:'DELETE' });
      const data = await res.json();
      if (data.success) { globals.showSuccess && globals.showSuccess('Deleted'); loadInstructions(); } else { globals.showError && globals.showError(data.error || 'Delete failed'); }
    } catch { globals.showError && globals.showError('Delete failed'); }
  }

  async function performGlobalInstructionSearch(query){
    const outEl = document.getElementById('instruction-global-results');
    if(!outEl) return;
    const trimmed = (query||'').trim();
    const isRegex = document.getElementById('instruction-global-regex-toggle')?.checked || false;
    if(!trimmed || trimmed.length < 2){ outEl.textContent = 'Enter 2+ chars for global search.'; return; }
    let re = null;
    if (isRegex) {
      try { re = new RegExp(trimmed, 'i'); } catch (e) { outEl.textContent = 'Invalid regex: ' + (e.message||e); return; }
    }
    const started = performance.now();
    outEl.textContent = 'Searching…';
    try {
      let results;
      if (re) {
        // Regex mode: fetch all instructions and filter client-side
        const res = await adminAuth.adminFetch('/api/instructions');
        const data = await res.json();
        if(!res.ok) throw new Error('http ' + res.status);
        const allInstrs = data.instructions || data.data?.instructions || [];
        // Load full content for each matching instruction
        const matched = [];
        for (const instr of allInstrs) {
          const nameMatch = re.test(instr.name || '');
          const catMatch = Array.isArray(instr.categories) && instr.categories.some(c => re.test(c));
          const summaryMatch = re.test(instr.semanticSummary || '');
          if (nameMatch || catMatch || summaryMatch) {
            matched.push({ name: instr.name, snippet: instr.semanticSummary || '', categories: instr.categories || [instr.category].filter(Boolean), score: nameMatch ? 1 : 0.5 });
          }
        }
        results = { results: matched, count: matched.length };
      } else {
        const res = await adminAuth.adminFetch('/api/instructions_search?q=' + encodeURIComponent(trimmed));
        results = await res.json();
        if(!res.ok || results.success === false){ throw new Error(results.error||'Search failed'); }
      }
      const elapsed = Math.round(performance.now() - started);
      if(!Array.isArray(results.results) || !results.results.length){
        outEl.textContent = `No global matches (${isRegex ? 'regex' : 'q'}='${trimmed}', ${elapsed}ms).`; // lgtm[js/xss-through-exception]
        return;
      }
      const rows = results.results.map(r=>{
        let safeName = escapeHtml(r.name || '');
        let safeSnippet = escapeHtml(r.snippet || '').replace(/\*\*(.+?)\*\*/g,'<mark>$1</mark>');
        safeName = highlightMatch(safeName, trimmed, isRegex);
        safeSnippet = highlightMatch(safeSnippet, trimmed, isRegex);
        const cats = Array.isArray(r.categories) && r.categories.length ? r.categories.slice(0,6).map(c => escapeHtml(c)).join(', ') : '—';
        return `<div class="instruction-global-result" style="background:#1f2228; border:1px solid #2c3038; border-radius:4px; padding:6px 8px; margin-bottom:6px;">
          <div style="font-weight:600; font-size:12px;">${safeName} <span style="opacity:.55; font-weight:400;">(${cats})</span></div>
          <div style="font-size:11px; white-space:normal;">${safeSnippet}</div>
        </div>`; }).join('');
      outEl.innerHTML = `<div style="margin-bottom:6px; font-weight:600;">Global Search Results (${Number(results.count) || 0})${isRegex ? ' <span style="color:#73bf69;">[regex]</span>' : ''} <span style="opacity:.55; font-weight:400;">${elapsed}ms</span></div>` + rows; // lgtm[js/xss-through-dom]
      try { outEl.scrollIntoView({ behavior:'smooth', block:'center' }); } catch { /* ignore */ }
    } catch(e){ outEl.textContent = 'Global search error: ' + (e.message||e); }
  }

  function attachGlobalSearchHandlers(){
    const btn = document.getElementById('instruction-global-search-btn');
    const input = document.getElementById('instruction-global-search');
    if(btn) btn.onclick = ()=> performGlobalInstructionSearch(input.value);
    if(input) input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ performGlobalInstructionSearch(input.value); }});
  }

  // fallback integration: if local filter returns zero but name filter has >=3 chars run global
  function maybeTriggerGlobalFallback(){
    try {
      const nameFilter = (document.getElementById('instruction-filter')?.value||'').trim();
      const list = globals.allInstructions || [];
      const filtered = getFilteredInstructions(list);
      if(filtered.length === 0 && nameFilter.length >= 3){
        performGlobalInstructionSearch(nameFilter);
      }
    } catch{/* ignore */
    }
  }

  // ── Archive view (spec 006-archive-lifecycle REQ-27) ──────────────────────
  if (globals.instructionView == null) globals.instructionView = 'active';

  function setInstructionView(view) {
    const next = view === 'archived' ? 'archived' : 'active';
    globals.instructionView = next;
    const activeBtn = document.getElementById('instruction-view-active');
    const archivedBtn = document.getElementById('instruction-view-archived');
    if (activeBtn) activeBtn.classList.toggle('btn-active', next === 'active');
    if (archivedBtn) archivedBtn.classList.toggle('btn-active', next === 'archived');
    globals.instructionPage = 1;
    loadInstructions();
  }

  function renderArchivedList(instructions) {
    const listEl = document.getElementById('instructions-list');
    if (!listEl) return;
    const filtered = getFilteredInstructions(instructions || []);
    if (filtered.length === 0) {
      listEl.innerHTML = '<p>No archived instructions found.</p>';
      buildInstructionPaginationControls(0);
      return;
    }
    const totalFiltered = filtered.length;
    let pageItems = filtered;
    if (globals.instructionPageSize !== 'All') {
      const start = (globals.instructionPage - 1) * globals.instructionPageSize;
      const end = start + globals.instructionPageSize;
      pageItems = filtered.slice(start, end);
    }
    const rows = pageItems.map((instr) => {
      const escapedName = escapeHtml(instr.name);
      const safeTitle = escapeHtml(instr.title || '');
      const safeReason = escapeHtml(instr.archiveReason || '—');
      const safeSource = escapeHtml(instr.archiveSource || '—');
      const safeArchivedAt = instr.archivedAt ? escapeHtml(new Date(instr.archivedAt).toLocaleString()) : '—';
      const safeArchivedBy = escapeHtml(instr.archivedBy || '—');
      const restoreEligible = instr.restoreEligible !== false;
      const lockedBadge = restoreEligible
        ? ''
        : '<span class="archive-badge locked" title="restoreEligible=false">LOCKED</span>';
      const cats = Array.isArray(instr.categories) ? instr.categories : [];
      const safeCat = escapeHtml(cats[0] || '—');
      return `
        <div class="instruction-item" data-instruction="${escapedName}">
          <div class="instruction-item-header">
            <div class="instruction-name">${lockedBadge}${escapedName} <span style="opacity:.6;font-weight:400;">${safeTitle}</span></div>
            <div class="instruction-actions">
              <button class="action-btn" data-instruction-action="edit-archived" data-instruction-name="${escapedName}" ${restoreEligible ? '' : 'disabled title="restoreEligible=false (locked)"'}>✏ Edit</button>
              <button class="action-btn" data-instruction-action="restore" data-instruction-name="${escapedName}" ${restoreEligible ? '' : 'disabled title="restoreEligible=false"'}>♻ Restore</button>
              <button class="action-btn danger" data-instruction-action="purge" data-instruction-name="${escapedName}">🗑 Purge</button>
            </div>
          </div>
          <div class="instruction-meta">
            <div class="meta-chip" title="Category"><span class="chip-label">CAT</span><span class="chip-value">${safeCat}</span></div>
            <div class="meta-chip" title="Archive reason"><span class="chip-label">REASON</span><span class="chip-value">${safeReason}</span></div>
            <div class="meta-chip" title="Archive source"><span class="chip-label">SOURCE</span><span class="chip-value">${safeSource}</span></div>
            <div class="meta-chip" title="Archived at"><span class="chip-label">AT</span><span class="chip-value">${safeArchivedAt}</span></div>
            <div class="meta-chip" title="Archived by"><span class="chip-label">BY</span><span class="chip-value">${safeArchivedBy}</span></div>
          </div>
        </div>`;
    }).join('');
    listEl.innerHTML = rows;
    wireInstructionListActions(listEl);
    buildInstructionPaginationControls(totalFiltered);
  }

  async function loadArchivedInstructions() {
    const listEl = document.getElementById('instructions-list');
    if (listEl) listEl.innerHTML = 'Loading archived...';
    try {
      const res = await adminAuth.adminFetch('/api/instructions_archived');
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const list = Array.isArray(data.instructions) ? data.instructions : [];
      globals.allArchivedInstructions = list;
      renderArchivedList(list);
    } catch (e) {
      console.warn('loadArchivedInstructions error', e);
      if (listEl) listEl.innerHTML = '<div class="error">Failed to load archived instructions</div>';
    }
  }

  const ARCHIVE_REASONS_CLIENT = ['deprecated', 'superseded', 'duplicate-merge', 'manual', 'legacy-scope'];

  function promptArchiveInstruction(name) {
    if (!name) return;
    const reason = window.prompt(
      'Archive "' + name + '"\n\nReason (one of: ' + ARCHIVE_REASONS_CLIENT.join(', ') + '):',
      'manual',
    );
    if (reason === null) return;
    const trimmedReason = String(reason).trim();
    if (!ARCHIVE_REASONS_CLIENT.includes(trimmedReason)) {
      globals.showError && globals.showError('Invalid archive reason. Allowed: ' + ARCHIVE_REASONS_CLIENT.join(', '));
      return;
    }
    const archivedBy = window.prompt('Archived by (optional identifier, leave blank to skip):', '') || '';
    const payload = { reason: trimmedReason };
    if (archivedBy.trim()) payload.archivedBy = archivedBy.trim();
    adminAuth.adminFetch('/api/instructions/' + encodeURIComponent(name) + '/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Archive failed');
      }
      globals.showSuccess && globals.showSuccess('Instruction archived');
      loadInstructions();
    }).catch((e) => {
      globals.showError && globals.showError(e.message || 'Archive failed');
    });
  }

  function promptRestoreInstruction(name) {
    if (!name) return;
    const overwrite = window.confirm(
      'Restore "' + name + '" to the active surface.\n\nClick OK to use overwrite mode (replace any active entry with the same id), or Cancel to use reject mode (fail on collision).',
    );
    const payload = { restoreMode: overwrite ? 'overwrite' : 'reject' };
    adminAuth.adminFetch('/api/instructions_archived/' + encodeURIComponent(name) + '/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Restore failed');
      }
      globals.showSuccess && globals.showSuccess('Instruction restored (' + payload.restoreMode + ')');
      loadInstructions();
    }).catch((e) => {
      globals.showError && globals.showError(e.message || 'Restore failed');
    });
  }

  function promptPurgeArchivedInstruction(name) {
    if (!name) return;
    const typed = window.prompt(
      'Hard-purge archived "' + name + '" — this is IRREVERSIBLE.\n\nType the id to confirm:',
      '',
    );
    if (typed === null) return;
    if (typed.trim() !== name) {
      globals.showError && globals.showError('Purge cancelled: id did not match.');
      return;
    }
    adminAuth.adminFetch('/api/instructions_archived/' + encodeURIComponent(name) + '?confirm=true', {
      method: 'DELETE',
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Purge failed');
      }
      globals.showSuccess && globals.showSuccess('Archived instruction purged');
      loadInstructions();
    }).catch((e) => {
      globals.showError && globals.showError(e.message || 'Purge failed');
    });
  }

  // Override legacy global renderer with new chip-based implementation.
  // The inline <script> block in admin.html (legacy) runs before deferred external scripts,
  // so its renderInstructionList is captured here (if present). We intentionally DO NOT
  // call the legacy renderer because it emits the old stacked meta layout. Instead we
  // invoke our enhanced local renderInstructionList and optionally fall back to the legacy
  // one only if an unexpected error occurs (defensive resilience).
  const legacyRenderInstructionList = window.renderInstructionList;
  window.renderInstructionList = function(list){
    if (globals.instructionPage == null || Number.isNaN(globals.instructionPage)) globals.instructionPage = 1;
    if (globals.instructionPageSize == null) globals.instructionPageSize = 25;
    try {
      renderInstructionList(list);
    } catch(e){
      try { legacyRenderInstructionList && legacyRenderInstructionList(list); } catch { /* ignore */ }
    }
    const filtered = getFilteredInstructions(list||[]);
    if(filtered.length === 0) maybeTriggerGlobalFallback();
  };

  // If the legacy script already fetched instructions and populated window.allInstructions,
  // force a re-render so the UI upgrades (chip styling / tree view) without requiring user action.
  try {
    if(Array.isArray(window.allInstructions) && window.allInstructions.length){
      setTimeout(()=>{ try { renderCurrentInstructionView(); } catch { /* ignore */ } }, 0);
    }
  } catch { /* ignore */ }

  // Expose key functions used by inline HTML event handlers (oninput/onclick) so they
  // continue to work after the extraction + IIFE encapsulation.
  try {
    Object.assign(window, {
      filterInstructions,
      editInstruction,
      deleteInstruction,
      showCreateInstruction,
      changeInstructionPage,
      loadInstructions, // optional manual trigger
      refreshInstructionsIfVisible,
      saveInstruction,
      formatInstructionJson,
      toggleInstructionDiff,
      toggleInstructionPreview,
      applyInstructionTemplate,
      cancelEditInstruction,
      updateInstructionEditorDiagnostics,
      setInstructionView,
      setInstructionViewMode,
      buildInstructionTree,
      selectInstructionPreview,
      copySelectedInstructionBody,
      copyFlatPreviewBody,
      loadArchivedInstructions,
      editArchivedInstruction,
      promptArchiveInstruction,
      promptRestoreInstruction,
      promptPurgeArchivedInstruction,
      toggleFlatPreview
    });
  } catch { /* ignore */ }

  // Expose for manual trigger if needed
  window.performGlobalInstructionSearch = performGlobalInstructionSearch;

  // Reflect the persisted view mode on the toggle buttons once the DOM is ready.
  try { syncViewModeButtons(getInstructionViewMode()); } catch { /* ignore */ }
  document.addEventListener('DOMContentLoaded', () => { try { syncViewModeButtons(getInstructionViewMode()); } catch { /* ignore */ } });

  // Hook after DOM ready if instructions section becomes active later
  document.addEventListener('DOMContentLoaded', attachGlobalSearchHandlers);
  // If script injected after DOMContentLoaded (defer), also call immediately
  if(document.readyState === 'interactive' || document.readyState === 'complete') attachGlobalSearchHandlers();

})();

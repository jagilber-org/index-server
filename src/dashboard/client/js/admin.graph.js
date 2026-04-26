/* eslint-disable */
// Extracted graph/mermaid logic from admin.html
(function(){
  // State
  window.graphOriginalSource = '';
  let graphEditing = false;

  let __graphReloadInFlight = false;
  let __graphReloadAttempt = 0;
  let __graphReloadWatchdog = null;
  function setGraphMetaProgress(stage, extra){
    try {
      const meta = document.getElementById('graph-meta2') || document.getElementById('graph-meta');
      if(meta){
        const ts = Date.now()%100000;
        const base = meta.textContent || '';
        const marker = `[stage:${stage}${extra?';'+extra:''};t=${ts}]`;
        if(!/\[stage:/.test(base)) meta.textContent = base + ' ' + marker; else meta.textContent = base.replace(/\[stage:[^\]]+\]/, marker);
      }
    } catch{}
  }

  function renderGraphTextMessage(host, message){
    if(!host) return;
    const box = document.createElement('div');
    box.style.color = '#f2495c';
    box.style.fontFamily = 'monospace';
    box.style.whiteSpace = 'pre';
    box.textContent = message;
    host.replaceChildren(box);
  }

  const SVG_ALLOWED_TAGS = new Map([
    ['svg', 'svg'], ['g', 'g'], ['defs', 'defs'], ['style', 'style'], ['title', 'title'], ['desc', 'desc'],
    ['path', 'path'], ['rect', 'rect'], ['circle', 'circle'], ['ellipse', 'ellipse'], ['polygon', 'polygon'], ['polyline', 'polyline'], ['line', 'line'],
    ['text', 'text'], ['tspan', 'tspan'], ['textpath', 'textPath'],
    ['marker', 'marker'], ['pattern', 'pattern'], ['clippath', 'clipPath'], ['mask', 'mask'], ['symbol', 'symbol'], ['use', 'use'],
    ['lineargradient', 'linearGradient'], ['radialgradient', 'radialGradient'], ['stop', 'stop']
  ]);
  const SVG_ALLOWED_ATTRS = new Set([
    'id', 'class', 'role',
    'xmlns', 'xmlns:xlink', 'xml:space',
    'viewbox', 'preserveaspectratio', 'version',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'd', 'points', 'pathlength',
    'transform', 'transform-origin',
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'opacity', 'color',
    'font-family', 'font-size', 'font-style', 'font-weight',
    'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing', 'word-spacing',
    'marker-start', 'marker-mid', 'marker-end',
    'markerunits', 'markerwidth', 'markerheight', 'orient', 'refx', 'refy',
    'patternunits', 'patterncontentunits', 'patterntransform',
    'gradientunits', 'gradienttransform', 'spreadmethod',
    'offset', 'stop-color', 'stop-opacity',
    'clip-path', 'clippathunits', 'mask', 'maskunits', 'maskcontentunits', 'filter',
    'href', 'xlink:href', 'style',
    'aria-hidden', 'aria-label', 'aria-labelledby', 'aria-describedby'
  ]);

  function hasUnsafeUrlValue(value){
    const text = String(value || '');
    if(!text) return false;
    if(/\b(?:javascript|vbscript|data)\s*:/i.test(text)) return true;
    const urlMatches = text.matchAll(/url\(([^)]*)\)/gi);
    for(const match of urlMatches){
      const inner = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
      if(!/^#[-\w:.]+$/i.test(inner)) return true;
    }
    return false;
  }

  function sanitizeSvgStyleText(cssText){
    const css = String(cssText || '');
    if(!css.trim()) return '';
    if(/@import|expression\s*\(|-moz-binding|behavior\s*:|<\/style/i.test(css)) return '';
    if(hasUnsafeUrlValue(css)) return '';
    return css;
  }

  function sanitizeSvgNode(node){
    if(!node) return null;
    if(node.nodeType === Node.TEXT_NODE){
      return document.createTextNode(node.textContent || '');
    }
    if(node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = String(node.localName || node.nodeName || '').toLowerCase();
    const canonicalTag = SVG_ALLOWED_TAGS.get(tag);
    if(!canonicalTag) return null;
    const clean = document.createElementNS('http://www.w3.org/2000/svg', canonicalTag);
    Array.from(node.attributes || []).forEach((attr) => {
      const name = String(attr.name || '').toLowerCase();
      if(!name || name.startsWith('on') || !SVG_ALLOWED_ATTRS.has(name)) return;
      const value = attr.value || '';
      if((name === 'href' || name === 'xlink:href') && !/^\s*#[-\w:.]+\s*$/i.test(value)) return;
      if(hasUnsafeUrlValue(value)) return;
      if(name === 'style'){
        const safeStyle = sanitizeSvgStyleText(value);
        if(!safeStyle) return;
        clean.setAttribute(attr.name, safeStyle);
        return;
      }
      if(name === 'xlink:href'){
        clean.setAttributeNS('http://www.w3.org/1999/xlink', attr.name, value);
        return;
      }
      clean.setAttribute(attr.name, value);
    });
    if(tag === 'style'){
      const safeCss = sanitizeSvgStyleText(node.textContent || '');
      if(!safeCss) return null;
      clean.textContent = safeCss;
      return clean;
    }
    Array.from(node.childNodes || []).forEach((child) => {
      const cleanChild = sanitizeSvgNode(child);
      if(cleanChild) clean.appendChild(cleanChild);
    });
    return clean;
  }

  function sanitizeGraphSvg(svgMarkup){
    const parsed = new DOMParser().parseFromString(String(svgMarkup || ''), 'image/svg+xml'); // lgtm[js/xss-through-dom] — output sanitized via sanitizeSvgNode before any DOM insertion
    if(parsed.querySelector('parsererror') || parsed.documentElement.tagName.toLowerCase() !== 'svg'){
      return null;
    }
    const cleanSvg = sanitizeSvgNode(parsed.documentElement);
    if(!cleanSvg || cleanSvg.tagName.toLowerCase() !== 'svg') return null;
    if(!cleanSvg.getAttribute('xmlns')) cleanSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return cleanSvg;
  }

  function renderGraphSvg(host, svgMarkup){
    if(!host) return;
    const safeSvg = sanitizeGraphSvg(svgMarkup);
    if(!safeSvg){
      renderGraphTextMessage(host, 'Mermaid render failed:: invalid SVG output');
      return;
    }
    host.replaceChildren(safeSvg);
  }

  async function reloadGraphMermaid(){
    if(__graphReloadInFlight){ setGraphMetaProgress('skip-concurrent'); return; }
    __graphReloadInFlight = true; __graphReloadAttempt++;
    const attemptId = __graphReloadAttempt;
    clearTimeout(__graphReloadWatchdog);
    __graphReloadWatchdog = setTimeout(()=>{
      setGraphMetaProgress('watchdog-expired','a='+attemptId);
      __graphReloadInFlight = false;
    }, 15000);
    setGraphMetaProgress('start','a='+attemptId);
    const enrichEl = document.getElementById('graph-enrich');
    const categoriesEl = document.getElementById('graph-categories');
    const usageEl = document.getElementById('graph-usage');
    const edgeTypesEl = document.getElementById('graph-edgeTypes');
  const layoutSel = document.getElementById('graph-layout');
  // Default enrich & categories to true if element not yet bound so initial meta shows enriched schema
  const enrich = enrichEl && 'checked' in enrichEl ? enrichEl.checked : true;
  const categories = categoriesEl && 'checked' in categoriesEl ? categoriesEl.checked : true;
    const usage = usageEl && 'checked' in usageEl ? usageEl.checked : false;
    const edgeTypesRaw = edgeTypesEl && 'value' in edgeTypesEl ? (edgeTypesEl.value || '').trim() : '';
    let layout = (layoutSel && 'value' in layoutSel) ? layoutSel.value : 'elk';
  const theme = 'base'; // fixed project-standard theme
    const params = new URLSearchParams();
    const selCatsEl = document.getElementById('drill-categories');
    const selInstEl = document.getElementById('drill-instructions');
    const selectedCategories = selCatsEl ? Array.from(selCatsEl.selectedOptions).map(o=>o.value).filter(Boolean) : [];
    const selectedIds = selInstEl ? Array.from(selInstEl.selectedOptions).map(o=>o.value).filter(Boolean) : [];
    const scopeFiltered = selectedCategories.length > 0 || selectedIds.length > 0;
    // Always include toggle flags irrespective of scope filtering so meta (schema version, categories)
    // remains accurate and tests expecting enrichment signals succeed.
    if(enrich) params.set('enrich','1');
    if(categories) params.set('categories','1');
    if(usage) params.set('usage','1');
    if(edgeTypesRaw) params.set('edgeTypes', edgeTypesRaw);
    if(selectedCategories.length) params.set('selectedCategories', selectedCategories.join(','));
    if(selectedIds.length) params.set('selectedIds', selectedIds.join(','));
    const target = document.getElementById('graph-mermaid');
    const metaEl = document.getElementById('graph-meta');
    if(target) target.textContent = '(loading graph...)';
    const skeleton = document.querySelector('.graph-loading-skeleton');
    if(skeleton) skeleton.style.display = '';
    const manualOverride = window.__GRAPH_MANUAL_OVERRIDE === true;
    const persistedOverride = !manualOverride ? null : (function(){
      try { return localStorage.getItem('mcp.graph.manualOverrideSource') || null; } catch { return null; }
    })();
  setGraphMetaProgress('params', 'en='+(enrich?1:0)+';cat='+(categories?1:0)+';use='+(usage?1:0)+';selCats='+selectedCategories.length+';selIds='+selectedIds.length);
    let fetchOk = false; let data = null; let lastErr = null;
    try {
      setGraphMetaProgress('fetch','a='+attemptId);
      const res = await adminAuth.adminFetch('/api/graph/mermaid?'+params.toString());
      if(!res.ok) throw new Error('http '+res.status);
      data = await res.json();
      fetchOk = !!(data && data.success && data.mermaid);
      setGraphMetaProgress(fetchOk? 'fetch-ok':'fetch-empty','a='+attemptId);
    } catch(e){ lastErr = e; setGraphMetaProgress('fetch-error','a='+attemptId); }
    if(!fetchOk && attemptId === 1){
      // Retry once with ultra-minimal params
      try {
        setGraphMetaProgress('retry1');
        const res2 = await adminAuth.adminFetch('/api/graph/mermaid?enrich=1');
        if(res2.ok){ const d2 = await res2.json(); if(d2?.success && d2.mermaid){ data = d2; fetchOk = true; setGraphMetaProgress('retry-ok'); }}
      } catch{ setGraphMetaProgress('retry-fail'); }
    }
    if(fetchOk){
      try {
        let mermaidSource = data.mermaid;
        setGraphMetaProgress('fetched-bytes','len='+ (mermaidSource? mermaidSource.length:0));
        const effectiveLayout = layout === 'elk' ? 'elk' : 'default';
        if(effectiveLayout === 'elk') await ensureMermaidElk();
        // Merge or create frontmatter ensuring single config.theme + config.layout entries
        function mergeFrontmatter(src){
          if(!src) return src;
          const wantThemeLine = theme ? `  theme: ${theme}` : null;
          const wantLayoutLine = (effectiveLayout === 'elk') ? '  layout: elk' : null;
          const wantThemeVariables = `  themeVariables:\n    primaryColor: '#3b82f6'\n    primaryTextColor: '#d0d4d8'\n    primaryBorderColor: '#2c3038'\n    lineColor: '#363b44'\n    secondaryColor: '#1f2228'\n    tertiaryColor: '#181b1f'\n    background: '#111217'\n    mainBkg: '#181b1f'\n    secondBkg: '#1f2228'`;
          const hasFrontmatter = src.startsWith('---\n');
          // If frontmatter missing OR malformed ensure we create a fresh one
          const m = hasFrontmatter ? /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(src) : null;
          if(!m){
            const lines = ['config:'];
            if(wantThemeLine) lines.push(wantThemeLine);
            if(wantLayoutLine) lines.push(wantLayoutLine);
            lines.push(wantThemeVariables);
            // If there was an orphan leading '---' without closing, strip it first
            const cleaned = hasFrontmatter ? src.replace(/^---\n?/, '') : src;
            return `---\n${lines.join('\n')}\n---\n${cleaned}`;
          }
          // Split existing frontmatter header & body (valid pattern)
          let header = m[1];
          const body = m[2];
          // Ensure config: section exists
          if(!/^config:/m.test(header)){
            header = 'config:\n'+header;
          }
            // Remove existing simple theme/layout lines; keep a single themeVariables block (first occurrence)
          const lines = header.split(/\r?\n/);
          let seenThemeVars = false;
          const filtered = [];
          for(let i=0;i<lines.length;i++){
            const l = lines[i];
            if(/(^\s*theme:\s)/.test(l) || /(^\s*layout:\s)/.test(l)) continue;
            if(/^\s*themeVariables:/.test(l)){
              if(seenThemeVars){ continue; }
              seenThemeVars = true;
              filtered.push(l);
              // retain following indented lines belonging to existing themeVariables block
              for(let j=i+1;j<lines.length;j++){
                const nl = lines[j];
                if(/^\s{2,}\S/.test(nl)) { filtered.push(nl); i=j; continue; }
                break;
              }
              continue;
            }
            filtered.push(l);
          }
          // Rebuild and inject desired lines after config:
          const rebuilt = filtered;
          let cfgIdx = rebuilt.findIndex(l=>/^config:/.test(l));
          if(cfgIdx === -1){ rebuilt.unshift('config:'); cfgIdx = 0; }
          const inject = [];
          if(wantThemeLine) inject.push(wantThemeLine);
          if(wantLayoutLine) inject.push(wantLayoutLine);
          if(!seenThemeVars) inject.push(wantThemeVariables);
          rebuilt.splice(cfgIdx+1,0,...inject);
          return `---\n${rebuilt.join('\n')}\n---\n${body}`;
        }
        mermaidSource = mergeFrontmatter(mermaidSource);
        // Sanitize duplicated YAML mapping keys in frontmatter (e.g., accidental repeated darkMode)
        function sanitizeFrontmatter(src){
          if(!src || src.indexOf('---') !== 0) return src;
          try {
            const segMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(src);
            if(!segMatch) return src; // not standard frontmatter pattern
            const header = segMatch[1];
            const body = segMatch[2];
            const lines = header.split(/\r?\n/);
            const seenAtIndent = {}; // key -> indent level signature
            const out = [];
            for(const line of lines){
              // Match YAML simple key: value OR key: (end) respecting indentation
              const m = /^(\s*)([A-Za-z0-9_-]+):/.exec(line);
              if(m){
                const indent = m[1].length;
                const key = m[2];
                const sig = indent+':'+key;
                if(seenAtIndent[sig]){
                  // Skip duplicate at same nesting level
                  continue;
                }
                seenAtIndent[sig] = true;
              }
              out.push(line);
            }
            return `---\n${out.join('\n')}\n---\n${body}`;
          } catch{ return src; }
        }
        let ensured = ensureMermaidDirective(mermaidSource);
        ensured = sanitizeFrontmatter(ensured);
        // If manual override is active, sanitize it too so duplicate keys (e.g. darkMode) don't break parse
        let sanitizedOverride = null;
        if(manualOverride && persistedOverride){
          sanitizedOverride = sanitizeFrontmatter(persistedOverride);
          setGraphMetaProgress('manual-override');
          window.graphOriginalSource = sanitizedOverride; // lgtm[js/xss-through-dom]
          if(target) target.textContent = sanitizedOverride;
        } else {
          window.graphOriginalSource = ensured;
          if(target) target.textContent = ensured;
        }
            // Include scope filtering indicator so user sees when selection scoping applied
            if(metaEl){
              const scopeNote = scopeFiltered ? ' (scoped)' : '';
              metaEl.textContent = `schema=v${data.meta?.graphSchemaVersion} nodes=${data.meta?.nodeCount} edges=${data.meta?.edgeCount}${scopeNote}`; // lgtm[js/xss-through-exception]
            }
        setGraphMetaProgress('render-prep','a='+attemptId);
        try { await ensureMermaid(); } catch{}
        try { if(effectiveLayout === 'elk' && !window.mermaid?.mcpElkRegistered) await ensureMermaidElk(); } catch{}
        if(window.mermaid){
          setGraphMetaProgress('render-run','a='+attemptId);
          try {
            const renderSource = (manualOverride && sanitizedOverride) ? sanitizedOverride : ensured;
            // Lightweight syntax validation before attempting full render (helps surface parse errors explicitly)
            try {
              if(window.mermaid.parse){
                await window.mermaid.parse(renderSource);
              }
            } catch(parseErr){
              setGraphMetaProgress('parse-fail','a='+attemptId);
              const hostParse = document.getElementById('graph-mermaid-svg');
              if(hostParse){
                renderGraphTextMessage(hostParse, `Mermaid parse error:: ${String((parseErr && parseErr.message) || parseErr || '').slice(0, 200)}`);
              }
              // Abort further render attempt
              throw parseErr;
            }
            let svg; ({ svg } = await window.mermaid.render('graphMermaidSvg', renderSource));
            const host = document.getElementById('graph-mermaid-svg'); if(host) renderGraphSvg(host, svg);
            const skel = document.querySelector('.graph-loading-skeleton'); if(skel) skel.style.display = 'none';
            setGraphMetaProgress('render-ok','a='+attemptId);
          } catch(rendErr){
            setGraphMetaProgress('render-fail','a='+attemptId);
            const skelFail = document.querySelector('.graph-loading-skeleton'); if(skelFail) skelFail.style.display = 'none';
            const hostErr = document.getElementById('graph-mermaid-svg');
            if(hostErr && !/Mermaid parse error/.test(hostErr.textContent||'')){
              renderGraphTextMessage(hostErr, `Mermaid render failed:: ${String((rendErr && rendErr.message) || rendErr || '').slice(0, 200)}`);
            }
            try { console.warn('[mermaid render failed]', rendErr); } catch{}
          }
        }
      } catch(procErr){ setGraphMetaProgress('process-error','a='+attemptId); }
    } else {
      if(target) target.textContent = `(graph unavailable${lastErr?': '+(lastErr.message||lastErr):''})`;
      setGraphMetaProgress('unavailable','err='+((lastErr && (lastErr.message||String(lastErr))) || 'none'));
    }
    clearTimeout(__graphReloadWatchdog);
    __graphReloadInFlight = false;
  }

  function ensureMermaidDirective(src){
    if(!src) return 'flowchart TB';
    const hasDirective = /^(---[\s\S]*?---\s*)?(%%.*\n)*\s*(flowchart|graph)\b/m.test(src);
    if(hasDirective) return src;
    if(/^---/.test(src)){
      const parts = src.split(/---\s*\n/);
      if(parts.length>=3){ const rest = parts.slice(2).join('---\n'); return `---\n${parts[1]}---\nflowchart TB\n${rest}`; }
    }
    return 'flowchart TB\n'+src;
  }

  // Mermaid loader state (copied behavior)
  let mermaidLoading = null;
  let mermaidElkLoading = null;
  function mermaidNeedsReload(force){ if(force) return true; if(!window.mermaid) return true; const ver = window.mermaid.version || window.mermaid.mermaidAPI?.getConfig?.()?.version || ''; if(ver.startsWith('10.')) return true; return false; }
  async function ensureMermaid(force){
    if(mermaidNeedsReload(force)){
      if(window.mermaid && (force || !window.mermaid.registerLayoutLoaders)){
        try{ [...document.querySelectorAll('script[src*="mermaid"]')].forEach(s=>s.remove()); } catch{}
        try{ delete window.mermaid; } catch{}
        mermaidLoading = null;
      }
    }
    if(window.mermaid && !force) return;
    if(mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise((resolve,reject)=>{
      const s = document.createElement('script');
      s.src = '/js/mermaid.min.js';
      s.onload = ()=>{ try { const large = !!window.__MERMAID_LARGE_GRAPH_FLAG; let configuredMaxEdges; if(typeof window.__MERMAID_MAX_EDGES === 'number' && window.__MERMAID_MAX_EDGES>0){ configuredMaxEdges = window.__MERMAID_MAX_EDGES; } else { configuredMaxEdges = large ? 20000 : 3000; } const maxTextSize = large ? 10000000 : 1000000; // Standardize base theme (frontmatter may still override per-graph)
        window.mermaid.initialize({ startOnLoad:false, theme:'base', maxEdges: configuredMaxEdges, maxTextSize, securityLevel:'strict' }); window.__MERMAID_ACTIVE_MAX_EDGES = configuredMaxEdges; window.__MERMAID_ACTIVE_MAX_TEXT_SIZE = maxTextSize; resolve(null);} catch(e){ reject(e);} };
      s.onerror = (e)=>reject(e instanceof Error? e : new Error('mermaid load failed'));
      document.head.appendChild(s);
    });
    return mermaidLoading;
  }

  async function ensureMermaidElk(){
    await ensureMermaid();
    if(window.mermaid && !window.mermaid.registerLayoutLoaders && !window.mermaid.__reloadedOnce){ window.mermaid.__reloadedOnce = true; await ensureMermaid(true); }
    if(window.mermaid?.mcpElkRegistered) return;
    if(mermaidElkLoading) return mermaidElkLoading;
    mermaidElkLoading = new Promise((resolve)=>{
      const localElk = './mermaid-layout-elk.esm.min.mjs';
      const urls = [ localElk ];
      let idx = 0;
      function tryNext(){ if(window.mermaid?.mcpElkRegistered) return resolve(null); if(idx >= urls.length) return resolve(null); const url = urls[idx++]; (async ()=>{ try{ const mod = await import(url); let descriptorArray = (mod && mod.default && Array.isArray(mod.default)) ? mod.default : (Array.isArray(mod) ? mod : null); if(!descriptorArray && typeof mod === 'object'){ const arr = Array.isArray(mod.default)? mod.default : null; descriptorArray = arr || null; } if(descriptorArray && window.mermaid?.registerLayoutLoaders){ try{ window.mermaid.registerLayoutLoaders(descriptorArray); window.mermaid.mcpElkRegistered = true; resolve(null); return; } catch(e){ /* try next */ } } } catch(e){ /* try next */ } tryNext(); })(); }
      tryNext();
    });
    return mermaidElkLoading;
  }

  function initGraphScopeDefaults(){
    const catSel = document.getElementById('drill-categories');
    const instSel = document.getElementById('drill-instructions');
    if(catSel && !catSel.options.length) refreshDrillCategories().catch(()=>{});
    if(instSel && !instSel.options.length) loadDrillInstructions().catch(()=>{});
    const mer = document.getElementById('graph-mermaid'); if(mer) mer.textContent='(no selection - choose categories and/or instructions then Refresh)';
  }

  function copyMermaidSource(){ const el = document.getElementById('graph-mermaid'); if(!el) return; const txt = el.textContent || ''; navigator.clipboard.writeText(txt).catch(()=>{}); }

  function toggleGraphEdit(){
    if(graphEditing){
      cancelGraphEdit();
      return;
    }
    const target = document.getElementById('graph-mermaid');
    if(!target) return;
    // Capture current content as restore baseline when entering edit mode
    window.graphOriginalSource = target.textContent || ''; // lgtm[js/xss-through-dom]
    graphEditing = true;
    target.setAttribute('contenteditable','true');
    target.style.outline = '1px solid #3b82f6';
  window.__GRAPH_MANUAL_OVERRIDE = true; // enable manual override mode
    setGraphMetaProgress('edit-start');
    try { document.getElementById('graph-edit-btn').style.display='none'; } catch{}
    try { document.getElementById('graph-apply-btn').style.display='inline-block'; } catch{}
    try { document.getElementById('graph-cancel-btn').style.display='inline-block'; } catch{}
  }

  function applyGraphEdit(){
    const target = document.getElementById('graph-mermaid');
    if(!target) return;
    const code = target.textContent || '';
    // Promote edited content to new baseline so subsequent cancel doesn't revert it
    window.graphOriginalSource = code;
  persistGraphSource(code);
  try { localStorage.setItem('mcp.graph.manualOverrideSource', code); } catch{}
    setGraphMetaProgress('apply');
    (async ()=>{
      try {
        await ensureMermaid();
        const { svg } = await window.mermaid.render('graphMermaidSvg', code);
        const legacyHost = document.getElementById('graph-mermaid-svg'); if(legacyHost) renderGraphSvg(legacyHost, svg);
        setGraphMetaProgress('apply-ok');
      } catch(e){
        setGraphMetaProgress('apply-fail');
        try { alert('Render failed: '+ ((e && e.message) || e)); } catch{}
      }
    })();
    cancelGraphEdit(true); // keep edited content visible
  }

  function cancelGraphEdit(keep){
  if(!graphEditing) return;
    const target = document.getElementById('graph-mermaid');
    if(target){
      target.removeAttribute('contenteditable');
      target.style.outline='none';
      if(!keep){
        // Restore baseline content
        target.textContent = window.graphOriginalSource;
      }
    }
  graphEditing=false;
    setGraphMetaProgress('edit-end');
    try { document.getElementById('graph-edit-btn').style.display='inline-block'; } catch{}
    try { document.getElementById('graph-apply-btn').style.display='none'; } catch{}
    try { document.getElementById('graph-cancel-btn').style.display='none'; } catch{}
  }

  // Drilldown helpers (absorbed from admin.drilldown.js)
  async function refreshDrillCategories(){
    const el = document.getElementById('drill-categories');
    if(!el) return;
    try{
      const res = await adminAuth.adminFetch('/api/graph/categories');
      const data = await res.json();
      el.innerHTML = '';
      if(Array.isArray(data?.categories)){
        data.categories.forEach(c=>{ const o = document.createElement('option'); o.value=c.id||c.name; o.textContent = c.name||c.id; el.appendChild(o); });
        let auto = 0; for(const opt of Array.from(el.options)){ if(auto<3){ opt.selected = true; auto++; } }
      }
      if(typeof window.reloadGraphMermaid === 'function') { try { window.reloadGraphMermaid(); } catch(_){} }
    }catch(e){ console.warn('failed refreshDrillCategories',e); }
  }

  async function loadDrillInstructions(){
    const el = document.getElementById('drill-instructions');
    if(!el) return;
    try{
      const res = await adminAuth.adminFetch('/api/graph/instructions');
      const data = await res.json();
      el.innerHTML = '';
      if(Array.isArray(data?.instructions)){
        data.instructions.forEach(i=>{ const o = document.createElement('option'); o.value=i.id; o.textContent = `${i.title||i.id}`; el.appendChild(o); });
      }
    }catch(e){ console.warn('failed loadDrillInstructions',e); }
  }

  function clearSelections(){
    const catSel = document.getElementById('drill-categories');
    const instSel = document.getElementById('drill-instructions');
    if(catSel) { for(const opt of Array.from(catSel.options)) opt.selected = false; }
    if(instSel) { for(const opt of Array.from(instSel.options)) opt.selected = false; }
  }

  // Expose
  window.reloadGraphMermaid = reloadGraphMermaid;
  window.reloadGraphMermaidForce = function(){ // lgtm[js/xss-through-dom]
    try { clearTimeout(__graphReloadWatchdog); } catch{}
    __graphReloadInFlight = false; // clear guard
    reloadGraphMermaid();
  };
  window.ensureMermaid = ensureMermaid;
  window.ensureMermaidElk = ensureMermaidElk;
  window.initGraphScopeDefaults = initGraphScopeDefaults;
  window.ensureMermaidDirective = ensureMermaidDirective;
  window.copyMermaidSource = copyMermaidSource;
  window.toggleGraphEdit = toggleGraphEdit;
  window.applyGraphEdit = applyGraphEdit;
  window.cancelGraphEdit = cancelGraphEdit;
  window.refreshDrillCategories = refreshDrillCategories;
  window.loadDrillInstructions = loadDrillInstructions;
  window.clearSelections = clearSelections;

  // Local persistence helpers
  const LS_KEY = 'mcp.graph.lastSource';
  function persistGraphSource(src){ try { if(src && src.trim().length) localStorage.setItem(LS_KEY, src); } catch{} }
  function loadPersistedGraphSource(){ try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; } }
  window.__persistGraphSource = persistGraphSource;

  // Auto render on content edits when checkbox enabled
  function bindAutoRender(){
    const pre = document.getElementById('graph-mermaid');
    if(!pre) return;
    pre.addEventListener('input', ()=>{
      const auto = (document.getElementById('graph-auto-render')||{}).checked;
      if(auto && graphEditing){
        const code = pre.textContent || '';
        persistGraphSource(code);
        // Debounced lightweight render (cancel previous if still pending)
        clearTimeout(window.__graphAutoRenderTimer);
        window.__graphAutoRenderTimer = setTimeout(()=>{
          (async ()=>{ try { await ensureMermaid(); const { svg } = await window.mermaid.render('graphMermaidSvg', code); const legacyHost = document.getElementById('graph-mermaid-svg'); if(legacyHost) renderGraphSvg(legacyHost, svg); } catch{} })();
        }, 400);
      }
    });
  }

  // Theme insertion removed (fixed theme configuration)

  document.addEventListener('DOMContentLoaded', ()=>{
    bindAutoRender();
    // If we have a persisted manual edit, restore it (but allow fresh reload to overwrite when refreshed)
    const persisted = loadPersistedGraphSource();
    if(persisted){
      const target = document.getElementById('graph-mermaid');
      if(target && target.textContent && !/\(loading graph/.test(target.textContent)){
        // Only restore if existing content is a real graph
        target.textContent = persisted;
      }
    }
    // Restore manual override source if present
    try {
      const mo = localStorage.getItem('mcp.graph.manualOverrideSource');
      if(mo){ window.__GRAPH_MANUAL_OVERRIDE = true; const t = document.getElementById('graph-mermaid'); if(t) t.textContent = mo; }
    } catch{}
  });

  let __graphInitialAutoReload = false;
  async function graphEnsureReadyAndReload(){
    // Avoid multiple concurrent auto reloads
    if(__graphInitialAutoReload) return; __graphInitialAutoReload = true;
    try {
      // Ensure categories then instructions then mermaid libs before reload
      try { await refreshDrillCategories(); } catch {}
      try { await loadDrillInstructions(); } catch {}
      // Ensure mermaid (and elk) prior to first fetch so meta elements ready quickly
      try { await ensureMermaid(); } catch {}
      try { await ensureMermaidElk(); } catch {}
      await reloadGraphMermaid();
    } catch(e){
      try { console.warn('[graphEnsureReadyAndReload] failed', e); } catch{}
    }
  }
  window.graphEnsureReadyAndReload = graphEnsureReadyAndReload;

  // Attach refresh button listener (id added in admin.html)
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('graph-refresh-btn');
    if(btn){ btn.addEventListener('click', ()=> window.reloadGraphMermaidForce()); }
  });

  // Inject selection change listeners to trigger reload and clear manual override mode
  function bindScopeSelectionListeners(){
    try {
      const catSel = document.getElementById('drill-categories');
      const instSel = document.getElementById('drill-instructions');
      const handler = ()=>{
        // Clear manual override so new scope fetch isn't masked
        if(window.__GRAPH_MANUAL_OVERRIDE){
          try { delete window.__GRAPH_MANUAL_OVERRIDE; } catch{}
          try { localStorage.removeItem('mcp.graph.manualOverrideSource'); } catch{}
          setGraphMetaProgress('scope-clear-override');
        }
        // If user is not editing custom graph text, trigger debounced reload
        if(!graphEditing){
          clearTimeout(window.__graphScopeReloadTimer);
          setGraphMetaProgress('scope-change');
          window.__graphScopeReloadTimer = setTimeout(()=>{ window.reloadGraphMermaid && window.reloadGraphMermaid(); }, 200);
        }
      };
      if(catSel && !catSel.__mcpScopeBound){ catSel.addEventListener('change', handler); catSel.addEventListener('input', handler); catSel.__mcpScopeBound = true; }
      if(instSel && !instSel.__mcpScopeBound){ instSel.addEventListener('change', handler); instSel.addEventListener('input', handler); instSel.__mcpScopeBound = true; }
    } catch{}
  }
  window.bindScopeSelectionListeners = bindScopeSelectionListeners;

  // Helper to explicitly clear manual override and force reload
  window.clearGraphManualOverride = function(force){
    try { delete window.__GRAPH_MANUAL_OVERRIDE; } catch{}
    try { localStorage.removeItem('mcp.graph.manualOverrideSource'); } catch{}
    if(force) window.reloadGraphMermaid && window.reloadGraphMermaid();
  };

  document.addEventListener('DOMContentLoaded', ()=>{
    try { bindScopeSelectionListeners(); } catch{}
  });

  // Auto-load graph when section becomes visible (tab switch via MutationObserver)
  document.addEventListener('DOMContentLoaded', () => {
    const graphSection = document.getElementById('graph-section');
    if (graphSection) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'class' && !graphSection.classList.contains('hidden')) {
            graphEnsureReadyAndReload();
            break;
          }
        }
      });
      observer.observe(graphSection, { attributes: true, attributeFilter: ['class'] });
    }
  });

  // ── Phase 4.3 — Zoom controls and fullscreen ──────────────────────────
  let zoomLevel = 1;
  const ZOOM_STEP = 0.15;
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 5;

  function applyZoom(){
    const svg = document.getElementById('graph-mermaid-svg');
    if(svg) svg.style.transform = 'scale(' + zoomLevel + ')';
    if(svg) svg.style.transformOrigin = 'top left';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const zoomIn = document.getElementById('graph-zoom-in');
    const zoomOut = document.getElementById('graph-zoom-out');
    const zoomReset = document.getElementById('graph-zoom-reset');
    const fullscreenBtn = document.getElementById('graph-fullscreen-btn');
    const renderCard = document.getElementById('graph-render-card');

    if(zoomIn) zoomIn.addEventListener('click', () => { zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP); applyZoom(); });
    if(zoomOut) zoomOut.addEventListener('click', () => { zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP); applyZoom(); });
    if(zoomReset) zoomReset.addEventListener('click', () => { zoomLevel = 1; applyZoom(); });

    if(fullscreenBtn && renderCard){
      fullscreenBtn.addEventListener('click', () => {
        renderCard.classList.toggle('graph-fullscreen');
        fullscreenBtn.textContent = renderCard.classList.contains('graph-fullscreen') ? '✕' : '⛶';
      });
    }

    // Mousewheel zoom on the rendered diagram
    const rendered = document.getElementById('graph-mermaid-rendered');
    if(rendered){
      rendered.addEventListener('wheel', (e) => {
        if(e.ctrlKey || e.metaKey){
          e.preventDefault();
          zoomLevel = e.deltaY < 0
            ? Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP)
            : Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
          applyZoom();
        }
      }, { passive: false });
    }
  });
})();

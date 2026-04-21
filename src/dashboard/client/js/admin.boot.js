/* eslint-disable */
// admin.boot.js
(function(){
  'use strict';

  // Minimal bootstrapping for the admin UI. Keep this file small so it can be loaded early.
  function showSection(section){
    document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
    let activeSection = document.getElementById(section + '-section');
    // Fallback resolution: allow passing full id (e.g. 'overview-section') or data-section name
    if(!activeSection){
      if(section.endsWith('-section')) activeSection = document.getElementById(section);
      if(!activeSection){
        // Try match by prefix (id starts with section)
        activeSection = Array.from(document.querySelectorAll('.admin-section')).find(s=>s.id === section || s.id === section+'-section' || s.id.startsWith(section));
      }
    }
    if (activeSection) {
      activeSection.classList.remove('hidden');
    } else {
      // Lightweight debug log; keep from spamming
      if(!(window.__lastMissingSection === section)) {
        console.warn('[admin] section not found', section);
        window.__lastMissingSection = section;
      }
    }
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      const ds = btn.getAttribute('data-section');
      if(ds === section) btn.classList.add('active'); else btn.classList.remove('active');
    });
    window.currentSection = section;
    // Lazy-load graph module when needed (mermaid + elk heavy). This keeps initial boot small.
    if(section === 'graph'){
      ensureGraphModule().then(()=>{
        if(typeof window.initGraphScopeDefaults === 'function') { try { window.initGraphScopeDefaults(); } catch(_){} }
        // Deterministic ready chain replacing earlier ad-hoc reload
        if(typeof window.graphEnsureReadyAndReload === 'function') {
          try { window.graphEnsureReadyAndReload(); } catch{}
        } else if(typeof window.reloadGraphMermaid === 'function') {
          // Fallback
          try { window.reloadGraphMermaid(); } catch{}
        }
      }).catch(()=>{});
    } else if(section === 'instructions') {
      // Ensure instructions module script loaded and then invoke loadInstructions directly as fail-safe.
      ensureInstructionsModule().then(()=>{
        if(typeof window.loadSectionData === 'function') window.loadSectionData(section);
        if(typeof window.loadInstructions === 'function') {
          try { window.loadInstructions(); } catch(e){ /* ignore */ }
        }
      }).catch(()=>{
        if(typeof window.loadInstructions === 'function') {
          try { window.loadInstructions(); } catch(e){ }
        }
      });
    } else {
      if (typeof window.loadSectionData === 'function') window.loadSectionData(section);
    }
    // Config panel auto-refresh lifecycle
    if (section === 'config') {
      if (typeof window.startConfigAutoRefresh === 'function') window.startConfigAutoRefresh();
    } else {
      if (typeof window.stopConfigAutoRefresh === 'function') window.stopConfigAutoRefresh();
    }
  }

  // Ensure graph/drilldown heavy module is loaded only once.
  let __graphModuleLoad = null;
  function loadGraphModule(){
    if(__graphModuleLoad) return __graphModuleLoad;
    __graphModuleLoad = (async ()=>{
      try{
        // Scripts are already referenced with defer in admin.html; they may already have executed.
        if(typeof window.reloadGraphMermaid === 'function' && typeof window.initGraphScopeDefaults === 'function') return;
        // Attempt dynamic import fallback for environments that prefer it.
        try { await import('./admin.graph.js'); } catch(e) { /* ignore import failures */ }
        try { await import('./admin.drilldown.js'); } catch(e) { /* ignore */ }
      }catch(e){ /* swallow */ }
    })();
    return __graphModuleLoad;
  }

  // Public ensure wrapper for symmetry / future retries
  function ensureGraphModule(){ return loadGraphModule(); }

  // Lightweight loader for instructions module in case defer script failed to execute before navigation.
  let __instructionsModuleLoad = null;
  function ensureInstructionsModule(){
    if(typeof window.loadInstructions === 'function') return Promise.resolve();
    if(__instructionsModuleLoad) return __instructionsModuleLoad;
    __instructionsModuleLoad = (async ()=>{
      // Attempt dynamic import; ignore errors (the static defer script may already exist or path may differ in dist build)
      try { await import('./admin.instructions.js'); } catch(e) { /* ignore */ }
    })();
    return __instructionsModuleLoad;
  }

  function startAutoRefresh(){
    if(window.__adminRefresh) clearInterval(window.__adminRefresh);
    window.__adminRefresh = setInterval(()=>{
      if(window.currentSection === 'overview' && typeof window.loadOverviewData === 'function') window.loadOverviewData();
      if(window.currentSection === 'sessions' && typeof window.loadSessions === 'function') window.loadSessions();
      if(window.currentSection === 'maintenance' && typeof window.loadMaintenanceStatus === 'function') window.loadMaintenanceStatus();
    }, 30000);
  }

  document.addEventListener('DOMContentLoaded', function(){
    // expose showSection for inline handlers expected by existing markup
  window.showSection = showSection;
  window.ensureGraphModule = ensureGraphModule;
    window.startAutoRefresh = startAutoRefresh;
    try { showSection('overview'); } catch(e){ /* ignore */ }
    try { startAutoRefresh(); } catch(e){ /* ignore */ }
    try { wireAdminControls(); } catch(e) { /* ignore wiring errors */ }
  });

  // Attach event listeners to commonly interacted controls. This reduces reliance on inline attributes.
  function wireAdminControls(){
    // Set defaults before any list rendering (avoid undefined page size causing slice logic oddities)
    if(!window.instructionPageSize) window.instructionPageSize = 25;
    // Wire nav buttons (previously relied on inline onclick attributes)
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      try {
        btn.addEventListener('click', (ev) => {
          // Determine target section by button text or aria/data attribute if present
          let target = btn.getAttribute('data-section');
          if(!target){
            const txt = (btn.textContent || '').toLowerCase();
            if(txt.includes('overview')) target = 'overview';
            else if(txt.includes('config')) target = 'config';
            else if(txt.includes('session')) target = 'sessions';
            else if(txt.includes('maintenance')) target = 'maintenance';
            else if(txt.includes('monitor')) target = 'monitoring';
            else if(txt.includes('instruction')) target = 'instructions';
            else if(txt.includes('graph')) target = 'graph';
          }
          if(target) {
            try { showSection(target); } catch(e){ /* ignore */ }
          }
        });
      } catch(e){}
    });

    // Delegated fallback: if an event bubbles from a button inside .admin-nav, handle it.
    const nav = document.querySelector('.admin-nav');
    if(nav && !nav.__delegatedTabs){
      nav.addEventListener('click', (e) => {
        const targetEl = (e.target instanceof HTMLElement) ? (e.target.closest('.nav-btn')) : null;
        if(!targetEl) return;
        const section = targetEl.getAttribute('data-section');
        if(section){
          e.preventDefault();
          try { showSection(section); } catch(err){ /* ignore */ }
        }
      });
      Object.defineProperty(nav,'__delegatedTabs',{value:true, enumerable:false});
    }

    // Expose a small debug utility for manual diagnosis in browser console.
    if(!window._debugTabs){
      window._debugTabs = function(){
        const buttons = Array.from(document.querySelectorAll('.nav-btn')).map(function(b){
          return {
            text: (b.textContent || '').trim(),
            ds: b.getAttribute('data-section'),
            hasClick: !!(b._listenerAttached),
            classes: b.className
          };
        });
        return { currentSection: window.currentSection, buttons: buttons };
      };
    }

    // Ensure active state of nav buttons maps to currentSection correctly
    const updateNavActive = () => {
      document.querySelectorAll('.nav-btn').forEach(btn => {
        const target = btn.getAttribute('data-section');
        if(target === window.currentSection) btn.classList.add('active'); else btn.classList.remove('active');
      });
    };
    // Periodically refresh nav active state in case other code changes currentSection
    setInterval(updateNavActive, 600);

    // Log tail toggle
    const tailBtn = document.getElementById('log-tail-btn');
    if(tailBtn) tailBtn.addEventListener('click', () => { if(typeof window.toggleLogTail === 'function') window.toggleLogTail(); });

    // Log reload (if input for lines exists)
    const linesInput = document.getElementById('log-lines');
    if(linesInput) linesInput.addEventListener('change', () => { if(typeof window.loadLogs === 'function') window.loadLogs(); });

    // Backup filter input
    const backupSearch = document.getElementById('backup-search');
    if(backupSearch) backupSearch.addEventListener('input', () => { if(typeof window.filterBackupRows === 'function') window.filterBackupRows(); });

    // Delegate maintenance control buttons (enable/disable) inside maintenance-control
    const maint = document.getElementById('maintenance-control');
    if(maint) maint.addEventListener('click', (ev) => {
      const el = ev.target;
      if(!(el instanceof HTMLElement)) return;
      if(el.matches('[data-toggle-maint]')){
        const enable = el.getAttribute('data-toggle-maint') === '1';
        if(typeof window.toggleMaintenanceMode === 'function') window.toggleMaintenanceMode(enable);
      }
    });

    // System Operations action buttons delegation
    const sysOps = document.querySelector('#maintenance-section .action-buttons');
    if(sysOps && !sysOps.__sysOpsWired){
      sysOps.addEventListener('click', (ev)=>{
        const el = ev.target instanceof HTMLElement ? ev.target.closest('[data-op]') : null;
        if(!el) return;
        const op = el.getAttribute('data-op');
        if(op === 'create-backup' && typeof window.performBackup === 'function') { try { window.performBackup(); } catch(_){} }
        else if(op === 'clear-caches' && typeof window.clearCaches === 'function') { try { window.clearCaches(); } catch(_){} }
        else if(op === 'restart-server' && typeof window.restartServer === 'function') { try { window.restartServer(); } catch(_){} }
        else if(op === 'restore-backup') {
          const sel = document.getElementById('backup-select');
            if(sel && sel.value){
              if(typeof window.restoreBackup === 'function') { try { window.restoreBackup(sel.value); } catch(_){} }
            }
        }
      });
      Object.defineProperty(sysOps,'__sysOpsWired',{value:true});
    }
    // Convert existing inline handlers to event listeners and observe future additions
    convertInlineHandlers(document);
    const mo = new MutationObserver((records) => {
      for(const r of records){
        r.addedNodes.forEach(n => {
          if(!(n instanceof HTMLElement)) return;
          convertInlineHandlers(n);
        });
      }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  // Replace inline attributes (onclick, oninput, onsubmit) with proper event listeners.
  // Security: Uses a named function dispatch map instead of new Function() (Issue #34 fix).
  // Inline handlers must reference registered function names (e.g., onclick="handleSave(event)")
  function safeExecInlineCode(el, code, event) {
    // Extract function name and arguments from inline handler
    // e.g., "editInstruction('000-bootstrapper')" or "handleSave(event)"
    const match = code.match(/^([a-zA-Z_$][\w$.]*)\s*\(([^)]*)\)/);
    if (match) {
      const fnPath = match[1];
      const argsStr = match[2].trim();
      const parts = fnPath.split('.');
      let fn = window;
      for (const p of parts) {
        if (fn == null) return;
        fn = fn[p];
      }
      if (typeof fn === 'function') {
        try {
          // Parse inline arguments: resolve string literals, numbers, 'event', booleans, null
          const args = argsStr ? argsStr.split(',').map(a => {
            a = a.trim();
            if (a === 'event' || a === 'e') return event;
            if (a === 'this') return el;
            if (a === 'true') return true;
            if (a === 'false') return false;
            if (a === 'null') return null;
            if (a === 'undefined') return undefined;
            // String literal (single or double quoted)
            const strMatch = a.match(/^(['"])(.*)\1$/);
            if (strMatch) return strMatch[2];
            // Number
            if (!isNaN(Number(a)) && a !== '') return Number(a);
            // Fallback: treat as window property reference
            return window[a];
          }) : [];
          fn.apply(el, args);
        } catch (e) { console.error('inline handler failed:', e); }
        return;
      }
    }
    // Handle guard pattern: "window.fn && window.fn('arg')" or "fn && fn('arg')"
    const guardMatch = code.match(/^[\w$.]+\s*&&\s*([a-zA-Z_$][\w$.]*)\s*\(([^)]*)\)/);
    if (guardMatch) {
      const fnPath2 = guardMatch[1];
      const argsStr2 = guardMatch[2].trim();
      const parts2 = fnPath2.split('.');
      let fn2 = window;
      for (const p of parts2) { if (fn2 == null) return; fn2 = fn2[p]; }
      if (typeof fn2 === 'function') {
        try {
          const args2 = argsStr2 ? argsStr2.split(',').map(a => {
            a = a.trim();
            if (a === 'event' || a === 'e') return event;
            if (a === 'this') return el;
            const sm = a.match(/^(['"])(.*)\1$/);
            if (sm) return sm[2];
            if (!isNaN(Number(a)) && a !== '') return Number(a);
            return window[a];
          }) : [];
          fn2.apply(el, args2);
        } catch (e) { console.error('inline handler failed:', e); }
        return;
      }
    }
    // Fallback: simple known patterns
    if (/^return\s+false\s*;?\s*$/.test(code)) { event.preventDefault(); return; }
    if (/^(this\.(value|checked|disabled)\s*=)/.test(code)) return; // DOM assignment — skip
    console.warn('[admin.boot] Unrecognized inline handler, skipped for security:', code.substring(0, 60));
  }

  function convertInlineHandlers(root){
    if(!root || !(root.querySelectorAll)) return;
    // onclick
    root.querySelectorAll('[onclick]').forEach(el => {
      try {
        const code = el.getAttribute('onclick');
        if(!code) return;
        el.removeAttribute('onclick');
        el.addEventListener('click', function(event){
          safeExecInlineCode(this, code, event);
        });
      } catch(e){ /* ignore */ }
    });
    // oninput
    root.querySelectorAll('[oninput]').forEach(el => {
      try {
        const code = el.getAttribute('onput') || el.getAttribute('oninput');
        if(!code) return;
        el.removeAttribute('oninput');
        el.removeAttribute('onput');
        el.addEventListener('input', function(event){
          safeExecInlineCode(this, code, event);
        });
      } catch(e){ /* ignore */ }
    });
    // onchange
    root.querySelectorAll('[onchange]').forEach(el => {
      try {
        const code = el.getAttribute('onchange');
        if(!code) return;
        el.removeAttribute('onchange');
        el.addEventListener('change', function(event){
          safeExecInlineCode(this, code, event);
        });
      } catch(e){ /* ignore */ }
    });
    // onsubmit (for forms) - execute and honor returned false
    root.querySelectorAll('form[onsubmit]').forEach(form => {
      try {
        const code = form.getAttribute('onsubmit');
        if(!code) return;
        form.removeAttribute('onsubmit');
        form.addEventListener('submit', function(event){
          safeExecInlineCode(this, code, event);
        });
      } catch(e){ /* ignore */ }
    });
  }

})();

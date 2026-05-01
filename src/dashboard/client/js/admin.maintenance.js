/* eslint-disable */
// Extracted from admin.html: Backup / Restore and maintenance helpers
(function(){
    function getDownloadFilename(contentDisposition, fallbackName){
        if(!contentDisposition) return fallbackName;
        const match = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
        if(!match || !match[1]) return fallbackName;
        try { return decodeURIComponent(match[1].replace(/"/g, '')); } catch { return match[1].replace(/"/g, ''); }
    }

    function looksLikeZip(bytes){
        return !!(bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b);
    }

    async function loadBackups() {
        try {
            const sel = document.getElementById('backup-select');
            const meta = document.getElementById('backup-list-meta');
            if (!sel) return;
            sel.innerHTML = '<option value="">Loading...</option>';
            const res = await adminAuth.adminFetch('/api/admin/maintenance/backups');
            if (!res.ok) throw new Error('list failed');
            const data = await res.json();
            const backups = (data.backups || []).slice(0, 200);
            if (!backups.length) {
                sel.innerHTML = '<option value="">(no backups)</option>';
                if (meta) meta.textContent = 'No backups available';
                return;
            }
            const warningBackups = backups.filter(function(b){ return b.warnings && b.warnings.length > 0; });
            sel.innerHTML = backups.map(function(b) {
                var warnTag = (b.warnings && b.warnings.length > 0) ? ' ⚠️' : '';
                var label = b.id + '  •  ' + b.instructionCount + ' files  •  ' + (b.schemaVersion || 'schema?') + '  •  ' + new Date(b.createdAt).toLocaleString() + warnTag;
                return '<option value="' + b.id + '">' + label + '</option>';
            }).join('');
            if (meta) {
                var metaText = backups.length + ' backup(s)';
                if (warningBackups.length > 0) {
                    metaText += ' — ⚠️ ' + warningBackups.length + ' with warnings';
                }
                meta.innerHTML = metaText;
            }
            if (data.hasWarnings) {
                showBackupWarningBanner(warningBackups);
            } else {
                clearBackupWarningBanner();
            }
        } catch (err) {
            console.warn('loadBackups error', err);
            var sel = document.getElementById('backup-select');
            if (sel) sel.innerHTML = '<option value="">(error loading)</option>';
            showBackupWarningBanner([{ id: 'load-error', warnings: ['Failed to load backup list: ' + (err.message || err)] }]);
        }
    }

    function showBackupWarningBanner(backupsWithWarnings) {
        var container = document.getElementById('backup-restore-area');
        if (!container) return;
        clearBackupWarningBanner();
        if (!backupsWithWarnings || backupsWithWarnings.length === 0) return;
        var banner = document.createElement('div');
        banner.id = 'backup-warning-banner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'background:#ff983022;border:1px solid #ff983066;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:12px;color:#ff9830;';
        var lines = ['<strong>⚠️ Backup warnings:</strong>'];
        backupsWithWarnings.forEach(function(b) {
            (b.warnings || []).forEach(function(w) { lines.push('• ' + w); });
        });
        banner.innerHTML = lines.join('<br>');
        container.parentNode.insertBefore(banner, container.nextSibling);
    }

    function clearBackupWarningBanner() {
        var existing = document.getElementById('backup-warning-banner');
        if (existing) existing.remove();
    }

    async function restoreSelectedBackup() {
        const statusEl = document.getElementById('backup-restore-status');
        const sel = document.getElementById('backup-select');
        try {
            if (!sel || !sel.value) {
                if (statusEl) statusEl.textContent = 'Select a backup first';
                console.warn('[restore] aborted: no backup selected');
                return;
            }
            const choice = sel.value;
            if (!confirm(`Restore backup ${choice}? Current instructions will be safety-backed up first.`)) {
                console.info('[restore] aborted: user cancelled confirm dialog for', choice);
                if (statusEl) statusEl.textContent = 'Restore cancelled';
                return;
            }
            if (statusEl) statusEl.textContent = 'Restoring...';
            console.info('[restore] POST /api/admin/maintenance/restore', { backupId: choice });
            const res = await adminAuth.adminFetch('/api/admin/maintenance/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupId: choice }) });
            console.info('[restore] response status', res.status);
            const data = await res.json().catch(function(e){ console.error('[restore] failed to parse JSON', e); return { success: false, error: 'invalid JSON response' }; });
            console.info('[restore] response body', data);
            if (res.ok && data.success) {
                if (statusEl) statusEl.textContent = `Restored ${choice} (${data.restored || 0} files)`;
                if (typeof showSuccess === 'function') showSuccess(`Restored ${choice} (${data.restored || 0} files)`);
                // Re-load stats & instructions to reflect changes
                if (typeof loadOverviewData === 'function') loadOverviewData();
                if (typeof currentSection !== 'undefined' && currentSection === 'instructions' && typeof loadInstructions === 'function') loadInstructions();
                loadBackups();
            } else {
                const msg = `Restore failed: ${data.error || data.message || ('HTTP ' + res.status)}`;
                if (statusEl) statusEl.textContent = msg;
                console.error('[restore]', msg);
                alert(msg);
            }
        } catch (err) {
            console.error('[restore] exception', err);
            if (statusEl) statusEl.textContent = 'Error restoring backup: ' + (err && err.message || err);
            alert('Error restoring backup: ' + (err && err.message || err));
        }
    }

    async function loadMaintenanceStatus() {
        try {
            const response = await adminAuth.adminFetch('/api/admin/maintenance');
            const data = await response.json();

            if (data.success) {
                if (typeof displayMaintenanceStatus === 'function') displayMaintenanceStatus(data.maintenance); // lgtm[js/unneeded-defensive-code] — global may load asynchronously across dashboard panels
            } else {
                if (typeof showError === 'function') showError('Failed to load maintenance status');
            }
        } catch (error) {
            console.error('Error loading maintenance status:', error);
            if (typeof showError === 'function') showError('Failed to load maintenance status');
        }
    }

    function displayMaintenanceStatus(maintenance) {
        let html = `
            <div style="margin-top:12px; font-weight:600; font-size:13px;">index Normalization</div>
            <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              <button class="action-btn" id="normalize-dryrun-btn" style="padding:4px 10px; font-size:11px;">Dry Run Normalize</button>
              <button class="action-btn warning" id="normalize-apply-btn" style="padding:4px 10px; font-size:11px;">Apply Normalize</button>
              <label style="display:flex; align-items:center; gap:4px; font-size:11px; opacity:.8;"><input type="checkbox" id="normalize-force-canon"/> Force Canonical Hash</label>
              <span id="normalize-status" style="font-size:11px; opacity:.7;"></span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Last Backup</span>
                <span class="stat-value">${maintenance.lastBackup ? new Date(maintenance.lastBackup).toLocaleString() : 'Never'}</span>
            </div>
            <div style="margin-top:10px; font-weight:600; font-size:13px;">Backups</div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:4px;">
                                <button class="action-btn" style="padding:4px 8px; font-size:11px;" onclick="selectLatestBackup()">Select Latest</button>
                                <button class="action-btn danger" style="padding:4px 8px; font-size:11px;" onclick="deleteSelectedBackup()">Delete Selected</button>
                                <button class="action-btn warning" style="padding:4px 8px; font-size:11px;" onclick="promptPruneBackups()">Prune…</button>
                                <input id="backup-search" type="text" placeholder="Filter (id / schema)" oninput="filterBackupRows()" style="flex:1; min-width:160px; padding:4px 6px; background:#1f2228; border:1px solid #2c3038; border-radius:4px; color:#d0d4d8; font-size:12px;" />
                                <span id="backup-filter-count" style="font-size:11px; opacity:.65;"></span>
                            </div>
                            <div id="backup-list-full" style="margin-top:6px; font-size:12px; line-height:1.25; max-height:260px; overflow:auto; border:1px solid #2c3038; border-radius:4px; padding:6px; background:#1f2228;">
                                Loading backups...
                            </div>
        `;

        const target = document.getElementById('maintenance-control');
        if (target) target.innerHTML = html;

                // Wire normalization buttons after HTML injection
                setTimeout(() => {
                    const dryBtn = document.getElementById('normalize-dryrun-btn');
                    const applyBtn = document.getElementById('normalize-apply-btn');
                    const statusEl = document.getElementById('normalize-status');
                    const forceBox = document.getElementById('normalize-force-canon');
                    async function doNormalize(dryRun){
                        if(!dryBtn || !applyBtn) return;
                        dryBtn.disabled = true; applyBtn.disabled = true;
                        if(statusEl) statusEl.textContent = dryRun? 'Running dry run...' : 'Normalizing...';
                        try {
                            const res = await adminAuth.adminFetch('/api/admin/maintenance/normalize', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ dryRun, forceCanonical: !!(forceBox&&forceBox.checked) }) });
                            const data = await res.json();
                            if(data.success){
                                const s = data.summary || {};
                                const msg = `${dryRun? 'DryRun':'Applied'}: changed=${s.changed||0} hash=${s.fixedHash||0} ver=${s.fixedVersion||0} tier=${s.fixedTier||0} ts=${s.addedTimestamps||0}`;
                                if(statusEl) statusEl.textContent = msg;
                                if(!dryRun && typeof loadOverviewData==='function') loadOverviewData();
                                if(!dryRun && typeof currentSection !== 'undefined' && currentSection==='instructions' && typeof loadInstructions==='function') loadInstructions();
                            } else {
                                if(statusEl) statusEl.textContent = 'Normalize failed: ' + (data.error||'unknown');
                            }
                        } catch(e){ if(statusEl) statusEl.textContent = 'Normalize error'; }
                        finally { if(dryBtn) dryBtn.disabled=false; if(applyBtn) applyBtn.disabled=false; }
                    }
                    if(dryBtn) dryBtn.addEventListener('click', ()=> doNormalize(true));
                    if(applyBtn) applyBtn.addEventListener('click', ()=> { if(confirm('Apply normalization changes to disk?')) doNormalize(false); });
                },0);

        // Async load & render full backup list (separate from restore dropdown)
        (async () => {
            const container = document.getElementById('backup-list-full');
            if(!container) return;
            try {
                const res = await adminAuth.adminFetch('/api/admin/maintenance/backups');
                if(!res.ok) throw new Error('request failed');
                const data = await res.json();
                const backups = Array.isArray(data.backups) ? data.backups : [];
                if(backups.length === 0){
                    container.innerHTML = '<div style="opacity:0.6;">(no backups)</div>';
                    return;
                }
                const fmtSize = (n) => {
                    if(!n) return '0 B';
                    const units = ['B','KB','MB','GB'];
                    let u=0, v=n;
                    while(v >= 1024 && u < units.length-1){ v/=1024; u++; }
                    return v.toFixed(v>=100||u===0?0:1)+' '+units[u];
                };
                let table = '<table id="backup-table" style="width:100%; border-collapse:collapse; font-size:11px;">';
                table += '<thead><tr style="text-align:left; background:#1f2228;"><th style="padding:4px;">ID</th><th style="padding:4px;">Created</th><th style="padding:4px;">Files</th><th style="padding:4px;">Size</th><th style="padding:4px;">Schema</th></tr></thead><tbody>';
                backups.forEach(b => {
                    const created = b.createdAt ? new Date(b.createdAt).toLocaleString() : '—';
                    table += `<tr data-backup-id="${b.id}" style="cursor:pointer; border-top:1px solid #2c3038;">
                        <td style="padding:4px; white-space:nowrap;">${b.id}</td>
                        <td style="padding:4px; white-space:nowrap;">${created}</td>
                        <td style="padding:4px;">${b.instructionCount ?? 0}</td>
                        <td style="padding:4px;">${fmtSize(b.sizeBytes||0)}</td>
                        <td style="padding:4px;">${b.schemaVersion || '—'}</td>
                    </tr>`;
                });
                table += '</tbody></table>';
                table += '<div style="margin-top:4px; opacity:0.55;">Click a row to select it for restore. Use filter box to narrow results.</div>';
                container.innerHTML = table;
                container.querySelectorAll('tr[data-backup-id]').forEach(row => {
                    row.addEventListener('click', () => {
                        const id = row.getAttribute('data-backup-id');
                        const sel = document.getElementById('backup-select');
                        if(sel){ sel.value = id; }
                        container.querySelectorAll('tr[data-backup-id]').forEach(r => r.style.background='');
                        row.style.background = '#1f2228';
                        window.__lastSelectedBackupId = id;
                    });
                });
                window.__allBackupRows = backups.map(b => ({ id: b.id, schema: b.schemaVersion || '', created: b.createdAt, count: b.instructionCount }));
                updateBackupFilterCount();
            } catch(err){
                container.innerHTML = '<div style="color:#f2495c;">Error loading backups</div>';
            }
        })();
    }

    function selectLatestBackup(){
        const table = document.getElementById('backup-table');
        if(!table) return;
        const first = table.querySelector('tbody tr[data-backup-id]');
        if(first){ first.click(); }
    }

    async function deleteSelectedBackup(){
        const sel = document.getElementById('backup-select');
        const id = (sel && sel.value) || window.__lastSelectedBackupId;
        if(!id){ alert('Select a backup first'); return; }
        if(!confirm(`Delete backup ${id}? This cannot be undone.`)) return;
        try {
            const res = await adminAuth.adminFetch(`/api/admin/maintenance/backup/${encodeURIComponent(id)}`, { method:'DELETE' });
            const data = await res.json();
            if(data.success){ if (typeof showSuccess === 'function') showSuccess(`Deleted ${id}`); loadMaintenanceStatus(); loadBackups(); }
            else { if (typeof showError === 'function') showError(data.error || 'Delete failed'); }
        } catch(e){ if (typeof showError === 'function') showError('Delete failed'); }
    }

    function promptPruneBackups(){
        const retainStr = prompt('Retain how many newest backups? (0 = delete all)', '10');
        if(retainStr == null) return;
        const retain = parseInt(retainStr,10);
        if(isNaN(retain) || retain < 0){ alert('Enter a non-negative number'); return; }
        pruneBackups(retain);
    }

    async function pruneBackups(retain){
        try {
            const res = await adminAuth.adminFetch('/api/admin/maintenance/backups/prune', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ retain })});
            const data = await res.json();
            if(data.success){
                var msg = data.message || 'Pruned';
                if (data.errors && data.errors.length > 0) {
                    msg += '\n⚠️ ' + data.errors.length + ' error(s):\n' + data.errors.join('\n');
                    if (typeof showError === 'function') showError(msg);
                } else {
                    if (typeof showSuccess === 'function') showSuccess(msg);
                }
                loadMaintenanceStatus(); loadBackups();
            }
            else { if (typeof showError === 'function') showError(data.error || 'Prune failed'); }
        } catch(e){ if (typeof showError === 'function') showError('Prune failed: ' + (e.message || e)); }
    }

    function filterBackupRows(){
        const q = (document.getElementById('backup-search')||{value:''}).value.trim().toLowerCase();
        const table = document.getElementById('backup-table');
        if(!table){ return; }
        let visible = 0, total = 0;
        table.querySelectorAll('tbody tr[data-backup-id]').forEach(tr => {
            total++;
            const id = tr.getAttribute('data-backup-id') || '';
            const schema = (tr.cells[4]?.textContent||'');
            const match = !q || id.toLowerCase().includes(q) || schema.toLowerCase().includes(q);
            tr.style.display = match ? '' : 'none';
            if(match) visible++;
        });
        updateBackupFilterCount(visible, total);
    }

    function updateBackupFilterCount(visible, total){
        const el = document.getElementById('backup-filter-count');
        if(!el) return;
        if(visible == null || total == null){
            const table = document.getElementById('backup-table');
            if(!table){ el.textContent=''; return; }
            const rows = table.querySelectorAll('tbody tr[data-backup-id]');
            total = rows.length; visible = Array.from(rows).filter(r=>r.style.display!=='none').length;
        }
        el.textContent = `${visible}/${total}`;
    }

    async function toggleMaintenanceMode(enable) {
        try {
            const response = await adminAuth.adminFetch('/api/admin/maintenance/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: enable,
                    message: enable ? 'Admin panel maintenance' : undefined
                })
            });

            const data = await response.json();
            if (data.success) {
                if (typeof showSuccess === 'function') showSuccess(data.message);
                loadMaintenanceStatus();
            } else {
                if (typeof showError === 'function') showError('Failed to toggle maintenance mode');
            }
        } catch (error) {
            console.error('Error toggling maintenance mode:', error);
            if (typeof showError === 'function') showError('Failed to toggle maintenance mode');
        }
    }

    async function exportBackupToFile(){
        const sel = document.getElementById('backup-select');
        const id = (sel && sel.value) || window.__lastSelectedBackupId;
        if(!id){ alert('Select a backup first'); return; }
        try {
            const res = await adminAuth.adminFetch('/api/admin/maintenance/backup/' + encodeURIComponent(id) + '/export');
            if(!res.ok){ const d = await res.json().catch(()=>({})); alert('Export failed: '+(d.error||res.statusText)); return; }
            const blob = await res.blob();
            const contentDisposition = res.headers.get('content-disposition') || '';
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            const fallbackName = contentType.includes('application/zip') ? (id + '.zip') : (id + '.json');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = getDownloadFilename(contentDisposition, fallbackName);
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(a.href);
            if(typeof showSuccess === 'function') showSuccess('Exported ' + id);
        } catch(e){ alert('Export error: '+(e.message||e)); }
    }

    function importBackupFromFile(){
        const input = document.getElementById('backup-file-input');
        if(input){ input.value = ''; input.click(); }
    }

    async function handleBackupFileSelected(ev){
        const file = ev.target && ev.target.files && ev.target.files[0];
        if(!file) {
            console.warn('[restore-from-file] no file selected');
            return;
        }
        const statusEl = document.getElementById('backup-restore-status');
        try {
            const lowerName = file.name.toLowerCase();
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const zipBackup = looksLikeZip(bytes) || lowerName.endsWith('.zip');
            console.info('[restore-from-file] selected', { name: file.name, size: file.size, zip: zipBackup });

            if(!zipBackup && !lowerName.endsWith('.json')){ alert('Please select a .json or .zip backup file'); return; }

            // "Restore from File" performs import + restore in one shot via ?restore=1.
            // The current instructions/ are safety-backed up by the server before overwrite.
            const fileCount = zipBackup ? null : (function(){ try { return Object.keys(JSON.parse(new TextDecoder('utf-8').decode(bytes)).files || {}).length; } catch { return null; } })();
            const promptMsg = 'Restore from ' + file.name + '?\n\nThis will overwrite the live instructions. A safety backup of the current state will be taken first.' + (fileCount != null ? '\n\nFile count in bundle: ' + fileCount : '');
            if(!confirm(promptMsg)) {
                console.info('[restore-from-file] cancelled by user');
                if (statusEl) statusEl.textContent = 'Restore cancelled';
                return;
            }

            if (statusEl) statusEl.textContent = 'Importing & restoring ' + file.name + '...';

            let res;
            if(zipBackup){
                console.info('[restore-from-file] POST /api/admin/maintenance/backup/import?restore=1 (zip)', { bytes: arrayBuffer.byteLength });
                res = await adminAuth.adminFetch('/api/admin/maintenance/backup/import?restore=1', {
                    method:'POST',
                    headers:{
                        'Content-Type':'application/zip',
                        'X-Backup-Filename': file.name,
                    },
                    body: arrayBuffer,
                });
            } else {
                const text = new TextDecoder('utf-8').decode(bytes);
                const bundle = JSON.parse(text);
                if(!bundle.files || typeof bundle.files !== 'object'){ alert('Invalid backup file: must contain a "files" object'); return; }
                console.info('[restore-from-file] POST /api/admin/maintenance/backup/import?restore=1 (json)', { files: Object.keys(bundle.files).length });
                res = await adminAuth.adminFetch('/api/admin/maintenance/backup/import?restore=1', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(bundle) });
            }
            console.info('[restore-from-file] response status', res.status);
            const data = await res.json().catch(function(e){ console.error('[restore-from-file] failed to parse JSON', e); return { success: false, error: 'invalid JSON response' }; });
            console.info('[restore-from-file] response body', data);
            if(res.ok && data.success){
                const msg = data.message || ('Imported and restored ' + (data.backupId || ''));
                if(typeof showSuccess === 'function') showSuccess(msg);
                if (statusEl) statusEl.textContent = msg;
                loadMaintenanceStatus();
                loadBackups();
                if (typeof loadOverviewData === 'function') loadOverviewData();
                if (typeof currentSection !== 'undefined' && currentSection === 'instructions' && typeof loadInstructions === 'function') loadInstructions();
            } else {
                const errMsg = 'Restore failed: ' + (data.error || data.message || ('HTTP ' + res.status));
                console.error('[restore-from-file]', errMsg, data);
                if (statusEl) statusEl.textContent = errMsg;
                alert(errMsg);
            }
        } catch(e){
            console.error('[restore-from-file] exception', e);
            if (statusEl) statusEl.textContent = 'Error: ' + (e.message||e);
            alert('Restore-from-file error: '+(e.message||e));
        }
    }

    // Signal Groom: apply usage signals to instruction priority/requirement
    async function runSignalGroom(dryRun) {
        const statusEl = document.getElementById('signal-groom-status');
        if (statusEl) statusEl.innerHTML = '<span style="opacity:.7;">Running groom' + (dryRun ? ' (dry run)' : '') + '...</span>';
        try {
            const res = await adminAuth.adminFetch('/api/tools/index_groom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: { dryRun: !!dryRun } })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Groom failed');
            const result = data.result || data;
            const parts = [];
            if (result.signalApplied != null) parts.push('Signals applied: ' + result.signalApplied);
            if (result.repairedHashes) parts.push('Hashes repaired: ' + result.repairedHashes);
            if (result.normalizedCategories) parts.push('Categories normalized: ' + result.normalizedCategories);
            if (result.filesRewritten) parts.push('Files rewritten: ' + result.filesRewritten);
            if (result.dryRun) parts.push('(dry run - no changes written)');
            if (statusEl) statusEl.innerHTML = '<span style="color:#73bf69;">' + (parts.join(' | ') || 'Done') + '</span>';
        } catch (e) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#f2495c;">Error: ' + (e.message || e) + '</span>';
        }
    }

    // Expose to global for staged migration
    window.loadBackups = loadBackups;
    window.restoreSelectedBackup = restoreSelectedBackup;
    window.loadMaintenanceStatus = loadMaintenanceStatus;
    window.displayMaintenanceStatus = displayMaintenanceStatus;
    window.selectLatestBackup = selectLatestBackup;
    window.deleteSelectedBackup = deleteSelectedBackup;
    window.promptPruneBackups = promptPruneBackups;
    window.pruneBackups = pruneBackups;
    window.filterBackupRows = filterBackupRows;
    window.updateBackupFilterCount = updateBackupFilterCount;
    window.toggleMaintenanceMode = toggleMaintenanceMode;
    window.exportBackupToFile = exportBackupToFile;
    window.importBackupFromFile = importBackupFromFile;
    window.handleBackupFileSelected = handleBackupFileSelected;
    window.runSignalGroom = runSignalGroom;
})();

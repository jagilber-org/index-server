/* eslint-disable */
// admin.utils.js
// Shared helper utilities for admin UI. Keep this file small and stable.
(function(window){
  'use strict';

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes){
    const sizes = ['B','KB','MB','GB'];
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  function showError(message){
    const container = document.querySelector('.admin-container');
    if(!container) return;
    document.querySelectorAll('.error, .success').forEach(el => el.remove());
    const d = document.createElement('div'); d.className='error'; d.textContent = message;
    container.insertBefore(d, container.firstChild.nextSibling);
    setTimeout(()=> d.remove(), 5000);
  }

  function showSuccess(message){
    const container = document.querySelector('.admin-container');
    if(!container) return;
    document.querySelectorAll('.error, .success').forEach(el => el.remove());
    const d = document.createElement('div'); d.className='success'; d.textContent = message;
    container.insertBefore(d, container.firstChild.nextSibling);
    setTimeout(()=> d.remove(), 5000);
  }

  // Expose minimal API
  window.adminUtils = Object.assign(window.adminUtils || {}, {
    escapeHtml,
    formatBytes,
    showError,
    showSuccess
  });
})(window);

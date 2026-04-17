/* eslint-disable */
// admin.instances.js — Instance discovery widget for admin dashboard
(function(){
  'use strict';

  var _dropdownOpen = false;

  /** Fetch instances from the API and render the widget. */
  function loadInstances(){
    adminAuth.adminFetch('/api/instances')
      .then(function(res){ return res.ok ? res.json() : null; })
      .then(function(data){
        if(!data || !data.instances) return;
        renderInstances(data);
      })
      .catch(function(){ /* silently ignore fetch errors */ });
  }

  /** Render the instances badge count and dropdown list. */
  function renderInstances(data){
    var widget = document.getElementById('instances-widget');
    var badge = document.getElementById('instances-badge');
    var countEl = document.getElementById('instances-count');
    var pluralEl = document.getElementById('instances-plural');
    var listEl = document.getElementById('instances-list');
    if(!widget || !badge || !countEl || !listEl) return;

    var instances = data.instances || [];
    var count = instances.length;

    // Show widget once we have data
    widget.style.display = 'inline-block';

    // Update badge
    countEl.textContent = String(count);
    if(pluralEl) pluralEl.textContent = count === 1 ? '' : 's';
    if(count > 0){ badge.classList.add('multi'); } else { badge.classList.remove('multi'); }

    // Render dropdown list
    var html = '';
    for(var i = 0; i < instances.length; i++){
      var inst = instances[i];
      var dotClass = inst.current ? 'instance-dot current' : 'instance-dot alive';
      var itemClass = inst.current ? 'instance-item current' : 'instance-item';
      var tag = inst.current ? '<span class="instance-tag">(this)</span>' : '';
      var uptime = inst.startedAt ? timeSince(inst.startedAt) : '';
      var url = location.protocol + '//' + (inst.host || '127.0.0.1') + ':' + inst.port + '/admin';
      html += '<a class="' + itemClass + '" href="' + url + '" title="PID ' + inst.pid + '">'
        + '<span class="' + dotClass + '"></span>'
        + '<span class="instance-port">:' + inst.port + '</span>'
        + tag
        + '<span class="instance-meta">PID ' + inst.pid + (uptime ? ' · ' + uptime : '') + '</span>'
        + '</a>';
    }
    listEl.innerHTML = html;
  }

  /** Toggle the dropdown visibility. */
  function toggleDropdown(e){
    if(e) { e.stopPropagation(); }
    var dd = document.getElementById('instances-dropdown');
    if(!dd) return;
    _dropdownOpen = !_dropdownOpen;
    if(_dropdownOpen){
      dd.classList.remove('hidden');
      // Refresh data when opening
      loadInstances();
    } else {
      dd.classList.add('hidden');
    }
  }

  /** Close dropdown when clicking outside. */
  function closeDropdownOnOutsideClick(e){
    if(!_dropdownOpen) return;
    var widget = document.getElementById('instances-widget');
    if(widget && !widget.contains(e.target)){
      _dropdownOpen = false;
      var dd = document.getElementById('instances-dropdown');
      if(dd) dd.classList.add('hidden');
    }
  }

  /** Simple "time since" formatter. */
  function timeSince(isoStr){
    try {
      var ms = Date.now() - new Date(isoStr).getTime();
      if(ms < 0) return '';
      var sec = Math.floor(ms / 1000);
      if(sec < 60) return sec + 's';
      var min = Math.floor(sec / 60);
      if(min < 60) return min + 'm';
      var hr = Math.floor(min / 60);
      if(hr < 24) return hr + 'h ' + (min % 60) + 'm';
      var d = Math.floor(hr / 24);
      return d + 'd ' + (hr % 24) + 'h';
    } catch(e){ return ''; }
  }

  // Wire up on DOM ready
  document.addEventListener('DOMContentLoaded', function(){
    var badge = document.getElementById('instances-badge');
    if(badge) badge.addEventListener('click', toggleDropdown);
    document.addEventListener('click', closeDropdownOnOutsideClick);

    // Initial load
    loadInstances();

    // Poll every 5 seconds for fast instance discovery
    setInterval(loadInstances, 5000);

    // Also reload immediately when tab becomes visible
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden) loadInstances();
    });
  });

  // Expose for auto-refresh integration
  window.loadInstances = loadInstances;
})();

/**
 * @vitest-environment jsdom
 *
 * Behavioral coverage for the messaging tab's auto refresh.
 *
 * Loads the REAL `admin.messaging.js` into a DOM and drives its exported entry
 * points, so these exercise production code rather than a reimplementation.
 *
 * The contract under test is not just "it polls" — it is "it polls without ever
 * disturbing what the user is doing". Each guard gets a test that fails if the
 * guard is removed, plus the two properties that make a silent background
 * repaint tolerable: no DOM churn when nothing changed, and no lost selection
 * or scroll position when something did.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.messaging.js');
const source = fs.readFileSync(CLIENT_JS, 'utf8');

type W = Window & typeof globalThis & Record<string, any>;

interface Msg {
  id: string;
  channel: string;
  sender: string;
  body: string;
  createdAt: string;
  recipients?: string[];
  priority?: string;
  readBy?: string[];
}

/** Server state the fake adminFetch serves; mutate it to simulate new traffic. */
let serverMessages: Msg[];
let fetchLog: string[];
/** When set, channel/message fetches park on this until it is released. */
let gate: { promise: Promise<void>; release: () => void } | null;

function msg(id: string, body = `body ${id}`): Msg {
  return {
    id,
    channel: 'general',
    sender: 'agent-a',
    body,
    createdAt: `2026-08-18T10:00:${id.padStart(2, '0')}Z`,
    recipients: ['*'],
    priority: 'normal',
    readBy: [],
  };
}

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function loadModule(): W {
  const w = window as unknown as W;
  document.body.innerHTML = `
    <div id="messaging-section" class="admin-section">
      <div class="msg-sidebar">
        <div id="msg-summary"></div>
        <div id="messaging-channel-list"></div>
        <div id="messaging-sender-list"></div>
      </div>
      <div class="msg-main">
        <input id="msg-search" data-action="filter-input" />
        <input type="checkbox" id="msg-select-all" data-action="select-all" />
        <input type="checkbox" id="msg-auto-refresh" data-action="toggle-auto-refresh" checked />
        <span id="msg-refresh-status"></span>
        <span id="msg-count"></span>
        <div id="messaging-message-list"></div>
        <div id="messaging-pagination"></div>
      </div>
      <div class="msg-compose">
        <input id="msg-compose-channel" />
        <input id="msg-compose-sender" />
        <input id="msg-compose-recipients" value="*" />
        <input id="msg-compose-tags" />
        <select id="msg-compose-priority"><option value="normal">Normal</option></select>
        <textarea id="msg-compose-body"></textarea>
      </div>
      <div id="messaging-detail"></div>
    </div>`;

  w.adminUtils = { escapeHtml: (s: unknown) => String(s ?? '') };
  w.adminAuth = {
    adminFetch: async (url: string) => {
      fetchLog.push(String(url));
      if (gate) await gate.promise;
      if (String(url).includes('/api/messages/channels')) {
        return jsonResponse({ channels: [{ channel: 'general', messageCount: serverMessages.length }] });
      }
      return jsonResponse({ messages: serverMessages.map(m => ({ ...m })) });
    },
  };

  // Evaluate the real production IIFE against this DOM.
  w.eval(source);
  return w;
}

function openGate() {
  let release!: () => void;
  const promise = new Promise<void>(r => { release = r; });
  gate = { promise, release };
  return gate;
}

/** Let queued microtasks drain. */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function renderedIds(): string[] {
  return Array.from(document.querySelectorAll('#messaging-message-list .msg-card'))
    .map(el => (el as HTMLElement).dataset.id || '');
}

describe('messaging auto refresh (behavioral)', () => {
  beforeEach(() => {
    serverMessages = [msg('1'), msg('2')];
    fetchLog = [];
    gate = null;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('picks up messages created by other processes without any user action', async () => {
    const w = loadModule();
    await w.initMessaging();
    expect(renderedIds()).toEqual(['2', '1']);

    // A message written by an agent over the stdio MCP server: no websocket
    // event ever reaches this browser, so only the poll can surface it.
    serverMessages = [msg('3'), msg('1'), msg('2')];
    await w.msgAutoRefreshTick();
    await flush();

    expect(renderedIds()).toEqual(['3', '2', '1']);
  });

  it('installs a repeating poll rather than refreshing only once', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window, 'setInterval');
    const w = loadModule();
    await w.initMessaging();

    expect(spy).toHaveBeenCalled();
    const [, delay] = spy.mock.calls[spy.mock.calls.length - 1];
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(60000);
  });

  describe('guards — must not disturb current activity', () => {
    it('does not refresh while a detail/edit modal is open', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgEdit('1');
      expect(document.getElementById('messaging-detail')!.childElementCount).toBeGreaterThan(0);

      const before = fetchLog.length;
      expect(w.msgAutoRefreshBlockedReason()).toBe('editing');
      await w.msgAutoRefreshTick();
      await flush();

      expect(fetchLog.length, 'no network while a modal is open').toBe(before);
    });

    it('does not discard text typed into an open edit form', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgEdit('1');
      const ta = document.getElementById('msg-edit-body') as HTMLTextAreaElement;
      ta.value = 'half-written reply';

      serverMessages = [msg('9'), msg('1'), msg('2')];
      await w.msgAutoRefreshTick();
      await flush();

      expect((document.getElementById('msg-edit-body') as HTMLTextAreaElement).value)
        .toBe('half-written reply');
    });

    it('does not refresh while focus is in a messaging input', async () => {
      const w = loadModule();
      await w.initMessaging();

      const search = document.getElementById('msg-search') as HTMLInputElement;
      search.focus();

      expect(w.msgAutoRefreshBlockedReason()).toBe('typing');
      const before = fetchLog.length;
      await w.msgAutoRefreshTick();
      await flush();
      expect(fetchLog.length).toBe(before);
    });

    it('does not refresh while an unsent compose draft exists', async () => {
      const w = loadModule();
      await w.initMessaging();

      const body = document.getElementById('msg-compose-body') as HTMLTextAreaElement;
      body.value = 'draft in progress';
      (document.activeElement as HTMLElement | null)?.blur();

      expect(w.msgAutoRefreshBlockedReason()).toBe('composing');
      const before = fetchLog.length;
      await w.msgAutoRefreshTick();
      await flush();
      expect(fetchLog.length).toBe(before);
    });

    it('does not refresh while the browser tab is backgrounded', async () => {
      const w = loadModule();
      await w.initMessaging();

      const spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      expect(w.msgAutoRefreshBlockedReason()).toBe('background');
      const before = fetchLog.length;
      await w.msgAutoRefreshTick();
      await flush();
      expect(fetchLog.length).toBe(before);
      spy.mockRestore();
    });

    it('does not refresh while the messaging section is not the active tab', async () => {
      const w = loadModule();
      await w.initMessaging();

      document.getElementById('messaging-section')!.classList.add('hidden');
      expect(w.msgAutoRefreshBlockedReason()).toBe('section-hidden');
      const before = fetchLog.length;
      await w.msgAutoRefreshTick();
      await flush();
      expect(fetchLog.length).toBe(before);
    });

    it('does not repaint when a modal opens WHILE the fetch is in flight', async () => {
      const w = loadModule();
      await w.initMessaging();
      expect(renderedIds()).toEqual(['2', '1']);

      // Start a tick and stall it mid-fetch.
      const g = openGate();
      serverMessages = [msg('7'), msg('1'), msg('2')];
      const tick = w.msgAutoRefreshTick();
      await flush();

      // User opens a message while the request is outstanding.
      gate = null;
      w.msgDetail('1');
      g.release();
      await tick;
      await flush();

      expect(renderedIds(), 'list must not change under an open modal').toEqual(['2', '1']);
      expect(document.querySelector('.msg-modal'), 'modal stays open').not.toBeNull();
    });

    it('honours the auto-refresh off switch and persists the choice', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgSetAutoRefresh(false);
      serverMessages = [msg('4'), msg('1'), msg('2')];
      const before = fetchLog.length;
      await w.msgAutoRefreshTick();
      await flush();

      expect(fetchLog.length).toBe(before);
      expect(renderedIds()).toEqual(['2', '1']);

      // A fresh page load keeps the preference.
      const w2 = loadModule();
      await w2.initMessaging();
      expect((document.getElementById('msg-auto-refresh') as HTMLInputElement).checked).toBe(false);
    });
  });

  describe('non-destructive repaint', () => {
    it('leaves the DOM untouched when nothing changed', async () => {
      const w = loadModule();
      await w.initMessaging();
      const firstCard = document.querySelector('#messaging-message-list .msg-card');

      await w.msgAutoRefreshTick();
      await flush();

      expect(fetchLog.some(u => u.includes('/api/messages/channels')), 'it did poll').toBe(true);
      expect(
        document.querySelector('#messaging-message-list .msg-card'),
        'identical data must not rebuild the list',
      ).toBe(firstCard);
    });

    it('keeps checkbox selections for messages that still exist', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgToggleSelect('2', true);
      serverMessages = [msg('5'), msg('1'), msg('2')];
      await w.msgAutoRefreshTick();
      await flush();

      expect(renderedIds()).toEqual(['5', '2', '1']);
      const box = document.querySelector('.msg-card[data-id="2"] .msg-card-checkbox') as HTMLInputElement;
      expect(box.checked, 'selection survives a background refresh').toBe(true);
    });

    it('drops selections for messages that disappeared', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgToggleSelect('2', true);
      serverMessages = [msg('1')];
      await w.msgAutoRefreshTick();
      await flush();

      expect(renderedIds()).toEqual(['1']);
      // Re-adding message 2 must not resurrect a stale selection.
      serverMessages = [msg('2'), msg('1')];
      await w.msgAutoRefreshTick();
      await flush();
      const box = document.querySelector('.msg-card[data-id="2"] .msg-card-checkbox') as HTMLInputElement;
      expect(box.checked).toBe(false);
    });

    it('preserves the active channel/sender/search filters across a refresh', async () => {
      const w = loadModule();
      await w.initMessaging();

      w.msgFilter('body 1');
      expect(renderedIds()).toEqual(['1']);

      serverMessages = [msg('6'), msg('1'), msg('2')];
      await w.msgAutoRefreshTick();
      await flush();

      expect(renderedIds(), 'filter still applied after refresh').toEqual(['1']);
    });

    it('restores scroll position after a repaint', async () => {
      const w = loadModule();
      await w.initMessaging();

      const scrollTo = vi.fn();
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
      Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
      Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo });

      serverMessages = [msg('8'), msg('1'), msg('2')];
      await w.msgAutoRefreshTick();
      await flush();

      expect(scrollTo).toHaveBeenCalledWith(0, 240);
    });
  });

  describe('websocket wiring', () => {
    it('registers on the shared listener list instead of monkey-patching onmessage', async () => {
      const w = loadModule();
      expect(Array.isArray(w.dashboardSocketListeners)).toBe(true);
      expect(w.dashboardSocketListeners.length).toBeGreaterThan(0);
    });

    it('refreshes when a message_received event arrives', async () => {
      vi.useFakeTimers();
      const w = loadModule();
      await w.initMessaging();

      serverMessages = [msg('10'), msg('1'), msg('2')];
      for (const fn of w.dashboardSocketListeners) fn({ type: 'message_received' });
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
      await flush();

      expect(renderedIds()).toEqual(['10', '2', '1']);
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * Behavioral coverage for the nav-tab counter bubbles (messaging, instructions,
 * feedback). Loads the REAL admin.nav-bubbles.js into a DOM and exercises the
 * polling / reset lifecycle.
 *
 * Contract under test:
 *   1. First poll establishes a baseline — no bubble shown.
 *   2. Subsequent polls show delta (current − lastSeen), capped at 99+.
 *   3. Clicking a tab resets its bubble to hidden.
 *   4. While viewing a tab, its lastSeen tracks current (no stale bubble).
 *   5. Negative deltas (e.g. purged items) never show a bubble.
 *   6. WebSocket `message_received` triggers an immediate messaging poll.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.nav-bubbles.js');
const source = fs.readFileSync(CLIENT_JS, 'utf8');

type W = Window & typeof globalThis & Record<string, any>;

let serverCounts: { messaging: number; instructions: number; feedback: number };
let fetchLog: string[];

function buildDom(): W {
  const w = window as unknown as W;
  document.body.innerHTML = `
    <div class="admin-nav">
      <button class="nav-btn" data-section="messaging">Messaging<span id="nav-messaging-bubble" class="nav-bubble" hidden></span></button>
      <button class="nav-btn" data-section="instructions">Instructions<span id="nav-instructions-bubble" class="nav-bubble" hidden></span></button>
      <button class="nav-btn" data-section="feedback">Feedback<span id="nav-feedback-bubble" class="nav-bubble" hidden></span></button>
    </div>
  `;

  fetchLog = [];
  w.adminAuth = {
    adminFetch: async (url: string) => {
      fetchLog.push(String(url));
      if (String(url).includes('/api/messages/stats')) {
        return { ok: true, json: async () => ({ success: true, total: serverCounts.messaging, unread: 0, channels: 1 }) };
      }
      if (String(url).includes('/api/instructions')) {
        return { ok: true, json: async () => ({ success: true, count: serverCounts.instructions, instructions: [] }) };
      }
      if (String(url).includes('/api/admin/feedback')) {
        return { ok: true, json: async () => ({ entries: [], total: serverCounts.feedback, lastUpdated: '2026-08-18T00:00:00Z' }) };
      }
      return { ok: true, json: async () => ({ success: false }) };
    },
  };
  w.currentSection = 'overview';
  w.dashboardSocketListeners = [];
  return w;
}

function loadModule(): W {
  const w = buildDom();
  w.eval(source);
  return w;
}

async function flush(times = 12) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function getBubble(id: string) {
  return document.getElementById(id) as HTMLSpanElement;
}

describe('admin.nav-bubbles', () => {
  beforeEach(() => {
    serverCounts = { messaging: 5, instructions: 10, feedback: 3 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    const w = window as unknown as W;
    delete w._navBubbles;
    delete w.adminAuth;
    w.dashboardSocketListeners = [];
  });

  it('first poll establishes baseline — no bubble visible', async () => {
    loadModule();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(true);
    expect(getBubble('nav-instructions-bubble').hidden).toBe(true);
    expect(getBubble('nav-feedback-bubble').hidden).toBe(true);
  });

  it('shows count delta when items increase', async () => {
    const w = loadModule();
    await flush();

    serverCounts.messaging = 8;
    serverCounts.instructions = 12;
    serverCounts.feedback = 4;

    w._navBubbles.pollAll();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(false);
    expect(getBubble('nav-messaging-bubble').textContent).toBe('3');

    expect(getBubble('nav-instructions-bubble').hidden).toBe(false);
    expect(getBubble('nav-instructions-bubble').textContent).toBe('2');

    expect(getBubble('nav-feedback-bubble').hidden).toBe(false);
    expect(getBubble('nav-feedback-bubble').textContent).toBe('1');
  });

  it('caps display at 99+', async () => {
    const w = loadModule();
    await flush();

    serverCounts.messaging = 205;
    w._navBubbles.pollAll();
    await flush();

    const bubble = getBubble('nav-messaging-bubble');
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe('99+');
  });

  it('clicking tab resets its bubble', async () => {
    const w = loadModule();
    await flush();

    serverCounts.messaging = 10;
    w._navBubbles.pollAll();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(false);

    const btn = document.querySelector('[data-section="messaging"]') as HTMLButtonElement;
    btn.click();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(true);
  });

  it('does not show bubble for negative deltas (items purged)', async () => {
    const w = loadModule();
    await flush();

    serverCounts.messaging = 2;
    w._navBubbles.pollAll();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(true);
  });

  it('keeps lastSeen in sync while viewing a tab', async () => {
    const w = loadModule();
    await flush();

    w.currentSection = 'messaging';
    const btn = document.querySelector('[data-section="messaging"]') as HTMLButtonElement;
    btn.click();

    serverCounts.messaging = 15;
    w._navBubbles.pollAll();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(true);

    w.currentSection = 'overview';

    serverCounts.messaging = 18;
    w._navBubbles.pollAll();
    await flush();

    const bubble = getBubble('nav-messaging-bubble');
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe('3');
  });

  it('WebSocket message_received triggers immediate messaging poll', async () => {
    const w = loadModule();
    await flush();

    const initialFetchCount = fetchLog.filter((u) => u.includes('/api/messages/stats')).length;

    serverCounts.messaging = 7;
    for (const listener of w.dashboardSocketListeners) {
      listener({ type: 'message_received' });
    }
    await flush();

    const afterFetchCount = fetchLog.filter((u) => u.includes('/api/messages/stats')).length;
    expect(afterFetchCount).toBeGreaterThan(initialFetchCount);

    const bubble = getBubble('nav-messaging-bubble');
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe('2');
  });

  it('clicking bubble span inside button still resets (event delegation)', async () => {
    const w = loadModule();
    await flush();

    serverCounts.feedback = 6;
    w._navBubbles.pollAll();
    await flush();

    const bubble = getBubble('nav-feedback-bubble');
    expect(bubble.hidden).toBe(false);

    bubble.click();

    expect(bubble.hidden).toBe(true);
  });

  it('each tab resets independently', async () => {
    const w = loadModule();
    await flush();

    serverCounts.messaging = 8;
    serverCounts.instructions = 14;
    serverCounts.feedback = 7;
    w._navBubbles.pollAll();
    await flush();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(false);
    expect(getBubble('nav-instructions-bubble').hidden).toBe(false);
    expect(getBubble('nav-feedback-bubble').hidden).toBe(false);

    (document.querySelector('[data-section="messaging"]') as HTMLButtonElement).click();

    expect(getBubble('nav-messaging-bubble').hidden).toBe(true);
    expect(getBubble('nav-instructions-bubble').hidden).toBe(false);
    expect(getBubble('nav-feedback-bubble').hidden).toBe(false);
  });

  it('installs a repeating poll interval', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(window, 'setInterval');
    loadModule();

    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toBe(15000);
  });
});

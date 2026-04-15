import { test, expect, Page } from '@playwright/test';

/**
 * Playwright E2E tests for the messaging dashboard panel.
 * Tests navigation, compose, send, display, and filter functionality.
 */

test.describe('Messaging Dashboard @baseline', () => {
  async function goto(page: Page) {
    await page.goto('/admin');
    await page.waitForSelector('.admin-root, body');
  }

  async function navigateToMessaging(page: Page) {
    await goto(page);
    const navBtn = page.locator('.nav-btn[data-section="messaging"]');
    await expect(navBtn).toBeVisible({ timeout: 5000 });
    await navBtn.click();
    await page.waitForSelector('#messaging-section', { state: 'visible', timeout: 5000 });
  }

  test('messaging nav button is visible', async ({ page }) => {
    await goto(page);
    await expect(page.locator('.nav-btn[data-section="messaging"]')).toBeVisible();
  });

  test('messaging section loads on click', async ({ page }) => {
    await navigateToMessaging(page);
    await expect(page.locator('#messaging-section')).toBeVisible();
    await expect(page.locator('#messaging-channel-list')).toBeVisible();
    await expect(page.locator('#messaging-message-list')).toBeVisible();
  });

  test('compose form elements exist', async ({ page }) => {
    await navigateToMessaging(page);
    await expect(page.locator('#msg-compose-channel')).toBeVisible();
    await expect(page.locator('#msg-compose-body')).toBeVisible();
    await expect(page.locator('#msg-compose-sender')).toBeVisible();
    await expect(page.locator('#msg-compose-recipients')).toBeVisible();
  });

  test('send a message and see it in the list', async ({ page }) => {
    await navigateToMessaging(page);

    // Fill compose form
    await page.fill('#msg-compose-channel', 'e2e-test');
    await page.fill('#msg-compose-sender', 'playwright');
    await page.fill('#msg-compose-body', 'Hello from Playwright E2E test');

    // Send
    await page.click('button:has-text("Send")');

    // Wait for refresh and verify message appears
    await page.waitForTimeout(1000);
    const messageList = page.locator('#messaging-message-list');
    await expect(messageList.locator('.message-item')).toHaveCount(1, { timeout: 5000 });
    await expect(messageList).toContainText('Hello from Playwright E2E test');
    await expect(messageList).toContainText('playwright');
  });

  test('search filter narrows messages', async ({ page }) => {
    await navigateToMessaging(page);

    // Send two messages
    await page.fill('#msg-compose-channel', 'filter-test');
    await page.fill('#msg-compose-body', 'alpha message');
    await page.click('button:has-text("Send")');
    await page.waitForTimeout(500);

    await page.fill('#msg-compose-body', 'beta message');
    await page.click('button:has-text("Send")');
    await page.waitForTimeout(500);

    // Filter for 'alpha'
    await page.fill('#msg-search', 'alpha');
    await page.waitForTimeout(300);

    const items = page.locator('#messaging-message-list .message-item');
    await expect(items).toHaveCount(1, { timeout: 3000 });
    await expect(items.first()).toContainText('alpha');
  });

  test('refresh button reloads messages', async ({ page }) => {
    await navigateToMessaging(page);
    const refreshBtn = page.locator('button:has-text("Refresh")');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // Should not throw — just verify it completes
    await page.waitForTimeout(500);
  });

  test('channel list shows channels with counts', async ({ page }) => {
    await navigateToMessaging(page);

    // Send messages to different channels
    for (const ch of ['channel-a', 'channel-b']) {
      await page.fill('#msg-compose-channel', ch);
      await page.fill('#msg-compose-body', `msg for ${ch}`);
      await page.click('button:has-text("Send")');
      await page.waitForTimeout(500);
    }

    const channelList = page.locator('#messaging-channel-list');
    await expect(channelList.locator('.channel-item')).toHaveCount(2, { timeout: 5000 });
  });
});

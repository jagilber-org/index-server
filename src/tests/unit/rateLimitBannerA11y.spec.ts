/**
 * Rate-Limit Banner Accessibility Tests — Issue #63 frontend verification
 *
 * Validates the accessible rate-limit banner code in admin.utils.js:
 *   - Banner sets role="alert" for screen readers
 *   - Banner sets aria-live="assertive"
 *   - Emoji decoration has aria-hidden="true"
 *   - Tier label distinguishes 'global' from 'mutation'
 *   - clearRateLimitBanner cleanup
 *
 * Tests the JavaScript source structurally (no DOM needed for these checks).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const UTILS_JS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'dashboard', 'client', 'js', 'admin.utils.js'),
  'utf-8',
);

const AUTH_JS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'dashboard', 'client', 'js', 'admin.auth.js'),
  'utf-8',
);

describe('Rate-limit banner accessibility (issue #63 frontend)', () => {
  describe('admin.utils.js showRateLimitBanner', () => {
    it('creates banner with role="alert"', () => {
      expect(UTILS_JS).toContain("setAttribute('role', 'alert')");
    });

    it('sets aria-live="assertive" for screen reader announcements', () => {
      expect(UTILS_JS).toContain("setAttribute('aria-live', 'assertive')");
    });

    it('marks emoji decoration as aria-hidden="true"', () => {
      expect(UTILS_JS).toContain('aria-hidden="true"');
    });

    it('distinguishes mutation tier label from global', () => {
      expect(UTILS_JS).toContain("tier === 'mutation'");
      expect(UTILS_JS).toContain('Mutation rate limit');
      expect(UTILS_JS).toContain('Rate limit');
    });

    it('includes a countdown element for retry timer', () => {
      expect(UTILS_JS).toContain('rl-countdown');
      expect(UTILS_JS).toContain('retryAfterSeconds');
    });

    it('exposes showRateLimitBanner and clearRateLimitBanner on window.adminUtils', () => {
      expect(UTILS_JS).toContain('showRateLimitBanner');
      expect(UTILS_JS).toContain('clearRateLimitBanner');
    });

    it('clearRateLimitBanner removes banner and clears interval', () => {
      expect(UTILS_JS).toContain("document.getElementById('rate-limit-banner')");
      expect(UTILS_JS).toContain('clearInterval');
      expect(UTILS_JS).toContain('.remove()');
    });
  });

  describe('admin.auth.js 429 integration', () => {
    it('detects 429 response and parses tier from body', () => {
      expect(AUTH_JS).toContain('response.status === 429');
      expect(AUTH_JS).toContain('rlBody.tier');
    });

    it('falls back tier to global when not in body', () => {
      expect(AUTH_JS).toContain("rlBody.tier || 'global'");
    });

    it('calls showRateLimitBanner with retryAfter and tier', () => {
      expect(AUTH_JS).toContain('showRateLimitBanner(retryAfter, tier)');
    });

    it('handles parse failure gracefully (try/catch around 429 body)', () => {
      // The 429 handler is wrapped in try/catch to not break on malformed body
      expect(AUTH_JS).toContain("couldn't parse 429 body");
    });
  });
});

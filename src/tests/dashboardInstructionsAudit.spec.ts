/**
 * dashboardInstructionsAudit.spec.ts
 *
 * The dashboard's create/update/delete routes wrote instructions directly via
 * writeEntryAsync()/removeEntry() and never called logAudit — so edits made
 * through the admin UI were absent from the audit trail, while the
 * archive/restore/purge routes in the same file were audited. Once activity
 * telemetry was hooked to logAudit (#525 follow-up), the same gap left Catalog
 * Activity permanently empty for the most visible mutation path: a real create
 * returned `verified: true` and recorded zero activity rows.
 *
 * These tests pin the audit call for each write path. They assert on the
 * SOURCE of the route module rather than booting an Express app, matching the
 * approach used by the other dashboard route specs in this suite; the
 * audit->activity mapping itself is covered behaviourally in
 * activityStore.spec.ts.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { activityTypeFromAudit } from '../services/activityLog.js';

const ROUTE_FILE = path.join(process.cwd(), 'src/dashboard/server/routes/instructions.routes.ts');

let source: string;

/** Extract the body of a route handler so assertions cannot match a neighbour. */
function handlerBody(method: string, routePath: string): string {
  const needle = `router.${method}('${routePath}'`;
  const start = source.indexOf(needle);
  expect(start, `route ${method.toUpperCase()} ${routePath} not found`).toBeGreaterThan(-1);

  // Walk to the next router.<verb>( registration, or end of file.
  const nextIdx = source.slice(start + needle.length).search(/router\.(get|post|put|delete)\(/);
  return nextIdx === -1
    ? source.slice(start)
    : source.slice(start, start + needle.length + nextIdx);
}

beforeAll(() => {
  source = fs.readFileSync(ROUTE_FILE, 'utf8');
});

describe('dashboard instruction writes are audited', () => {
  it('imports logAudit', () => {
    expect(source).toMatch(/import\s*\{[^}]*logAudit[^}]*\}\s*from\s*['"][^'"]*auditLog/);
  });

  it.each([
    ['post', '/instructions', 'add'],
    ['put', '/instructions/:name', 'patch'],
    ['delete', '/instructions/:name', 'remove'],
  ])('%s %s emits a logAudit(%s) call', (method, routePath, action) => {
    const body = handlerBody(method, routePath);
    expect(body).toContain('logAudit(');
    expect(body).toMatch(new RegExp(`logAudit\\(\\s*['"]${action}['"]`));
  });

  it('audits the create only after read-back verification', () => {
    const body = handlerBody('post', '/instructions');
    // The route returns 500 before this point when read-back fails, so the
    // audit must sit after that guard — otherwise a write that never became
    // visible would be reported as a committed change.
    const guard = body.indexOf('failed read-back verification');
    const audit = body.indexOf('logAudit(');
    expect(guard).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(guard);
  });

  it('uses audit actions that the activity bridge actually maps', () => {
    // A logAudit call with an action outside the allowlist records nothing and
    // fails silently -- exactly the shape of the original defect. Pin the
    // action names to the mapper rather than trusting the string literals.
    expect(activityTypeFromAudit('add', { created: true, overwritten: false })).toBe('added');
    expect(activityTypeFromAudit('patch', { changed: true, op: 'dashboard_edit' })).toBe('modified');
    expect(activityTypeFromAudit('remove', { via: 'dashboard' })).toBe('removed');
  });

  it('still audits the archive lifecycle routes', () => {
    // These were already audited; guard against a refactor dropping them.
    for (const [method, routePath] of [
      ['post', '/instructions/:name/archive'],
      ['post', '/instructions_archived/:name/restore'],
      ['delete', '/instructions_archived/:name'],
    ] as const) {
      expect(handlerBody(method, routePath), `${method} ${routePath}`).toContain('logAudit(');
    }
  });
});

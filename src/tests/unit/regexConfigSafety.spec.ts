import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let warnCalls: string[] = [];

vi.mock('../../services/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn((message: string) => { warnCalls.push(message); }),
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

describe('regex safety for config-backed services', () => {
  let tempDir: string;

  beforeEach(() => {
    warnCalls = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regex-config-safety-'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('ownershipService skips invalid or unsafe ownership rules and keeps safe matches working', async () => {
    fs.writeFileSync(path.join(tempDir, 'owners.json'), JSON.stringify({
      ownership: [
        { pattern: '(a+)+$', owner: 'bad-team' },
        { pattern: '(a?){25}a{25}', owner: 'catastrophic-team' },
        { pattern: '[invalid', owner: 'broken-team' },
        { pattern: '^safe-id$', owner: 'safe-team' },
      ],
    }));

    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    const { resolveOwner } = await import('../../services/ownershipService.js');

    expect(resolveOwner('safe-id')).toBe('safe-team');
    expect(resolveOwner('aaaaaaaaaaaaaaaaaaaa!')).toBeUndefined();
    expect(warnCalls).toEqual(expect.arrayContaining([
      expect.stringContaining('Skipping ownership rule for "bad-team"'),
      expect.stringContaining('Skipping ownership rule for "catastrophic-team"'),
      expect.stringContaining('Skipping ownership rule for "broken-team"'),
    ]));
  });

  it('PromptReviewService ignores invalid or unsafe configured regexes without suppressing safe rules', async () => {
    const criteriaPath = path.join(tempDir, 'PROMPT-CRITERIA.json');
    fs.writeFileSync(criteriaPath, JSON.stringify({
      version: '1.0.0',
      categories: [
        {
          id: 'security',
          rules: [
            { id: 'unsafe-pattern', pattern: '(a+)+$', severity: 'high', description: 'unsafe pattern' },
            { id: 'catastrophic-pattern', pattern: '(a?){25}a{25}', severity: 'high', description: 'catastrophic pattern' },
            { id: 'broken-pattern', pattern: '[invalid', severity: 'high', description: 'broken pattern' },
            { id: 'unsafe-required', mustContain: '(a+)+$', severity: 'medium', description: 'unsafe requirement' },
            { id: 'match-safe', pattern: 'token', severity: 'medium', description: 'contains token' },
            { id: 'required-safe', mustContain: 'SAFE', severity: 'low', description: 'must mention SAFE' },
          ],
        },
      ],
    }));

    const { PromptReviewService } = await import('../../services/promptReviewService.js');

    const service = new PromptReviewService(criteriaPath);
    const issues = service.review('token only');

    expect(issues).toEqual([
      expect.objectContaining({ ruleId: 'match-safe', severity: 'medium', match: 'token' }),
      expect.objectContaining({ ruleId: 'required-safe', severity: 'low' }),
    ]);
    expect(issues.map((issue) => issue.ruleId)).not.toContain('unsafe-pattern');
    expect(issues.map((issue) => issue.ruleId)).not.toContain('catastrophic-pattern');
    expect(issues.map((issue) => issue.ruleId)).not.toContain('broken-pattern');
    expect(issues.map((issue) => issue.ruleId)).not.toContain('unsafe-required');
    expect(warnCalls).toEqual(expect.arrayContaining([
      expect.stringContaining('Skipping unsafe pattern regex for rule "unsafe-pattern"'),
      expect.stringContaining('Skipping unsafe pattern regex for rule "catastrophic-pattern"'),
      expect.stringContaining('Skipping unsafe pattern regex for rule "broken-pattern"'),
      expect.stringContaining('Skipping unsafe mustContain regex for rule "unsafe-required"'),
    ]));
  });
});

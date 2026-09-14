/**
 * Regression test for #520: INDEX_SERVER_DIR "undefined" in test env restore.
 *
 * Verifies that getInstructionsDir() rejects the literal string "undefined"
 * and falls back to the default instructions directory.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'path';
import {
  getInstructionsDir,
  _resetIndexContextProcessLatches,
  _resetIndexContextStateForTests,
} from '../../services/indexContext.js';

describe('#520 INDEX_SERVER_DIR "undefined" guard', () => {
  const saved = process.env.INDEX_SERVER_DIR;

  beforeEach(() => {
    _resetIndexContextProcessLatches();
    _resetIndexContextStateForTests();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = saved;
    _resetIndexContextProcessLatches();
    _resetIndexContextStateForTests();
  });

  it('getInstructionsDir ignores literal "undefined" and uses default', () => {
    process.env.INDEX_SERVER_DIR = 'undefined';
    const dir = getInstructionsDir();
    const defaultDir = path.join(process.cwd(), 'instructions');
    expect(dir).toBe(defaultDir);
  });

  it('getInstructionsDir still uses a valid INDEX_SERVER_DIR when set', () => {
    const testDir = path.join(process.cwd(), 'tmp', 'test-520-valid');
    process.env.INDEX_SERVER_DIR = testDir;
    const dir = getInstructionsDir();
    expect(dir).toBe(path.resolve(testDir));
  });
});

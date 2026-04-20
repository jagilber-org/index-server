import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FileIndexRepository } from '../services/indexRepository';
import { InstructionEntry } from '../models/instruction';

function tempDir() {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'catrepo-'));
  return dir;
}

describe('FileIndexRepository basic ops', () => {
  it('saves, lists, loads and removes entries', () => {
    const dir = tempDir();
    const repo = new FileIndexRepository(dir);
    const entry: InstructionEntry = {
      id: 'test-entry',
      title: 'Test Entry',
      body: 'Body',
      priority: 1,
      audience: 'all',
      requirement: 'optional',
      categories: ['test']
    } as any; // minimal fields for test
    repo.save(entry);
    const files = repo.listFiles();
    expect(files.some(f => f === 'test-entry.json')).toBe(true);
    const snapshot = repo.load();
    expect(snapshot.entries.length).toBe(1);
    expect(snapshot.hash).toBeTypeOf('string');
    repo.remove('test-entry');
    expect(repo.listFiles().length).toBe(0);
  });
});

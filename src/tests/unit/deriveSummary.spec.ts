/**
 * deriveSummary and normalize backfill tests for issue #537.
 *
 * Verifies that deriveSummary strips markdown headings and title-restating
 * lines, and that normalize() detects and re-derives degenerate stored
 * semanticSummary values.
 */
import { describe, it, expect } from 'vitest';
import { ClassificationService } from '../../services/classificationService';
import type { InstructionEntry } from '../../models/instruction';

const svc = new ClassificationService();

/** Helper: build a minimal valid InstructionEntry for normalize(). */
function makeEntry(overrides: Partial<InstructionEntry>): InstructionEntry {
  return {
    id: 'test-' + Date.now(),
    title: 'Test Title',
    body: 'Test body content.',
    categories: ['testing'],
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    contentType: 'instruction',
    sourceHash: '',
    schemaVersion: '8',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// -- deriveSummary unit tests (tested through normalize) --

describe('deriveSummary (via normalize)', () => {
  it('strips heading markers and returns first prose line', () => {
    const entry = makeEntry({ body: '# Azure Kusto\nFirst paragraph here' });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('First paragraph here');
  });

  it('strips multi-level headings', () => {
    const entry = makeEntry({ body: '## Sub heading\nContent here' });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Content here');
  });

  it('skips multiple headings before prose', () => {
    const entry = makeEntry({ body: '# Title\n## Section\nActual content' });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Actual content');
  });

  it('falls back to heading text (stripped of #) when body is heading-only', () => {
    const entry = makeEntry({ body: '# Just A Heading' });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Just A Heading');
  });

  it('returns plain first line when no heading present (regression guard)', () => {
    const entry = makeEntry({ body: 'Plain first line\nSecond line' });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Plain first line');
  });

  it('truncates prose lines longer than 160 chars', () => {
    const longLine = 'A'.repeat(200);
    const entry = makeEntry({ body: longLine });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('A'.repeat(157) + '...');
    expect(norm.semanticSummary!.length).toBe(160);
  });

  it('skips lines that restate the title', () => {
    const entry = makeEntry({
      title: 'Azure Kusto Methods',
      body: 'Azure Kusto Methods\nQuery clusters using KQL.',
    });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Query clusters using KQL.');
  });

  it('skips both headings and title-restating lines', () => {
    const entry = makeEntry({
      title: 'Azure Kusto Methods',
      body: '# Azure Kusto Methods\nAzure Kusto Methods\nReal content here.',
    });
    delete (entry as Partial<InstructionEntry>).semanticSummary;
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Real content here.');
  });
});

// -- Normalization backfill tests --

describe('normalize - degenerate semanticSummary backfill', () => {
  it('replaces degenerate heading summary', () => {
    const entry = makeEntry({
      semanticSummary: '# Old Heading',
      body: '# Old Heading\nReal content',
    });
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Real content');
  });

  it('replaces title-duplicate summary', () => {
    const entry = makeEntry({
      title: 'Azure Kusto Methods',
      semanticSummary: 'Azure Kusto Methods',
      body: 'Azure Kusto Methods\nQuery clusters using KQL.',
    });
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Query clusters using KQL.');
  });

  it('preserves author-provided summary', () => {
    const entry = makeEntry({
      semanticSummary: 'A good human-written summary',
      body: 'Some body content here.',
    });
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('A good human-written summary');
  });

  it('preserves non-heading first-line summary', () => {
    const entry = makeEntry({
      semanticSummary: 'Plain first line',
      body: 'Plain first line\nMore content',
    });
    const norm = svc.normalize(entry);
    expect(norm.semanticSummary).toBe('Plain first line');
  });
});

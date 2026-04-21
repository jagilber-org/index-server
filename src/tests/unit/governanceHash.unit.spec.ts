import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { computeGovernanceHash, projectGovernance } from '../../services/indexContext';

function makeEntry(id:string, title='T'){ return { id, title, body:'b', version:'1.0.0', owner:'owner', priorityTier:'P2', semanticSummary:'summary', changeLog:['a'] } as any; }

describe('computeGovernanceHash determinism (P0)', () => {
  it('order-insensitive for same set of entries', () => {
    const a = makeEntry('a');
    const b = makeEntry('b');
    const h1 = computeGovernanceHash([a,b]);
    const h2 = computeGovernanceHash([b,a]);
    expect(h1).toBe(h2);
  });
  it('changes when semantic summary changes', () => {
    const e1 = makeEntry('x','Title');
    const e2 = { ...e1, semanticSummary:'diff' };
    const h1 = computeGovernanceHash([e1]);
    const h2 = computeGovernanceHash([e2]);
    expect(h1).not.toBe(h2);
  });
  it('projectGovernance stable projection', () => {
    const e = makeEntry('p');
    const g1 = projectGovernance(e);
    const g2 = projectGovernance(e);
    expect(g1).toEqual(g2);
    const hash = crypto.createHash('sha256').update(e.semanticSummary,'utf8').digest('hex');
    expect(g1.semanticSummarySha256).toBe(hash);
  });
});

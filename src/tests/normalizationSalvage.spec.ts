import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getIndexState, invalidate, markindexDirty, touchIndexVersion } from '../services/indexContext';
import { getRuntimeConfig } from '../config/runtimeConfig';

// This test verifies that legacy / variant audience & requirement values are salvaged
// (normalized) rather than rejected by schema validation after recent enhancements.

function writeJson(file: string, obj: unknown){
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

describe('normalization salvage', () => {
  const dir = path.join(process.cwd(), 'tmp', 'salvage-tests');
  const prevEnv = process.env.INDEX_SERVER_DIR;
  beforeAll(()=>{
    fs.mkdirSync(dir, { recursive: true });
    process.env.INDEX_SERVER_DIR = dir;
  });

  it('salvages audience variants and freeform requirement sentences', () => {
    const legacy = {
      id: 'salvage-audience-teams',
      title: 'Legacy audience value teams',
      body: 'Example body',
      audience: 'teams', // variant not in strict enum
      requirement: 'This is a free form descriptive requirement sentence explaining expectations.',
      priority: 50,
      categories: ['test'],
      contentType: 'instruction',
      schemaVersion: '4'
    };
    writeJson(path.join(dir, 'salvage-audience-teams.json'), legacy);
    // Force reload
    invalidate(); markindexDirty(); touchIndexVersion();
    const st = getIndexState();
    const entry = st.byId.get('salvage-audience-teams');
    // Depending on timing, salvage may have normalized prior to validation; if not present, fail for visibility.
    expect(entry, 'entry should be accepted after salvage normalization').toBeTruthy();
    if(entry){
      expect(entry.audience).toBe('group');
      expect(entry.requirement).toBe('recommended');
    }
  });

  it('salvages upper-case requirement MUST and maps to mandatory', () => {
    const legacy = {
      id: 'salvage-requirement-must',
      title: 'Legacy requirement MUST',
      body: 'Example body 2',
      audience: 'developers',
      requirement: 'MUST',
      priority: 40,
      categories: ['test'],
      contentType: 'instruction',
      schemaVersion: '4'
    };
    writeJson(path.join(dir, 'salvage-requirement-must.json'), legacy);
    invalidate(); markindexDirty(); touchIndexVersion();
    const st = getIndexState();
    const entry = st.byId.get('salvage-requirement-must');
    expect(entry).toBeTruthy();
    expect(entry?.requirement).toBe('mandatory');
    expect(entry?.audience).toBe('group'); // developers -> group
  });

  it('salvages missing audience to all', () => {
    const noAudience = {
      id: 'salvage-missing-audience',
      title: 'Missing audience field',
      body: 'Body text for missing audience test',
      // audience intentionally omitted
      requirement: 'recommended',
      priority: 50,
      categories: ['test'],
      contentType: 'instruction',
      schemaVersion: '4'
    };
    writeJson(path.join(dir, 'salvage-missing-audience.json'), noAudience);
    invalidate(); markindexDirty(); touchIndexVersion();
    const st = getIndexState();
    const entry = st.byId.get('salvage-missing-audience');
    expect(entry, 'entry with missing audience should be accepted after salvage').toBeTruthy();
    if (entry) {
      expect(entry.audience).toBe('all');
    }
  });

  it('salvages missing requirement to recommended', () => {
    const noReq = {
      id: 'salvage-missing-requirement',
      title: 'Missing requirement field',
      body: 'Body text for missing requirement test',
      audience: 'all',
      // requirement intentionally omitted
      priority: 50,
      categories: ['test'],
      contentType: 'instruction',
      schemaVersion: '4'
    };
    writeJson(path.join(dir, 'salvage-missing-requirement.json'), noReq);
    invalidate(); markindexDirty(); touchIndexVersion();
    const st = getIndexState();
    const entry = st.byId.get('salvage-missing-requirement');
    expect(entry, 'entry with missing requirement should be accepted after salvage').toBeTruthy();
    if (entry) {
      expect(entry.requirement).toBe('recommended');
    }
  });

  it('truncates body exceeding configured max length', () => {
    const bodyMaxLength = getRuntimeConfig().index.bodyMaxLength;
    const oversizedBody = 'x'.repeat(bodyMaxLength + 500);
    const bigBody = {
      id: 'salvage-body-truncated',
      title: 'Oversized body entry',
      body: oversizedBody,
      audience: 'all',
      requirement: 'recommended',
      priority: 50,
      categories: ['test'],
      contentType: 'instruction',
      schemaVersion: '4'
    };
    writeJson(path.join(dir, 'salvage-body-truncated.json'), bigBody);
    invalidate(); markindexDirty(); touchIndexVersion();
    const st = getIndexState();
    const entry = st.byId.get('salvage-body-truncated');
    expect(entry, 'entry with oversized body should be accepted after truncation salvage').toBeTruthy();
    if (entry) {
      expect(entry.body.length).toBeLessThanOrEqual(bodyMaxLength);
    }
  });

  afterAll(()=>{
    process.env.INDEX_SERVER_DIR = prevEnv;
  });
});

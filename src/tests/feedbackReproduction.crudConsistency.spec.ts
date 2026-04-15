/**
 * @fileoverview Red/Green Test Suite - CRUD State Consistency Issues
 *
 * This test suite focuses on the CRUD operation inconsistency issue reported in production:
 * - Issue #740513ece59b2a0c: Inconsistent Instruction Visibility - Add Skip vs Get Not Found
 *
 * Tests validate the fundamental contract that all CRUD operations should maintain
 * consistent state views of the instruction index.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestClient, type TestClient } from './helpers/mcpTestClient.js';

/**
 * Helper wrapper around test client read result to expose normalized flags.
 */
function isNotFound(obj: Record<string, unknown> | undefined): boolean {
  if(!obj) return true;
  if((obj as { notFound?: boolean }).notFound) return true;
  // Dispatcher get returns { item } when found.
  if('item' in obj) return false;
  return false;
}

describe('Feedback Reproduction: CRUD State Consistency', () => {
  const TEST_ID = 'crud-consistency-test-instruction';
  let client: TestClient;
  // Track the ephemeral instructions dir used for each test so we can clean it up after.
  let currentInstructionsDir: string | undefined;

  beforeEach(async () => {
  // PERFORMANCE / FLAKINESS NOTE:
  // Earlier timeouts (15s/25s) were caused by pointing the client at the large shared `instructions` directory
  // ( >1k entries ) which made create/list/read sequences slow under concurrent suite load.
  // To obtain deterministic sub-second execution we provision a fresh ephemeral directory per test.
  // If an explicit TEST_INDEX_SERVER_DIR is supplied we still honor it for diagnostic overrides.
  if (process.env.TEST_INDEX_SERVER_DIR) {
    currentInstructionsDir = process.env.TEST_INDEX_SERVER_DIR;
  } else {
    const isolationRoot = path.join(process.cwd(), 'tmp', 'crud-consistency-isolation');
    fs.mkdirSync(isolationRoot, { recursive: true });
    const dirName = `run-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    currentInstructionsDir = path.join(isolationRoot, dirName);
    fs.mkdirSync(currentInstructionsDir, { recursive: true });
  }
  client = await createTestClient({ forceMutation: true, instructionsDir: currentInstructionsDir });
    // Defensive cleanup
    try { await client.remove(TEST_ID); } catch { /* ignore */ }
  });

  afterEach(async () => {
    await client.close();
    // Best-effort cleanup of ephemeral directory (skip if user supplied a custom one for debugging)
    if (currentInstructionsDir && !process.env.TEST_INDEX_SERVER_DIR) {
      try { fs.rmSync(currentInstructionsDir, { recursive: true, force: true }); } catch { /* ignore */ }
      currentInstructionsDir = undefined;
    }
  });

  describe('Issue #740513ece59b2a0c: Add Skip vs Get Not Found Inconsistency', () => {

    it('ADD_THEN_DUPLICATE_ADD_CONSISTENCY - Core reproduction case', async () => {
      const create1 = await client.create({ id: TEST_ID, body: 'Test instruction' }, { overwrite: true });
      expect(create1?.created ?? create1?.overwritten ?? true, 'Initial add should indicate creation/overwrite').toBeTruthy();

      const read1 = await client.read(TEST_ID);
      expect(isNotFound(read1)).toBe(false);

      const duplicate = await client.create({ id: TEST_ID, body: 'Test instruction' }, { overwrite: false });
      // duplicate path should set skipped true OR created false
      const skipped = (duplicate?.skipped === true) || (duplicate?.created === false);
      expect(skipped, 'Second add should report skipped or created=false').toBe(true);

      const read2 = await client.read(TEST_ID);
      // RED ASSERTION (expected to fail given prod report): if duplicate skipped, read must NOT be notFound
      if (skipped) {
        expect(isNotFound(read2), 'INCONSISTENCY: add skipped but subsequent read reports notFound').toBe(false);
      }
    }, 15000);

    it('LIST_VISIBILITY_AFTER_SKIP - Verify list operation consistency', async () => {
      await client.create({ id: TEST_ID, body: 'List test' }, { overwrite: true });
      const dup = await client.create({ id: TEST_ID, body: 'List test' }, { overwrite: false });
      const skipped = (dup?.skipped === true) || (dup?.created === false);
      if (skipped) {
  const list = await client.list();
  const found = list.items.find((i: unknown) => (i as { id?: string }).id === TEST_ID);
        expect(found, 'INCONSISTENCY: add skipped but list missing entry').toBeDefined();
      }
    }, 15000);

    it('OVERWRITE_RECOVERY_VERIFICATION - Test workaround effectiveness', async () => {
      await client.create({ id: TEST_ID, body: 'Recovery body' }, { overwrite: true });
      const dup = await client.create({ id: TEST_ID, body: 'Recovery body' }, { overwrite: false });
      const skipped = (dup?.skipped === true) || (dup?.created === false);
      if (skipped) {
        const readInconsistent = await client.read(TEST_ID);
        if (isNotFound(readInconsistent)) {
          const recovered = await client.create({ id: TEST_ID, body: 'RECOVERED BODY' }, { overwrite: true });
          expect(recovered?.overwritten || recovered?.created, 'Overwrite recovery should succeed').toBeTruthy();
          const readRecovered = await client.read(TEST_ID);
            expect(isNotFound(readRecovered), 'Post-overwrite get should succeed').toBe(false);
        }
      }
    }, 20000);

    it('ATOMIC_CRUD_SEQUENCE - Verify operation atomicity', async () => {
      const add1 = await client.create({ id: TEST_ID, body: 'Atomic body' }, { overwrite: true });
      expect(add1?.created || add1?.overwritten).toBeTruthy();
      const read1 = await client.read(TEST_ID); expect(isNotFound(read1)).toBe(false);
  const list1 = await client.list(); expect(list1.items.find((i: unknown) => (i as { id?: string }).id === TEST_ID)).toBeDefined();
      const dup = await client.create({ id: TEST_ID, body: 'Atomic body' }, { overwrite: false });
      const skipped = (dup?.skipped === true) || (dup?.created === false);
      if (skipped) {
        const read2 = await client.read(TEST_ID);
        expect(isNotFound(read2), 'Get after skipped add should not be notFound (red if inconsistency present)').toBe(false);
        const list2 = await client.list();
  expect(list2.items.find((i: unknown) => (i as { id?: string }).id === TEST_ID), 'List after skipped add should contain entry').toBeDefined();
      }
    }, 25000);
  });
});

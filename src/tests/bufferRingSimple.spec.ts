import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BufferRing, BufferRingFactory, OverflowStrategy } from '../utils/BufferRing';

describe('BufferRing - Simple Tests', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffer-ring-test-'));
    tempFile = path.join(tempDir, 'test-buffer.json');
  });

  afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Basic Operations', () => {
    it('should add entries and track count', () => {
      const buffer = new BufferRing<string>({ capacity: 3 });

      buffer.add('a');
      buffer.add('b');
      buffer.add('c');

      expect(buffer.getStats().count).toBe(3);
      expect(buffer.getAll()).toEqual(['a', 'b', 'c']);
    });

    it('should handle overflow with DROP_OLDEST strategy', () => {
      const buffer = new BufferRing<string>({
        capacity: 2,
        overflowStrategy: OverflowStrategy.DROP_OLDEST
      });

      buffer.add('a');
      buffer.add('b');
      buffer.add('c'); // Should drop 'a'

      expect(buffer.getStats().count).toBe(2);
      expect(buffer.getAll()).toEqual(['b', 'c']);
    });

    it('should handle clear operation', () => {
      const buffer = new BufferRing<string>({ capacity: 3 });

      buffer.add('a');
      buffer.add('b');
      buffer.clear();

      expect(buffer.getStats().count).toBe(0);
      expect(buffer.getAll()).toEqual([]);
    });
  });

  describe('Persistence', () => {
    it('should save and load from disk', async () => {
      const buffer = new BufferRing<string>({
        capacity: 5,
        persistPath: tempFile
      });

      buffer.add('test1');
      buffer.add('test2');
      buffer.add('test3');

      await buffer.saveToDisk();
      expect(fs.existsSync(tempFile)).toBe(true);

      buffer.clear();
      expect(buffer.getStats().count).toBe(0);

      await buffer.loadFromDisk();
      expect(buffer.getStats().count).toBe(3);
      expect(buffer.getAll()).toEqual(['test1', 'test2', 'test3']);
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      const buffer = new BufferRing<string>({ capacity: 3 });

      buffer.add('a');
      buffer.add('b');
      buffer.add('c');
      buffer.add('d'); // Should drop 'a'

      const stats = buffer.getStats();
      expect(stats.count).toBe(3);
      expect(stats.capacity).toBe(3);
      expect(stats.totalAdded).toBe(4);
      expect(stats.totalDropped).toBe(1);
      expect(stats.utilization).toBe(100);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('Factory Methods', () => {
    it('should create log buffer with appropriate config', () => {
      const testPath = path.join(tempDir, 'factory-test.json');
      const buffer = BufferRingFactory.createLogBuffer(500, testPath);

      expect(buffer.getConfig().capacity).toBe(500);
      expect(buffer.getConfig().overflowStrategy).toBe(OverflowStrategy.DROP_OLDEST);
      expect(buffer.getConfig().persistPath).toBe(testPath);
      expect(buffer.getConfig().autoPersist).toBe(true);
    });

    it('should create metrics buffer with appropriate config', () => {
      const buffer = BufferRingFactory.createMetricsBuffer(200);

      expect(buffer.getConfig().capacity).toBe(200);
      expect(buffer.getConfig().overflowStrategy).toBe(OverflowStrategy.DROP_OLDEST);
      expect(buffer.getConfig().autoPersist).toBe(false);
    });
  });
});

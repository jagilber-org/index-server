/**
 * TDD RED/GREEN test: Validates the catalog→index rename is complete.
 * RED: These imports will fail because files still use old names.
 * GREEN: After rename, all imports resolve and exports exist.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');

describe('catalog to index rename validation', () => {
  describe('file renames', () => {
    it('indexContext.ts exists (was catalogContext.ts)', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'indexContext.ts'))).toBe(true);
    });
    it('indexLoader.ts exists (was catalogLoader.ts)', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'indexLoader.ts'))).toBe(true);
    });
    it('indexRepository.ts exists (was catalogRepository.ts)', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'indexRepository.ts'))).toBe(true);
    });
    it('old catalogContext.ts no longer exists', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'catalogContext.ts'))).toBe(false);
    });
    it('old catalogLoader.ts no longer exists', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'catalogLoader.ts'))).toBe(false);
    });
    it('old catalogRepository.ts no longer exists', () => {
      expect(fs.existsSync(path.join(SRC, 'services', 'catalogRepository.ts'))).toBe(false);
    });
  });

  describe('exported identifiers renamed', () => {
    it('indexContext.ts exports IndexState (not CatalogState)', () => {
      const content = fs.readFileSync(path.join(SRC, 'services', 'indexContext.ts'), 'utf8');
      expect(content).toContain('export interface IndexState');
      expect(content).not.toContain('CatalogState');
    });
    it('indexLoader.ts exports IndexLoader class (not CatalogLoader)', () => {
      const content = fs.readFileSync(path.join(SRC, 'services', 'indexLoader.ts'), 'utf8');
      expect(content).toContain('export class IndexLoader');
      expect(content).not.toContain('CatalogLoader');
    });
    it('indexRepository.ts exports FileIndexRepository (not FileCatalogRepository)', () => {
      const content = fs.readFileSync(path.join(SRC, 'services', 'indexRepository.ts'), 'utf8');
      expect(content).toContain('export class FileIndexRepository');
      expect(content).not.toContain('FileCatalogRepository');
    });
  });

  describe('no stale catalog imports in src/services/', () => {
    it('no .ts files in src/services/ import from old catalog paths', () => {
      const servicesDir = path.join(SRC, 'services');
      const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.ts'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
        expect(content, file + ' still imports catalogContext').not.toMatch(/from ['"]\.\/catalogContext/);
        expect(content, file + ' still imports catalogLoader').not.toMatch(/from ['"]\.\/catalogLoader/);
        expect(content, file + ' still imports catalogRepository').not.toMatch(/from ['"]\.\/catalogRepository/);
      }
    });
  });

  describe('documentation filenames renamed', () => {
    const docsDir = path.resolve(SRC, '..', 'docs');
    it('docs/index_normalization.md exists', () => {
      expect(fs.existsSync(path.join(docsDir, 'index_normalization.md'))).toBe(true);
    });
    it('docs/index_quality_gates.md exists', () => {
      expect(fs.existsSync(path.join(docsDir, 'index_quality_gates.md'))).toBe(true);
    });
    it('old docs/catalog_normalization.md no longer exists', () => {
      expect(fs.existsSync(path.join(docsDir, 'catalog_normalization.md'))).toBe(false);
    });
    it('old docs/catalog_quality_gates.md no longer exists', () => {
      expect(fs.existsSync(path.join(docsDir, 'catalog_quality_gates.md'))).toBe(false);
    });
  });

  describe('copilot-instructions updated', () => {
    const copilotInstructionsPath = path.resolve(SRC, '..', '.github', 'copilot-instructions.md');
    const hasCopilotInstructions = fs.existsSync(copilotInstructionsPath);

    it.skipIf(!hasCopilotInstructions)('says Index Server not Catalog Server', () => {
      const content = fs.readFileSync(copilotInstructionsPath, 'utf8');
      expect(content).not.toMatch(/Catalog Server/);
      expect(content).toContain('Index Server');
    });
  });
});

#!/usr/bin/env node

const fs = require('fs');

/**
 * Unicode Character Scanner for Index Server
 * Detects problematic Unicode characters that cause subtle bugs
 */

// Character definitions with their problematic patterns
const PROBLEMATIC_CHARS = {
  // Smart/Curly Quotes (HIGH — breaks code and commands)
  '\u201C': { name: 'LEFT DOUBLE QUOTATION MARK', category: 'smart-quote', severity: 'critical', replacement: '"' },
  '\u201D': { name: 'RIGHT DOUBLE QUOTATION MARK', category: 'smart-quote', severity: 'critical', replacement: '"' },
  '\u2018': { name: 'LEFT SINGLE QUOTATION MARK', category: 'smart-quote', severity: 'critical', replacement: '\'' },
  '\u2019': { name: 'RIGHT SINGLE QUOTATION MARK', category: 'smart-quote', severity: 'critical', replacement: '\'' },
  '\u00AB': { name: 'LEFT GUILLEMET', category: 'smart-quote', severity: 'critical', replacement: '"' },
  '\u00BB': { name: 'RIGHT GUILLEMET', category: 'smart-quote', severity: 'critical', replacement: '"' },
  '\u201E': { name: 'DOUBLE LOW-9 QUOTATION MARK', category: 'smart-quote', severity: 'critical', replacement: '"' },

  // Dashes (MEDIUM — breaks markdown, CLI flags, ranges)
  '\u2014': { name: 'EM DASH', category: 'dash', severity: 'warning', replacement: '--' },
  '\u2013': { name: 'EN DASH', category: 'dash', severity: 'warning', replacement: '-' },
  '\u2012': { name: 'FIGURE DASH', category: 'dash', severity: 'warning', replacement: '-' },
  '\u2015': { name: 'HORIZONTAL BAR', category: 'dash', severity: 'warning', replacement: '--' },

  // Spaces (HIGH — invisible bugs)
  '\u00A0': { name: 'NON-BREAKING SPACE', category: 'space', severity: 'critical', replacement: ' ' },
  '\u2003': { name: 'EM SPACE', category: 'space', severity: 'critical', replacement: ' ' },
  '\u2002': { name: 'EN SPACE', category: 'space', severity: 'critical', replacement: ' ' },
  '\u2007': { name: 'FIGURE SPACE', category: 'space', severity: 'critical', replacement: ' ' },
  '\u202F': { name: 'NARROW NO-BREAK SPACE', category: 'space', severity: 'critical', replacement: ' ' },
  '\u200B': { name: 'ZERO WIDTH SPACE', category: 'space', severity: 'critical', replacement: '' },
  '\u200C': { name: 'ZERO WIDTH NON-JOINER', category: 'space', severity: 'critical', replacement: '' },
  '\u200D': { name: 'ZERO WIDTH JOINER', category: 'space', severity: 'critical', replacement: '' },
  '\uFEFF': { name: 'ZERO WIDTH NO-BREAK SPACE (BOM)', category: 'space', severity: 'critical', replacement: '' },

  // Other Problematic Characters
  '\u2026': { name: 'HORIZONTAL ELLIPSIS', category: 'other', severity: 'warning', replacement: '...' },
  '\u2022': { name: 'BULLET', category: 'other', severity: 'warning', replacement: '-' },
  '\u00B7': { name: 'MIDDLE DOT', category: 'other', severity: 'info', replacement: '.' },
  '\u200F': { name: 'RIGHT-TO-LEFT MARK', category: 'control', severity: 'warning', replacement: '' },
  '\u200E': { name: 'LEFT-TO-RIGHT MARK', category: 'control', severity: 'warning', replacement: '' },

  // Export Artifacts (OneNote, Word, Confluence, web copy-paste)
  '\u00B0': { name: 'DEGREE SIGN', category: 'export-artifact', severity: 'warning', replacement: '-' },
  '\u25CB': { name: 'WHITE CIRCLE', category: 'export-artifact', severity: 'warning', replacement: '-' },
  '\u25CF': { name: 'BLACK CIRCLE', category: 'export-artifact', severity: 'warning', replacement: '-' },
  '\u25A0': { name: 'BLACK SQUARE', category: 'export-artifact', severity: 'warning', replacement: '-' },
  '\u25AA': { name: 'SMALL BLACK SQUARE', category: 'export-artifact', severity: 'warning', replacement: '-' },
  '\u00A7': { name: 'SECTION SIGN', category: 'export-artifact', severity: 'info', replacement: '' },
  '\u00B6': { name: 'PILCROW SIGN', category: 'export-artifact', severity: 'warning', replacement: '' },
  '\u0192': { name: 'LATIN SMALL F WITH HOOK', category: 'export-artifact', severity: 'warning', replacement: 'f' },
};

// Additional patterns to detect
const PATTERNS = {
  backtickO: /`o`/g, // OneNote bullet export artifact
  backtickSection: /`§`/g, // OneNote bullet export artifact
  backtickDot: /`·`/g, // OneNote bullet export artifact
  multipleNbsp: /\u00A0{3,}/g, // Multiple consecutive NBSP
  bomMidFile: /(?!^)\uFEFF/g, // BOM appearing mid-file
};

/**
 * Scan text content for problematic Unicode characters
 * @param {string} content - The text content to scan
 * @param {string} filePath - Path to the file being scanned
 * @returns {Object} Scan results
 */
function scanContent(content, filePath) {
  const issues = [];
  const lines = content.split('\n');
  let autoFixableCount = 0;
  let fixedContent = content;

  // Check for BOM at start
  const hasBOM = content.charCodeAt(0) === 0xFEFF;

  // Detect encoding (simplified)
  const encoding = 'UTF-8'; // Node.js default

  // Scan each character
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      const codepoint = char.charCodeAt(0);

      // Check if it's a problematic character
      if (PROBLEMATIC_CHARS[char]) {
        const charInfo = PROBLEMATIC_CHARS[char];
        const contextStart = Math.max(0, charIndex - 10);
        const contextEnd = Math.min(line.length, charIndex + 11);
        const context = line.substring(contextStart, contextEnd);

        issues.push({
          line: lineIndex + 1,
          column: charIndex + 1,
          char: char,
          codepoint: `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
          name: charInfo.name,
          category: charInfo.category,
          severity: charInfo.severity,
          context: context,
          replacement: charInfo.replacement
        });

        if (charInfo.replacement !== undefined) {
          autoFixableCount++;
        }
      }

      // Check for control characters
      if ((codepoint >= 0x0000 && codepoint <= 0x001F && codepoint !== 0x09 && codepoint !== 0x0A && codepoint !== 0x0D) ||
          (codepoint >= 0x0080 && codepoint <= 0x009F)) {
        const contextStart = Math.max(0, charIndex - 10);
        const contextEnd = Math.min(line.length, charIndex + 11);
        const context = line.substring(contextStart, contextEnd);

        issues.push({
          line: lineIndex + 1,
          column: charIndex + 1,
          char: char,
          codepoint: `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
          name: 'CONTROL CHARACTER',
          category: 'control',
          severity: 'critical',
          context: context,
          replacement: ''
        });

        autoFixableCount++;
      }

      // Check for fullwidth ASCII variants (U+FF01-U+FF5E)
      if (codepoint >= 0xFF01 && codepoint <= 0xFF5E) {
        const asciiEquivalent = String.fromCharCode(codepoint - 0xFF01 + 0x21);
        const contextStart = Math.max(0, charIndex - 10);
        const contextEnd = Math.min(line.length, charIndex + 11);
        const context = line.substring(contextStart, contextEnd);

        issues.push({
          line: lineIndex + 1,
          column: charIndex + 1,
          char: char,
          codepoint: `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
          name: 'FULLWIDTH ASCII VARIANT',
          category: 'other',
          severity: 'warning',
          context: context,
          replacement: asciiEquivalent
        });

        autoFixableCount++;
      }
    }
  }

  // Check for patterns
  for (const [patternName, pattern] of Object.entries(PATTERNS)) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const lineIndex = content.substring(0, match.index).split('\n').length - 1;
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const column = match.index - lineStart + 1;
      const line = lines[lineIndex];
      const contextStart = Math.max(0, column - 11);
      const contextEnd = Math.min(line.length, column + 10);
      const context = line.substring(contextStart, contextEnd);

      let replacement = '';
      if (patternName.startsWith('backtick')) {
        replacement = '- ';
      } else if (patternName === 'multipleNbsp') {
        replacement = ' ';
      }

      issues.push({
        line: lineIndex + 1,
        column: column,
        char: match[0],
        codepoint: 'PATTERN',
        name: `PATTERN: ${patternName.toUpperCase()}`,
        category: 'export-artifact',
        severity: 'warning',
        context: context,
        replacement: replacement
      });

      autoFixableCount++;
    }
  }

  // Apply auto-fixes if there are issues
  if (issues.length > 0) {
    for (const issue of issues) {
      if (issue.replacement !== undefined && issue.codepoint !== 'PATTERN') {
        fixedContent = fixedContent.replace(issue.char, issue.replacement);
      }
    }

    // Apply pattern fixes
    fixedContent = fixedContent
      .replace(PATTERNS.backtickO, '- ')
      .replace(PATTERNS.backtickSection, '- ')
      .replace(PATTERNS.backtickDot, '- ')
      .replace(PATTERNS.multipleNbsp, ' ')
      .replace(PATTERNS.bomMidFile, '');
  }

  return {
    file: filePath,
    encoding: encoding,
    hasBOM: hasBOM,
    totalIssues: issues.length,
    issues: issues,
    autoFixable: autoFixableCount,
    fixedContent: issues.length > 0 ? fixedContent : null
  };
}

/**
 * Scan a file for problematic Unicode characters
 * @param {string} filePath - Path to the file to scan
 * @returns {Object|null} Scan results or null if file cannot be read
 */
function scanFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory() || stats.size > 10 * 1024 * 1024) { // Skip files > 10MB
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8'); // lgtm[js/file-system-race] — scanner reads files traversed in this run; CLI tool
    return scanContent(content, filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return {
      file: filePath,
      error: error.message,
      totalIssues: 0,
      issues: [],
      autoFixable: 0,
      fixedContent: null
    };
  }
}

// Export functions for use as a module
module.exports = {
  scanContent,
  scanFile,
  PROBLEMATIC_CHARS,
  PATTERNS
};

// CLI usage if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node unicode-scanner.js <file1> [file2] ...');
    console.log('       node unicode-scanner.js --help');
    process.exit(1);
  }

  if (args[0] === '--help') {
    console.log('Unicode Character Scanner');
    console.log('Detects problematic Unicode characters that cause subtle bugs');
    console.log('');
    console.log('Usage: node unicode-scanner.js <file1> [file2] ...');
    console.log('');
    console.log('Returns JSON with detected issues and auto-fix suggestions');
    process.exit(0);
  }

  const results = [];
  for (const filePath of args) {
    const result = scanFile(filePath);
    if (result) {
      results.push(result);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

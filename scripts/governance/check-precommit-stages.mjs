#!/usr/bin/env node
/**
 * check-precommit-stages.mjs — enforce explicit `stages:` markers on every
 * hook declared in `.pre-commit-config.yaml`.
 *
 * Closes the failure mode tracked in issue #246: during the v1.26.4 release
 * cycle, 3 remediation PRs (#241, #243, #244) were required because hooks
 * relied on `default_stages: [pre-commit]` instead of an explicit `stages:`
 * declaration. The default caused silent behavior drift between local
 * `pre-commit run` and CI's `pre-commit run --all-files --hook-stage <stage>`
 * replay, and hygiene hooks ran at unintended stages.
 *
 * This check fails CI if any hook block in `.pre-commit-config.yaml` omits
 * an explicit `stages:` list. It does NOT rely on a YAML library — the file
 * has a stable structure (`hooks:` mapping → list of `- id: <name>` blocks)
 * and the parser is a small indentation-aware state machine. Adding a YAML
 * dep just for one CI gate would be overkill.
 *
 * Usage:
 *   node scripts/governance/check-precommit-stages.mjs
 *   node scripts/governance/check-precommit-stages.mjs --file <path>
 *
 * Exit codes:
 *   0  every hook declares `stages:`
 *   1  one or more hooks missing `stages:` (offenders listed on stderr),
 *      or the config file is unreadable / malformed
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { file: '.pre-commit-config.yaml' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) args.file = argv[++i];
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/governance/check-precommit-stages.mjs [--file <path>]');
      process.exit(0);
    }
  }
  return args;
}

/**
 * Walk `.pre-commit-config.yaml` line-by-line and return an array of
 * { id, line, hasStages } records — one per hook block. A hook block starts
 * at a line matching `- id: <name>` and ends when we see another sibling
 * list item at the same indent OR a dedent to ≤ the indent of the parent
 * `hooks:` key.
 *
 * Comments (`#`) and blank lines inside the block are ignored. `stages:`
 * detection is liberal: any line within the block whose first non-whitespace
 * token is `stages:` counts.
 */
function extractHookBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null; // { id, line, indent, hasStages }

  function closeCurrent() {
    if (current) {
      blocks.push(current);
      current = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip comments for structural decisions but DO NOT skip the line —
    // comment-only lines should not close a block.
    const stripped = raw.replace(/\s+#.*$|^\s*#.*$/, '');
    if (stripped.trim() === '') continue;

    const indent = raw.match(/^[ \t]*/)[0].length;
    // List-item start at this indent — either a new hook or a sibling that
    // closes the current one.
    const listMatch = stripped.match(/^([ \t]*)-\s+(\S.*)$/);
    if (listMatch) {
      const itemIndent = listMatch[1].length;
      const rest = listMatch[2];
      // If we have a current block and this list item is at the same indent,
      // close it before considering whether this is a new hook.
      if (current && itemIndent <= current.indent) {
        closeCurrent();
      }
      const idMatch = rest.match(/^id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/);
      if (idMatch) {
        current = {
          id: idMatch[1],
          line: i + 1,
          indent: itemIndent,
          hasStages: false,
        };
      }
      continue;
    }

    // Non-list-item line. If we're inside a hook block, check for `stages:`
    // at a deeper indent than the block opener. A dedent to ≤ block indent
    // closes the block.
    if (current) {
      if (indent <= current.indent) {
        closeCurrent();
      } else {
        const key = stripped.trim().match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
        if (key && key[1] === 'stages') {
          current.hasStages = true;
        }
      }
    }
  }
  closeCurrent();
  return blocks;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = resolve(args.file);
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`check-precommit-stages: cannot read ${filePath}: ${e.message}`);
    process.exit(1);
  }

  const blocks = extractHookBlocks(text);
  if (blocks.length === 0) {
    console.error(`check-precommit-stages: no hook blocks found in ${filePath} — file unexpectedly empty or malformed`);
    process.exit(1);
  }

  const offenders = blocks.filter((b) => !b.hasStages);
  if (offenders.length > 0) {
    console.error(`check-precommit-stages: ${offenders.length} hook(s) missing explicit \`stages:\` declaration in ${filePath}:`);
    for (const o of offenders) {
      console.error(`  - id: ${o.id}  (line ${o.line})`);
    }
    console.error('');
    console.error('Every hook MUST declare its own `stages:` list. Relying on');
    console.error('`default_stages:` caused 3 remediation PRs (#241, #243, #244) in');
    console.error('v1.26.4 by drifting hygiene hooks to unintended stages and breaking');
    console.error('parity between local `pre-commit run` and the CI replay.');
    console.error('See: https://github.com/jagilber-dev/index-server/issues/246');
    process.exit(1);
  }

  console.log(`check-precommit-stages: OK — ${blocks.length} hook(s) all declare \`stages:\``);
  process.exit(0);
}

main();

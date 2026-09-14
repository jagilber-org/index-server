const { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, rmSync } = require('fs');
const { join } = require('path');

function main(){
  if(!existsSync('.git')) return; // not a git repo yet
  const hooksDir = join('.git','hooks');
  if(!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

  // Pre-commit hook — uses cross-platform Node.js script
  const hookPath = join(hooksDir, 'pre-commit');
  const content = `#!/usr/bin/env bash\n# Auto-generated pre-commit hook (cross-platform Node.js)\nnode ./scripts/hooks/pre-commit.mjs`;
  writeFileSync(hookPath, content, { encoding:'utf8' });
  chmodSync(hookPath, 0o755);

  // No commit-msg hook is installed (#582). The one that used to live here ran
  // commit-msg-baseline.mjs, which exited 0 unless INTERNAL-BASELINE.md was in
  // the staged diff -- and that file does not exist and has no commits, so the
  // hook could not fire. Existing clones carry the stale hook, so remove it
  // rather than leave a dead gate installed; the content check means a
  // hand-written commit-msg hook is left alone.
  const commitMsgPath = join(hooksDir, 'commit-msg');
  if (existsSync(commitMsgPath)) {
    let existing = '';
    try { existing = readFileSync(commitMsgPath, 'utf8'); } catch { /* unreadable: leave it */ }
    if (existing.includes('commit-msg-baseline')) {
      rmSync(commitMsgPath, { force: true });
    }
  }

  // Pre-push hook enforces public-mirror protection.
  const prePushPath = join(hooksDir, 'pre-push');
  const prePushContent = `#!/usr/bin/env bash\n# Auto-generated pre-push hook (cross-platform Node.js)\nnode ./scripts/hooks/pre-push.mjs "$@"`;
  writeFileSync(prePushPath, prePushContent, { encoding:'utf8' });
  chmodSync(prePushPath, 0o755);
}

main();

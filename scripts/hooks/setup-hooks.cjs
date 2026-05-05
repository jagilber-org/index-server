const { existsSync, mkdirSync, chmodSync, writeFileSync } = require('fs');
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

  // Commit-msg hook — uses cross-platform Node.js script
  const commitMsgPath = join(hooksDir, 'commit-msg');
  const commitMsgContent = `#!/usr/bin/env bash\n# Auto-generated commit-msg hook (cross-platform Node.js)\nnode ./scripts/hooks/commit-msg-baseline.mjs "$1"`;
  writeFileSync(commitMsgPath, commitMsgContent, { encoding:'utf8' });
  chmodSync(commitMsgPath, 0o755);

  // Pre-push hook enforces public-mirror protection.
  const prePushPath = join(hooksDir, 'pre-push');
  const prePushContent = `#!/usr/bin/env bash\n# Auto-generated pre-push hook (cross-platform Node.js)\nnode ./scripts/hooks/pre-push.mjs "$@"`;
  writeFileSync(prePushPath, prePushContent, { encoding:'utf8' });
  chmodSync(prePushPath, 0o755);
}

main();

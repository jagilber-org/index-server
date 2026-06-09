/**
 * Publish-ToMirror.ps1 — Release workflow polling (#269).
 *
 * The mirror publish helper must, after creating the release tag, poll the
 * resulting tag-triggered Release workflow run and exit non-zero if the run
 * fails or times out. This spec scans the script source to ensure the wiring
 * is present (and stays present under future refactors).
 *
 * Refs: jagilber-dev/index-server#269
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'build', 'Publish-ToMirror.ps1');
const WRAPPER_PATH = path.join(REPO_ROOT, 'scripts', 'Publish-ToMirror.ps1');

describe('Publish-ToMirror.ps1 — release workflow polling (#269)', () => {
  let source: string;
  let wrapperSource: string;

  beforeAll(() => {
    source = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    wrapperSource = fs.readFileSync(WRAPPER_PATH, 'utf-8');
  });

  it('declares the -WaitForRelease switch parameter', () => {
    expect(source).toMatch(/\[switch\]\$WaitForRelease/);
  });

  it('declares the -ReleaseWorkflowTimeoutMinutes int parameter with a default', () => {
    expect(source).toMatch(/\[int\]\$ReleaseWorkflowTimeoutMinutes\s*=\s*\d+/);
  });

  it('declares the -ReleaseWorkflowName string parameter', () => {
    expect(source).toMatch(/\[string\]\$ReleaseWorkflowName/);
  });

  it('defines the Wait-ReleaseWorkflowRun function', () => {
    expect(source).toMatch(/function\s+Wait-ReleaseWorkflowRun/);
  });

  it('Wait-ReleaseWorkflowRun queries gh run list filtered by tag (via injectable invoker)', () => {
    // After PR #411 review the function shells out via `& $GhInvoker $invokeArgs`
    // rather than calling `gh` directly, so the assertion now checks the
    // invocation shape: the discovery call must build a `--branch $Tag`-scoped
    // `run list` arg vector and pass it through the invoker.
    expect(source).toMatch(/@\('run','list',[\s\S]*?'--branch',\$Tag/);
    expect(source).toMatch(/&\s*\$GhInvoker\s+\$invokeArgs/);
  });

  it('polls run status until completion via gh run view (via injectable invoker)', () => {
    expect(source).toMatch(/@\('run','view',\[string\]\$runId,/);
    expect(source).toMatch(/status,conclusion/);
  });

  it('treats anything other than conclusion=success as failure', () => {
    expect(source).toMatch(/Conclusion\s+-ne\s+'success'/);
  });

  it('sets a script-scoped failure flag and exits non-zero', () => {
    expect(source).toMatch(/\$script:ReleaseWorkflowFailed\s*=\s*\$true/);
    expect(source).toMatch(/if\s*\(\s*\$script:ReleaseWorkflowFailed\s*\)/);
    expect(source).toMatch(/exit\s+1/);
  });

  it('invokes Wait-ReleaseWorkflowRun only after successful tag creation', () => {
    // The call must appear inside the else-branch that follows a successful
    // tag-creation gh api call (i.e. after the Write-ReleaseWorkflowHandoff call).
    const idxHandoff = source.indexOf('Write-ReleaseWorkflowHandoff -Repo $prRepo -Tag $Tag');
    const idxWait = source.indexOf('Wait-ReleaseWorkflowRun');
    expect(idxHandoff).toBeGreaterThan(0);
    // The first Wait-ReleaseWorkflowRun reference is the function definition;
    // the second is the invocation in the tag-success branch.
    const secondWait = source.indexOf('Wait-ReleaseWorkflowRun', idxWait + 1);
    expect(secondWait).toBeGreaterThan(idxHandoff);
  });

  it('gates polling behind the -WaitForRelease switch (opt-in)', () => {
    expect(source).toMatch(/if\s*\(\s*\$WaitForRelease\s*\)/);
  });

  it('wrapper script forwards the new parameters', () => {
    expect(wrapperSource).toMatch(/\[switch\]\$WaitForRelease/);
    expect(wrapperSource).toMatch(/\[int\]\$ReleaseWorkflowTimeoutMinutes/);
    expect(wrapperSource).toMatch(/\[string\]\$ReleaseWorkflowName/);
  });
});

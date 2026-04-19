import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('server entrypoint import ownership', () => {
  it('uses the consolidated toolHandlers shim instead of duplicating handler side-effect imports', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'index-server.ts'), 'utf8');

    expect(source).toContain("import '../services/toolHandlers';");
    expect(source).not.toMatch(/import '\.\.\/services\/handlers\.[^']+';/);
    expect(source).not.toContain("import '../services/instructions.dispatcher';");
  });

  it('delegates multi-instance startup to the extracted helper', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'index-server.ts'), 'utf8');
    const helperSource = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'multiInstanceStartup.ts'), 'utf8');

    expect(source).toContain("import { startMultiInstanceMode } from './multiInstanceStartup';");
    expect(source).toContain('await startMultiInstanceMode(cfg.dashboardHost, runtime);');
    expect(source).not.toContain("import { LeaderElection }");
    expect(source).not.toContain("import { ThinClient }");
    expect(helperSource).toContain('new LeaderElection({');
    expect(helperSource).toContain('const thinClient = new ThinClient({ stateDir });');
  });

  it('delegates background startup services to the extracted helper', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'index-server.ts'), 'utf8');
    const helperSource = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'backgroundServicesStartup.ts'), 'utf8');

    expect(source).toContain("import { startOptionalMemoryMonitoring, startDeferredBackgroundServices } from './backgroundServicesStartup';");
    expect(source).toContain('startOptionalMemoryMonitoring(runtime);');
    expect(source).toContain('startDeferredBackgroundServices(runtime);');
    expect(source).not.toContain('const memMonitor = getMemoryMonitor();');
    expect(source).not.toContain('startIndexVersionPoller({');
    expect(source).not.toContain('startAutoBackup();');
    expect(helperSource).toContain('const memMonitor = getMemoryMonitor();');
    expect(helperSource).toContain('startIndexVersionPoller({');
    expect(helperSource).toContain('startAutoBackup();');
  });

  it('delegates startup diagnostics to the extracted helper', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'index-server.ts'), 'utf8');
    const helperSource = fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'startupDiagnostics.ts'), 'utf8');

    expect(source).toContain("import { emitStartupDiagnostics } from './startupDiagnostics';");
    expect(source).toContain('await emitStartupDiagnostics(runtime, __bufferEnabled, __earlyInitChunks);');
    expect(source).not.toContain('const methods = listRegisteredMethods();');
    expect(source).not.toContain('const idx = getIndexState();');
    expect(source).not.toContain('const dirDiag = diagnoseInstructionsDir();');
    expect(helperSource).toContain('const methods = listRegisteredMethods();');
    expect(helperSource).toContain('const idx = getIndexState();');
    expect(helperSource).toContain('const dirDiag = diagnoseInstructionsDir();');
  });
});

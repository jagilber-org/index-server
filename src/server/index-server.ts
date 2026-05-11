#!/usr/bin/env node
/**
 * Index Server - Dual Transport Architecture
 *
 * PRIMARY TRANSPORT - MCP Protocol (stdin/stdout):
 * - JSON-RPC 2.0 over stdio for all MCP client communication
 * - VS Code, Claude, and other MCP clients connect via stdin/stdout only
 * - Process-isolated, no network exposure
 *
 * SECONDARY TRANSPORT - Admin Dashboard (optional HTTP):
 * - HTTP server on localhost for administrator monitoring
 * - Read-only interface for status, tools, and metrics
 * - Not for MCP client communication - admin use only
 */
// Early stdin buffering (handshake hardening):
// Some fast clients send the initialize frame immediately after spawn. If the
// SDK server's stdin listener isn't attached yet, those bytes can sit without
// a consumer until the listener is registered. In practice we observed cases
// where initialize never produced a response in ~30s test windows. To harden
// the handshake we capture ALL stdin data prior to startSdkServer() completing
// and then re-emit the buffered chunks once the SDK has attached its handlers.
// This ensures spec compliance: an initialize request always yields either a
// success or a version negotiation error – never silent drop.
// Install MCP log bridge stderr intercept FIRST — before any module writes to stderr.
// This buffers all stderr output and replays it through MCP notifications/message
// after the handshake, so VS Code shows proper [info]/[warning]/[error] levels
// instead of tagging everything as [warning] [server stderr].
import '../services/mcpLogBridge';
// Install global stderr log prefix (timestamps, pid, ppid, seq, tid) before any diagnostic output.
import '../services/logPrefix';
// Ensure logger initializes early (file logging environment may auto-resolve)
import '../services/logger';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';
const __earlyInitChunks: Buffer[] = [];
let __earlyInitFirstLogged = false;
let __sdkReady = false;
// Allow opt-out (e.g., diagnostic comparison) via INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER=1
const __bufferEnabled = !getRuntimeConfig().server.disableEarlyStdinBuffer;
// We attach the temporary listener immediately so even synchronous module load
// time is covered.
function __earlyCapture(chunk: Buffer){
  if(!__sdkReady && __bufferEnabled){
    __earlyInitChunks.push(Buffer.from(chunk));
    // Light diagnostic: log only on first capture & optionally every 10th if deep buffering occurs.
    if(getBooleanEnv('INDEX_SERVER_LOG_DIAG')){
      if(!__earlyInitFirstLogged){
        __earlyInitFirstLogged = true;
        const preview = chunk.toString('utf8').replace(/\r/g,'\\r').replace(/\n/g,'\\n').slice(0,120);
        const hasContentLength = chunk.toString('utf8').includes('Content-Length');
        try { process.stderr.write(`[handshake-buffer] first early chunk captured size=${chunk.length} hasContentLength=${hasContentLength} preview="${preview}"\n`); } catch { /* ignore */ }
      } else if(__earlyInitChunks.length % 10 === 0){
        try { process.stderr.write(`[handshake-buffer] bufferedChunks=${__earlyInitChunks.length}\n`); } catch { /* ignore */ }
      }
    }
  }
}
try { if(__bufferEnabled) process.stdin.on('data', __earlyCapture); } catch { /* ignore */ }

import { startSdkServer } from './sdkServer';
import { startMultiInstanceMode } from './multiInstanceStartup';
import { startOptionalMemoryMonitoring, startDeferredBackgroundServices } from './backgroundServicesStartup';
import { emitStartupDiagnostics } from './startupDiagnostics';
import '../services/toolHandlers';
import { autoSeedBootstrap } from '../services/seedBootstrap';
import { createDashboardServer } from '../dashboard/server/DashboardServer.js';
import { getMetricsCollector } from '../dashboard/server/MetricsCollector.js';
import { cleanStalePortFiles, writePortFile, removePortFile, validateInstances } from '../dashboard/server/InstanceManager.js';
import { getBooleanEnv } from '../utils/envUtils';
import { DEFAULT_PORTS } from '../config/defaultValues';
import fs from 'fs';
import path from 'path';
import { logError, logInfo } from '../services/logger';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';
import { emitPreflightAndMaybeExit } from '../services/preflight';
import { execFileSync } from 'child_process';
import { createShutdownGuard } from './shutdownGuard';
import { runCertInit, formatPrintEnv, validateOptions as validateCertOptions } from './certInit';
import { CertInitError } from './certInit.types';
import type { PrintEnvFormat } from './certInit.types';
import {
  getServer,
  listServers,
  removeServer,
  restoreLatestBackup,
  upsertServer,
  validateFile,
  type McpClientTarget,
  type McpOperationOptions,
  type McpScope,
} from '../services/mcpConfig';

// Singleton shutdown guard — all exit paths funnel through this (Issue #36 fix)
export const shutdownGuard = createShutdownGuard();
// Store in global symbol so services (indexContext) can register cleanup without circular imports
(globalThis as Record<symbol, typeof shutdownGuard>)[Symbol.for('mcp-shutdown-guard')] = shutdownGuard;

// ---------------------------------------------------------------------------
// Unified global diagnostics guard (installs once) for uncaught errors, promise
// rejections, runtime warnings, and termination signals. Emits NDJSON to stderr
// for compatibility with typescript-schema-viewer log analysis.
// Uses direct process.stderr.write (not the logger) for safety in crash paths.
// ---------------------------------------------------------------------------
if(!process.listeners('uncaughtException').some(l => (l as unknown as { name?:string }).name === 'mcpGlobalGuard')){
  const ndjson = (level: string, msg: string, detail?: string) => {
    try {
      const rec: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, pid: process.pid };
      if (detail) rec.detail = detail;
      process.stderr.write(JSON.stringify(rec) + '\n');
    } catch { /* truly last resort */ }
  };
  const errDetail = (e: unknown) => {
    if(e instanceof Error) return e.stack ?? `${e.name||'Error'}: ${e.message}`;
    return typeof e === 'object' ? JSON.stringify(e) : String(e);
  };

  const getFatalExitDelayMs = () => Math.max(0, getRuntimeConfig().server.fatalExitDelayMs);

  // Register port file cleanup with the shutdown guard
  shutdownGuard.registerCleanup('removePortFile', () => {
    try { removePortFile(); } catch { /* ignore */ }
  });

  const uncaughtHandler = function mcpGlobalGuard(err: unknown){
    ndjson('ERROR', '[indexServer] Uncaught exception', errDetail(err));
    const code = shutdownGuard.initiateShutdown('uncaughtException');
    setTimeout(() => process.exit(code), getFatalExitDelayMs());
  };
  const rejectionHandler = function mcpGlobalGuard(reason: unknown){
    ndjson('ERROR', '[indexServer] Unhandled rejection', errDetail(reason));
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', rejectionHandler);

  // Surface Node.js process warnings (deprecations, experimental flags, etc.)
  process.on('warning', (w: Error) => {
    ndjson('WARN', '[indexServer] Process warning', errDetail(w));
  });

  // Graceful shutdown on common termination signals: log intent then exit
  const sigHandler = (sig: NodeJS.Signals) => {
    ndjson('INFO', `[indexServer] Signal received: ${sig}`);
    const code = shutdownGuard.initiateShutdown(sig);
    setTimeout(() => process.exit(code), 5);
  };
  ['SIGINT','SIGTERM'].forEach(s => { try { process.once(s as NodeJS.Signals, sigHandler); } catch { /* ignore */ } });

  // Detect parent disconnect (stdin EOF). On Windows, SIGTERM is not reliably
  // delivered when the parent (VS Code) kills the child process. The stdin
  // stream closing is the most reliable signal that the parent is gone. Without
  // this, the Express dashboard HTTP server keeps the event loop alive and the
  // process becomes an orphan that never exits (Issue: stale instances).
  try {
    if (process.stdin && !process.stdin.destroyed) {
      const stdinCloseHandler = () => {
        ndjson('INFO', '[indexServer] Parent disconnected (stdin closed) — initiating shutdown');
        const code = shutdownGuard.initiateShutdown('stdin-closed');
        setTimeout(() => process.exit(code), 50);
      };
      process.stdin.once('end', stdinCloseHandler);
      process.stdin.once('close', stdinCloseHandler);
    }
  } catch { /* ignore */ }

  // Belt-and-suspenders: PPID watchdog. On Windows, stdin EOF detection can be
  // unreliable in edge cases (parent crash, pipe handle inheritance). Periodically
  // check if the parent process (PPID) is still alive. If the parent is gone, we
  // are orphaned and should exit. The check uses process.kill(pid, 0) which on
  // Windows calls OpenProcess() -- it throws ESRCH if the process doesn't exist.
  // Skip when ppid is 0 or 1 (init / no parent) or when running interactively.
  //
  // Opt-out: INDEX_SERVER_DISABLE_PPID_WATCHDOG=1 disables the watchdog entirely.
  // Required for dev sandbox launchers that intentionally spawn through a
  // transient shell (e.g. `cmd /c start /B node ...`), where the recorded PPID
  // is the cmd shell that exits immediately after spawning the node child.
  try {
    const watchdogDisabled = getBooleanEnv('INDEX_SERVER_DISABLE_PPID_WATCHDOG');
    const ppid = process.ppid;
    if (!watchdogDisabled && ppid && ppid > 1) {
      const PPID_CHECK_INTERVAL_MS = 30_000; // 30 seconds
      const ppidTimer = setInterval(() => {
        try {
          process.kill(ppid, 0); // signal 0 = existence check, no actual signal sent
        } catch {
          // Parent is gone -- we are orphaned
          ndjson('WARN', `[indexServer] Parent pid=${ppid} no longer exists — initiating shutdown`);
          clearInterval(ppidTimer);
          const code = shutdownGuard.initiateShutdown('ppid-orphan');
          setTimeout(() => process.exit(code), 50);
        }
      }, PPID_CHECK_INTERVAL_MS);
      ppidTimer.unref(); // don't keep the event loop alive just for the watchdog
    }
  } catch { /* ignore */ }
}

// Low-level ingress tracing: echo raw stdin frames when verbose enabled (diagnostic only)
try {
  if(getBooleanEnv('INDEX_SERVER_VERBOSE_LOGGING') && !process.stdin.listenerCount('data')){
    process.stdin.on('data', chunk => {
      try { process.stderr.write(`[in] ${chunk.toString().replace(/\n/g,'\\n')}\n`); } catch { /* ignore */ }
    });
  }
} catch { /* ignore */ }

interface CliConfig {
  dashboard: boolean;
  dashboardPort: number;
  dashboardHost: string;
  maxPortTries: number;
  legacy: boolean; // deprecated flag (ignored)
  dashboardTls: boolean;
  dashboardTlsCert?: string;
  dashboardTlsKey?: string;
  dashboardTlsCa?: string;
  // ── --init-cert family (see src/server/certInit.ts and docs/cert_init.md) ──
  /** Trigger TLS cert generation on startup. */
  initCert?: boolean;
  /** Output directory for generated cert/key. Defaults to <home>/.index-server/certs. */
  certDir?: string;
  /** Override path for generated certificate file. */
  certFile?: string;
  /** Override path for generated private key file. */
  keyFile?: string;
  /** CommonName for the generated certificate. */
  certCn?: string;
  /** Comma-separated SAN entries (DNS:/IP: prefixed). */
  certSan?: string;
  /** Validity period in days (1..3650). */
  certDays?: number;
  /** RSA key size in bits (2048 or 4096). */
  certKeyBits?: number;
  /** Overwrite existing cert/key files. */
  certForce?: boolean;
  /** Print env-var lines after generation. true=auto, or 'posix'|'powershell'|'both'. */
  certPrintEnv?: boolean | string;
  /** Continue normal server startup after cert-init (composes with --init-cert). */
  start?: boolean;
}

function parseArgs(argv: string[]): CliConfig {
  const runtimeCfg = reloadRuntimeConfig();
  const http = runtimeCfg.dashboard.http;
  const config: CliConfig = {
    dashboard: http.enable,
    dashboardPort: http.port,
    dashboardHost: http.host,
    maxPortTries: http.maxPortTries,
    legacy: false,
    dashboardTls: http.tls.enabled,
    dashboardTlsCert: http.tls.certPath,
    dashboardTlsKey: http.tls.keyPath,
    dashboardTlsCa: http.tls.caPath,
  };

  const args = argv.slice(2);
  for(let i=0;i<args.length;i++){
    const raw = args[i];
    if(raw === '--dashboard') config.dashboard = true;
    else if(raw === '--no-dashboard') config.dashboard = false;
    else if(raw.startsWith('--dashboard-port=')) {
      const parsed = parseInt(raw.split('=')[1], 10);
      if (!Number.isNaN(parsed)) config.dashboardPort = parsed;
    }
    else if(raw === '--dashboard-port'){
      const v = args[++i];
      if(v){
        const parsed = parseInt(v, 10);
        if (!Number.isNaN(parsed)) config.dashboardPort = parsed;
      }
    }
    else if(raw.startsWith('--dashboard-host=')) config.dashboardHost = raw.split('=')[1] || config.dashboardHost;
    else if(raw === '--dashboard-host'){ const v = args[++i]; if(v) config.dashboardHost = v; }
    else if(raw.startsWith('--dashboard-tries=')) config.maxPortTries = Math.max(1, parseInt(raw.split('=')[1],10) || config.maxPortTries);
    else if(raw === '--dashboard-tries'){ const v = args[++i]; if(v) config.maxPortTries = Math.max(1, parseInt(v,10) || config.maxPortTries); }
  else if(raw === '--dashboard-tls') config.dashboardTls = true;
  else if(raw.startsWith('--dashboard-tls-cert=')) config.dashboardTlsCert = raw.split('=')[1];
  else if(raw === '--dashboard-tls-cert'){ const v = args[++i]; if(v) config.dashboardTlsCert = v; }
  else if(raw.startsWith('--dashboard-tls-key=')) config.dashboardTlsKey = raw.split('=')[1];
  else if(raw === '--dashboard-tls-key'){ const v = args[++i]; if(v) config.dashboardTlsKey = v; }
  else if(raw.startsWith('--dashboard-tls-ca=')) config.dashboardTlsCa = raw.split('=')[1];
  else if(raw === '--dashboard-tls-ca'){ const v = args[++i]; if(v) config.dashboardTlsCa = v; }
  // ── --init-cert family ───────────────────────────────────────────────
  else if(raw === '--init-cert') config.initCert = true;
  else if(raw.startsWith('--cert-dir=')) config.certDir = raw.split('=').slice(1).join('=');
  else if(raw === '--cert-dir'){ const v = args[++i]; if(v) config.certDir = v; }
  else if(raw.startsWith('--cert-file=')) config.certFile = raw.split('=').slice(1).join('=');
  else if(raw === '--cert-file'){ const v = args[++i]; if(v) config.certFile = v; }
  else if(raw.startsWith('--key-file=')) config.keyFile = raw.split('=').slice(1).join('=');
  else if(raw === '--key-file'){ const v = args[++i]; if(v) config.keyFile = v; }
  else if(raw.startsWith('--cn=')) config.certCn = raw.split('=').slice(1).join('=');
  else if(raw === '--cn'){ const v = args[++i]; if(v) config.certCn = v; }
  else if(raw.startsWith('--san=')) config.certSan = raw.split('=').slice(1).join('=');
  else if(raw === '--san'){ const v = args[++i]; if(v) config.certSan = v; }
  else if(raw.startsWith('--days=')) { const p = parseInt(raw.split('=')[1], 10); if(!Number.isNaN(p)) config.certDays = p; }
  else if(raw === '--days'){ const v = args[++i]; if(v){ const p = parseInt(v, 10); if(!Number.isNaN(p)) config.certDays = p; } }
  else if(raw.startsWith('--key-bits=')) { const p = parseInt(raw.split('=')[1], 10); if(!Number.isNaN(p)) config.certKeyBits = p; }
  else if(raw === '--key-bits'){ const v = args[++i]; if(v){ const p = parseInt(v, 10); if(!Number.isNaN(p)) config.certKeyBits = p; } }
  else if(raw === '--force') config.certForce = true;
  else if(raw === '--print-env') config.certPrintEnv = true;
  else if(raw.startsWith('--print-env=')) config.certPrintEnv = raw.split('=').slice(1).join('=');
  else if(raw === '--start') config.start = true;
  else if(raw === '--legacy' || raw === '--legacy-transport') config.legacy = true; // no-op
  else if(raw === '--setup' || raw === '--configure'){
      launchSetupWizard(argv);
    }
  else if(raw === '--help' || raw === '-h'){
      printHelpAndExit();
    }
  }
  return config;
}

function launchSetupWizard(argv: string[]): never {
  const wizardPath = path.join(__dirname, '..', '..', 'scripts', 'build', 'setup-wizard.mjs');
  // Forward all args after --setup/--configure to the wizard
  const setupIdx = argv.findIndex(a => a === '--setup' || a === '--configure');
  const forwardArgs = setupIdx >= 0 ? argv.slice(setupIdx + 1) : [];
  try {
    execFileSync(process.execPath, [wizardPath, ...forwardArgs], { stdio: 'inherit' });
  } catch (e) {
    const code = (e as { status?: number }).status ?? 1;
    process.exit(code);
  }
  process.exit(0);
}

const MCP_CONFIG_COMMANDS = new Set(['--mcp-list', '--mcp-get', '--mcp-upsert', '--mcp-remove', '--mcp-restore', '--mcp-validate']);

function parseMcpConfigOptions(argv: string[]): { command?: string; options: McpOperationOptions; json: boolean } {
  const args = argv.slice(2);
  const command = args.find(arg => MCP_CONFIG_COMMANDS.has(arg));
  const options: McpOperationOptions = {};
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    if (raw === '--target' && args[i + 1]) options.target = args[++i] as McpClientTarget;
    else if (raw.startsWith('--target=')) options.target = raw.slice('--target='.length) as McpClientTarget;
    else if (raw === '--scope' && args[i + 1]) options.scope = args[++i] as McpScope;
    else if (raw.startsWith('--scope=')) options.scope = raw.slice('--scope='.length) as McpScope;
    else if (raw === '--name' && args[i + 1]) options.name = args[++i];
    else if (raw.startsWith('--name=')) options.name = raw.slice('--name='.length);
    else if (raw === '--from-profile' && args[i + 1]) options.profile = args[++i] as McpOperationOptions['profile'];
    else if (raw.startsWith('--from-profile=')) options.profile = raw.slice('--from-profile='.length) as McpOperationOptions['profile'];
    else if (raw === '--backup' && args[i + 1]) options.backup = args[++i];
    else if (raw.startsWith('--backup=')) options.backup = raw.slice('--backup='.length);
    else if (raw === '--dry-run') options.dryRun = true;
    else if (raw === '--json') json = true;
    else if (raw === '--env' && args[i + 1]) {
      const pair = args[++i];
      const idx = pair.indexOf('=');
      if (idx <= 0) throw new Error(`Invalid --env value: ${pair}. Expected KEY=VALUE.`);
      options.env = options.env ?? {};
      options.env[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  }
  return { command, options, json };
}

function handleMcpConfigCli(argv: string[]): void {
  const hasMcpCommand = argv.some(arg => MCP_CONFIG_COMMANDS.has(arg));
  if (!hasMcpCommand) return;
  let json = argv.includes('--json');
  try {
    const parsed = parseMcpConfigOptions(argv);
    const { command, options } = parsed;
    json = parsed.json;
    if (!command) return;
    const result =
      command === '--mcp-list' ? listServers(options) :
      command === '--mcp-get' ? getServer(options) :
      command === '--mcp-upsert' ? upsertServer(options) :
      command === '--mcp-remove' ? removeServer(options) :
      command === '--mcp-restore' ? restoreLatestBackup(options) :
      validateFile(options);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stderr.write(`MCP config ${result.action} succeeded: ${result.path}\n`);
      if (result.servers) process.stderr.write(`Servers: ${result.servers.join(', ')}\n`);
      if (result.validation && !result.validation.ok) process.stderr.write(`Validation errors: ${result.validation.errors.join('; ')}\n`);
    }
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    else process.stderr.write(`MCP config command failed: ${message}\n`);
    process.exit(2);
  }
}

function printHelpAndExit(){
  const help = `index-server - Model Context Protocol Server

MCP TRANSPORT (Client Communication):
  Primary transport: JSON-RPC 2.0 over stdio (stdin/stdout)
  Purpose: VS Code, Claude, and other MCP clients
  Security: Process-isolated, no network exposure

SETUP:
  --setup                  Launch interactive configuration wizard
  --configure              Alias for --setup

MCP CONFIGURATION CRUD:
  --mcp-list               List configured MCP servers for a target
  --mcp-get                Get one configured MCP server entry
  --mcp-upsert             Create or update one MCP server entry
  --mcp-remove             Remove one MCP server entry
  --mcp-restore            Restore the latest MCP config backup, or --backup PATH
  --mcp-validate           Validate one MCP config file
  --target TARGET          vscode | copilot-cli | claude (default: vscode)
  --scope SCOPE            repo | global for VS Code (default: repo)
  --name NAME              MCP server name (default: index-server)
  --from-profile PROFILE   default | enhanced | experimental
  --env KEY=VALUE          Add or override one INDEX_SERVER_* env value; repeatable
  --backup PATH            Restore this explicit backup path with --mcp-restore
  --dry-run                Validate and report without writing
  --json                   Emit JSON result to stdout

ADMIN DASHBOARD (Optional):
  --dashboard              Enable read-only admin dashboard (default off)
  --dashboard-port=PORT    Dashboard port (default 8787)
  --dashboard-host=HOST    Dashboard host (default 127.0.0.1)
  --dashboard-tries=N      Port retry attempts (default 10)
  --no-dashboard           Disable dashboard
  --dashboard-tls          Enable HTTPS/WSS for dashboard
  --dashboard-tls-cert=PATH  TLS certificate file (PEM)
  --dashboard-tls-key=PATH   TLS private key file (PEM)
  --dashboard-tls-ca=PATH    Optional CA certificate file (PEM)
  Purpose: Local administrator monitoring only

CERTIFICATE BOOTSTRAP (Optional, Self-Signed TLS):
  --init-cert              Generate a self-signed TLS cert+key.
                           Requires openssl on PATH (Windows: C:\\Program Files\\Git\\usr\\bin).
                           See docs/cert_init.md for setup.
                           Exits after generation unless --start is also given.
  --cert-dir PATH          Output directory (default: ~/.index-server/certs)
  --cert-file PATH         Override cert output path (must be under --cert-dir)
  --key-file PATH          Override key output path (must be under --cert-dir)
  --cn NAME                CommonName subject (default: localhost)
  --san LIST               Comma-separated SAN entries (default: DNS:localhost,IP:127.0.0.1)
  --days N                 Validity in days, 1..3650 (default: 365)
  --key-bits N             RSA key size, 2048 or 4096 (default: 2048)
  --force                  Overwrite existing cert/key files
  --print-env[=FMT]        Print INDEX_SERVER_DASHBOARD_TLS_* env lines after generation.
                           FMT = posix | powershell | both | auto (default: auto)
  --start                  After --init-cert, start the server with the generated material
                           (sets --dashboard-tls and feeds the new cert/key automatically)
  See docs/cert_init.md for full reference, examples, and security notes.

ENVIRONMENT VARIABLES:
  INDEX_SERVER_DASHBOARD=1          Enable dashboard (0=disable, 1=enable)
  INDEX_SERVER_DASHBOARD_PORT=PORT  Dashboard port (default 8787)
  INDEX_SERVER_DASHBOARD_HOST=HOST  Dashboard host (default 127.0.0.1)
  INDEX_SERVER_DASHBOARD_TRIES=N    Port retry attempts (default 10)
  INDEX_SERVER_DASHBOARD_TLS=1      Enable HTTPS/WSS for dashboard
  INDEX_SERVER_DASHBOARD_TLS_CERT   TLS certificate file path (PEM)
  INDEX_SERVER_DASHBOARD_TLS_KEY    TLS private key file path (PEM)
  INDEX_SERVER_DASHBOARD_TLS_CA     Optional CA certificate file path (PEM)

  Other environment variables:
  INDEX_SERVER_VERBOSE_LOGGING=1   Verbose RPC/transport logging
  INDEX_SERVER_LOG_DIAG=1           Diagnostic logging
  INDEX_SERVER_MUTATION=0           Force read-only mode (writes enabled by default)
  INDEX_SERVER_IDLE_KEEPALIVE_MS    Keepalive interval (default 30000ms)
  NODE_ENV=development              Use dev ports (dashboard=${DEFAULT_PORTS.DASHBOARD_DEV}, leader=${DEFAULT_PORTS.LEADER_DEV})

GENERAL:
  -h, --help               Show this help and exit
  (legacy transport removed; SDK only)

IMPORTANT:
- MCP clients connect via stdio only, not HTTP dashboard
- Dashboard is for admin monitoring, not client communication
- All MCP protocol frames output to stdout; logs to stderr
- Command line arguments override environment variables`;
  // write to stderr to avoid contaminating stdout protocol
  process.stderr.write(help + '\n');
  process.exit(0);
}

function findPackageVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '..', '..', 'package.json')
  ];
  for(const p of candidates){
    try {
      if(fs.existsSync(p)){
        const raw = JSON.parse(fs.readFileSync(p,'utf8'));
        if(raw?.version) return raw.version;
      }
    } catch { /* ignore */ }
  }
  return '0.0.0';
}

// Added close handle in return object for test coverage harness so unit tests can start and stop the dashboard
// without leaving open event loop handles. Production code ignores the extra property.
async function startDashboard(cfg: CliConfig): Promise<{ url: string; close: () => void } | null> {
  if (!cfg.dashboard) return null;

  // Build TLS options if enabled — read cert/key from disk
  let tlsOpt: { cert: string; key: string; ca?: string } | undefined;
  if (cfg.dashboardTls) {
    if (!cfg.dashboardTlsCert || !cfg.dashboardTlsKey) {
      process.stderr.write(`[startup] Dashboard TLS enabled but cert/key paths missing. Set INDEX_SERVER_DASHBOARD_TLS_CERT and INDEX_SERVER_DASHBOARD_TLS_KEY.\n`);
      return null;
    }
    try {
      const cert = fs.readFileSync(cfg.dashboardTlsCert, 'utf8');
      const key = fs.readFileSync(cfg.dashboardTlsKey, 'utf8');
      const ca = cfg.dashboardTlsCa ? fs.readFileSync(cfg.dashboardTlsCa, 'utf8') : undefined;
      tlsOpt = { cert, key, ca };
    } catch (err) {
      process.stderr.write(`[startup] Failed to read TLS cert/key files: ${err}\n`);
      return null;
    }
  }

  try {
    process.stderr.write(`[startup] Starting dashboard server on ${cfg.dashboardHost}:${cfg.dashboardPort}${tlsOpt ? ' (HTTPS)' : ''}\n`);

    const dashboardServer = createDashboardServer({
      port: cfg.dashboardPort,
      host: cfg.dashboardHost,
      maxPortTries: cfg.maxPortTries,
      enableWebSockets: true,
      enableCors: false,
      tls: tlsOpt,
      graphEnabled: getRuntimeConfig().dashboard.graphEnabled,
    });

    const result = await dashboardServer.start();

    // Record dashboard startup in metrics
    getMetricsCollector().recordConnection('dashboard_server');

    return {
      url: result.url,
      close: result.close
    };
  } catch (error) {
    process.stderr.write(`[startup] Dashboard startup failed: ${error}\n`);
    return null;
  }
}

export async function main(){
  handleMcpConfigCli(process.argv);
  // Run startup preflight (module/data presence). Non-fatal unless INDEX_SERVER_PREFLIGHT_STRICT=1
  try { emitPreflightAndMaybeExit(); } catch { /* ignore preflight wrapper errors */ }
  // -------------------------------------------------------------
  // Automatic bootstrap seeding (executes before any index load)
  // -------------------------------------------------------------
  try { autoSeedBootstrap(); } catch { /* ignore seeding errors (non-fatal) */ }
  // -------------------------------------------------------------
  // Idle keepalive support (multi-client shared server test aid)
  // -------------------------------------------------------------
  // Some test scenarios spawn the index server with stdin set to 'ignore'
  // (child_process stdio option) and then create separate test clients
  // that each spawn *their own* server processes pointing at the same
  // instructions directory. In that arrangement the originally spawned
  // shared server would exit immediately because no stdin activity occurs
  // (no MCP initialize frame arrives). That premature exit caused RED in
  // multi-client shared server tests before any CRUD
  // assertions executed.
  //
  // To accommodate this interim RED/ GREEN progression—while future work
  // may add true multi-attach capabilities—we keep the process alive for
  // a bounded idle window when (a) stdin is not readable OR (b) no stdin
  // activity is observed shortly after startup. Environment variable
  // INDEX_SERVER_IDLE_KEEPALIVE_MS (default 30000) bounds the maximum keepalive.
  // This has negligible overhead and only applies when no initialize
  // handshake occurs promptly.
  let __stdinActivity = false;
  try { if(process.stdin && !process.stdin.destroyed){ process.stdin.on('data', () => { __stdinActivity = true; }); } } catch { /* ignore */ }

  function startIdleKeepalive(){
    const serverConfig = getRuntimeConfig().server;
    const maxMs = Math.max(1000, serverConfig.idleKeepaliveMs);
    const started = Date.now();
    // Only create ONE interval.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if((global as any).__mcpIdleKeepalive) return;
    // Emit a synthetic readiness marker for test environments that spawn the
    // server with stdin=ignore and rely on a '[ready]' sentinel before
    // proceeding (multi-client shared server tests). This does NOT
    // emit a formal JSON-RPC server/ready (which would follow initialize in
    // normal operation); it's a plain log line to stdout and is gated to the
    // idle keepalive path only so production interactive flows are unaffected.
    // Synthetic readiness sentinel (only when explicitly enabled) so tests that rely on a
    // shared server with stdin ignored can proceed. Stricter gating to avoid contaminating
    // other protocol tests: requires INDEX_SERVER_SHARED_SERVER_SENTINEL=1 AND delays emission slightly
    // to allow an initialize frame to arrive first if stdin is active. Legacy env
    // INDEX_SERVER_IDLE_READY_SENTINEL is ignored unless accompanied by INDEX_SERVER_SHARED_SERVER_SENTINEL.
    try {
      if(serverConfig.sharedSentinel === 'multi-client-shared' && !__stdinActivity){
        setTimeout(()=>{ if(!__stdinActivity){ try { process.stdout.write('[ready] idle-keepalive (no stdin activity)\n'); } catch { /* ignore */ } } }, 60);
      }
    } catch { /* ignore */ }
    const iv = setInterval(() => {
      // Clear early if stdin becomes active (late attach) so we don't keep zombie processes.
      if(__stdinActivity || Date.now() - started > maxMs){
        clearInterval(iv);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).__mcpIdleKeepalive = undefined;
      } else if(getRuntimeConfig().server.multicoreTrace){
        try {
          // Reflective access to private diagnostic API (Node internal) guarded defensively
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyProc: any = process as unknown as any;
          const handlesLen = typeof anyProc._getActiveHandles === 'function' ? (anyProc._getActiveHandles()||[]).length : 'n/a';
          process.stderr.write(`[keepalive] t=${Date.now()-started}ms handles=${handlesLen} stdinActivity=${__stdinActivity}\n`);
        } catch { /* ignore */ }
      }
    }, 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__mcpIdleKeepalive = iv;
  }
  // Always start keepalive immediately (unconditional) so a lack of stdin activity
  // cannot allow the event loop to drain and exit before the shared-server test
  // observes the synthetic readiness sentinel. The interval self-clears on first
  // stdin activity or after the bounded max window.
  startIdleKeepalive();

  const cfg = parseArgs(process.argv);
  const runtime = getRuntimeConfig();

  // ── --init-cert dispatch ──────────────────────────────────────────────
  // Self-contained: if --init-cert is given, run cert generation. When --start
  // is NOT also given, exit after generation (or on error). When --start IS
  // given, inject the generated paths into the dashboard TLS config so the
  // server boots with the new material — no extra env wiring required.
  // Constitution refs: AR-1 (additive, no implicit side effects without flag),
  // SH-4 (path traversal guard re-asserted by validateOptions inside runCertInit),
  // OB-3/OB-5 (CertInitError surfaced with stable code; structured logs from module).
  if (cfg.initCert) {
    try {
      const result = await runCertInit({
        certDir: cfg.certDir,
        certFile: cfg.certFile,
        keyFile: cfg.keyFile,
        cn: cfg.certCn,
        san: cfg.certSan,
        days: cfg.certDays,
        keyBits: cfg.certKeyBits as 2048 | 4096 | undefined,
        force: cfg.certForce ?? false,
        printEnv: (cfg.certPrintEnv ?? false) as boolean | PrintEnvFormat,
      });
      process.stderr.write(
        `[init-cert] ${result.kind === 'generated' ? 'generated' : 'skipped'}: cert=${result.certFile} key=${result.keyFile}\n`,
      );
      if (cfg.certPrintEnv) {
        const fmt: PrintEnvFormat = (typeof cfg.certPrintEnv === 'string')
          ? (cfg.certPrintEnv as PrintEnvFormat)
          : 'auto';
        // Re-validate to obtain the resolved option shape (paths) for the helper.
        const opts = validateCertOptions({
          certDir: cfg.certDir,
          certFile: result.certFile,
          keyFile: result.keyFile,
          cn: cfg.certCn,
          san: cfg.certSan,
          days: cfg.certDays,
          keyBits: cfg.certKeyBits as 2048 | 4096 | undefined,
          force: cfg.certForce ?? false,
          printEnv: (cfg.certPrintEnv ?? false) as boolean | PrintEnvFormat,
        });
        process.stderr.write(formatPrintEnv(opts, fmt));
      }
      // When --start was passed, inject paths into the dashboard TLS config
      // so startDashboard() picks them up without requiring --dashboard-tls-cert/key.
      if (cfg.start) {
        cfg.dashboardTls = true;
        cfg.dashboardTlsCert = result.certFile;
        cfg.dashboardTlsKey = result.keyFile;
        // Continue normal startup below.
      } else {
        // Generation-only mode: exit cleanly.
        process.exit(0);
      }
    } catch (e) {
      const code = (e instanceof CertInitError) ? e.code : 'UNKNOWN';
      const msg = (e instanceof Error) ? e.message : String(e);
      process.stderr.write(`[init-cert] FAILED (code=${code}): ${msg}\n`);
      try { logError('[init-cert] failed', { code, message: msg }); } catch { /* ignore */ }
      process.exit(2);
    }
  }

  // ── Dev/prod port-collision guard ─────────────────────────────────
  // When NODE_ENV=development (or --watch), refuse to start on production
  // default ports to prevent dev servers from receiving production traffic.
  const isDev = process.env.NODE_ENV === 'development' || process.argv.some(a => a === '--watch' || a.includes('--watch'));
  if (isDev) {
    const prodPorts: number[] = [DEFAULT_PORTS.DASHBOARD, DEFAULT_PORTS.LEADER];
    if (prodPorts.includes(cfg.dashboardPort)) {
      process.stderr.write(
        `[startup] FATAL: Dev server refusing to start on production port ${cfg.dashboardPort}.\n` +
        `[startup] Production dashboard default is ${DEFAULT_PORTS.DASHBOARD}, dev default is ${DEFAULT_PORTS.DASHBOARD_DEV}.\n` +
        `[startup] Set INDEX_SERVER_DASHBOARD_PORT=${DEFAULT_PORTS.DASHBOARD_DEV} or remove NODE_ENV=development to use production ports.\n`
      );
      process.exit(1);
    }
    process.stderr.write(`[startup] Dev mode: dashboard port ${cfg.dashboardPort} (prod=${DEFAULT_PORTS.DASHBOARD})\n`);
  }

  const dash = await startDashboard(cfg);
  if(dash){
    process.stderr.write(`[startup] Dashboard server started successfully\n`);
    process.stderr.write(`[startup] Dashboard URL: ${dash.url}\n`);
    process.stderr.write(`[startup] Dashboard host: ${cfg.dashboardHost}\n`);
    process.stderr.write(`[startup] Dashboard port: ${dash.url.split(':').pop()?.replace('/', '') || 'unknown'}\n`);
    process.stderr.write(`[startup] Dashboard WebSockets: enabled\n`);
    process.stderr.write(`[startup] Dashboard access: Local admin interface (not for MCP clients)\n`);

    // Instance discovery: clean stale port files, register this instance
    try {
      cleanStalePortFiles();
      const dashPort = parseInt(dash.url.split(':').pop()?.replace('/', '') || '0', 10);
      if (dashPort > 0) {
        writePortFile(dashPort, cfg.dashboardHost);
        process.stderr.write(`[startup] Instance port file written (pid=${process.pid} port=${dashPort})\n`);
      }
      // Background instance health sweep: periodically HTTP-ping other instances
      // and remove port files for ones that no longer respond. Defense-in-depth
      // against orphaned processes where stdin-close detection didn't fire.
      const validateIntervalMs = 30_000;
      const validateTimer = setInterval(() => {
        validateInstances().catch(() => { /* ignore */ });
      }, validateIntervalMs);
      validateTimer.unref(); // Don't keep process alive just for validation
    } catch (e) {
      process.stderr.write(`[startup] Instance registration failed: ${e}\n`);
    }
  } else if(cfg.dashboard) {
    process.stderr.write(`[startup] Dashboard enabled but failed to start (check port ${cfg.dashboardPort})\n`);
  } else {
    process.stderr.write(`[startup] Dashboard disabled (set INDEX_SERVER_DASHBOARD=1 to enable)\n`);
  }

  // ---------------------------------------------------------------
  // Multi-instance: Leader election + HTTP MCP transport [EXPERIMENTAL]
  // ---------------------------------------------------------------
  await startMultiInstanceMode(cfg.dashboardHost, runtime);

  startOptionalMemoryMonitoring(runtime);

  await emitStartupDiagnostics(runtime, __bufferEnabled, __earlyInitChunks);
  await startSdkServer();
  // Auto-confirm bootstrap (test harness opt-in). Executed after SDK start so index state
  // exists; harmless if already confirmed or non-bootstrap instructions present.
  try {
    if(runtime.server.bootstrap.autoconfirm){
      const ok = forceBootstrapConfirmForTests('auto-confirm env');
      if(ok && runtime.logging.diagnostics){ try { process.stderr.write('[bootstrap] auto-confirm applied (test env)\n'); } catch { /* ignore */ } }
    }
  } catch { /* ignore */ }
  startDeferredBackgroundServices(runtime);
  // Mark SDK ready & replay any buffered stdin chunks exactly once.
  __sdkReady = true;
  if(__bufferEnabled){
    try { process.stdin.off('data', __earlyCapture); } catch { /* ignore */ }
    if(__earlyInitChunks.length){
      const totalBytes = __earlyInitChunks.reduce((sum, c) => sum + c.length, 0);
      const hasContentLength = __earlyInitChunks.some(c => c.toString('utf8').includes('Content-Length'));
      const hasInitialize = __earlyInitChunks.some(c => c.toString('utf8').includes('"method"') && c.toString('utf8').includes('initialize'));
      if(runtime.logging.diagnostics){
        try {
          process.stderr.write(`[handshake-buffer] replay starting chunks=${__earlyInitChunks.length} totalBytes=${totalBytes} hasContentLength=${hasContentLength} hasInitialize=${hasInitialize}\n`);
        } catch { /* ignore */ }
      }
      try {
        for(let i = 0; i < __earlyInitChunks.length; i++){
          const c = __earlyInitChunks[i];
          process.stdin.emit('data', c);
          if(runtime.logging.diagnostics && i === 0){
            const preview = c.toString('utf8').replace(/\r/g,'\\r').replace(/\n/g,'\\n').slice(0,200);
            try { process.stderr.write(`[handshake-buffer] replayed chunk[0] size=${c.length} preview="${preview}"\n`); } catch { /* ignore */ }
          }
        }
      } catch(e) {
        if(runtime.logging.diagnostics){
          try { process.stderr.write(`[handshake-buffer] replay error: ${(e instanceof Error) ? e.message : String(e)}\n`); } catch { /* ignore */ }
        }
      }
      if(runtime.logging.diagnostics) logError(`[handshake-buffer] replayed ${__earlyInitChunks.length} early chunk(s)`);
      __earlyInitChunks.length = 0;
    } else if(runtime.logging.diagnostics){
      try { process.stderr.write(`[handshake-buffer] replay skipped (no buffered chunks)\n`); } catch { /* ignore */ }
    }
  }
  process.stderr.write('[startup] SDK server started (stdio only)\n');
  try { logInfo('[indexServer] Server started', { pid: process.pid, logFile: runtime.logging.file }); } catch { /* ignore */ }
}

if(require.main === module){
  main();
}

// Test-only named exports for coverage of argument parsing & dashboard logic
export { parseArgs as _parseArgs, findPackageVersion as _findPackageVersion, startDashboard as _startDashboard };

// Public export for dashboard functionality
export { startDashboard };

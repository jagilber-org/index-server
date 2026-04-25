/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SDK-based MCP server bootstrap (dynamic require variant to work under CommonJS build).
 * Uses the published dist/ subpath exports without relying on TS ESM moduleResolution.
 *
 * Orchestrates server creation and startup, delegating handshake/protocol logic to
 * handshakeManager.ts and transport/dispatcher setup to transportFactory.ts.
 */
import fs from 'fs';
import path from 'path';
import { getToolRegistry } from '../services/toolRegistry';
import '../services/toolHandlers';
import { getHandler } from './registry';
import { z } from 'zod';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { registerMcpServer } from '../services/mcpLogBridge';
import {
  isHandshakeFallbacksEnabled,
  SUPPORTED_PROTOCOL_VERSIONS,
  record,
  initFrameLog,
  negotiateProtocolVersion,
  emitReadyGlobal,
  handshakeLog,
  setupStdinSniffer,
  setupSafetyFallbacks,
} from './handshakeManager';
import {
  dynamicImport,
  setupStdoutDiagnostics,
  setupDispatcherOverride,
  wrapTransportSend,
  setupKeepalive,
} from './transportFactory';
import {
  getReadOnlyPrompt,
  getReadOnlySurfaceCapabilities,
  listReadOnlyPrompts,
  listReadOnlyResources,
  readReadOnlyResource,
} from './mcpReadOnlySurfaces';

// ESM dynamic import used below for SDK modules.
// We'll lazy-load ESM exports via dynamic import when starting.
let StdioServerTransport: any;

/**
 * Create and configure an MCP SDK server instance with the full tool registry.
 * @param ServerClass - The MCP SDK Server constructor (loaded dynamically to avoid ESM/CJS conflicts)
 * @returns Configured SDK server instance with all tool handlers registered
 */
export function createSdkServer(ServerClass: any) {
  // Derive version from package.json (no artificial suffix so clients see real semantic version)
  let version = '0.0.0';
  const pkgCandidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),  // dist/server/../.. = repo root
    path.join(__dirname, '..', 'package.json'),         // fallback
  ];
  for (const pkgPath of pkgCandidates) {
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (raw.version) { version = raw.version; break; }
      }
    } catch { /* ignore */ }
  }
  const serverCapabilities = {
    tools: { listChanged: true },
    logging: {},
    ...getReadOnlySurfaceCapabilities(),
  };
  const server: any = new ServerClass({ name: 'index', version }, { capabilities: serverCapabilities });
  (server as any).__declaredVersion = version;

  // Register server with the MCP log bridge (activated later after ready)
  registerMcpServer(server);

  // Never emit tools/list_changed before ready. Wrap sendToolListChanged to enforce ordering.
  try {
    const origSendToolListChanged = (server as any).sendToolListChanged?.bind(server);
    if(origSendToolListChanged && !(server as any).__listPatched){
      (server as any).__listPatched = true;
      (server as any).sendToolListChanged = (...a: any[]) => {
        if(!(server as any).__readyNotified){
          (server as any).__pendingListChanged = true; record('buffer_list_changed_pre_ready');
          return;
        }
        return origSendToolListChanged(...a);
      };
    }
  } catch { /* ignore */ }

  // Track ready notification + whether initialize was seen (ordering guarantee)
  (server as any).__readyNotified = false;
  (server as any).__sawInitializeRequest = false;
  (server as any).__initResponseSent = false;

  // Single fallback watchdog if ready somehow suppressed.
  if(isHandshakeFallbacksEnabled()){
    setTimeout(()=>{
      try {
        if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
          record('watchdog_emit_ready');
          emitReadyGlobal(server,'watchdog');
        }
      } catch { /* ignore */ }
    },250).unref?.();
  }

  const requestSchema = (methodName: string) => z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.literal(methodName),
    params: z.any().optional()
  });

  // Explicit initialize handler – guarantees deterministic initialize response
  // followed by exactly one server/ready notification.
  server.setRequestHandler(requestSchema('initialize'), async (req: { params?: any }) => {
    try {
      (server as any).__sawInitializeRequest = true;
      record('initialize_received', { requestedProtocol: req?.params?.protocolVersion });
      const requested = req?.params?.protocolVersion as string | undefined;
      const negotiated = negotiateProtocolVersion(requested);
      const versionDeclared = (server as any).__declaredVersion || (server as any).version || '0.0.0';
      const result: any = {
        protocolVersion: negotiated,
        serverInfo: { name: 'index', version: versionDeclared },
        capabilities: serverCapabilities,
        instructions: 'Use initialize -> tools/list -> tools/call { name, arguments }. Prompts: prompts/list and prompts/get. Resources: resources/list and resources/read. Health: tools/call health_check. Metrics: tools/call metrics_snapshot. Ping: ping.'
      };
      initFrameLog('handler_return', { negotiated });
      return result;
    } catch {
      return { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0], serverInfo:{ name:'index', version:'0.0.0' }, capabilities:serverCapabilities, instructions:'init fallback' };
    }
  });

  // Legacy internal _oninitialize patch (will not trigger because we intercept initialize directly)
  const originalInitInner = (server as any)._oninitialize?.bind(server);
  if(originalInitInner && !(server as any).__initPatched){
    (server as any).__initPatched = true;
    (server as any)._oninitialize = async function(request: any){
      const result = await originalInitInner(request);
      try {
        const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
        (result as any).protocolVersion = negotiated;
        if(result && typeof result === 'object' && !('instructions' in result)){
          (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Prompts: prompts/list and prompts/get. Resources: resources/list and resources/read. Health: tools/call health_check. Metrics: tools/call metrics_snapshot. Ping: ping.';
        }
        (this as any).__sawInitializeRequest = true;
      } catch { /* ignore */ }
      return result;
    };
  }

  server.setRequestHandler(requestSchema('tools/list'), async () => {
    record('tools_list_request', { afterReady: !!(server as any).__readyNotified, sawInit: !!(server as any).__sawInitializeRequest });
    const registry = getToolRegistry();
    return { tools: registry.map(r => ({ name: r.name, description: r.description, inputSchema: r.inputSchema as Record<string,unknown> })) };
  });

  server.setRequestHandler(requestSchema('prompts/list'), async () => {
    return { prompts: listReadOnlyPrompts() };
  });

  server.setRequestHandler(z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.literal('prompts/get'),
    params: z.object({
      _meta: z.any().optional(),
      name: z.string(),
      arguments: z.record(z.string()).optional(),
    }),
  }), async (req: { params: { name: string; arguments?: Record<string, string> } }) => {
    const prompt = getReadOnlyPrompt(req.params.name, req.params.arguments);
    if(!prompt){
      throw { code: -32602, message: `Unknown prompt: ${req.params.name}`, data: { message: `Unknown prompt: ${req.params.name}`, method: 'prompts/get', name: req.params.name } };
    }
    return prompt;
  });

  server.setRequestHandler(requestSchema('resources/list'), async () => {
    return { resources: listReadOnlyResources() };
  });

  server.setRequestHandler(z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.literal('resources/read'),
    params: z.object({
      _meta: z.any().optional(),
      uri: z.string(),
    }),
  }), async (req: { params: { uri: string } }) => {
    const resource = readReadOnlyResource(req.params.uri);
    if(!resource){
      throw { code: -32602, message: `Unknown resource: ${req.params.uri}`, data: { message: `Unknown resource: ${req.params.uri}`, method: 'resources/read', uri: req.params.uri } };
    }
    return resource;
  });

  // Raw handler for tools/call (MCP style) - returns content array
  server.setRequestHandler(requestSchema('tools/call'), async (req: { params?: { name?: string; arguments?: Record<string, unknown> } }) => {
    const p = req?.params ?? {};
    const name = p.name ?? '';
    const args = p.arguments || {};
    if(name === 'health_check') record('tools_call_health');
    try {
      if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] call method=tools/call tool=${name} id=${(req as any)?.id ?? 'n/a'}\n`);
    } catch { /* ignore */ }
    const handler = getHandler(name);
    if(!handler){
      throw { code: -32601, message: `Unknown tool: ${name}`, data: { message: `Unknown tool: ${name}`, method: name } };
    }
    try {
      const result = await Promise.resolve(handler(args));
      try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] tool_result tool=${name} bytes=${Buffer.byteLength(JSON.stringify(result),'utf8')}\n`); } catch { /* ignore */ }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch(e){
      const code = (e as any)?.code;
      const sem = (e as any)?.__semantic === true;
      if(Number.isSafeInteger(code)){
        try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] tool_error_passthru tool=${name} code=${code} semantic=${sem?'1':'0'} msg=${(e as any)?.message || ''}\n`); } catch { /* ignore */ }
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] tool_error_wrap tool=${name} msg=${msg.replace(/\s+/g,' ')} code=${code ?? 'n/a'}\n`); } catch { /* ignore */ }
      throw { code: -32603, message: 'Tool execution failed', data: { message: msg, method: name } };
    }
  });

  // Lightweight ping handler (simple reachability / latency measurement)
  server.setRequestHandler(requestSchema('ping'), async () => {
    if((server as any).__sawInitializeRequest && (server as any).__initResponseSent && !(server as any).__readyNotified){
      emitReadyGlobal(server,'ping-trigger');
    }
    return { timestamp: new Date().toISOString(), uptimeMs: Math.round(process.uptime() * 1000) };
  });

  return server;
}

// Diagnostic accessor tool registered via dynamic side-effect (safe: tiny + read-only)
try { (global as any).__MCP_HANDSHAKE_TRACE_TOOL__ = true; } catch { /* ignore */ }

export async function startSdkServer() {
  // Lazy dynamic import once (first-call path)
  if(!StdioServerTransport){
    let modServer: any, modStdio: any;
    try {
      modServer = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
      modStdio = await dynamicImport('@modelcontextprotocol/sdk/server/stdio.js');
    } catch(e){
      try { process.stderr.write(`[startup] sdk_dynamic_import_failed ${(e instanceof Error)? e.message: String(e)}\n`); } catch { /* ignore */ }
    }
    try { StdioServerTransport = modStdio?.StdioServerTransport; } catch { /* ignore */ }
    let server: any;
    try { if(modServer?.Server) server = createSdkServer(modServer.Server); } catch(e){ try { process.stderr.write(`[startup] sdk_server_create_failed ${(e instanceof Error)? e.message: String(e)}\n`); } catch { /* ignore */ } }

    await setupStdoutDiagnostics();
    setupStdinSniffer(server);

    if(!StdioServerTransport || !server){ throw new Error('MCP SDK transport unavailable (removed fallback)'); }

    setupDispatcherOverride(server);

    const logDiag = getRuntimeConfig().logging.diagnostics;
    if(logDiag){
      try { process.stderr.write(`[transport-init] creating StdioServerTransport\n`); } catch { /* ignore */ }
    }
    const transport = new StdioServerTransport();
    if(logDiag){
      try { process.stderr.write(`[transport-init] connecting transport to server\n`); } catch { /* ignore */ }
    }
    await server.connect(transport);
    if(logDiag){
      try {
        const stdinReadable = process.stdin.readable;
        const stdinListenerCount = process.stdin.listenerCount('data');
        process.stderr.write(`[transport-init] transport connected stdin.readable=${stdinReadable} stdin.dataListeners=${stdinListenerCount}\n`);
      } catch { /* ignore */ }
    }

    setupKeepalive();
    setupSafetyFallbacks(server);
    wrapTransportSend(server, transport);
    return;
  }

  // Secondary path: StdioServerTransport already loaded
  const modServer: any = await dynamicImport('@modelcontextprotocol/sdk/server/index.js');
  const server = createSdkServer(modServer.Server);
  const logDiag2 = getRuntimeConfig().logging.diagnostics;
  if(logDiag2){
    try { process.stderr.write(`[transport-init] (secondary) creating StdioServerTransport\n`); } catch { /* ignore */ }
  }
  const transport = new StdioServerTransport();
  if(logDiag2){
    try { process.stderr.write(`[transport-init] (secondary) connecting transport to server\n`); } catch { /* ignore */ }
  }
  await server.connect(transport);
  if(logDiag2){
    try {
      const stdinReadable = process.stdin.readable;
      const stdinListenerCount = process.stdin.listenerCount('data');
      process.stderr.write(`[transport-init] (secondary) transport connected stdin.readable=${stdinReadable} stdin.dataListeners=${stdinListenerCount}\n`);
    } catch { /* ignore */ }
  }
  setupKeepalive('secondary');
  // Safety fallback timer (mirrors dynamic path) for missed ready emission
  if(isHandshakeFallbacksEnabled()){
    setTimeout(()=>{
      try {
        if((server as any).__sawInitializeRequest && !(server as any).__readyNotified){
          handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms-secondary', sawInit:true, initRespSent: !!(server as any).__initResponseSent });
          emitReadyGlobal(server,'safety-timeout-100ms-secondary');
        }
      } catch { /* ignore */ }
    }, 100).unref?.();
  }
}

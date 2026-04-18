// Global stderr console redirection for MCP protocol safety.
// Redirects console.log / console.debug / console.info to stderr so dashboard
// server-side code never contaminates the MCP JSON-RPC stdio protocol stream on stdout.
// Does NOT patch stderr.write — NDJSON log lines must pass through unmodified.
// Safe to import multiple times (idempotent guard).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if(!(global as any).__mcpConsoleRedirected){
  try {
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const redirect = (original: (...args: unknown[]) => void) => {
      return (...args: unknown[]) => {
        try {
          const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
          stderrWrite(msg + '\n');
        } catch { original(...args); }
      };
    };
    console.log = redirect(console.log);
    console.debug = redirect(console.debug);
    console.info = redirect(console.info);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__mcpConsoleRedirected = true;
  } catch { /* ignore */ }
}

export {}; // module side-effect only

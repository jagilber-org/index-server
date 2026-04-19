import type { RuntimeConfig } from '../config/runtimeConfig';
import { installHandlerProxy } from './registry';
import { LeaderElection } from '../dashboard/server/LeaderElection.js';
import { createMcpTransportRoutes } from '../dashboard/server/HttpTransport.js';
import { ThinClient } from '../dashboard/server/ThinClient.js';

/**
 * Start multi-instance leader or follower behavior when enabled by runtime config.
 * Preserves the existing leader election and follower proxy flow from the server entrypoint.
 */
export async function startMultiInstanceMode(dashboardHost: string, runtime: RuntimeConfig): Promise<void> {
  const instanceMode = runtime.server.instanceMode;
  if (instanceMode !== 'leader' && instanceMode !== 'auto') {
    if (instanceMode !== 'standalone') {
      process.stderr.write(`[startup] Instance mode=${instanceMode} (follower mode requires thin-client entry point)\n`);
    }
    return;
  }

  try {
    const stateDir = runtime.dashboard.admin.stateDir;
    const leaderPort = runtime.server.leaderPort;
    const leaderHost = dashboardHost || '127.0.0.1';

    const election = new LeaderElection({
      stateDir,
      port: leaderPort,
      host: leaderHost,
      heartbeatIntervalMs: runtime.server.heartbeatIntervalMs,
      staleThresholdMs: runtime.server.staleThresholdMs,
    });

    const role = election.start();
    process.stderr.write(`[startup] Instance mode=${instanceMode} elected=${role} pid=${process.pid}\n`);

    if (role === 'leader') {
      const express = (await import('express')).default;
      const mcpApp = express();
      mcpApp.use('/mcp', createMcpTransportRoutes());
      const transportLocation = `${leaderHost}:${leaderPort}/mcp`;

      const mcpServer = mcpApp.listen(leaderPort, leaderHost, () => {
        process.stderr.write(`[startup] MCP HTTP transport listening on ${transportLocation}\n`);
        process.stderr.write(`[startup] Thin clients can connect via INDEX_SERVER_STATE_DIR=${stateDir}\n`);
      });

      mcpServer.on('error', (err: NodeJS.ErrnoException) => {
        process.stderr.write(`[startup] MCP HTTP transport failed: ${err.message}\n`);
        if (err.code === 'EADDRINUSE') {
          process.stderr.write(`[startup] Port ${leaderPort} is already in use. Check INDEX_SERVER_LEADER_PORT or other services on this port.\n`);
          process.stderr.write(`[startup] Releasing leader lock and continuing as standalone.\n`);
          election.stop();
        } else {
          election.stop();
        }
      });

      process.on('exit', () => {
        election.stop();
        try { mcpServer.close(); } catch { /* ignore */ }
      });
      return;
    }

    process.stderr.write(`[startup] Running as follower -- leader at pid=${election.leaderInfo?.pid} port=${election.leaderInfo?.port}\n`);

    const thinClient = new ThinClient({ stateDir });
    const leaderUrl = thinClient.discoverLeader();
    process.stderr.write(`[startup] Follower proxy target: ${leaderUrl ?? 'pending discovery'}\n`);

    installHandlerProxy(async (tool: string, params: unknown) => {
      const response = await thinClient.sendRpc(tool, params) as { result?: unknown; error?: { code: number; message: string } };
      if (response.error) {
        throw new Error(`Leader error [${response.error.code}]: ${response.error.message}`);
      }
      return response.result;
    });
    process.stderr.write(`[startup] Handler proxy installed -- all tool calls forwarded to leader\n`);

    election.on('leader-lost', () => {
      process.stderr.write(`[startup] Leader lost -- attempting promotion\n`);
    });

    election.on('promoted', () => {
      process.stderr.write(`[startup] Promoted to leader -- starting HTTP transport before removing proxy\n`);

      (async () => {
        try {
          const express = (await import('express')).default;
          const mcpApp = express();
          mcpApp.use('/mcp', createMcpTransportRoutes());
          const transportLocation = `${leaderHost}:${leaderPort}/mcp`;
          const mcpServer = mcpApp.listen(leaderPort, leaderHost, () => {
            installHandlerProxy(null);
            process.stderr.write(`[startup] MCP HTTP transport listening on ${transportLocation}\n`);
            process.stderr.write(`[startup] Handler proxy removed -- serving requests locally\n`);
          });
          mcpServer.on('error', (err: NodeJS.ErrnoException) => {
            process.stderr.write(`[startup] Post-promotion HTTP transport failed: ${err.message}\n`);
            if (err.code === 'EADDRINUSE') {
              process.stderr.write(`[startup] Port ${leaderPort} in use after promotion -- retrying in 2s\n`);
              setTimeout(() => {
                try {
                  mcpServer.close();
                  mcpApp.listen(leaderPort, leaderHost, () => {
                    installHandlerProxy(null);
                    process.stderr.write(`[startup] MCP HTTP transport listening on retry\n`);
                  });
                } catch (retryErr) {
                  process.stderr.write(`[startup] Port retry failed: ${retryErr}\n`);
                  election.stop();
                }
              }, 2000);
            } else {
              election.stop();
            }
          });
          process.on('exit', () => {
            try { mcpServer.close(); } catch { /* ignore */ }
          });
        } catch (e) {
          process.stderr.write(`[startup] Post-promotion HTTP setup failed: ${e}\n`);
        }
      })();
    });

    process.on('exit', () => {
      election.stop();
      thinClient.stop();
    });
  } catch (e) {
    process.stderr.write(`[startup] Leader election failed: ${e}\n`);
  }
}

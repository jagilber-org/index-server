import net from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { bindToPort, buildHttpServer, closeHttpServer } from '../../dashboard/server/httpLifecycle';

const sockets: net.Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

describe('httpLifecycle', () => {
  it('bounds shutdown when a client leaves an incomplete request open', async () => {
    const app = express();
    app.get('/health', (_request, response) => response.sendStatus(200));
    const server = buildHttpServer(app);
    await bindToPort(server, 0, '127.0.0.1');

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP server did not expose a TCP address');

    const socket = net.createConnection({ host: '127.0.0.1', port: address.port });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');

    const started = Date.now();
    await closeHttpServer(server, 50);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(server.listening).toBe(false);
  });
});

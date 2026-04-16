/**
 * Logs Routes
 * Routes: GET /logs, GET /logs/stream
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';

export function createLogsRoutes(): Router {
  const router = Router();

  /**
   * GET /api/logs - Get server logs with optional tail functionality
   */
  router.get('/logs', (req: Request, res: Response) => {
    try {
      const loggingConfig = getRuntimeConfig().logging;
      const logFile = loggingConfig.file;
      const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : 100;
      const follow = req.query.follow === 'true';
      const raw = req.query.raw === '1' || req.query.raw === 'true';

      if (!logFile || !fs.existsSync(logFile)) {
        return res.json({
          logs: [],
          message: 'No log file configured or file not found. Set INDEX_SERVER_LOG_FILE environment variable or update runtime logging configuration.',
          timestamp: Date.now(),
          totalLines: 0
        });
      }

      // Read log file
      const logContent = fs.readFileSync(logFile, 'utf8');
      const allLines = logContent.split('\n').filter(line => line.trim());

      // Get last N lines (tail functionality)
      const tailLines = lines > 0 ? allLines.slice(-lines) : allLines;

      if (raw) {
        // Plain text response for simpler clients (backwards-compatible option)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(tailLines.join('\n'));
        return;
      }

      res.json({
        logs: tailLines,
        timestamp: Date.now(),
        totalLines: allLines.length,
        showing: tailLines.length,
        file: loggingConfig.rawFileValue ?? logFile,
        follow: follow,
        mode: raw ? 'text' : 'json'
      });

    } catch (error) {
      console.error('[API] Logs error:', error);
      res.status(500).json({
        error: 'Failed to read logs',
        timestamp: Date.now()
      });
    }
  });

  /**
   * GET /api/logs/stream - Server-Sent Events stream for real-time log tailing
   */
  router.get('/logs/stream', (req: Request, res: Response) => {
    const loggingConfig = getRuntimeConfig().logging;
    const logFile = loggingConfig.file;

    if (!logFile || !fs.existsSync(logFile)) {
      return res.status(404).json({
        error: 'Log file not available',
        message: 'No log file configured or file not found. Set INDEX_SERVER_LOG_FILE environment variable or update runtime logging configuration.'
      });
    }

    // Set up Server-Sent Events
    const origin = req.headers.origin;
    const corsOrigin = (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) ? origin : '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
    });

    let lastSize = 0;
    let watchInterval: NodeJS.Timeout | null = null;

    try {
      // Get initial file size
      const initialStats = fs.statSync(logFile);
      lastSize = initialStats.size;

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

      // Poll for file changes (more reliable than fs.watchFile)
      watchInterval = setInterval(() => {
        try {
          const currentStats = fs.statSync(logFile);
          if (currentStats.size > lastSize) {
            // File has grown, read new content
            const stream = fs.createReadStream(logFile, {
              start: lastSize,
              end: currentStats.size - 1,
              encoding: 'utf8'
            });

            let buffer = '';
            stream.on('data', (chunk: string | Buffer) => {
              const chunkStr = chunk.toString();
              buffer += chunkStr;
              const lineArr = buffer.split('\n');
              buffer = lineArr.pop() || ''; // Keep incomplete line in buffer

              lineArr.forEach(line => {
                if (line.trim()) {
                  res.write(`data: ${JSON.stringify({
                    type: 'log',
                    line: line.trim(),
                    timestamp: Date.now()
                  })}\n\n`);
                }
              });
            });

            stream.on('end', () => {
              lastSize = currentStats.size;
            });

            stream.on('error', (error) => {
              console.error('[Logs] Stream read error:', error);
              res.write(`data: ${JSON.stringify({
                type: 'error',
                message: 'Failed to read log stream',
                timestamp: Date.now()
              })}\n\n`);
            });
          }
        } catch (error) {
          console.error('[Logs] Stream poll error:', error);
          res.write(`data: ${JSON.stringify({
            type: 'error',
            message: 'Failed to poll log file',
            timestamp: Date.now()
          })}\n\n`);
        }
      }, 1000);

      // Cleanup on client disconnect
      req.on('close', () => {
        if (watchInterval) {
          clearInterval(watchInterval);
          watchInterval = null;
        }
      });

      // Keep connection alive
      const heartbeat = setInterval(() => {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
      }, 30000);

      req.on('close', () => {
        clearInterval(heartbeat);
      });

    } catch (error) {
      console.error('[Logs] Failed to start log streaming:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: 'Failed to start log streaming',
        timestamp: Date.now()
      })}\n\n`);
    }
  });

  return router;
}

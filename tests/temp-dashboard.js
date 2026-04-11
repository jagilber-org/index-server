const express = require('express');
const path = require('path');
const app = express();

app.use(express.static('dist/dashboard/client'));

app.get('/api/realtime', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    connections: 1,
    requestCount: 42,
    errorRate: 0.0,
    successRate: 100.0,
    avgResponseTime: 25
  });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/dashboard/client/admin.html'));
});

app.get('/', (req, res) => {
  res.send('<h1>MCP Dashboard</h1><p>Server is running</p><a href="/admin">Admin Panel</a>');
});

const server = app.listen(8790, () => {
  console.log('Dashboard running on http://127.0.0.1:8790');
  console.log('Admin panel: http://127.0.0.1:8790/');
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

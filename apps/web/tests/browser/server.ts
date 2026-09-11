import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRelay} from '../../lib/relay';
import {walletFixture} from '../fixtures';
const relay = createRelay({origin: 'http://localhost:3101', walletService: walletFixture().service,
  readBalance: async () => ({amount: '128.50', updatedAt: Date.now(), stale: false})});
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3101');
  if (url.pathname === '/api/health') {res.end('ok'); return;}
  if (url.pathname.startsWith('/api/relay/')) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const result = await relay.handle(new Request(url, {method: req.method, headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined}));
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text()); return;
  }
  const path = url.pathname === '/' ? '/terminal/index.html' : url.pathname;
  if (!/^\/(terminal|symbols)\/[a-z0-9-]+\.(html|js|css|svg)$/.test(path)) {res.writeHead(404); res.end(); return;}
  const types: Record<string, string> = {html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml'};
  res.setHeader('Content-Type', types[path.split('.').pop()!]); res.end(await readFile(join(process.cwd(), 'public', path)));
});
server.listen(3101, '127.0.0.1');
process.on('SIGTERM', () => {relay.close(); server.close();});

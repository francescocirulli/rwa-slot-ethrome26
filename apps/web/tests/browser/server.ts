import {buildSync} from 'esbuild';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHardware} from '../../lib/hardware';
import {createRelay} from '../../lib/relay';
import {walletFixture} from '../fixtures';
const relay = createRelay({origin: 'http://localhost:3101', walletService: walletFixture().service,
  readBalance: async () => ({amount: '128.50', updatedAt: Date.now(), stale: false})});
const hardware = createHardware({origin: 'http://localhost:3101', token: 'browser-hardware-test-token-32-characters'});
const bundle=buildSync({entryPoints:['tests/browser/inventory-fixture.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
const phoneBundle=buildSync({entryPoints:['tests/browser/phone-fixture.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'phone.js',alias:{'@privy-io/react-auth':'./tests/browser/phone-privy-fixture.tsx','@/lib/slot/use-transaction':'./tests/browser/phone-transaction-fixture.ts'},define:{'process.env.NODE_ENV':'"test"'}});
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3101');
  if(url.pathname==='/phone-fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/phone-fixture.css"></head><body><div id="root"></div><script src="/phone-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/phone-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(phoneBundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text);return;}
  if(url.pathname==='/phone-fixture.css'){res.setHeader('Content-Type','text/css');res.end((await readFile(join(process.cwd(),'app/phone/style.css'),'utf8'))+'\n'+(await readFile(join(process.cwd(),'lib/slot/transaction-review.css'),'utf8')));return;}
  if(url.pathname==='/inventory-fixture'){res.setHeader('Content-Type','text/html');res.end('<html><head><link rel="stylesheet" href="/admin-fixture.css"></head><body><div id="root"></div><script src="/inventory-fixture.js"></script></body></html>');return;}
  if(url.pathname==='/inventory-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/admin-fixture.css'){res.setHeader('Content-Type','text/css');res.end(await readFile(join(process.cwd(),'app/admin/style.css')));return;}
  if(url.pathname.startsWith('/brands/')&&/^\/brands\/[a-z-]+\.(svg|png)$/.test(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.svg')?'image/svg+xml':'image/png');res.end(await readFile(join(process.cwd(),'public',url.pathname)));return;}
  if (url.pathname === '/api/health') {res.end('ok'); return;}
  if (url.pathname.startsWith('/api/relay/') || url.pathname.startsWith('/api/hardware/')) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const result = await (url.pathname.startsWith('/api/hardware/') ? hardware : relay).handle(new Request(url, {method: req.method, headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined}));
    res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text()); return;
  }
  const path = url.pathname === '/' ? '/terminal/index.html' : url.pathname;
  if (!/^\/(terminal|symbols|decor)\/[a-z0-9-]+\.(html|js|css|svg)$/.test(path)) {res.writeHead(404); res.end(); return;}
  const types: Record<string, string> = {html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml'};
  res.setHeader('Content-Type', types[path.split('.').pop()!]); res.end(await readFile(join(process.cwd(), 'public', path)));
});
server.listen(3101, '127.0.0.1');
process.on('SIGTERM', () => {relay.close(); server.close();});

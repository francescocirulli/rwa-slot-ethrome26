import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {terminalCsp} from '../lib/terminal-security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const html = await readFile(join(process.cwd(), 'public/terminal/index.html'), 'utf8');
  return new Response(html, {headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': terminalCsp,
  }});
}

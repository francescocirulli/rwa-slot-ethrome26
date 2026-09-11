import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const html = await readFile(join(process.cwd(), 'public/terminal/index.html'), 'utf8');
  return new Response(html, {headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  }});
}

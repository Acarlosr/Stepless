import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 4173);
const frontendRoot = new URL('../frontend/', import.meta.url);
const apiOrigin = new URL(process.env.PREVIEW_API_ORIGIN || 'https://www.stepless.lat');
const maxBodyBytes = 1024 * 1024;
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
]);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyApi(req, res, requestUrl) {
  const target = requestUrl.pathname === '/api/rpc'
    ? new URL('https://rpc.testnet.arc.network')
    : new URL(requestUrl.pathname + requestUrl.search, apiOrigin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value && !['host', 'connection', 'content-length'].includes(name.toLowerCase())) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method || 'GET');
  const body = hasBody ? await readRequestBody(req) : undefined;
  const upstream = await fetch(target, {
    method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  const responseHeaders = {};
  for (const [name, value] of upstream.headers) {
    if (!['content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) responseHeaders[name] = value;
  }
  responseHeaders['cache-control'] = 'no-store';
  res.writeHead(upstream.status, responseHeaders);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveStatic(res, requestUrl) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';
  const requested = normalize(pathname).replace(/^([/\\])+/, '');
  const rootPath = normalize(fileURLToPath(frontendRoot));
  const filePath = join(rootPath, requested);
  if (relative(rootPath, filePath).startsWith('..')) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return send(res, 404, 'Not found');
    send(res, 200, await readFile(filePath), mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (requestUrl.pathname.startsWith('/api/')) await proxyApi(req, res, requestUrl);
    else await serveStatic(res, requestUrl);
  } catch (error) {
    const status = error?.message === 'BODY_TOO_LARGE' ? 413 : 502;
    send(res, status, JSON.stringify({ error: status === 413 ? 'Payload muito grande.' : 'Falha no proxy local.', detail: error?.message }), 'application/json; charset=utf-8');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Stepless preview: http://127.0.0.1:${port}`);
  console.log(`API proxy: ${apiOrigin.origin}`);
});
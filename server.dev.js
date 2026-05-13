/**
 * server.dev.js — Servidor de desarrollo local
 * Simula el entorno de Vercel Serverless Functions en ESM.
 * USO: node server.dev.js (requiere .env con las variables configuradas)
 */

import 'dotenv/config';
import { createServer } from 'node:http';
import { URL } from 'node:url';

// Importar handlers
import productsIndex   from './api/products/index.js';
import productsId      from './api/products/[id].js';
import quotationsIndex from './api/quotations/index.js';
import quotationsId    from './api/quotations/[id].js';
import activities      from './api/activities/index.js';
import mercadopago     from './api/webhooks/mercadopago.js';
import iaSuggestions   from './api/ia/suggestions.js';

const PORT = process.env.PORT || 4000;

const ROUTES = [
  { method: 'ALL', pattern: /^\/api\/products\/([^/]+)$/,         handler: productsId,      param: 'id' },
  { method: 'ALL', pattern: /^\/api\/products(\/)?$/,             handler: productsIndex },
  { method: 'ALL', pattern: /^\/api\/quotations\/([^/]+)$/,       handler: quotationsId,    param: 'id' },
  { method: 'ALL', pattern: /^\/api\/quotations(\/)?$/,           handler: quotationsIndex },
  { method: 'ALL', pattern: /^\/api\/activities(\/)?$/,           handler: activities },
  { method: 'ALL', pattern: /^\/api\/webhooks\/mercadopago(\/)?$/, handler: mercadopago },
  { method: 'ALL', pattern: /^\/api\/ia\/suggestions(\/)?$/,      handler: iaSuggestions },
];

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'ARMHEL + INO Backend', env: 'development' }));
    return;
  }

  const route = ROUTES.find(r => r.pattern.test(pathname));
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { message: 'Ruta no encontrada' } }));
    return;
  }

  const match = pathname.match(route.pattern);
  const body = await parseBody(req).catch(() => ({}));

  const query = Object.fromEntries(url.searchParams.entries());
  if (route.param && match[1]) query[route.param] = match[1];

  // Detectar action desde querystring (ej: /api/quotations/XXX?action=pdf)
  const action = url.searchParams.get('action');
  if (action) query.action = action;

  req.body = body;
  req.query = query;

  try {
    await route.handler(req, res);
  } catch (err) {
    console.error('[DEV SERVER ERROR]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { message: 'Error interno', detail: err.message } }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🔧 ARMHEL+INO Dev Server corriendo en http://localhost:${PORT}\n`);
  console.log('  GET  /api/products');
  console.log('  POST /api/products');
  console.log('  GET  /api/products/:id');
  console.log('  GET  /api/quotations');
  console.log('  POST /api/quotations');
  console.log('  GET  /api/quotations/:id');
  console.log('  POST /api/webhooks/mercadopago');
  console.log('  POST /api/ia/suggestions\n');
});

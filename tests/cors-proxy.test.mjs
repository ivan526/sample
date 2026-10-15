import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer, preview } from 'vite';

// Exercise the real frontend middleware before the API, rather than testing
// Fastify in isolation: Vite can otherwise consume OPTIONS before proxying.
test('Vite dev and preview forward API preflights to the backend CORS policy', async (t) => {
  const envKeys = ['NODE_ENV', 'LOG_LEVEL', 'CORS_ORIGINS', 'VITE_DEV_API_TARGET'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.CORS_ORIGINS = ' http://10.75.77.120:5174, https://w3.huawei.com ';

  const { buildApp } = await import('../server/src/app.ts');
  const api = await buildApp();
  await api.ready();
  t.after(() => api.close());
  // Use the raw listener to avoid Fastify's interface-discovery logging in
  // restricted containers. Request handling still uses the real Fastify app.
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  process.env.VITE_DEV_API_TARGET = `http://127.0.0.1:${api.server.address().port}`;

  const dev = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, warmup: { clientFiles: [] } },
  });
  t.after(() => dev.close());
  const devHttp = createHttpServer(dev.middlewares);
  t.after(() => new Promise((resolve) => devHttp.close(resolve)));
  devHttp.listen(0, '127.0.0.1');
  await once(devHttp, 'listening');

  const previewDir = await mkdtemp(path.join(os.tmpdir(), 'mss-cors-preview-'));
  t.after(() => rm(previewDir, { recursive: true, force: true }));
  await writeFile(path.join(previewDir, 'index.html'), '<!doctype html><title>CORS proxy fixture</title>');
  const built = await preview({
    logLevel: 'silent',
    build: { outDir: previewDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  t.after(() => new Promise((resolve) => built.httpServer.close(resolve)));

  for (const [name, server] of [['dev', devHttp], ['preview', built.httpServer]]) {
    await t.test(name, async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const origin of ['https://w3.huawei.com', 'http://10.75.77.120:5174']) {
        for (const path of ['/auth/login', '/config/auth/me']) {
          const response = await fetch(`${base}/api/v1${path}`, {
            method: 'OPTIONS',
            headers: {
              Origin: origin,
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'content-type,authorization',
            },
          });
          assert.equal(response.status, 204);
          assert.equal(response.headers.get('access-control-allow-origin'), origin);
          assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
          assert.match(response.headers.get('access-control-allow-methods'), /POST/);
          assert.match(response.headers.get('access-control-allow-headers'), /authorization/i);
          assert.match(response.headers.get('vary'), /origin/i);
        }
      }
      const deniedOrigin = 'https://untrusted.example';
      const denied = await fetch(`${base}/api/v1/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: deniedOrigin, 'Access-Control-Request-Method': 'POST' },
      });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);

      const loginError = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { Origin: 'https://w3.huawei.com', 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(loginError.status, 400);
      assert.equal(loginError.headers.get('access-control-allow-origin'), 'https://w3.huawei.com');
    });
  }
});

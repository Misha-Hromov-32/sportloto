// Запуск TypeScript-скрипта с алиасом «@/» через модульный раннер Vite (без отдельного пакета и без сервера).
// Пример: node scripts/run-ts.mjs scripts/checks/core.ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, createServerModuleRunner } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('Укажите скрипт: node scripts/run-ts.mjs scripts/checks/core.ts');
  process.exit(1);
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  resolve: { alias: { '@': path.join(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
process.argv = [process.argv[0], entry, ...args];
let code = 0;
try {
  const mod = await runner.import(`/${path.relative(root, path.resolve(root, entry)).replace(/\\/g, '/')}`);
  if (typeof mod.main === 'function') code = (await mod.main(args)) ?? 0;
} catch (error) {
  console.error(error);
  code = 1;
} finally {
  await runner.close();
  await server.close();
}
process.exit(code);

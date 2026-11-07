import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: {
      alias: [{ find: '@', replacement: src('') }],
    },
    server: {
      host: env.VITE_DEV_HOST || '127.0.0.1',
      port: 5173,
      strictPort: true,
      // /api и живые обновления (SSE) — на бэкенд: cookie и токены работают без CORS.
      proxy: {
        '/api': { target: env.VITE_API_PROXY || 'http://127.0.0.1:8000' },
        '/mcp': { target: env.VITE_API_PROXY || 'http://127.0.0.1:8000' },
      },
    },
    preview: { port: 4173, strictPort: true },
    build: { chunkSizeWarningLimit: 1600 },
  };
});

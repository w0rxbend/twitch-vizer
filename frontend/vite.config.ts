import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readdirSync } from 'fs';

const scenesDir = resolve(__dirname, 'src/scenes');

// Each src/scenes/<name>/index.html becomes a build entry automatically,
// so adding a scene directory is enough — no config edit required.
const sceneInputs = Object.fromEntries(
  readdirSync(scenesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(scenesDir, entry.name, 'index.html')))
    .map((entry) => [entry.name, resolve(scenesDir, entry.name, 'index.html')]),
);

export default defineConfig(({ command }) => ({
  root: scenesDir,
  base: command === 'serve' ? '/' : './',
  server: {
    open: '/hacker-chat/',
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(scenesDir, 'index.html'),
        ...sceneInputs,
      },
    },
  },
}));

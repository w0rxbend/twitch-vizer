import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src/scenes'),
  base: command === 'serve' ? '/' : '/static/scenes/',
  server: {
    open: '/biome/',
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../backend/vizer/static/scenes'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        biome: resolve(__dirname, 'src/scenes/biome/index.html'),
      },
    },
  },
}));

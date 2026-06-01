import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src/scenes'),
  base: command === 'serve' ? '/' : './',
  server: {
    open: '/chat/',
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
        chat: resolve(__dirname, 'src/scenes/chat/index.html'),
      },
    },
  },
}));

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src/scenes'),
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
        chat: resolve(__dirname, 'src/scenes/chat/index.html'),
        emojiChat: resolve(__dirname, 'src/scenes/emoji-chat/index.html'),
        fluidChat: resolve(__dirname, 'src/scenes/fluid-chat/index.html'),
        glitchOverlay: resolve(__dirname, 'src/scenes/glitch-overlay/index.html'),
        hackerChat: resolve(__dirname, 'src/scenes/hacker-chat/index.html'),
        mrRobot: resolve(__dirname, 'src/scenes/mr-robot/index.html'),
        pixelChat: resolve(__dirname, 'src/scenes/pixel-chat/index.html'),
      },
    },
  },
}));

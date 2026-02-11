import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'src/client'),
  plugins: [wasm()],
  resolve: {
    alias: {
      '@devvit/web/client': path.resolve(__dirname, 'src/testbed/mocks/devvit-web-client.js'),
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        splash: path.resolve(__dirname, 'src/client/splash.html'),
        creator: path.resolve(__dirname, 'src/client/creator.html'),
        game: path.resolve(__dirname, 'src/client/game.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});

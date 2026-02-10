import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm(), devvit()],
});

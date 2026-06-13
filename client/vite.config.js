import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { boneyardPlugin } from 'boneyard-js/vite';

// Vite + Vitest configuration for the Nuvault client.
export default defineConfig({
  plugins: [react(), boneyardPlugin()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    css: false,
  },
});

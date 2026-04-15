import { defineConfig } from 'vite';
import { mainProcessExternals } from './vite.base.config.mjs';

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      external: mainProcessExternals,
    },
    sourcemap: true,
  },
});

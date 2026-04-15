import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('./src-vue', import.meta.url));

export default defineConfig({
  base: './',
  clearScreen: false,
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  optimizeDeps: {
    exclude: ['electron'],
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: () => false,
        },
      },
    }),
    vueDevTools(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  root: projectRoot,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../.vite/renderer/main_window',
    rollupOptions: {
      external: ['electron'],
    },
  },
});

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { mainProcessExternals } from './vite.base.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerElectronLogShimPath = path.resolve(__dirname, 'src/modules/workerElectronLogShim.js');

export default defineConfig((configEnv) => {
  const isWorkerBuild = [
    'src/modules/logSearchWorker.js',
    'src/modules/logIndexWorker.js'
  ].includes(configEnv?.forgeConfigSelf?.entry);

  return {
    build: {
      emptyOutDir: false,
      rollupOptions: {
        external: mainProcessExternals,
      },
      sourcemap: true,
    },
    resolve: {
      alias: isWorkerBuild
        ? {
            'electron-log': workerElectronLogShimPath
          }
        : {}
    }
  };
});

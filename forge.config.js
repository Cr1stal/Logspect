const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('./package.json');

const isPrerelease = packageJson.version.includes('-');
const projectRoot = __dirname;
const realNodeModulesPath = fs.existsSync(path.join(projectRoot, 'node_modules'))
  ? fs.realpathSync(path.join(projectRoot, 'node_modules')).replace(/\\/g, '/')
  : null;
const nativeResourceRoot = path.join(projectRoot, '.packaged-node-modules');
const nativeResourceNodeModulesPath = path.join(nativeResourceRoot, 'node_modules');

function stageNativeResourceModules() {
  const sourceNodeModulesPath = realNodeModulesPath || path.join(projectRoot, 'node_modules');

  if (!fs.existsSync(sourceNodeModulesPath)) {
    return null;
  }

  fs.mkdirSync(nativeResourceNodeModulesPath, { recursive: true });

  for (const moduleName of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
    const sourcePath = path.join(sourceNodeModulesPath, moduleName);
    const destinationPath = path.join(nativeResourceNodeModulesPath, moduleName);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.cpSync(sourcePath, destinationPath, {
      dereference: true,
      force: true,
      recursive: true,
    });
  }

  return nativeResourceNodeModulesPath;
}

const stagedNativeNodeModulesPath = stageNativeResourceModules();

function retainPackagedPath(file) {
  if (!file) return true;

  const normalized = file.replace(/\\/g, '/');

  if (
    normalized === '/package.json' ||
    normalized === '/.vite' ||
    normalized.startsWith('/.vite/') ||
    normalized === '/node_modules' ||
    normalized.startsWith('/node_modules/')
  ) {
    return true;
  }

  if (realNodeModulesPath) {
    return (
      normalized === realNodeModulesPath ||
      normalized.startsWith(`${realNodeModulesPath}/`)
    );
  }

  return false;
}

module.exports = {
  packagerConfig: {
    appBundleId: 'com.logspect.app',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright © 2025 Bilal Budhani',
    asar: {
      unpack: '**/*.node',
    },
    extraResource: stagedNativeNodeModulesPath ? [stagedNativeNodeModulesPath] : [],
    ignore: (file) => {
      return !retainPackagedPath(file);
    },
    icon: './build/icons/icon.icns',
    osxNotarize: false,
    osxSign: false,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      platforms: ['darwin'],
      config: {
        authToken: process.env.GITHUB_TOKEN,
        draft: false,
        generateReleaseNotes: true,
        prerelease: isPrerelease,
        repository: {
          owner: 'Cr1stal',
          name: 'Logspect',
        },
        tagPrefix: 'v',
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            config: 'vite.main.config.mjs',
            entry: 'src/main.js',
            target: 'main',
          },
          {
            config: 'vite.main.config.mjs',
            entry: 'src/modules/logSearchWorker.js',
            target: 'main',
          },
          {
            config: 'vite.main.config.mjs',
            entry: 'src/modules/logIndexWorker.js',
            target: 'main',
          },
          {
            config: 'vite.preload.config.mjs',
            entry: 'src/preload.js',
            target: 'preload',
          },
        ],
        renderer: [
          {
            config: 'vite.renderer.config.mjs',
            name: 'main_window',
          },
        ],
      },
    },
  ],
};

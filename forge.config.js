const packageJson = require('./package.json');

const isPrerelease = packageJson.version.includes('-');
const viteRetainedPaths = [
  '/.vite',
  '/node_modules',
  '/node_modules/better-sqlite3',
  '/node_modules/bindings',
  '/node_modules/file-uri-to-path',
];

module.exports = {
  packagerConfig: {
    appBundleId: 'com.logspect.app',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright © 2025 Bilal Budhani',
    asar: true,
    ignore: (file) => {
      if (!file) return false;
      return !viteRetainedPaths.some((allowedPath) => file.startsWith(allowedPath));
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

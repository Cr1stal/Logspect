const packageJson = require('./package.json');

const isPrerelease = packageJson.version.includes('-');

module.exports = {
  packagerConfig: {
    appBundleId: 'com.logspect.app',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright © 2025 Bilal Budhani',
    asar: true,
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
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            config: 'vite.main.config.mjs',
            entry: 'src/main.js',
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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, '..');
const nodeGypCli = require.resolve('@electron/node-gyp/bin/node-gyp.js');
const nodeGypCacheDir = path.join(os.tmpdir(), 'logspect-node-gyp');
const nativeModules = [
  {
    binaryPath: path.join('build', 'Release', 'volume.node'),
    moduleDir: path.join(projectRoot, 'node_modules', 'macos-alias'),
  },
  {
    binaryPath: path.join('build', 'Release', 'xattr.node'),
    moduleDir: path.join(projectRoot, 'node_modules', 'fs-xattr'),
  },
];

for (const { moduleDir, binaryPath } of nativeModules) {
  const compiledBinary = path.join(moduleDir, binaryPath);

  if (!fs.existsSync(moduleDir) || fs.existsSync(compiledBinary)) {
    continue;
  }

  const result = spawnSync(
    process.execPath,
    [nodeGypCli, 'rebuild', '--directory', moduleDir],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        npm_config_devdir: nodeGypCacheDir,
      },
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

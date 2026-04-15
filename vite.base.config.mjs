import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

const dependencies = Object.keys(packageJson.dependencies ?? {});

export const mainProcessExternals = [
  'electron',
  ...dependencies,
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

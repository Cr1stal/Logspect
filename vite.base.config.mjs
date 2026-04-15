import { builtinModules } from 'node:module';

// Bundle runtime dependencies into main/preload so packaged apps do not rely on
// a separate node_modules tree next to app.asar.
export const mainProcessExternals = [
  'electron',
  'better-sqlite3',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

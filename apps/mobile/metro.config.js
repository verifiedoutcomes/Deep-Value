// Monorepo-aware Metro config: lets the app resolve and transpile the
// workspace packages (@dvh/engine, @dvh/data) from TypeScript source.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Web: zustand's ESM build references `import.meta` (devtools middleware),
// which a classic-script web bundle cannot execute and blank-screens the
// hosted demo. Route the package to its CommonJS build on web only;
// native keeps the default resolution.
const zustandDir = path.dirname(require.resolve('zustand/package.json', { paths: [monorepoRoot] }));
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'zustand' || moduleName.startsWith('zustand/'))) {
    const sub = moduleName === 'zustand' ? 'index.js' : `${moduleName.slice('zustand/'.length)}.js`;
    return { type: 'sourceFile', filePath: path.join(zustandDir, sub) };
  }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;

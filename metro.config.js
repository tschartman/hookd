const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// lucide-react-native ships its "react-native" package.json field pointing to an
// ESM build that uses .mjs inter-imports Metro cannot resolve. Redirect the
// package to the CJS build so bundling works without touching the barrel import.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lucide-react-native') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
      ),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

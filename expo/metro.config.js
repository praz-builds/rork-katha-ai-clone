const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Story-world country data is a deliberately shared, pure contract. Metro
// must watch it because the edge functions own the canonical table and Expo
// imports it directly rather than maintaining a second locale-dependent copy.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../backend/supabase/functions/_shared"),
];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
];

module.exports = config;

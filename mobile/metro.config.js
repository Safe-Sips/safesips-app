// Metro config that lets the Expo app resolve the sibling `@safesips/shared`
// package (linked via a file: dependency) from outside its own folder.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../shared");

const config = getDefaultConfig(projectRoot);

// Watch the shared package so changes are picked up during development.
config.watchFolders = [sharedRoot];

// Resolve modules from the app first, then fall back to the shared package.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(sharedRoot, "node_modules"),
];

module.exports = config;

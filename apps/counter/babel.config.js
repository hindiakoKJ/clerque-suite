module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 split the worklets compiler into its own package.
    // It must be the LAST plugin in the list.
    plugins: ['react-native-worklets/plugin'],
  };
};

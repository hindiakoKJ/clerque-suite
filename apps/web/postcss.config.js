module.exports = {
  // Object (string-keyed) format — required for Turbopack compatibility.
  // Turbopack evaluates postcss configs in a sandboxed context and cannot
  // call require() on native modules at config-load time.  Using the
  // string-keyed plugin map lets PostCSS resolve the plugin itself.
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

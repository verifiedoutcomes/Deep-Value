// Dynamic layer over app.json. DVH_WEB_BASE_URL overrides the web base
// path for builds served somewhere other than GitHub Pages' /Deep-Value
// (the Claude app preview is served from an unknown path, so
// scripts/build-artifact.mjs builds with an empty base).
module.exports = ({ config }) => {
  const baseUrl = process.env.DVH_WEB_BASE_URL;
  if (baseUrl === undefined) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};

// Expo's default Metro config (it detects the npm workspaces itself), wrapped by
// Sentry so release bundles carry the debug IDs its source maps are matched on.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);

module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '^@render/api-client$': '<rootDir>/../openapi/client/index.ts',
    '^@react-native-community/geolocation$': '<rootDir>/__mocks__/@react-native-community/geolocation.js',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.js',
  },
  modulePaths: ['<rootDir>/node_modules'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-gesture-handler|react-native-webview|react-native-keychain|@react-native-community|openapi-fetch)/)',
  ],
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/src/**/*.test.{ts,tsx}'],
}

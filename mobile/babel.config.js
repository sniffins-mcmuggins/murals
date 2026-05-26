module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: {
          '@render/api-client': '../openapi/client/index.ts',
        },
      },
    ],
  ],
}

const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')

const config = {
  watchFolders: [path.resolve(repoRoot, 'openapi/client')],
  resolver: {
    extraNodeModules: {
      '@render/api-client': path.resolve(repoRoot, 'openapi/client'),
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)

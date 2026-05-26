const React = require('react')
const { View } = require('react-native')

const WebViewMock = (props) => React.createElement(View, { testID: 'webview', ...props })

module.exports = { __esModule: true, default: WebViewMock, WebView: WebViewMock }

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react-native'
import React from 'react'
import { FestivalMapScreen } from '../FestivalMapScreen'

jest.mock('../../../lib/api', () => ({
  apiClient: {
    GET: jest.fn().mockResolvedValue({
      data: { pins: [] },
      error: undefined,
    }),
  },
}))

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { festivalSlug: 'summer-walls-2027' } }),
}))

jest.mock('react-native-webview', () => {
  const { View } = require('react-native')
  const WebViewMock = (props: any) => <View testID="webview" {...props} />
  return { __esModule: true, default: WebViewMock, WebView: WebViewMock }
})

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('FestivalMapScreen', () => {
  it('renders without crashing', () => {
    render(<FestivalMapScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('festival-map-screen')).toBeTruthy()
  })

  it('renders the WebView', () => {
    render(<FestivalMapScreen />, { wrapper: Wrapper })
    expect(screen.getByTestId('webview')).toBeTruthy()
  })
})

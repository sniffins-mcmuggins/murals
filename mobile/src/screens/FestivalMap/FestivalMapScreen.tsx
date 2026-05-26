import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useRef } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { MAP_HTML } from '../../assets/mapHtml'
import { apiClient } from '../../lib/api'
import type { FestivalMapScreenProps, MapStackParamList } from '../../navigation/types'

type MapRoute = RouteProp<MapStackParamList, 'FestivalMap'>

export function FestivalMapScreen() {
  const navigation = useNavigation<FestivalMapScreenProps['navigation']>()
  const route = useRoute<MapRoute>()
  const festivalSlug = route.params?.festivalSlug
  const webViewRef = useRef<WebView>(null)

  const { data: mapData } = useQuery({
    queryKey: ['festival-map', festivalSlug],
    queryFn: async () => {
      if (!festivalSlug) return { pins: [] }
      const { data, error } = await apiClient.GET('/festivals/slug/{slug}/map', {
        params: { path: { slug: festivalSlug } },
      })
      if (error) return { pins: [] }
      return data
    },
    enabled: !!festivalSlug,
  })

  const onWebViewLoad = useCallback(() => {
    if (!webViewRef.current || !mapData?.pins) return
    webViewRef.current.postMessage(
      JSON.stringify({ type: 'SET_PINS', pins: mapData.pins }),
    )
  }, [mapData])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type === 'ARTIST_TAPPED' && msg.profileID) {
          navigation.navigate('ArtistProfile', { profileID: msg.profileID })
        }
      } catch {}
    },
    [navigation],
  )

  return (
    <View style={styles.container} testID="festival-map-screen">
      <WebView
        testID="webview"
        ref={webViewRef}
        source={{ html: MAP_HTML }}
        onLoadEnd={onWebViewLoad}
        onMessage={onMessage}
        style={styles.webview}
        originWhitelist={['*']}
      />
      {!mapData && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#E8A838" />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(250,247,242,0.7)',
  },
})

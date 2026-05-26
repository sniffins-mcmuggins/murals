import React from 'react'
import { StyleSheet, View } from 'react-native'

interface Props {
  height?: number
  width?: string | number
  borderRadius?: number
}

export function LoadingSkeleton({ height = 80, width = '100%', borderRadius = 8 }: Props) {
  return <View style={[styles.base, { height, width: width as any, borderRadius }]} />
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#E2DDD6',
    opacity: 0.6,
    marginVertical: 4,
  },
})

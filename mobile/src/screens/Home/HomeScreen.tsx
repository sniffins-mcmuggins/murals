import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FestivalCard } from '../../components/FestivalCard'
import { LoadingSkeleton } from '../../components/LoadingSkeleton'
import { apiClient } from '../../lib/api'
import type { components } from '../../lib/api'
import type { HomeScreenProps } from '../../navigation/types'

type Festival = components['schemas']['Festival']

export function HomeScreen(_props: Partial<HomeScreenProps>) {
  const navigation = useNavigation<HomeScreenProps['navigation']>()

  const { data: festivals, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['public-festivals'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/public/festivals', {
        params: { query: { status: 'live' } },
      })
      if (error) throw new Error('Failed to load festivals')
      return data as Festival[]
    },
  })

  if (isLoading) {
    return (
      <View style={styles.container} testID="home-screen">
        {[1, 2, 3].map((n) => (
          <LoadingSkeleton key={n} height={100} />
        ))}
      </View>
    )
  }

  if (isError) {
    return (
      <View style={styles.center} testID="home-screen">
        <Text style={styles.errorText}>Couldn't load festivals</Text>
        <Text style={styles.retryLink} onPress={() => refetch()}>
          Try again
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      testID="home-screen"
      data={festivals}
      keyExtractor={(f) => f.id}
      renderItem={({ item }) => (
        <FestivalCard
          festival={item}
          onPress={() =>
            navigation.navigate('Map', { festivalSlug: item.slug })
          }
        />
      )}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} />
      }
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No live festivals right now — check back soon</Text>
        </View>
      }
    />
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const MID = '#8A8896'
const AMBER = '#E8A838'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE, padding: 16 },
  list: { paddingVertical: 8, backgroundColor: OFFWHITE, flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorText: { color: INK, fontSize: 16, marginBottom: 8 },
  retryLink: { color: AMBER, fontSize: 14, textDecorationLine: 'underline' },
  emptyText: { color: MID, fontSize: 15, textAlign: 'center' },
})

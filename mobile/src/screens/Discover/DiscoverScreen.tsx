import { useNavigation } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React, { useState } from 'react'
import {
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { ArtistCard } from '../../components/ArtistCard'
import { LoadingSkeleton } from '../../components/LoadingSkeleton'
import { apiClient } from '../../lib/api'
import type { components } from '../../lib/api'
import { distanceKm, getCurrentPosition, requestLocationPermission } from '../../lib/location'
import type { DiscoverScreenProps } from '../../navigation/types'

type Profile = components['schemas']['ArtistProfile']
type Mode = 'random' | 'nearby'

interface NearbyResult {
  profile: Profile
  distanceKm: number
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function DiscoverScreen(_props: Partial<DiscoverScreenProps>) {
  const navigation = useNavigation<DiscoverScreenProps['navigation']>()
  const [mode, setMode] = useState<Mode>('random')
  const [locationDenied, setLocationDenied] = useState(false)
  const [nearbyResults, setNearbyResults] = useState<NearbyResult[] | null>(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)

  const {
    data: randomProfiles,
    isLoading: randomLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['public-profiles-random'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/public/profiles', {
        params: { query: { page: 1, per_page: 50 } },
      })
      if (error) throw new Error('Failed to load profiles')
      return shuffle((data as any).profiles as Profile[])
    },
  })

  async function loadNearby() {
    setNearbyLoading(true)
    setLocationDenied(false)
    try {
      const granted = await requestLocationPermission()
      if (!granted) {
        setLocationDenied(true)
        return
      }
      const userCoords = await getCurrentPosition()

      const { data: festivalsData } = await apiClient.GET('/public/festivals', {
        params: { query: { status: 'live' } },
      })
      const festivals = (festivalsData as any) ?? []

      const pinMap = new Map<string, { profile_id: string; lat: number; lng: number }>()
      await Promise.all(
        festivals.map(async (fest: any) => {
          const { data: mapData } = await apiClient.GET('/festivals/slug/{slug}/map', {
            params: { path: { slug: fest.slug } },
          })
          const pins = (mapData as any)?.pins ?? []
          for (const pin of pins) {
            if (pin.artist_id && pin.lat && pin.lng) {
              pinMap.set(pin.artist_id, { profile_id: pin.artist_id, lat: pin.lat, lng: pin.lng })
            }
          }
        }),
      )

      const results: NearbyResult[] = []
      for (const [profileID, pin] of pinMap.entries()) {
        const { data: profile } = await apiClient.GET('/profiles/{profileID}', {
          params: { path: { profileID } },
        })
        if (profile) {
          results.push({
            profile: profile as Profile,
            distanceKm: distanceKm(userCoords, { lat: pin.lat, lng: pin.lng }),
          })
        }
      }

      results.sort((a, b) => a.distanceKm - b.distanceKm)
      setNearbyResults(results)
    } finally {
      setNearbyLoading(false)
    }
  }

  function onModeSwitch(newMode: Mode) {
    setMode(newMode)
    if (newMode === 'nearby' && nearbyResults === null) {
      loadNearby()
    }
  }

  const isLoading = mode === 'random' ? randomLoading : nearbyLoading

  return (
    <View style={styles.container} testID="discover-screen">
      <View style={styles.segmentRow}>
        {(['random', 'nearby'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, mode === m && styles.segmentActive]}
            onPress={() => onModeSwitch(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'random' ? 'Random' : 'Nearby'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading && (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((n) => (
            <LoadingSkeleton key={n} height={80} />
          ))}
        </View>
      )}

      {mode === 'nearby' && locationDenied && (
        <View style={styles.center}>
          <Text style={styles.bodyText}>Location access needed to find nearby artists.</Text>
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.link}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'random' && !randomLoading && (
        <FlatList
          data={randomProfiles ?? []}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <ArtistCard
              profile={item}
              onPress={() => navigation.navigate('ArtistProfile', { profileID: item.id })}
            />
          )}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.bodyText}>No artists found.</Text>
            </View>
          }
        />
      )}

      {mode === 'nearby' && !nearbyLoading && !locationDenied && nearbyResults !== null && (
        <FlatList
          data={nearbyResults}
          keyExtractor={(r) => r.profile.id}
          renderItem={({ item }) => (
            <ArtistCard
              profile={item.profile}
              distanceLabel={`${item.distanceKm.toFixed(1)} km`}
              onPress={() => navigation.navigate('ArtistProfile', { profileID: item.profile.id })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.bodyText}>No artists found nearby.</Text>
            </View>
          }
        />
      )}
    </View>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE },
  segmentRow: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LIGHT,
    overflow: 'hidden',
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: WARM },
  segmentActive: { backgroundColor: INK },
  segmentText: { color: MID, fontWeight: '600' },
  segmentTextActive: { color: AMBER },
  skeletons: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  bodyText: { color: INK, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  link: { color: AMBER, fontSize: 14, textDecorationLine: 'underline' },
})

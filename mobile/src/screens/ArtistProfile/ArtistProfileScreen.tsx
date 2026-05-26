import { useRoute, type RouteProp } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import React from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { apiClient } from '../../lib/api'

// Stack-agnostic route type — works in HomeStack, MapStack, and DiscoverStack.
type ArtistProfileRoute = RouteProp<{ ArtistProfile: { profileID: string } }, 'ArtistProfile'>

export function ArtistProfileScreen() {
  const route = useRoute<ArtistProfileRoute>()
  const { profileID } = route.params

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', profileID],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/profiles/{profileID}', {
        params: { path: { profileID } },
      })
      if (error) throw new Error('Not found')
      return data
    },
  })

  const { data: collections } = useQuery({
    queryKey: ['collections', profileID],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/profiles/{profileID}/collections', {
        params: { path: { profileID } },
      })
      if (error) return []
      return data
    },
    enabled: !!profile,
  })

  if (profileLoading || !profile) {
    return (
      <View style={styles.center} testID="artist-profile-screen">
        <ActivityIndicator size="large" color="#E8A838" />
      </View>
    )
  }

  return (
    <ScrollView
      testID="artist-profile-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.name}>{profile.display_name}</Text>
      {profile.location_label ? (
        <Text style={styles.location}>{profile.location_label}</Text>
      ) : null}
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      {profile.medium_tags && profile.medium_tags.length > 0 && (
        <View style={styles.tags}>
          {profile.medium_tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {collections && collections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Collections</Text>
          {collections.map((col) => (
            <View key={col.id} style={styles.collectionCard}>
              <Text style={styles.collectionName}>{col.name}</Text>
              {col.description ? (
                <Text style={styles.collectionDesc}>{col.description}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: OFFWHITE },
  content: { padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  name: { fontSize: 28, fontWeight: '700', color: INK, marginBottom: 4 },
  location: { color: MID, fontSize: 14, marginBottom: 8 },
  bio: { color: INK, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  tag: { backgroundColor: WARM, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, color: INK },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: INK, marginBottom: 10 },
  collectionCard: {
    backgroundColor: WARM,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  collectionName: { fontSize: 15, fontWeight: '600', color: INK },
  collectionDesc: { color: MID, fontSize: 13, marginTop: 3 },
})

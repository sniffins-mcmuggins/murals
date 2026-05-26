import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { components } from '../lib/api'

type Profile = components['schemas']['ArtistProfile']

interface Props {
  profile: Profile
  onPress: () => void
  distanceLabel?: string
}

export function ArtistCard({ profile, onPress, distanceLabel }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.row}>
        <View style={styles.avatar} />
        <View style={styles.info}>
          <Text style={styles.name}>{profile.display_name}</Text>
          {profile.location_label ? (
            <Text style={styles.meta}>{profile.location_label}</Text>
          ) : null}
          {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
        </View>
      </View>
      {profile.medium_tags && profile.medium_tags.length > 0 && (
        <View style={styles.tags}>
          {profile.medium_tags.slice(0, 4).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'
const WARM = '#F0EAE0'

const styles = StyleSheet.create({
  card: {
    backgroundColor: OFFWHITE,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: WARM,
    marginRight: 12,
  },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: INK },
  meta: { color: MID, fontSize: 13, marginTop: 2 },
  distance: { color: AMBER, fontSize: 12, marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  tag: { backgroundColor: WARM, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 11, color: INK },
})

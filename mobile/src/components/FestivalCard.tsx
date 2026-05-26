import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { components } from '../lib/api'

type Festival = components['schemas']['Festival']

interface Props {
  festival: Festival
  onPress: () => void
}

export function FestivalCard({ festival, onPress }: Props) {
  const dateRange =
    festival.start_date && festival.end_date
      ? `${festival.start_date} – ${festival.end_date}`
      : festival.start_date ?? ''

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.header}>
        <Text style={styles.name}>{festival.name}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{festival.status}</Text>
        </View>
      </View>
      {festival.location_label ? (
        <Text style={styles.location}>{festival.location_label}</Text>
      ) : null}
      {dateRange ? <Text style={styles.dates}>{dateRange}</Text> : null}
    </TouchableOpacity>
  )
}

const OFFWHITE = '#FAF7F2'
const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'
const LIGHT = '#E2DDD6'

const styles = StyleSheet.create({
  card: {
    backgroundColor: OFFWHITE,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: LIGHT,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { flex: 1, fontSize: 18, fontWeight: '600', color: INK, marginRight: 8 },
  badge: {
    backgroundColor: AMBER,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: INK, textTransform: 'uppercase' },
  location: { color: MID, marginTop: 4, fontSize: 14 },
  dates: { color: MID, marginTop: 2, fontSize: 13 },
})

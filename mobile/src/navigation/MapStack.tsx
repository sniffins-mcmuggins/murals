import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { FestivalMapScreen } from '../screens/FestivalMap/FestivalMapScreen'
import type { MapStackParamList } from './types'

const Stack = createStackNavigator<MapStackParamList>()

export function MapStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="FestivalMap" component={FestivalMapScreen} options={{ title: 'Map' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}

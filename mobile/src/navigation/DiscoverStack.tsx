import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { DiscoverScreen } from '../screens/Discover/DiscoverScreen'
import type { DiscoverStackParamList } from './types'

const Stack = createStackNavigator<DiscoverStackParamList>()

export function DiscoverStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="DiscoverScreen" component={DiscoverScreen} options={{ title: 'Discover' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}

import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { ArtistProfileScreen } from '../screens/ArtistProfile/ArtistProfileScreen'
import { HomeScreen } from '../screens/Home/HomeScreen'
import type { HomeStackParamList } from './types'

const Stack = createStackNavigator<HomeStackParamList>()

export function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="HomeScreen" component={HomeScreen} options={{ title: 'Render' }} />
      <Stack.Screen name="ArtistProfile" component={ArtistProfileScreen} options={{ title: '' }} />
    </Stack.Navigator>
  )
}

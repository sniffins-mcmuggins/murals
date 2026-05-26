import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import React from 'react'
import { DiscoverStack } from './DiscoverStack'
import { HomeStack } from './HomeStack'
import { MapStack } from './MapStack'
import type { RootTabParamList } from './types'

const Tab = createBottomTabNavigator<RootTabParamList>()

const INK = '#1A1A2E'
const AMBER = '#E8A838'
const MID = '#8A8896'

export function BottomTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: AMBER,
        tabBarInactiveTintColor: MID,
        tabBarStyle: { backgroundColor: INK },
      }}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Map" component={MapStack} />
      <Tab.Screen name="Discover" component={DiscoverStack} />
    </Tab.Navigator>
  )
}

import { NavigationContainer, type LinkingOptions } from '@react-navigation/native'
import React from 'react'
import { BottomTabNavigator } from './BottomTabNavigator'

const linking: LinkingOptions<any> = {
  prefixes: ['render://'],
  config: {
    screens: {
      Home: {
        screens: { HomeScreen: '', ArtistProfile: 'artists/:profileID' },
      },
      Map: {
        screens: {
          FestivalMap: 'festivals/:festivalSlug/map',
          ArtistProfile: 'artists/:profileID',
        },
      },
      Discover: {
        screens: { DiscoverScreen: 'discover', ArtistProfile: 'artists/:profileID' },
      },
    },
  },
}

export function RootNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <BottomTabNavigator />
    </NavigationContainer>
  )
}

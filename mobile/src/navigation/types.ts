import type { StackScreenProps } from '@react-navigation/stack'
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import type { CompositeScreenProps } from '@react-navigation/native'

export type RootTabParamList = {
  Home: undefined
  Map: { festivalSlug?: string }
  Discover: undefined
}

export type HomeStackParamList = {
  HomeScreen: undefined
  ArtistProfile: { profileID: string }
}

export type MapStackParamList = {
  FestivalMap: { festivalSlug?: string }
  ArtistProfile: { profileID: string }
}

export type DiscoverStackParamList = {
  DiscoverScreen: undefined
  ArtistProfile: { profileID: string }
}

export type HomeScreenProps = CompositeScreenProps<
  StackScreenProps<HomeStackParamList, 'HomeScreen'>,
  BottomTabScreenProps<RootTabParamList>
>

export type FestivalMapScreenProps = CompositeScreenProps<
  StackScreenProps<MapStackParamList, 'FestivalMap'>,
  BottomTabScreenProps<RootTabParamList>
>

export type ArtistProfileScreenProps<T extends HomeStackParamList | MapStackParamList | DiscoverStackParamList> =
  StackScreenProps<T, 'ArtistProfile'>

export type DiscoverScreenProps = CompositeScreenProps<
  StackScreenProps<DiscoverStackParamList, 'DiscoverScreen'>,
  BottomTabScreenProps<RootTabParamList>
>

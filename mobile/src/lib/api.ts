import { Platform } from 'react-native'
import { createApiClient } from '@render/api-client'

const DEV_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001'

const PROD_BASE_URL = 'https://api.renderltd.com'

export const apiClient = createApiClient({
  baseUrl: __DEV__ ? DEV_BASE_URL : PROD_BASE_URL,
})

export type { components, paths, operations } from '@render/api-client'

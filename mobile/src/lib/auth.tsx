import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as Keychain from 'react-native-keychain'

const KEYCHAIN_SERVICE = 'render-mobile-jwt'

interface AuthContextValue {
  token: string | null
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  setToken: async () => {},
  clearToken: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)

  useEffect(() => {
    Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE }).then((result) => {
      if (result) setTokenState(result.password)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      setToken: async (t: string) => {
        await Keychain.setGenericPassword('jwt', t, { service: KEYCHAIN_SERVICE })
        setTokenState(t)
      },
      clearToken: async () => {
        await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE })
        setTokenState(null)
      },
    }),
    [token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

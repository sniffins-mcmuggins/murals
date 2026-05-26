# E8 — React Native App Design

**Date:** 2026-05-26
**Status:** Approved
**Project:** Render — Paint Festival Platform
**Depends on:** [2026-05-18-tech-stack-design.md](2026-05-18-tech-stack-design.md) · [2026-05-19-phase1-build-plan-design.md](2026-05-19-phase1-build-plan-design.md)

---

## Purpose

Deliver the React Native mobile app for the Render platform: a public-facing app for festival visitors and art enthusiasts. All management (artist dashboard, organiser tools) stays in the browser app. The Phase 1 mobile app is read-only and unauthenticated — it shows festivals, maps, artist profiles, and discovery.

This spec covers all 9 sub-issues (#61–#69) under E8. E1–E6 (API) are complete; this is a greenfield mobile app build on top of an existing backend.

---

## Sub-issues

| Issue | Title | Status |
|-------|-------|--------|
| #61 | RN bare scaffold (no Expo) | Open |
| #62 | React Navigation (tab + stack) | Open |
| #63 | Auth + react-native-keychain | Open |
| #64 | API client (generated TS types) | Open |
| #65 | Home screen (live festivals) | Open |
| #66 | Festival map screen (WebView + Leaflet) | Open |
| #67 | Artist profile screen + QR landing | Open |
| #68 | Discover screen (Nearby + Random) | Open |
| #69 | RN smoke test setup | Open |

---

## Implementation Approach

**Foundation first, then parallel screens.** One agent implements #61–#64 sequentially — each depends on the previous. Once the foundation is merged, four parallel agents implement screens #65–#68 simultaneously (no file-level collisions). A fifth agent handles #69 smoke tests after all screens exist.

This requires two API additions (see below) that are small enough to include in this plan rather than open new backend issues.

---

## Architecture

### Directory structure

```
mobile/
  src/
    screens/
      Home/
        HomeScreen.tsx
        index.ts
      FestivalMap/
        FestivalMapScreen.tsx
        index.ts
      ArtistProfile/
        ArtistProfileScreen.tsx
        index.ts
      Discover/
        DiscoverScreen.tsx
        index.ts
    navigation/
      RootNavigator.tsx      # NavigationContainer + linking config
      BottomTabNavigator.tsx # Home | Map | Discover tabs
      HomeStack.tsx          # Home → ArtistProfile
      MapStack.tsx           # FestivalMap → ArtistProfile
      DiscoverStack.tsx      # Discover → ArtistProfile
      types.ts               # RootStackParamList + typed navigation hooks
    lib/
      api.ts                 # singleton apiClient + useApiClient hook
      auth.ts                # AuthContext + useAuth hook
      location.ts            # requestLocationPermission + getCurrentPosition
    assets/
      map.html               # local Leaflet HTML for WebView
    components/
      FestivalCard.tsx
      ArtistCard.tsx
      LoadingSkeleton.tsx
      ErrorBoundary.tsx
  App.tsx                    # NavigationContainer + AuthProvider + QueryClientProvider
  index.js                   # RN entry point
  tsconfig.json
  .eslintrc.js
  prettier.config.js
  jest.config.js
  Taskfile.yml
  package.json
  .env.example               # API_BASE_URL
```

### Shared TypeScript types

The API client imports from `../../openapi/client` via a TypeScript path alias `@render/api-client`. This path alias is declared in both `tsconfig.json` and the Metro config (`metro.config.js`) so bundling and type-checking use the same resolution. All API response types come from the generated client — no manual type duplication.

### State management

TanStack Query (`@tanstack/react-query`) for server state. No global client-side state manager. Auth context holds the JWT (nullable for public-only use in Phase 1). This keeps the app simple and matches the web app's approach.

### API base URL

Read from `process.env.API_BASE_URL` (via `react-native-dotenv`). Default `.env.example` ships two lines:
```
# iOS simulator
# API_BASE_URL=http://localhost:3001
# Android emulator
# API_BASE_URL=http://10.0.2.2:3001
```
The developer uncomments the appropriate line.

---

## API Additions Required

Two endpoints are missing from the current API that E8 screens need. Both are small, unauthenticated, and clearly within the spirit of E5/E6. They are included in this plan.

### 1. `GET /public/festivals` — list live festivals

Needed by: Home screen (#65).

```
GET /public/festivals?status=live
```

- No auth required (`security: []`)
- Returns `Festival[]` where `status = 'live'` (or `status = 'open'` — configurable via query param)
- Supports `?status=live|open|archived` filter; defaults to `live`
- Returns 200 + empty array when no matching festivals exist
- OpenAPI tag: `festival`

**Implementation scope:** new handler `festival.ListPublicHandler`, new sqlc query `ListPublicFestivals(status)`, new route in main.go, OpenAPI spec updated, brief integration test.

### 2. `GET /profiles` — paginated public artist profiles

Needed by: Discover screen Random mode (#68).

```
GET /profiles?page=1&per_page=20
```

- No auth required (`security: []`)
- Returns paginated `ArtistProfile[]` (public fields only — same as `GET /profiles/{profileID}`)
- Default `per_page=20`, max `per_page=100`
- Response includes `{ profiles: ArtistProfile[], total: number, page: number, per_page: number }`
- Filters: none in Phase 1
- OpenAPI tag: `artist`

**Implementation scope:** new handler `artist.ListPublicHandler`, new sqlc query `ListPublicProfiles(offset, limit)`, new route in main.go, OpenAPI spec updated, brief integration test.

---

## Foundation (#61–#64)

### #61 — RN bare scaffold

Initialise a React Native bare project (no Expo) into `mobile/`. Use `@react-native-community/cli init` with the TypeScript template, then reconcile with the existing skeleton `package.json` and `Taskfile.yml`.

**TypeScript config (`tsconfig.json`):**
```json
{
  "extends": "@tsconfig/react-native/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "paths": {
      "@render/api-client": ["../../openapi/client/index.ts"]
    }
  }
}
```

**Metro config (`metro.config.js`):** add `resolver.extraNodeModules` + `watchFolders` to resolve `@render/api-client` via the path alias. This is the standard approach for RN monorepo-style path aliases without Expo.

**ESLint (`.eslintrc.js`):** extends `@react-native`, adds `prettier` plugin. Prettier config: `singleQuote: true`, `trailingComma: "all"`, `semi: false`.

**Taskfile.yml** (replaces skeleton):
```yaml
tasks:
  ios:     npx react-native run-ios
  android: npx react-native run-android
  test:    npm test -- --passWithNoTests
  lint:    npm run lint && npm run typecheck
  install: npm install
```

**Deliverable:** `task -d mobile ios` and `task -d mobile android` launch the default RN welcome screen. `task mobile:lint` passes with zero warnings.

### #62 — React Navigation

Install: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/stack`, plus peer deps (`react-native-screens`, `react-native-safe-area-context`).

**Navigation structure:**
```
NavigationContainer (linking: render://)
  └─ BottomTabNavigator (3 tabs)
       ├─ HomeStack
       │    ├─ HomeScreen (default)
       │    └─ ArtistProfileScreen
       ├─ MapStack
       │    ├─ FestivalMapScreen (default)
       │    └─ ArtistProfileScreen
       └─ DiscoverStack
            ├─ DiscoverScreen (default)
            └─ ArtistProfileScreen
```

`ArtistProfileScreen` appears in all three stacks so deep-linking from any context navigates correctly without resetting the tab.

**`navigation/types.ts`** declares the full param list:
```ts
export type RootTabParamList = { Home: undefined; Map: undefined; Discover: undefined }
export type HomeStackParamList = { HomeScreen: undefined; ArtistProfile: { profileID: string } }
export type MapStackParamList  = { FestivalMap: { festivalSlug: string } | undefined; ArtistProfile: { profileID: string } }
export type DiscoverStackParamList = { DiscoverScreen: undefined; ArtistProfile: { profileID: string } }
```

Each screen uses typed `useNavigation` and `useRoute` hooks — no `any` casts.

**Tab icons:** use `react-native-vector-icons/MaterialCommunityIcons` — `home`, `map`, `compass`. Tab labels: Home / Map / Discover. Active tint: `#E8A838` (amber). Inactive: `#8A8896` (mid). Background: `#1A1A2E` (ink).

### #63 — Auth infrastructure

Install `react-native-keychain`. No screens.

**`src/lib/auth.ts`:**
```ts
interface AuthContextValue {
  token: string | null
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}
```

`AuthProvider` reads from keychain on mount (`Keychain.getGenericPassword()`), stores in state. `setToken` writes to both keychain and state. `clearToken` removes from both. The context value is stable across renders (memoised).

`App.tsx` wraps everything: `<AuthProvider><QueryClientProvider><NavigationContainer>`.

### #64 — API client

Install `openapi-fetch` (already a dep of `openapi/client`).

**`src/lib/api.ts`:**
```ts
import { createApiClient } from '@render/api-client'
import { useAuth } from './auth'

let client: ReturnType<typeof createApiClient> | null = null

export function getApiClient(getToken?: () => string | null): ReturnType<typeof createApiClient> {
  if (!client) {
    client = createApiClient({
      baseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001',
      getToken,
    })
  }
  return client
}

export function useApiClient() {
  const { token } = useAuth()
  return getApiClient(() => token)
}
```

The singleton pattern avoids creating a new client on every render. `useApiClient` is the hook used in screen components. Re-exports all types from `@render/api-client` for convenience.

---

## Screen Implementations (#65–#68)

These four are implemented in parallel after the foundation merges.

### #65 — Home screen

**Data:** `GET /public/festivals?status=live` via TanStack Query (no auth).

**Layout:**
- Header: "Render" wordmark (Cormorant Garamond, ink colour)
- `FlatList` of `FestivalCard` components
- Each card: name, date range, location label, cover image (placeholder if null), status badge
- Tap → navigate to `MapStack/FestivalMap` with `festivalSlug`
- Pull-to-refresh (`onRefresh`)
- Loading: skeleton cards (3 × `LoadingSkeleton`)
- Empty: "No live festivals right now — check back soon" with the amber accent
- Error: "Couldn't load festivals" with retry button

**`FestivalCard`** is a shared component in `src/components/` used by Home only for now.

### #66 — FestivalMap screen

**Data:** `GET /festivals/slug/{slug}/map` via TanStack Query (no auth), after screen mounts.

**Layout:** full-screen `react-native-webview` rendering `src/assets/map.html`.

**`map.html`** — fresh, minimal Leaflet HTML:
- OpenStreetMap tiles
- No CPF-specific UI, no demo content
- Listens for `window.addEventListener('message', ...)` (from RN on Android) and `window.onmessage` (iOS)
- Accepted message types:
  - `{ type: 'SET_PINS', pins: MapPin[] }` — clears existing markers, adds new ones
  - `{ type: 'SET_CENTER', lat, lng, zoom }` — pan/zoom the map
- On marker tap: `window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ARTIST_TAPPED', profileID: pin.artist_id }))`
- Map colours: circle markers in amber (`#E8A838`), active in clay (`#C45C3A`), popup text in ink (`#1A1A2E`)

**RN side:**
1. On mount: initialise with a default Cheltenham centre (`lat: 51.9000, lng: -2.0800, zoom: 14`)
2. On data load: post `SET_PINS` with the festival's accepted artist pins
3. On `onMessage` from WebView: parse JSON, if `ARTIST_TAPPED` → navigate to `ArtistProfile` with `profileID`

**Loading state:** show a spinner over the WebView until `onLoadEnd` fires. Error state if fetch fails.

### #67 — Artist profile screen + QR landing

**Data:** `GET /profiles/{profileID}` and `GET /profiles/{profileID}/collections` via TanStack Query (parallel queries).

**Layout:**
- Hero: cover image (first collection image or placeholder), artist name in Cormorant Garamond
- Bio text, medium tags (amber chips), location label (if enabled)
- Collections: horizontally-scrollable carousel of collection cards, each showing cover image + name
- Tap collection: expands inline or navigates to a detail screen (Phase 2 — just show first image for Phase 1)
- Social links: icon row (Instagram, etc.) if present

**QR / deep link:** `render://artists/{profileID}` maps to this screen. Declared in the `linking` config passed to `NavigationContainer`:
```ts
const linking = {
  prefixes: ['render://'],
  config: {
    screens: {
      Home: { screens: { ArtistProfile: 'artists/:profileID' } },
      Map:  { screens: { ArtistProfile: 'artists/:profileID' } },
      Discover: { screens: { ArtistProfile: 'artists/:profileID' } },
    },
  },
}
```

Deep links open in whichever tab was last active.

**iOS:** add `render` scheme to `Info.plist` under `CFBundleURLTypes`. **Android:** add intent filter in `AndroidManifest.xml` for `render://` scheme.

**Image fallback:** `onError` on `<Image>` replaces src with a grey placeholder.

### #68 — Discover screen

**Two modes:** Nearby and Random, toggled by a segment control at the top of the screen.

**Random mode (primary):**
- Data: `GET /profiles?page=1&per_page=20` via TanStack Query
- Shuffle the results client-side (Fisher-Yates on first load)
- Render as a scrollable list of `ArtistCard` components (avatar, name, medium tags, location if enabled)
- Tap → `ArtistProfile` screen
- Pull-to-refresh fetches a new page; client re-shuffles

**Nearby mode:**
- On tab-switch to Nearby: call `requestLocationPermission()` from `src/lib/location.ts`
- If denied: show "Location access needed to find nearby artists" with a "Open Settings" button (`Linking.openSettings()`)
- If granted: call `getCurrentPosition()`, then `GET /public/festivals?status=live`, then for each festival `GET /festivals/slug/{slug}/map`. Collect all `MapPin[]`, deduplicate by `artist_id`, sort by distance from device. Render as `ArtistCard` list with distance label.
- Nearby uses festival pins as a proxy for artist geo-data — sufficient for Phase 1 (all accepted artists have pin coordinates). A dedicated geo-search endpoint is Phase 2.

**`src/lib/location.ts`:** wraps `react-native` `PermissionsAndroid` (Android) and `Geolocation.requestAuthorization()` (iOS) into a unified `requestLocationPermission(): Promise<boolean>` and `getCurrentPosition(): Promise<{ lat: number, lng: number }>`.

---

## Smoke Tests (#69)

Jest + `@testing-library/react-native`. One test file per screen. Tests mount the component with a mocked query client and assert key elements render without crashing.

**Mocking strategy:**
- `@react-navigation/native` → `jest-mock` from the package
- `@tanstack/react-query` → wrap in a real `QueryClient` with `retry: false`
- API calls → mock `src/lib/api.ts` via `jest.mock`, return minimal fixture data
- `react-native-keychain` → `jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn().mockResolvedValue(false) }))`
- `react-native-webview` → mock as a plain `<View>`

**Test files:**
```
src/screens/Home/__tests__/HomeScreen.test.tsx
src/screens/FestivalMap/__tests__/FestivalMapScreen.test.tsx
src/screens/ArtistProfile/__tests__/ArtistProfileScreen.test.tsx
src/screens/Discover/__tests__/DiscoverScreen.test.tsx
```

Each test: renders the screen, asserts it doesn't throw, asserts a top-level `testID` element is present.

`jest.config.js` preset: `@react-native`. `task mobile:test` runs `jest --passWithNoTests` (so the task passes on the scaffold before tests are written).

---

## Deep Links

URL scheme: `render://`

| URL | Screen |
|-----|--------|
| `render://artists/{profileID}` | ArtistProfile |
| `render://festivals/{slug}/map` | FestivalMap |

**iOS setup:** `CFBundleURLTypes` in `ios/RenderMobile/Info.plist`.
**Android setup:** `<intent-filter>` with `scheme="render"` in `AndroidManifest.xml`.

---

## Done Criteria

- [ ] `task mobile:lint` passes (ESLint + Prettier + TypeScript strict)
- [ ] `task mobile:test` passes (all smoke tests green)
- [ ] `task -d mobile ios` launches the app on iOS simulator
- [ ] `task -d mobile android` launches on Android emulator
- [ ] Deep link `render://artists/{any-valid-profileID}` navigates to ArtistProfile
- [ ] Home screen shows festivals from the running local stack
- [ ] Festival map screen renders OpenStreetMap tiles and artist pins
- [ ] GitHub issues #61–#69 closed, epic #8 closed, `blocked` label removed
- [ ] `task api:test:unit` still passes (API additions have integration tests)
- [ ] `task lint` passes project-wide

---

## Out of Scope

- Login / signup screens (Phase 2)
- Community / Stream Chat screen (Phase 2)
- Artist/organiser dashboard in mobile (browser-only at launch)
- Production build config, code signing, app store submission (Phase 2)
- App icon, splash screen polish (Phase 2)
- Offline map tile caching (Phase 2)
- In-app QR code scanner (Phase 2 — deep links handle Phase 1)
- Geo-search API endpoint (Nearby in Discover uses festival pins as proxy)

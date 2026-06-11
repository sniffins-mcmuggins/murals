import L from 'leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Bundlers disagree on the default export of an image import:
//   - webpack's image loader returns a StaticImageData object → `{ src, … }`
//   - Turbopack (Next 16's default bundler) returns the URL **string** directly
// The old code assumed `{ src }`, so under Turbopack `iconUrl` became `undefined`
// and Leaflet threw `iconUrl not set in Icon options` the moment the first
// <Marker> mounted — taking the whole public/organiser map down via the error
// boundary. Resolve either shape to a usable URL.
function assetSrc(mod: unknown): string {
  return typeof mod === 'string' ? mod : (mod as { src: string }).src
}

/**
 * Leaflet's default marker icon, with the bundler-mangled image paths resolved.
 *
 * Importing this module installs it on `L.Marker.prototype` as a side effect, so
 * any react-leaflet `<Marker>` (which uses the default icon) renders correctly.
 * Both the public festival map and the organiser map editor import it; keep this
 * the single source of truth for the default-icon fix.
 */
export const leafletDefaultIcon = L.icon({
  iconUrl: assetSrc(markerIcon),
  shadowUrl: assetSrc(markerShadow),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

L.Marker.prototype.options.icon = leafletDefaultIcon

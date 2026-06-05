package festival

import "regexp"

// Mirror of web/src/lib/embeds.ts parseEmbed provider rules. Keep in sync.
var (
	reYouTube   = regexp.MustCompile(`(?:youtube\.com/(?:watch\?v=|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})`)
	reVimeo     = regexp.MustCompile(`vimeo\.com/(?:video/)?(\d+)`)
	reSketchfab = regexp.MustCompile(`sketchfab\.com/(?:3d-models/[A-Za-z0-9-]*-|models/)([A-Za-z0-9]+)`)
)

// embedProvider returns "youtube", "vimeo", or "sketchfab" for a recognised
// embed URL, or "" if the URL is not a supported provider.
func embedProvider(raw string) string {
	switch {
	case reYouTube.MatchString(raw):
		return "youtube"
	case reVimeo.MatchString(raw):
		return "vimeo"
	case reSketchfab.MatchString(raw):
		return "sketchfab"
	default:
		return ""
	}
}

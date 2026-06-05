package festival

import (
	"net/url"
	"regexp"
	"strings"
)

// Mirror of web/src/lib/embeds.ts parseEmbed provider rules. Keep in sync.
// The host is validated via url.Parse (not regex) so an attacker-controlled
// host such as https://evil.com/youtube.com/embed/ID can never match.
var (
	reYTID        = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	reYTEmbedPath = regexp.MustCompile(`^/embed/([A-Za-z0-9_-]{11})`)
	reYTBePath    = regexp.MustCompile(`^/([A-Za-z0-9_-]{11})`)
	reVimeoPath   = regexp.MustCompile(`^/(?:video/)?(\d+)`)
	reSketchfab   = regexp.MustCompile(`^/(?:3d-models/[A-Za-z0-9-]*-|models/)([A-Za-z0-9]+)`)
)

// embedProvider returns "youtube", "vimeo", or "sketchfab" for a recognised
// embed URL, or "" if the URL is not a supported provider.
func embedProvider(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	host := strings.TrimPrefix(u.Hostname(), "www.")

	switch host {
	case "youtube.com", "m.youtube.com":
		if v := u.Query().Get("v"); reYTID.MatchString(v) {
			return "youtube"
		}
		if reYTEmbedPath.MatchString(u.Path) {
			return "youtube"
		}
	case "youtu.be":
		if reYTBePath.MatchString(u.Path) {
			return "youtube"
		}
	case "vimeo.com", "player.vimeo.com":
		if reVimeoPath.MatchString(u.Path) {
			return "vimeo"
		}
	case "sketchfab.com":
		if reSketchfab.MatchString(u.Path) {
			return "sketchfab"
		}
	}
	return ""
}

package festival

import "testing"

func TestEmbedProvider(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		// Valid providers
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":            "youtube",
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s":        "youtube",
		"https://youtu.be/dQw4w9WgXcQ":                           "youtube",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":              "youtube",
		"https://vimeo.com/123456789":                            "vimeo",
		"https://sketchfab.com/3d-models/a-cool-model-abc123DEF": "sketchfab",
		// Empty / non-url / unknown host
		"":                            "",
		"not a url":                   "",
		"https://example.com/video/1": "",
		"https://youtube.com":         "",
		// Attacker-controlled host / wrong scheme must NOT match
		"https://evil.com/youtube.com/embed/dQw4w9WgXcQ": "",
		"https://notyoutube.com/watch?v=dQw4w9WgXcQ":     "",
		"https://my-vimeo.com/123456789":                 "",
		"javascript:alert(1)//youtu.be/dQw4w9WgXcQ":      "",
		"data:text/html,vimeo.com/123456789":             "",
	}
	for in, want := range cases {
		if got := embedProvider(in); got != want {
			t.Errorf("embedProvider(%q) = %q, want %q", in, got, want)
		}
	}
}

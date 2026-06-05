package festival

import "testing"

func TestEmbedProvider(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":            "youtube",
		"https://youtu.be/dQw4w9WgXcQ":                           "youtube",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":              "youtube",
		"https://vimeo.com/123456789":                            "vimeo",
		"https://sketchfab.com/3d-models/a-cool-model-abc123DEF": "sketchfab",
		"":                            "",
		"not a url":                   "",
		"https://example.com/video/1": "",
		"https://youtube.com":         "",
	}
	for in, want := range cases {
		if got := embedProvider(in); got != want {
			t.Errorf("embedProvider(%q) = %q, want %q", in, got, want)
		}
	}
}

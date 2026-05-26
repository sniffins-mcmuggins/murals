package image_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	imageutil "github.com/sniffins-mcmuggins/render/api/internal/image"
)

func TestPublicURL(t *testing.T) {
	t.Parallel()
	tests := []struct {
		cdnBase  string
		s3Key    string
		expected string
	}{
		{
			cdnBase:  "http://localhost:9000/render-images",
			s3Key:    "abc123.jpg",
			expected: "http://localhost:9000/render-images/abc123.jpg",
		},
		{
			// trailing slash on cdnBase should be stripped
			cdnBase:  "http://localhost:9000/render-images/",
			s3Key:    "abc123.jpg",
			expected: "http://localhost:9000/render-images/abc123.jpg",
		},
		{
			cdnBase:  "https://cdn.example.com",
			s3Key:    "abc123.png",
			expected: "https://cdn.example.com/abc123.png",
		},
	}
	for _, tt := range tests {
		got := imageutil.PublicURL(tt.cdnBase, tt.s3Key)
		assert.Equal(t, tt.expected, got, "PublicURL(%q, %q)", tt.cdnBase, tt.s3Key)
	}
}

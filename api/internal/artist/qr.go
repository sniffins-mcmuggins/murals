package artist

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"net/http"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/qr"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sniffins-mcmuggins/render/api/internal/auth"
	"github.com/sniffins-mcmuggins/render/api/internal/httperr"
	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// qrSize is the rendered edge length in pixels. Large enough to print sharply
// (A5 card, wall label) per the README QR-code spec.
const qrSize = 512

// Brand palette from the design system (CLAUDE.md). The QR renders as ink
// modules on a warm off-white field so it reads as ours, not a generic black
// square, while staying high-contrast enough to scan reliably.
var (
	brandInk      = color.RGBA{R: 0x1A, G: 0x1A, B: 0x2E, A: 0xFF}
	brandOffwhite = color.RGBA{R: 0xFA, G: 0xF7, B: 0xF2, A: 0xFF}
)

// BuildProfileURL returns the canonical public profile URL the QR code encodes.
// Encoding the URL (not just an ID) means the printed QR keeps working as long
// as the route stays stable; if the route scheme ever changes the code is
// regenerated server-side with no reprint of stored data.
func BuildProfileURL(webBase, profileID string) string {
	return strings.TrimRight(webBase, "/") + "/artists/" + profileID
}

// renderBrandedQR encodes content as a QR code and returns a branded PNG: brand
// ink modules on a brand off-white background, scaled to qrSize x qrSize.
func renderBrandedQR(content string) ([]byte, error) {
	code, err := qr.Encode(content, qr.M, qr.Auto)
	if err != nil {
		return nil, err
	}
	scaled, err := barcode.Scale(code, qrSize, qrSize)
	if err != nil {
		return nil, err
	}

	out := image.NewRGBA(scaled.Bounds())
	bounds := scaled.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := scaled.At(x, y).RGBA()
			// scaled is black/white; recolour dark modules to brand ink and the
			// background to brand off-white.
			if (r+g+b)/3 < 0x8000 {
				out.Set(x, y, brandInk)
			} else {
				out.Set(x, y, brandOffwhite)
			}
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ProfileQRHandler handles GET /profiles/me/qr. Requires auth. Returns a branded
// PNG QR code encoding the caller's public profile URL. Nothing is persisted;
// the code is derived from the profile ID on each request.
func ProfileQRHandler(pool *pgxpool.Pool, webPublicBase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := auth.User(r.Context())
		if err != nil {
			httperr.Unauthorized(w)
			return
		}
		userUUID, err := pgUUIDFromString(principal.UserID)
		if err != nil {
			httperr.InternalServerError(w)
			return
		}

		q := sqlcdb.New(pool)
		profile, err := q.GetArtistProfileByUserID(r.Context(), userUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httperr.NotFound(w)
				return
			}
			httperr.InternalServerError(w)
			return
		}

		pngBytes, err := renderBrandedQR(BuildProfileURL(webPublicBase, profile.ID.String()))
		if err != nil {
			slog.Error("qr render failed", "err", err, "profile_id", profile.ID.String())
			httperr.InternalServerError(w)
			return
		}

		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "private, max-age=300")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(pngBytes)
	}
}

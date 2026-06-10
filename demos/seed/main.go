package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	demoPassword  = "demo-password-2027"
	adminEmail    = "admin@demo.art"
	marcusEmail   = "marcus@cpf-demo.art"
	ladyGabeEmail = "ladygabe@demo.art"
	sophieEmail   = "sophie@cpf-reviewer.art"
)

var cpfFields = []map[string]any{
	{"id": "f1", "type": "textarea", "label": "Describe your proposed mural concept", "required": true},
	{"id": "f2", "type": "select", "label": "Preferred wall size", "options": []string{"Small (up to 4m²)", "Medium (4–20m²)", "Large (20m²+)"}, "required": true},
	{"id": "f3", "type": "select", "label": "Primary medium", "options": []string{"Spray paint", "Brush", "Mixed media", "Roller"}, "required": true},
	{"id": "f5", "type": "select", "label": "Do you have public liability insurance?", "options": []string{"Yes", "No", "In progress"}, "required": true},
	{"id": "f6", "type": "select", "label": "Full festival availability (10–17 October)?", "options": []string{"Full period", "Partial — specify below"}, "required": true},
	{"id": "f7", "type": "select", "label": "Previous outdoor mural experience", "options": []string{"Yes", "No"}, "required": false},
	{"id": "f8", "type": "textarea", "label": "Anything else you'd like to tell us?", "required": false},
	// Profile-bound link fields (E28 + favicons): one per platform + website, pre-filled,
	// each with a Share checkbox so the artist picks which to include.
	{"id": "link_instagram", "type": "text", "label": "Instagram", "required": false, "prefill": "social.instagram"},
	{"id": "link_twitter", "type": "text", "label": "X / Twitter", "required": false, "prefill": "social.twitter"},
	{"id": "link_facebook", "type": "text", "label": "Facebook", "required": false, "prefill": "social.facebook"},
	{"id": "link_youtube", "type": "text", "label": "YouTube", "required": false, "prefill": "social.youtube"},
	{"id": "link_tiktok", "type": "text", "label": "TikTok", "required": false, "prefill": "social.tiktok"},
	{"id": "link_linkedin", "type": "text", "label": "LinkedIn", "required": false, "prefill": "social.linkedin"},
	{"id": "link_pinterest", "type": "text", "label": "Pinterest", "required": false, "prefill": "social.pinterest"},
	{"id": "link_website", "type": "text", "label": "Website", "required": false, "prefill": "website"},
}

// socialURL builds a plausible profile URL for a platform + handle, used to seed
// each demo applicant's shared application links.
func socialURL(platform, handle string) string {
	switch platform {
	case "instagram":
		return "https://instagram.com/" + handle
	case "twitter":
		return "https://x.com/" + handle
	case "facebook":
		return "https://facebook.com/" + handle
	case "youtube":
		return "https://youtube.com/@" + handle
	case "tiktok":
		return "https://tiktok.com/@" + handle
	case "linkedin":
		return "https://linkedin.com/in/" + handle
	case "pinterest":
		return "https://pinterest.com/" + handle
	case "website":
		return "https://" + handle + ".art"
	}
	return ""
}

// demoLinkSets gives each seeded applicant a distinct mix of shared social links
// so the favicon row visibly changes as an organiser flips through triage.
var demoLinkSets = [][]string{
	{"instagram", "tiktok", "website"},
	{"twitter", "youtube"},
	{"facebook", "linkedin", "pinterest"},
	{"instagram", "twitter", "website"},
}

type fictionalArtist struct {
	name    string
	email   string
	bio     string
	medium  string
	concept string
	size    string
	status  string
	pinLat  float64
	pinLng  float64
}

// avatarURLs maps fictional artist name → a portrait photo URL used as avatar_s3_key.
// These are public Unsplash images — the seed stores the URL directly as the key
// (same pattern as Lady Gabe's avatar), so cards render them without MinIO.
var avatarURLs = map[string]string{
	"Kit Harrow":   "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop&crop=faces",
	"Tomás Cruz":   "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=faces",
	"Amara Diallo": "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=120&h=120&fit=crop&crop=faces",
	"Rosa Vane":    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&h=120&fit=crop&crop=faces",
}

var artistSeed = []fictionalArtist{
	{"Kit Harrow", "kit@demo-artist.art", "Urban wildlife muralist based in Bristol.", "Spray paint",
		"A series of endangered British species rendered life-size across three panels.", "Large (20m²+)", "submitted", 0, 0},
	{"Tomás Cruz", "tomas@demo-artist.art", "Geometric abstraction in public spaces.", "Mixed media",
		"Fractured geometry reflecting Cheltenham's Regency architecture.", "Medium (4–20m²)", "submitted", 0, 0},
	{"Amara Diallo", "amara@demo-artist.art", "Celebrating West African cultural heritage through colour.", "Spray paint",
		"Kente patterns adapted for a Cheltenham townhouse gable end.", "Large (20m²+)", "submitted", 0, 0},
	{"Rosa Vane", "rosa@demo-artist.art", "Community portraiture and local history.", "Brush",
		"Portraits of five unsung figures from Cheltenham's history.", "Medium (4–20m²)", "submitted", 0, 0},
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://render:render@localhost:5432/render?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	hash, err := bcrypt.GenerateFromPassword([]byte(demoPassword), 12)
	if err != nil {
		log.Fatalf("bcrypt: %v", err)
	}
	pwHash := string(hash)

	demoEmails := []string{adminEmail, marcusEmail, ladyGabeEmail, sophieEmail}
	for _, a := range artistSeed {
		demoEmails = append(demoEmails, a.email)
	}

	if _, err := conn.Exec(ctx,
		`DELETE FROM users WHERE email = ANY($1::text[])`, demoEmails,
	); err != nil {
		log.Fatalf("delete demo users: %v", err)
	}
	// Clean up V01-created festivals (fresh organiser user, so not caught by user delete).
	// V01 creates "Cheltenham Paint Festival 2027" with a timestamped slug each run.
	if _, err := conn.Exec(ctx,
		`DELETE FROM festivals WHERE name = 'Cheltenham Paint Festival 2027' AND slug != 'cpf-2027'`,
	); err != nil {
		log.Fatalf("delete stale demo festivals: %v", err)
	}
	fmt.Println("Cleared existing demo rows")

	var adminID string
	fmt.Printf("  password for all:     %s\n", demoPassword)

	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_admin, is_beta, email_verified)
		 VALUES ($1, $2, true, true, true) RETURNING id`,
		adminEmail, pwHash).Scan(&adminID); err != nil {
		log.Fatalf("insert admin: %v", err)
	}
	fmt.Printf("  admin:     %s\n", adminEmail)

	var marcusID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_beta, email_verified)
		 VALUES ($1, $2, true, true) RETURNING id`,
		marcusEmail, pwHash).Scan(&marcusID); err != nil {
		log.Fatalf("insert marcus: %v", err)
	}
	fmt.Printf("  organiser: %s\n", marcusEmail)

	var gabeUserID, gabeProfileID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_beta, email_verified)
		 VALUES ($1, $2, true, true) RETURNING id`,
		ladyGabeEmail, pwHash).Scan(&gabeUserID); err != nil {
		log.Fatalf("insert ladygabe user: %v", err)
	}
	const gabeAvatarURL = "https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/f5c6bfe7-76c5-4b2c-b758-ca6619212ac6/LadyGabe-ExhibitionPortraits-EBP-15.jpg"
	const gabeHeadlineURL = "https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/1731342884036-2U79DU9SMFAB1VTGV0I2/20241009_133146~2_Original.jpeg"
	if err := conn.QueryRow(ctx,
		`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility, avatar_s3_key, headline_image_urls)
		 VALUES ($1, 'Lady Gabe',
		   'South-West muralist. Bold colour, mythological themes, outdoor work.',
		   '{"instagram":"https://instagram.com/ladygabeart","website":"https://ladygabe.com","twitter":"https://x.com/ladygabeart","tiktok":"https://tiktok.com/@ladygabeart"}',
		   'public', $2, $3) RETURNING id`,
		gabeUserID, gabeAvatarURL, []string{gabeHeadlineURL}).Scan(&gabeProfileID); err != nil {
		log.Fatalf("insert ladygabe profile: %v", err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
		 VALUES ($1, 'artist_basic', now() + interval '2 years', $2, 'Demo account')`,
		gabeUserID, adminID); err != nil {
		log.Fatalf("insert ladygabe grant: %v", err)
	}

	gabeImages := []string{
		"https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/1731342884036-2U79DU9SMFAB1VTGV0I2/20241009_133146~2_Original.jpeg",
		"https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/1775241018774-8GA6LVJ6LGNRK5BBNIXY/20260320_163113.jpg",
		"https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/1775242742143-HJ7AFW2P7Y6IZNBLDNDC/20260320_163557.jpg",
		"https://images.squarespace-cdn.com/content/v1/5a1c1f68f9a61edc99dee15f/1775241051717-NE5SYET937YXZ4YV3ET9/20260320_163458.jpg",
	}
	var gabeCollID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO collections (artist_profile_id, name, cover_s3_key, display_order)
		 VALUES ($1, 'Murals 2027', $2, 0) RETURNING id`,
		gabeProfileID, gabeImages[0]).Scan(&gabeCollID); err != nil {
		log.Fatalf("insert ladygabe collection: %v", err)
	}
	for i, imgURL := range gabeImages {
		if _, err := conn.Exec(ctx,
			`INSERT INTO collection_images (collection_id, s3_key, cdn_url, display_order)
			 VALUES ($1, $2, $3, $4)`,
			gabeCollID, fmt.Sprintf("external/lady-gabe-%d", i+1), imgURL, i); err != nil {
			log.Fatalf("insert ladygabe image %d: %v", i+1, err)
		}
	}
	fmt.Printf("  artist:    %s (profile public, %d images)\n", ladyGabeEmail, len(gabeImages))

	// Analytics events for Lady Gabe spread over the last ~85 days, so the
	// analytics demo clip shows real numbers (not zeros). Aggregated only — no
	// per-visitor data (GDPR-clean by design).
	for _, ev := range []struct {
		kind  string
		count int
	}{{"profile_view", 342}, {"qr_scan", 57}, {"link_click", 124}} {
		if _, err := conn.Exec(ctx,
			`INSERT INTO analytics_events (event_type, profile_id, occurred_at)
			 SELECT $1::analytics_event_type, $2, now() - (random() * interval '85 days')
			 FROM generate_series(1, $3)`,
			ev.kind, gabeProfileID, ev.count); err != nil {
			log.Fatalf("insert analytics %s: %v", ev.kind, err)
		}
	}
	fmt.Println("  analytics: Lady Gabe (342 views · 57 scans · 124 clicks)")

	type seededArtist struct {
		profileID string
		a         fictionalArtist
	}
	var seeded []seededArtist
	for _, a := range artistSeed {
		var uid, pid string
		if err := conn.QueryRow(ctx,
			`INSERT INTO users (email, password_hash, is_beta, email_verified)
			 VALUES ($1, $2, true, true) RETURNING id`,
			a.email, pwHash).Scan(&uid); err != nil {
			log.Fatalf("insert fictional artist %s: %v", a.email, err)
		}
		handle := a.email[:strings.Index(a.email, "@")]
		socialJSON := fmt.Sprintf(`{"instagram":"https://instagram.com/%s"}`, handle)
		avatarURL := avatarURLs[a.name]
		if err := conn.QueryRow(ctx,
			`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility, avatar_s3_key)
			 VALUES ($1, $2, $3, $4, 'public', $5) RETURNING id`,
			uid, a.name, a.bio, socialJSON, avatarURL).Scan(&pid); err != nil {
			log.Fatalf("insert fictional profile %s: %v", a.name, err)
		}
		seeded = append(seeded, seededArtist{pid, a})
	}
	fmt.Printf("  fictional artists: %d\n", len(seeded))

	// Promo code for V03 — artist redeems this to get access before publishing
	if _, err := conn.Exec(ctx,
		`INSERT INTO promo_codes (code, plan, duration_days, created_by)
		 VALUES ('DEMO2027', 'artist_basic', 730, $1)
		 ON CONFLICT (code) DO UPDATE SET revoked_at = NULL, use_count = 0`,
		adminID); err != nil {
		log.Fatalf("insert promo code: %v", err)
	}
	fmt.Println("  promo code: DEMO2027")

	const (
		cheltLat = 51.8994
		cheltLng = -2.0783
	)

	var festivalID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO festivals
		   (organiser_id, name, slug, description, location_label, start_date, end_date, status,
		    center_lat, center_lng)
		 VALUES ($1, 'Cheltenham Paint Festival 2027', 'cpf-2027',
		   'The UK''s premier paint festival returns for 2027. Eight days of live mural creation across the town centre.',
		   'Cheltenham, UK', '2027-10-10', '2027-10-17', 'open',
		   $2, $3)
		 RETURNING id`,
		marcusID, cheltLat, cheltLng).Scan(&festivalID); err != nil {
		log.Fatalf("insert festival: %v", err)
	}
	fmt.Printf("  festival:  cpf-2027 (%s)\n", festivalID)

	// Endorsements for Lady Gabe — one organiser (Marcus / CPF), one peer (Amara
	// Diallo) — so the public-profile and endorsements demo clips have real social
	// proof to show. moderation_status defaults to 'ok', so both appear publicly.
	if _, err := conn.Exec(ctx,
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, festival_id, body, skills)
		 VALUES ($1, $2, 'organiser', $3, $4, $5)
		 ON CONFLICT (endorser_id, endorsee_id) DO NOTHING`,
		marcusID, gabeProfileID, festivalID,
		"A consummate professional from first email to final coat — met every deadline, brilliant with the public, and the wall stopped people in their tracks. Any festival would be lucky to have her.",
		[]string{"reliability", "large-scale", "public engagement"}); err != nil {
		log.Fatalf("insert organiser endorsement: %v", err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO endorsements (endorser_id, endorsee_id, kind, body, skills)
		 SELECT user_id, $1, 'peer', $2, $3 FROM artist_profiles WHERE display_name = 'Amara Diallo'
		 ON CONFLICT (endorser_id, endorsee_id) DO NOTHING`,
		gabeProfileID,
		"Gabe's colour work is fearless. I've watched her take a blank gable end and turn it into the best thing on the street. A real one.",
		[]string{"colour", "composition"}); err != nil {
		log.Fatalf("insert peer endorsement: %v", err)
	}
	fmt.Println("  endorsements: Lady Gabe ← Marcus (organiser) + Amara (peer)")

	fieldsJSON, _ := json.Marshal(cpfFields)
	var formID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO application_forms (festival_id, fields, open_at)
		 VALUES ($1, $2, now()) RETURNING id`,
		festivalID, string(fieldsJSON)).Scan(&formID); err != nil {
		log.Fatalf("insert form: %v", err)
	}

	for i, s := range seeded {
		handle := s.a.email[:strings.Index(s.a.email, "@")]
		ans := map[string]string{
			"f1": s.a.concept,
			"f2": s.a.size,
			"f3": s.a.medium,
			"f5": "Yes",
			"f6": "Full period",
			"f7": "Yes",
			"f8": "",
		}
		// Distinct shared links per applicant — clickable favicons in triage + the slide-over.
		for _, p := range demoLinkSets[i%len(demoLinkSets)] {
			ans["link_"+p] = socialURL(p, handle)
		}
		answers, _ := json.Marshal(ans)
		if _, err := conn.Exec(ctx,
			`INSERT INTO applications (form_id, artist_id, status, answers)
			 VALUES ($1, $2, $3, $4)`,
			formID, s.profileID, s.a.status, string(answers)); err != nil {
			log.Fatalf("insert application %s: %v", s.a.name, err)
		}
		if s.a.status == "accepted" {
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_artists (festival_id, artist_id, status)
				 VALUES ($1, $2, 'accepted')`,
				festivalID, s.profileID); err != nil {
				log.Fatalf("insert festival_artist %s: %v", s.a.name, err)
			}
		}
	}
	fmt.Printf("  applications: %d\n", len(seeded))

	// Insert festival_spots for accepted artists (coordinates from artistSeed)
	spotNumber := 1
	for _, s := range seeded {
		if s.a.status == "accepted" {
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_spots (festival_id, number, lat, lng, artist_id)
				 VALUES ($1, $2, $3, $4, $5)`,
				festivalID, spotNumber, s.a.pinLat, s.a.pinLng, s.profileID); err != nil {
				log.Fatalf("insert festival_spot %s: %v", s.a.name, err)
			}
			spotNumber++
		}
	}
	fmt.Printf("  festival_spots: %d\n", spotNumber-1)

	// Seed portfolio collections for accepted artists using real CPF mural photos
	cpfImages := []string{
		"https://static.wixstatic.com/media/6d7a7a_59acbe0d8b894210aa57848285c919c6~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_3196dbda7c534044bd0bf0a327c82920~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_5b32f3466e964b98804afe4dfef92f2d~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_2ea09f026caf443dab1a7fb7e54a0476~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_823f76b215b14ac4b13d2fa8a1be73f0~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_6c929c75d82e4e5aa933e5674a0296b4~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_7826721c02e3490d9d014f35aa329588~mv2.jpg",
		"https://static.wixstatic.com/media/6d7a7a_4bb66caea30b4e418e3b341b6cd813f7~mv2.jpg",
	}
	cpfIdx := 0
	for _, s := range seeded {
		if s.a.status != "accepted" {
			continue
		}
		img1 := cpfImages[cpfIdx%len(cpfImages)]
		img2 := cpfImages[(cpfIdx+1)%len(cpfImages)]
		cpfIdx += 2
		var collID string
		if err := conn.QueryRow(ctx,
			`INSERT INTO collections (artist_profile_id, name, cover_s3_key, display_order)
			 VALUES ($1, 'Portfolio', $2, 0) RETURNING id`,
			s.profileID, img1).Scan(&collID); err != nil {
			log.Fatalf("insert collection for %s: %v", s.a.name, err)
		}
		for j, imgURL := range []string{img1, img2} {
			if _, err := conn.Exec(ctx,
				`INSERT INTO collection_images (collection_id, s3_key, cdn_url, display_order)
				 VALUES ($1, $2, $3, $4)`,
				collID, fmt.Sprintf("external/cpf-%d", cpfIdx-1+j), imgURL, j); err != nil {
				log.Fatalf("insert image for %s: %v", s.a.name, err)
			}
		}
	}
	fmt.Println("  accepted artist portfolios seeded")

	// ── Reviewer: Sophie Park ─────────────────────────────────────────────────────
	// Sophie is an invited panellist for CPF 2027. Her account is pre-scored so the
	// V06 organiser demo can show ★ averages on kanban cards after closing the round.
	var sophieID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_beta, email_verified)
		 VALUES ($1, $2, true, true) RETURNING id`,
		sophieEmail, pwHash).Scan(&sophieID); err != nil {
		log.Fatalf("insert sophie: %v", err)
	}
	// Add as an accepted reviewer (accepted_at = now so she gets emailed when round opens)
	if _, err := conn.Exec(ctx,
		`INSERT INTO festival_reviewers (festival_id, user_id, accepted_at)
		 VALUES ($1, $2, now())`,
		festivalID, sophieID); err != nil {
		log.Fatalf("insert sophie reviewer: %v", err)
	}
	// Pre-seed Sophie's scores on all 5 submitted applications so averages show on cards
	sophieScores := map[string]int32{
		"Kit Harrow":   4,
		"Tomás Cruz":   2,
		"Amara Diallo": 5,
		"Rosa Vane":    5,
	}
	for _, s := range seeded {
		score, ok := sophieScores[s.a.name]
		if !ok {
			continue
		}
		var appID string
		if err := conn.QueryRow(ctx,
			`SELECT a.id FROM applications a
			 JOIN artist_profiles ap ON ap.id = a.artist_id
			 WHERE ap.display_name = $1 AND a.form_id = $2`,
			s.a.name, formID).Scan(&appID); err != nil {
			log.Fatalf("lookup app for %s: %v", s.a.name, err)
		}
		if _, err := conn.Exec(ctx,
			`INSERT INTO application_scores (application_id, reviewer_id, criterion_id, score)
			 VALUES ($1, $2, 'overall', $3)
			 ON CONFLICT (application_id, reviewer_id, criterion_id) DO UPDATE SET score = EXCLUDED.score`,
			appID, sophieID, score); err != nil {
			log.Fatalf("insert score for %s: %v", s.a.name, err)
		}
	}
	fmt.Printf("  reviewer:  %s (scores seeded for %d applications)\n", sophieEmail, len(seeded))

	// ── CPF 2026 (historical — used for history overlay demo) ─────────────────────
	var cpf2026ID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO festivals
		   (organiser_id, name, slug, description, location_label, start_date, end_date, status,
		    center_lat, center_lng)
		 VALUES ($1, 'Cheltenham Paint Festival 2026', 'cpf-2026',
		   'The 2026 edition of the UK''s premier paint festival.',
		   'Cheltenham, UK', '2026-10-09', '2026-10-16', 'closed',
		   $2, $3)
		 RETURNING id`,
		marcusID, cheltLat, cheltLng).Scan(&cpf2026ID); err != nil {
		log.Fatalf("insert cpf2026: %v", err)
	}
	type histSpot struct {
		lat, lng float64
		status   string
	}
	cpf2026Spots := []histSpot{
		{51.9020, -2.0741, "permanent"},
		{51.8975, -2.0798, "permanent"},
		{51.9003, -2.0770, "temporary"},
		{51.8988, -2.0815, "temporary"},
		{51.9015, -2.0760, "unknown"},
		{51.8962, -2.0730, "unknown"},
	}
	for i, s := range cpf2026Spots {
		if _, err := conn.Exec(ctx,
			`INSERT INTO festival_spots (festival_id, number, lat, lng, mural_status)
			 VALUES ($1, $2, $3, $4, $5)`,
			cpf2026ID, i+1, s.lat, s.lng, s.status); err != nil {
			log.Fatalf("insert cpf2026 spot %d: %v", i+1, err)
		}
	}
	fmt.Printf("  cpf-2026:  %s (6 historical spots seeded)\n", cpf2026ID)

	fmt.Println("Demo seed complete ✓")
}

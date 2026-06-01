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
)

var cpfFields = []map[string]any{
	{"id": "f1", "type": "textarea", "label": "Describe your proposed mural concept", "required": true},
	{"id": "f2", "type": "select", "label": "Preferred wall size", "options": []string{"Small (up to 4m²)", "Medium (4–20m²)", "Large (20m²+)"}, "required": true},
	{"id": "f3", "type": "select", "label": "Primary medium", "options": []string{"Spray paint", "Brush", "Mixed media", "Roller"}, "required": true},
	{"id": "f4", "type": "textarea", "label": "Portfolio links (up to 3 URLs)", "required": true},
	{"id": "f5", "type": "select", "label": "Do you have public liability insurance?", "options": []string{"Yes", "No", "In progress"}, "required": true},
	{"id": "f6", "type": "select", "label": "Full festival availability (10–17 October)?", "options": []string{"Full period", "Partial — specify below"}, "required": true},
	{"id": "f7", "type": "select", "label": "Previous outdoor mural experience", "options": []string{"Yes", "No"}, "required": false},
	{"id": "f8", "type": "textarea", "label": "Anything else you'd like to tell us?", "required": false},
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

var artistSeed = []fictionalArtist{
	{"Kit Harrow", "kit@demo-artist.art", "Urban wildlife muralist based in Bristol.", "Spray paint",
		"A series of endangered British species rendered life-size across three panels.", "Large (20m²+)", "submitted", 0, 0},
	{"Tomás Cruz", "tomas@demo-artist.art", "Geometric abstraction in public spaces.", "Mixed media",
		"Fractured geometry reflecting Cheltenham's Regency architecture.", "Medium (4–20m²)", "submitted", 0, 0},
	{"Yuki Tanaka", "yuki@demo-artist.art", "Nature and landscape, Japanese-influenced style.", "Brush",
		"Cherry blossom and oak — a conversation between Japanese and British flora.", "Small (up to 4m²)", "submitted", 0, 0},
	{"Amara Diallo", "amara@demo-artist.art", "Celebrating West African cultural heritage through colour.", "Spray paint",
		"Kente patterns adapted for a Cheltenham townhouse gable end.", "Large (20m²+)", "submitted", 0, 0},
	{"Rosa Vane", "rosa@demo-artist.art", "Community portraiture and local history.", "Brush",
		"Portraits of five unsung figures from Cheltenham's history.", "Medium (4–20m²)", "submitted", 0, 0},
	{"Zara Osei", "zara@demo-artist.art", "Colour-field murals celebrating joyful public space.", "Roller",
		"Bold colour blocks celebrating Cheltenham's multicultural community.", "Large (20m²+)", "accepted", 51.9012, -2.0743},
	{"Finn Marlowe", "finn@demo-artist.art", "Typographic murals and text-based public art.", "Spray paint",
		"Poetry lines from Cheltenham Literature Festival past laureates.", "Medium (4–20m²)", "accepted", 51.9001, -2.0801},
	{"Priya Nair", "priya@demo-artist.art", "Botanical illustration at architectural scale.", "Brush",
		"Medicinal plants from Cheltenham's Victorian apothecary tradition.", "Medium (4–20m²)", "accepted", 51.8998, -2.0768},
	{"Cas Rivera", "cas@demo-artist.art", "Afrofuturist imagery and speculative worlds.", "Mixed media",
		"A portal — what Cheltenham looks like in 2127.", "Large (20m²+)", "accepted", 51.9021, -2.0712},
	{"Olly Webb", "olly@demo-artist.art", "Street art and paste-up.", "Spray paint",
		"Hyperrealist portrait series.", "Small (up to 4m²)", "declined", 0, 0},
	{"Jess Kamau", "jess@demo-artist.art", "Landscape and environmental themes.", "Brush",
		"Severn river ecosystem from source to estuary.", "Medium (4–20m²)", "declined", 0, 0},
	{"Bex Thornton", "bex@demo-artist.art", "Abstract expressionism in outdoor spaces.", "Roller",
		"Storm patterns in ink wash at building scale.", "Large (20m²+)", "declined", 0, 0},
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

	demoEmails := []string{adminEmail, marcusEmail, ladyGabeEmail}
	for _, a := range artistSeed {
		demoEmails = append(demoEmails, a.email)
	}

	if _, err := conn.Exec(ctx,
		`DELETE FROM users WHERE email = ANY($1::text[])`, demoEmails,
	); err != nil {
		log.Fatalf("delete demo users: %v", err)
	}
	fmt.Println("Cleared existing demo rows")

	var adminID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'admin', true) RETURNING id`,
		adminEmail, pwHash).Scan(&adminID); err != nil {
		log.Fatalf("insert admin: %v", err)
	}
	fmt.Printf("  admin:     %s\n", adminEmail)

	var marcusID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'organiser', true) RETURNING id`,
		marcusEmail, pwHash).Scan(&marcusID); err != nil {
		log.Fatalf("insert marcus: %v", err)
	}
	fmt.Printf("  organiser: %s\n", marcusEmail)

	var gabeUserID, gabeProfileID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, role, is_beta)
		 VALUES ($1, $2, 'artist', true) RETURNING id`,
		ladyGabeEmail, pwHash).Scan(&gabeUserID); err != nil {
		log.Fatalf("insert ladygabe user: %v", err)
	}
	if err := conn.QueryRow(ctx,
		`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility)
		 VALUES ($1, 'Lady Gabe',
		   'South-West based muralist. Bold colour, mythological themes, outdoor work across the UK.',
		   '{"instagram":"https://instagram.com/ladygabeart","website":"https://ladygabe.com"}',
		   'public') RETURNING id`,
		gabeUserID).Scan(&gabeProfileID); err != nil {
		log.Fatalf("insert ladygabe profile: %v", err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
		 VALUES ($1, 'artist_basic', now() + interval '2 years', $2, 'Demo account')`,
		gabeUserID, adminID); err != nil {
		log.Fatalf("insert ladygabe grant: %v", err)
	}
	fmt.Printf("  artist:    %s (profile public)\n", ladyGabeEmail)

	type seededArtist struct {
		profileID string
		a         fictionalArtist
	}
	var seeded []seededArtist
	for _, a := range artistSeed {
		var uid, pid string
		if err := conn.QueryRow(ctx,
			`INSERT INTO users (email, password_hash, role, is_beta)
			 VALUES ($1, $2, 'artist', true) RETURNING id`,
			a.email, pwHash).Scan(&uid); err != nil {
			log.Fatalf("insert fictional artist %s: %v", a.email, err)
		}
		handle := a.email[:strings.Index(a.email, "@")]
		socialJSON := fmt.Sprintf(`{"instagram":"https://instagram.com/%s"}`, handle)
		if err := conn.QueryRow(ctx,
			`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility)
			 VALUES ($1, $2, $3, $4, 'public') RETURNING id`,
			uid, a.name, a.bio, socialJSON).Scan(&pid); err != nil {
			log.Fatalf("insert fictional profile %s: %v", a.name, err)
		}
		seeded = append(seeded, seededArtist{pid, a})
	}
	fmt.Printf("  fictional artists: %d\n", len(seeded))

	var festivalID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO festivals
		   (organiser_id, name, slug, description, location_label, start_date, end_date, status)
		 VALUES ($1, 'Cheltenham Paint Festival 2027', 'cpf-2027',
		   'The UK''s premier paint festival returns for 2027. Eight days of live mural creation across the town centre.',
		   'Cheltenham, UK', '2027-10-10', '2027-10-17', 'open')
		 RETURNING id`,
		marcusID).Scan(&festivalID); err != nil {
		log.Fatalf("insert festival: %v", err)
	}
	fmt.Printf("  festival:  cpf-2027 (%s)\n", festivalID)

	fieldsJSON, _ := json.Marshal(cpfFields)
	var formID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO application_forms (festival_id, fields, open_at)
		 VALUES ($1, $2, now()) RETURNING id`,
		festivalID, string(fieldsJSON)).Scan(&formID); err != nil {
		log.Fatalf("insert form: %v", err)
	}

	for _, s := range seeded {
		answers, _ := json.Marshal(map[string]string{
			"f1": s.a.concept,
			"f2": s.a.size,
			"f3": s.a.medium,
			"f4": "https://portfolio.example/" + s.a.email[:5],
			"f5": "Yes",
			"f6": "Full period",
			"f7": "Yes",
			"f8": "",
		})
		if _, err := conn.Exec(ctx,
			`INSERT INTO applications (form_id, artist_id, status, answers)
			 VALUES ($1, $2, $3, $4)`,
			formID, s.profileID, s.a.status, string(answers)); err != nil {
			log.Fatalf("insert application %s: %v", s.a.name, err)
		}
		if s.a.status == "accepted" {
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_artists (festival_id, artist_id, status, pin_lat, pin_lng)
				 VALUES ($1, $2, 'accepted', $3, $4)`,
				festivalID, s.profileID, s.a.pinLat, s.a.pinLng); err != nil {
				log.Fatalf("insert festival_artist %s: %v", s.a.name, err)
			}
		}
	}
	fmt.Printf("  applications: %d\n", len(seeded))
	fmt.Println("Demo seed complete ✓")
}

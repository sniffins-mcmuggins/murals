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
	"gopkg.in/yaml.v3"
)

// ── YAML schema ──────────────────────────────────────────────────────────────

type SeedConfig struct {
	Config         ConfigBlock    `yaml:"config"`
	Accounts       AccountsBlock  `yaml:"accounts"`
	FeaturedArtist FeaturedArtist `yaml:"featured_artist"`
	PromoCodes     []PromoCode    `yaml:"promo_codes"`
	Festivals      []Festival     `yaml:"festivals"`
}

type ConfigBlock struct {
	Password string `yaml:"password"`
}

type AccountsBlock struct {
	AdminEmail     string `yaml:"admin_email"`
	OrganiserEmail string `yaml:"organiser_email"`
}

type FeaturedArtist struct {
	Email              string            `yaml:"email"`
	DisplayName        string            `yaml:"display_name"`
	Bio                string            `yaml:"bio"`
	SocialLinks        map[string]string `yaml:"social_links"`
	AvatarURL          string            `yaml:"avatar_url"`
	HeadlineURL        string            `yaml:"headline_url"`
	Collection         ArtistCollection  `yaml:"collection"`
	Analytics          map[string]int    `yaml:"analytics"`
	AccessPlan         string            `yaml:"access_plan"`
	AccessDurationDays int               `yaml:"access_duration_days"`
}

type ArtistCollection struct {
	Name   string   `yaml:"name"`
	Images []string `yaml:"images"`
}

type PromoCode struct {
	Code         string `yaml:"code"`
	Plan         string `yaml:"plan"`
	DurationDays int    `yaml:"duration_days"`
}

type Festival struct {
	Slug        string  `yaml:"slug"`
	Name        string  `yaml:"name"`
	Description string  `yaml:"description"`
	Location    string  `yaml:"location"`
	StartDate   string  `yaml:"start_date"`
	EndDate     string  `yaml:"end_date"`
	Status      string  `yaml:"status"`
	CenterLat   float64 `yaml:"center_lat"`
	CenterLng   float64 `yaml:"center_lng"`

	// Application-based festivals
	EndorsementsForFeaturedArtist []Endorsement    `yaml:"endorsements_for_featured_artist"`
	ApplicationForm               *ApplicationForm `yaml:"application_form"`
	ReviewerEmail                 string           `yaml:"reviewer_email"`
	Applicants                    []Applicant      `yaml:"applicants"`
	PortfolioImages               []string         `yaml:"portfolio_images"`

	// Historical festivals
	Spots []Spot `yaml:"spots"`
}

type ApplicationForm struct {
	Fields []FormField `yaml:"fields"`
}

type FormField struct {
	ID       string   `yaml:"id"`
	Type     string   `yaml:"type"`
	Label    string   `yaml:"label"`
	Options  []string `yaml:"options"`
	Required bool     `yaml:"required"`
	Prefill  string   `yaml:"prefill"`
}

type Applicant struct {
	Name          string   `yaml:"name"`
	Email         string   `yaml:"email"`
	Bio           string   `yaml:"bio"`
	AvatarURL     string   `yaml:"avatar_url"`
	Medium        string   `yaml:"medium"`
	Concept       string   `yaml:"concept"`
	Size          string   `yaml:"size"`
	Status        string   `yaml:"status"`
	SharedLinks   []string `yaml:"shared_links"`
	ReviewerScore int32    `yaml:"reviewer_score"`
}

type Endorsement struct {
	Kind       string   `yaml:"kind"`
	From       string   `yaml:"from"`
	FromArtist string   `yaml:"from_artist"`
	Body       string   `yaml:"body"`
	Skills     []string `yaml:"skills"`
}

type Spot struct {
	Lat         float64 `yaml:"lat"`
	Lng         float64 `yaml:"lng"`
	MuralStatus string  `yaml:"mural_status"`
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

func emailHandle(email string) string {
	return email[:strings.Index(email, "@")]
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	raw, err := os.ReadFile("seed.yaml")
	if err != nil {
		log.Fatalf("read seed.yaml: %v", err)
	}
	var cfg SeedConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		log.Fatalf("parse seed.yaml: %v", err)
	}

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

	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.Config.Password), 12)
	if err != nil {
		log.Fatalf("bcrypt: %v", err)
	}
	pwHash := string(hash)

	// ── cleanup ──────────────────────────────────────────────────────────────

	demoEmails := []string{cfg.Accounts.AdminEmail, cfg.Accounts.OrganiserEmail, cfg.FeaturedArtist.Email}
	for _, f := range cfg.Festivals {
		if f.ReviewerEmail != "" {
			demoEmails = append(demoEmails, f.ReviewerEmail)
		}
		for _, a := range f.Applicants {
			demoEmails = append(demoEmails, a.Email)
		}
	}
	if _, err := conn.Exec(ctx, `DELETE FROM users WHERE email = ANY($1::text[])`, demoEmails); err != nil {
		log.Fatalf("delete demo users: %v", err)
	}
	// V01 organiser-onboarding creates a timestamped CPF 2027 festival each run — clean those up.
	if _, err := conn.Exec(ctx,
		`DELETE FROM festivals WHERE name = 'Cheltenham Paint Festival 2027' AND slug != 'cpf-2027'`); err != nil {
		log.Fatalf("delete stale demo festivals: %v", err)
	}
	fmt.Println("Cleared existing demo rows")
	fmt.Printf("  password for all: %s\n", cfg.Config.Password)

	// ── admin ─────────────────────────────────────────────────────────────────

	var adminID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_admin, is_beta, email_verified)
		 VALUES ($1, $2, true, true, true) RETURNING id`,
		cfg.Accounts.AdminEmail, pwHash).Scan(&adminID); err != nil {
		log.Fatalf("insert admin: %v", err)
	}
	fmt.Printf("  admin:     %s\n", cfg.Accounts.AdminEmail)

	// ── organiser ─────────────────────────────────────────────────────────────

	var organiserID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_beta, email_verified)
		 VALUES ($1, $2, true, true) RETURNING id`,
		cfg.Accounts.OrganiserEmail, pwHash).Scan(&organiserID); err != nil {
		log.Fatalf("insert organiser: %v", err)
	}
	fmt.Printf("  organiser: %s\n", cfg.Accounts.OrganiserEmail)

	// ── featured artist ───────────────────────────────────────────────────────

	ga := cfg.FeaturedArtist
	var gabeUserID, gabeProfileID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, is_beta, email_verified)
		 VALUES ($1, $2, true, true) RETURNING id`,
		ga.Email, pwHash).Scan(&gabeUserID); err != nil {
		log.Fatalf("insert featured artist user: %v", err)
	}
	socialJSON, _ := json.Marshal(ga.SocialLinks)
	if err := conn.QueryRow(ctx,
		`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility, avatar_s3_key, headline_image_urls)
		 VALUES ($1, $2, $3, $4, 'public', $5, $6) RETURNING id`,
		gabeUserID, ga.DisplayName, ga.Bio, string(socialJSON), ga.AvatarURL, []string{ga.HeadlineURL},
	).Scan(&gabeProfileID); err != nil {
		log.Fatalf("insert featured artist profile: %v", err)
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO access_grants (user_id, plan, valid_until, granted_by, note)
		 VALUES ($1, $2, now() + ($3 * interval '1 day'), $4, 'Demo account')`,
		gabeUserID, ga.AccessPlan, ga.AccessDurationDays, adminID); err != nil {
		log.Fatalf("insert featured artist grant: %v", err)
	}

	var gabeCollID string
	if err := conn.QueryRow(ctx,
		`INSERT INTO collections (artist_profile_id, name, cover_s3_key, display_order)
		 VALUES ($1, $2, $3, 0) RETURNING id`,
		gabeProfileID, ga.Collection.Name, ga.Collection.Images[0]).Scan(&gabeCollID); err != nil {
		log.Fatalf("insert featured artist collection: %v", err)
	}
	for i, imgURL := range ga.Collection.Images {
		if _, err := conn.Exec(ctx,
			`INSERT INTO collection_images (collection_id, s3_key, cdn_url, display_order)
			 VALUES ($1, $2, $3, $4)`,
			gabeCollID, fmt.Sprintf("external/lady-gabe-%d", i+1), imgURL, i); err != nil {
			log.Fatalf("insert featured artist image %d: %v", i+1, err)
		}
	}
	fmt.Printf("  artist:    %s (profile public, %d images)\n", ga.Email, len(ga.Collection.Images))

	for kind, count := range ga.Analytics {
		if _, err := conn.Exec(ctx,
			`INSERT INTO analytics_events (event_type, profile_id, occurred_at)
			 SELECT $1::analytics_event_type, $2, now() - (random() * interval '85 days')
			 FROM generate_series(1, $3)`,
			kind, gabeProfileID, count); err != nil {
			log.Fatalf("insert analytics %s: %v", kind, err)
		}
	}
	fmt.Printf("  analytics: %s\n", ga.DisplayName)

	// ── promo codes ───────────────────────────────────────────────────────────

	for _, p := range cfg.PromoCodes {
		if _, err := conn.Exec(ctx,
			`INSERT INTO promo_codes (code, plan, duration_days, created_by)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (code) DO UPDATE SET revoked_at = NULL, use_count = 0`,
			p.Code, p.Plan, p.DurationDays, adminID); err != nil {
			log.Fatalf("insert promo code %s: %v", p.Code, err)
		}
		fmt.Printf("  promo code: %s\n", p.Code)
	}

	// ── festivals ─────────────────────────────────────────────────────────────

	for _, f := range cfg.Festivals {
		var festivalID string
		if err := conn.QueryRow(ctx,
			`INSERT INTO festivals
			   (organiser_id, name, slug, description, location_label, start_date, end_date, status,
			    center_lat, center_lng)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			 RETURNING id`,
			organiserID, f.Name, f.Slug, f.Description, f.Location,
			f.StartDate, f.EndDate, f.Status, f.CenterLat, f.CenterLng,
		).Scan(&festivalID); err != nil {
			log.Fatalf("insert festival %s: %v", f.Slug, err)
		}

		// Historical spots (no applications)
		for i, s := range f.Spots {
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_spots (festival_id, number, lat, lng, mural_status)
				 VALUES ($1, $2, $3, $4, $5)`,
				festivalID, i+1, s.Lat, s.Lng, s.MuralStatus); err != nil {
				log.Fatalf("insert spot %d for %s: %v", i+1, f.Slug, err)
			}
		}
		if len(f.Spots) > 0 {
			fmt.Printf("  %s: %s (%d historical spots)\n", f.Slug, festivalID, len(f.Spots))
			continue
		}

		// Endorsements for the featured artist
		for _, e := range f.EndorsementsForFeaturedArtist {
			switch e.Kind {
			case "organiser":
				if _, err := conn.Exec(ctx,
					`INSERT INTO endorsements (endorser_id, endorsee_id, kind, festival_id, body, skills)
					 VALUES ($1, $2, 'organiser', $3, $4, $5)
					 ON CONFLICT (endorser_id, endorsee_id) DO NOTHING`,
					organiserID, gabeProfileID, festivalID, e.Body, e.Skills); err != nil {
					log.Fatalf("insert organiser endorsement: %v", err)
				}
			case "peer":
				if _, err := conn.Exec(ctx,
					`INSERT INTO endorsements (endorser_id, endorsee_id, kind, body, skills)
					 SELECT user_id, $1, 'peer', $2, $3 FROM artist_profiles WHERE display_name = $4
					 ON CONFLICT (endorser_id, endorsee_id) DO NOTHING`,
					gabeProfileID, e.Body, e.Skills, e.FromArtist); err != nil {
					log.Fatalf("insert peer endorsement from %s: %v", e.FromArtist, err)
				}
			}
		}
		if len(f.EndorsementsForFeaturedArtist) > 0 {
			fmt.Printf("  endorsements: %s (%d)\n", ga.DisplayName, len(f.EndorsementsForFeaturedArtist))
		}

		// Application form
		if f.ApplicationForm == nil {
			fmt.Printf("  festival:  %s (%s)\n", f.Slug, festivalID)
			continue
		}
		fieldsJSON, _ := json.Marshal(f.ApplicationForm.Fields)
		var formID string
		if err := conn.QueryRow(ctx,
			`INSERT INTO application_forms (festival_id, fields, open_at)
			 VALUES ($1, $2, now()) RETURNING id`,
			festivalID, string(fieldsJSON)).Scan(&formID); err != nil {
			log.Fatalf("insert form for %s: %v", f.Slug, err)
		}

		// Applicants
		type seededApplicant struct {
			profileID string
			a         Applicant
		}
		var seeded []seededApplicant

		for _, a := range f.Applicants {
			var uid, pid string
			if err := conn.QueryRow(ctx,
				`INSERT INTO users (email, password_hash, is_beta, email_verified)
				 VALUES ($1, $2, true, true) RETURNING id`,
				a.Email, pwHash).Scan(&uid); err != nil {
				log.Fatalf("insert applicant user %s: %v", a.Email, err)
			}
			handle := emailHandle(a.Email)
			instagramJSON := fmt.Sprintf(`{"instagram":"https://instagram.com/%s"}`, handle)
			if err := conn.QueryRow(ctx,
				`INSERT INTO artist_profiles (user_id, display_name, bio, social_links, visibility, avatar_s3_key)
				 VALUES ($1, $2, $3, $4, 'public', $5) RETURNING id`,
				uid, a.Name, a.Bio, instagramJSON, a.AvatarURL).Scan(&pid); err != nil {
				log.Fatalf("insert applicant profile %s: %v", a.Name, err)
			}
			seeded = append(seeded, seededApplicant{pid, a})
		}

		for _, s := range seeded {
			handle := emailHandle(s.a.Email)
			ans := map[string]string{
				"f1": s.a.Concept,
				"f2": s.a.Size,
				"f3": s.a.Medium,
				"f5": "Yes",
				"f6": "Full period",
				"f7": "Yes",
				"f8": "",
			}
			for _, p := range s.a.SharedLinks {
				ans["link_"+p] = socialURL(p, handle)
			}
			answers, _ := json.Marshal(ans)
			if _, err := conn.Exec(ctx,
				`INSERT INTO applications (form_id, artist_id, status, answers)
				 VALUES ($1, $2, $3, $4)`,
				formID, s.profileID, s.a.Status, string(answers)); err != nil {
				log.Fatalf("insert application %s: %v", s.a.Name, err)
			}
			if s.a.Status == "accepted" {
				if _, err := conn.Exec(ctx,
					`INSERT INTO festival_artists (festival_id, artist_id, status)
					 VALUES ($1, $2, 'accepted')`,
					festivalID, s.profileID); err != nil {
					log.Fatalf("insert festival_artist %s: %v", s.a.Name, err)
				}
			}
		}
		fmt.Printf("  applications: %d\n", len(seeded))

		// Accepted artist spots + portfolio
		spotNumber := 1
		cpfIdx := 0
		for _, s := range seeded {
			if s.a.Status != "accepted" {
				continue
			}
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_spots (festival_id, number, lat, lng, artist_id)
				 VALUES ($1, $2, 0, 0, $3)`,
				festivalID, spotNumber, s.profileID); err != nil {
				log.Fatalf("insert spot for %s: %v", s.a.Name, err)
			}
			spotNumber++

			if len(f.PortfolioImages) > 0 {
				img1 := f.PortfolioImages[cpfIdx%len(f.PortfolioImages)]
				img2 := f.PortfolioImages[(cpfIdx+1)%len(f.PortfolioImages)]
				cpfIdx += 2
				var collID string
				if err := conn.QueryRow(ctx,
					`INSERT INTO collections (artist_profile_id, name, cover_s3_key, display_order)
					 VALUES ($1, 'Portfolio', $2, 0) RETURNING id`,
					s.profileID, img1).Scan(&collID); err != nil {
					log.Fatalf("insert portfolio collection for %s: %v", s.a.Name, err)
				}
				for j, imgURL := range []string{img1, img2} {
					if _, err := conn.Exec(ctx,
						`INSERT INTO collection_images (collection_id, s3_key, cdn_url, display_order)
						 VALUES ($1, $2, $3, $4)`,
						collID, fmt.Sprintf("external/cpf-%d", cpfIdx-2+j), imgURL, j); err != nil {
						log.Fatalf("insert portfolio image for %s: %v", s.a.Name, err)
					}
				}
			}
		}

		// Reviewer
		if f.ReviewerEmail != "" {
			var reviewerID string
			if err := conn.QueryRow(ctx,
				`INSERT INTO users (email, password_hash, is_beta, email_verified)
				 VALUES ($1, $2, true, true) RETURNING id`,
				f.ReviewerEmail, pwHash).Scan(&reviewerID); err != nil {
				log.Fatalf("insert reviewer: %v", err)
			}
			if _, err := conn.Exec(ctx,
				`INSERT INTO festival_reviewers (festival_id, user_id, accepted_at)
				 VALUES ($1, $2, now())`,
				festivalID, reviewerID); err != nil {
				log.Fatalf("insert reviewer record: %v", err)
			}
			scored := 0
			for _, s := range seeded {
				if s.a.ReviewerScore == 0 {
					continue
				}
				var appID string
				if err := conn.QueryRow(ctx,
					`SELECT a.id FROM applications a
					 JOIN artist_profiles ap ON ap.id = a.artist_id
					 WHERE ap.display_name = $1 AND a.form_id = $2`,
					s.a.Name, formID).Scan(&appID); err != nil {
					log.Fatalf("lookup app for %s: %v", s.a.Name, err)
				}
				if _, err := conn.Exec(ctx,
					`INSERT INTO application_scores (application_id, reviewer_id, criterion_id, score)
					 VALUES ($1, $2, 'overall', $3)
					 ON CONFLICT (application_id, reviewer_id, criterion_id) DO UPDATE SET score = EXCLUDED.score`,
					appID, reviewerID, s.a.ReviewerScore); err != nil {
					log.Fatalf("insert score for %s: %v", s.a.Name, err)
				}
				scored++
			}
			fmt.Printf("  reviewer:  %s (scores seeded for %d applications)\n", f.ReviewerEmail, scored)
		}

		fmt.Printf("  festival:  %s (%s)\n", f.Slug, festivalID)
	}

	fmt.Println("Demo seed complete ✓")
}

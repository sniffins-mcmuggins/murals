package artist

import (
	"context"

	"github.com/sniffins-mcmuggins/render/api/internal/sqlcdb"
)

// profileSnapshot is the frozen public read-model stored in profile_snapshots.
// Built from the same builders used for live rendering so the shape cannot drift.
type profileSnapshot struct {
	Profile     profileResponse      `json:"profile"`
	Collections []collectionSnapshot `json:"collections"`
}

type collectionSnapshot struct {
	collectionResponse
	Images []imageSnapshot `json:"images"`
}

type imageSnapshot struct {
	ID           string `json:"id"`
	S3Key        string `json:"s3_key"`
	CdnURL       string `json:"cdn_url"`
	DisplayOrder int32  `json:"display_order"`
}

// buildProfileSnapshot assembles the public read-model for a profile from the
// live tables. public=true so the serializer drops owner-only fields.
func buildProfileSnapshot(ctx context.Context, q *sqlcdb.Queries, profile sqlcdb.ArtistProfile) (profileSnapshot, error) {
	snap := profileSnapshot{Profile: toProfileResponse(profile, true)}

	collections, err := q.ListCollectionsByProfileID(ctx, profile.ID)
	if err != nil {
		return profileSnapshot{}, err
	}
	for _, c := range collections {
		cs := collectionSnapshot{collectionResponse: toCollectionResponse(c)}
		images, err := q.ListCollectionImages(ctx, c.ID)
		if err != nil {
			return profileSnapshot{}, err
		}
		for _, im := range images {
			cs.Images = append(cs.Images, imageSnapshot{
				ID:           im.ID.String(),
				S3Key:        im.S3Key,
				CdnURL:       im.CdnUrl,
				DisplayOrder: im.DisplayOrder,
			})
		}
		snap.Collections = append(snap.Collections, cs)
	}
	return snap, nil
}

package artist

import (
	"encoding/json"
	"testing"
)

// Ensure buildProfileSnapshot is referenced so the unused linter is satisfied
// while the function awaits its handler in the next task.
var _ = buildProfileSnapshot

func TestProfileSnapshotJSONRoundTrips(t *testing.T) {
	snap := profileSnapshot{
		Profile: profileResponse{ID: "p1", DisplayName: "Lady Gabe", Bio: "v2"},
		Collections: []collectionSnapshot{{
			collectionResponse: collectionResponse{ID: "c1", Name: "Murals"},
			Images:             []imageSnapshot{{ID: "i1", CdnURL: "https://cdn/x.jpg", DisplayOrder: 0}},
		}},
	}
	b, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back profileSnapshot
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back.Profile.DisplayName != "Lady Gabe" || len(back.Collections) != 1 ||
		len(back.Collections[0].Images) != 1 || back.Collections[0].Images[0].CdnURL != "https://cdn/x.jpg" {
		t.Fatalf("round-trip mismatch: %+v", back)
	}
}

package testutil

import (
	"context"
	"testing"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const testBucket = "render-images-test"

// NewMinIO starts a throwaway MinIO container and returns a connected client
// with the test bucket already created. Container stops on t.Cleanup.
func NewMinIO(t *testing.T) *minio.Client {
	t.Helper()
	ctx := context.Background()

	req := testcontainers.ContainerRequest{
		Image:        "minio/minio:latest",
		ExposedPorts: []string{"9000/tcp"},
		Env: map[string]string{
			"MINIO_ROOT_USER":     "rendertest",
			"MINIO_ROOT_PASSWORD": "rendertest123",
		},
		Cmd:         []string{"server", "/data"},
		WaitingFor:  wait.ForHTTP("/minio/health/live").WithPort("9000"),
	}
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("start minio container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			t.Logf("terminate minio: %v", err)
		}
	})

	host, err := c.Host(ctx)
	if err != nil {
		t.Fatalf("minio host: %v", err)
	}
	port, err := c.MappedPort(ctx, "9000")
	if err != nil {
		t.Fatalf("minio port: %v", err)
	}

	client, err := minio.New(host+":"+port.Port(), &minio.Options{
		Creds:  credentials.NewStaticV4("rendertest", "rendertest123", ""),
		Secure: false,
	})
	if err != nil {
		t.Fatalf("minio client: %v", err)
	}

	if err := client.MakeBucket(ctx, testBucket, minio.MakeBucketOptions{}); err != nil {
		t.Fatalf("make bucket: %v", err)
	}

	return client
}

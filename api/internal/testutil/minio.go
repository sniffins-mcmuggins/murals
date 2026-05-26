package testutil

import (
	"bytes"
	"context"
	"fmt"
	"testing"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// MinIOServer holds a running test MinIO container and its connection details.
type MinIOServer struct {
	Client   *minio.Client
	Endpoint string // "host:port"
	Bucket   string
}

// CDNBase returns the base URL for the test bucket, matching the CDN_BASE_URL env var pattern.
func (s MinIOServer) CDNBase() string {
	return "http://" + s.Endpoint + "/" + s.Bucket
}

// NewMinIOServer starts a throwaway MinIO container and returns the client with
// connection details. The bucket is created with public-read. Container stops on t.Cleanup.
func NewMinIOServer(t *testing.T) MinIOServer {
	t.Helper()
	ctx := context.Background()

	req := testcontainers.ContainerRequest{
		Image:        "minio/minio:latest",
		ExposedPorts: []string{"9000/tcp"},
		Env: map[string]string{
			"MINIO_ROOT_USER":     "rendertest",
			"MINIO_ROOT_PASSWORD": "rendertest123",
		},
		Cmd:        []string{"server", "/data"},
		WaitingFor: wait.ForHTTP("/minio/health/live").WithPort("9000"),
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

	endpoint := host + ":" + port.Port()
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4("rendertest", "rendertest123", ""),
		Secure: false,
	})
	if err != nil {
		t.Fatalf("minio client: %v", err)
	}

	const bucket = "render-images-test"
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
		t.Fatalf("make bucket: %v", err)
	}

	// Allow anonymous GET so CDN URL fetches work in round-trip tests (mirrors production minio-init)
	policy := fmt.Sprintf(`{
		"Version":"2012-10-17",
		"Statement":[{
			"Effect":"Allow",
			"Principal":{"AWS":["*"]},
			"Action":["s3:GetObject"],
			"Resource":["arn:aws:s3:::%s/*"]
		}]
	}`, bucket)
	if err := client.SetBucketPolicy(ctx, bucket, policy); err != nil {
		t.Fatalf("set bucket policy: %v", err)
	}

	return MinIOServer{Client: client, Endpoint: endpoint, Bucket: bucket}
}

// NewMinIO starts a throwaway MinIO container and returns a connected client.
// Use NewMinIOServer if you also need the endpoint or bucket name.
func NewMinIO(t *testing.T) *minio.Client {
	return NewMinIOServer(t).Client
}

// MinIOPutObject is a test helper for directly writing bytes to a MinIO bucket.
func MinIOPutObject(t *testing.T, ms MinIOServer, key string, data []byte, contentType string) {
	t.Helper()
	_, err := ms.Client.PutObject(context.Background(), ms.Bucket, key,
		bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType},
	)
	if err != nil {
		t.Fatalf("put object %s: %v", key, err)
	}
}

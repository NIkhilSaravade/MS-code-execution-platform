package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
)

// S3Client provides typed methods for the objects the worker needs to fetch.
type S3Client struct {
	client          *s3.Client
	bucketArtifacts string
	bucketTestCases string
}

// NewS3Client creates a client configured for MinIO or AWS S3.
// ForcePathStyle must be true for MinIO.
func NewS3Client(ctx context.Context, cfg *config.Config) (*S3Client, error) {
	resolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			if cfg.S3Endpoint != "" {
				return aws.Endpoint{
					URL:               cfg.S3Endpoint,
					SigningRegion:     cfg.S3Region,
					HostnameImmutable: true,
				}, nil
			}
			return aws.Endpoint{}, &aws.EndpointNotFoundError{}
		},
	)

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.S3Region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		),
		awsconfig.WithEndpointResolverWithOptions(resolver),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.S3ForcePathStyle
	})

	return &S3Client{
		client:          client,
		bucketArtifacts: cfg.S3BucketArtifacts,
		bucketTestCases: cfg.S3BucketTestCases,
	}, nil
}

// GetSubmissionCode downloads the user's source file from the artifacts bucket.
func (c *S3Client) GetSubmissionCode(ctx context.Context, s3Key string) ([]byte, error) {
	return c.getObject(ctx, c.bucketArtifacts, s3Key)
}

// GetTestCaseInput downloads a test case input file.
func (c *S3Client) GetTestCaseInput(ctx context.Context, s3Key string) ([]byte, error) {
	return c.getObject(ctx, c.bucketTestCases, s3Key)
}

// GetTestCaseExpected downloads a test case expected-output file.
func (c *S3Client) GetTestCaseExpected(ctx context.Context, s3Key string) ([]byte, error) {
	return c.getObject(ctx, c.bucketTestCases, s3Key)
}

// PutArtifact uploads an execution artifact (stdout, stderr) to the artifacts bucket.
func (c *S3Client) PutArtifact(ctx context.Context, s3Key string, body []byte) error {
	_, err := c.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucketArtifacts),
		Key:         aws.String(s3Key),
		Body:        mustReadCloser(body),
		ContentType: aws.String("text/plain; charset=utf-8"),
	})
	if err != nil {
		return fmt.Errorf("s3 put %s: %w", s3Key, err)
	}
	return nil
}

// --------------------------------------------------------------------------
// internal helpers
// --------------------------------------------------------------------------

func (c *S3Client) getObject(ctx context.Context, bucket, key string) ([]byte, error) {
	resp, err := c.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 get s3://%s/%s: %w", bucket, key, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read s3 body s3://%s/%s: %w", bucket, key, err)
	}
	return data, nil
}

type byteReadCloser struct{ *io.PipeReader }

func mustReadCloser(data []byte) io.Reader {
	pr, pw := io.Pipe()
	go func() {
		_, err := pw.Write(data)
		pw.CloseWithError(err)
	}()
	_ = pr // suppress unused
	// Return a simple bytes reader — no pipe needed for small payloads.
	return bytesReader(data)
}

type bytesReader []byte

func (b bytesReader) Read(p []byte) (n int, err error) {
	if len(b) == 0 {
		return 0, io.EOF
	}
	n = copy(p, b)
	b = b[n:]
	return n, nil
}

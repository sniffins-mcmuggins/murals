package email

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

type Sender struct {
	client   *sesv2.Client
	fromAddr string
}

func NewSender(ctx context.Context, region, fromAddr string) (*Sender, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return &Sender{client: sesv2.NewFromConfig(cfg), fromAddr: fromAddr}, nil
}

func (s *Sender) Send(ctx context.Context, to, subject, bodyHTML string) error {
	_, err := s.client.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(s.fromAddr),
		Destination:      &types.Destination{ToAddresses: []string{to}},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{Data: aws.String(subject), Charset: aws.String("UTF-8")},
				Body:    &types.Body{Html: &types.Content{Data: aws.String(bodyHTML), Charset: aws.String("UTF-8")}},
			},
		},
	})
	if err != nil {
		slog.Error("ses send failed", "to", to, "err", err)
	}
	return err
}

package email

import (
	"context"
	"fmt"
	"net/smtp"
)

// SMTPSender delivers email via plain SMTP — used for local dev with Mailpit.
// Mailpit accepts unauthenticated connections so auth is nil.
type SMTPSender struct {
	addr     string // host:port
	fromAddr string
}

func NewSMTPSender(host, port, fromAddr string) *SMTPSender {
	return &SMTPSender{addr: host + ":" + port, fromAddr: fromAddr}
}

func (s *SMTPSender) Send(_ context.Context, to, subject, bodyHTML string) error {
	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s",
		s.fromAddr, to, subject, bodyHTML,
	)
	return smtp.SendMail(s.addr, nil, s.fromAddr, []string{to}, []byte(msg))
}

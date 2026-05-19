# dev: hot reload via air (source mounted as volume)
FROM golang:1.25-alpine AS dev
RUN go install github.com/air-verse/air@v1.61.5
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
CMD ["air", "-c", ".air.toml"]

# builder: compile static binary
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api

# prod: minimal runtime image
FROM alpine:3.20 AS prod
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/api /bin/api
CMD ["/bin/api"]

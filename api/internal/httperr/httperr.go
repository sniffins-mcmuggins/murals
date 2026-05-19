// Package httperr writes RFC 7807 problem+json responses.
package httperr

import (
	"encoding/json"
	"net/http"
)

const contentType = "application/problem+json"

// Problem is an RFC 7807 problem detail object.
type Problem struct {
	Type     string `json:"type,omitempty"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Instance string `json:"instance,omitempty"`
}

// Write serialises p as application/problem+json with the given status code.
func Write(w http.ResponseWriter, status int, title, detail string) {
	p := Problem{
		Type:   "about:blank",
		Title:  title,
		Status: status,
		Detail: detail,
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}

func BadRequest(w http.ResponseWriter, detail string) {
	Write(w, http.StatusBadRequest, "Bad Request", detail)
}

func Unauthorized(w http.ResponseWriter) {
	Write(w, http.StatusUnauthorized, "Unauthorized", "missing or invalid authentication token")
}

func Forbidden(w http.ResponseWriter) {
	Write(w, http.StatusForbidden, "Forbidden", "you are not authorised to perform this action")
}

func NotFound(w http.ResponseWriter) {
	Write(w, http.StatusNotFound, "Not Found", "the requested resource does not exist")
}

func UnprocessableEntity(w http.ResponseWriter, detail string) {
	Write(w, http.StatusUnprocessableEntity, "Unprocessable Entity", detail)
}

func InternalServerError(w http.ResponseWriter) {
	Write(w, http.StatusInternalServerError, "Internal Server Error", "an unexpected error occurred")
}

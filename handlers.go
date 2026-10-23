package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

//go:embed all:static
var staticFS embed.FS

// Handler builds the full HTTP handler: JSON API + embedded single-page UI.
func (s *AppState) Handler() (http.Handler, error) {
	ui, err := fs.Sub(staticFS, "static")
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()

	// Notes
	mux.HandleFunc("GET /api/notes", s.handleListNotes)
	mux.HandleFunc("POST /api/notes", s.handleSaveNote)
	mux.HandleFunc("DELETE /api/notes", s.handleDeleteNote)
	mux.HandleFunc("GET /api/notes/content", s.handleNoteContent)
	mux.HandleFunc("POST /api/notes/rename", s.handleRenameNote)
	mux.HandleFunc("PUT /api/notes/rename", s.handleRenameNote)

	// Connections
	mux.HandleFunc("GET /api/connections", s.handleListConnections)
	mux.HandleFunc("POST /api/connections", s.handleSaveConnection)
	mux.HandleFunc("DELETE /api/connections", s.handleDeleteConnection)

	// Execution, agent testing and graph
	mux.HandleFunc("POST /api/run", s.handleRun)
	mux.HandleFunc("/api/agent/test", s.handleAgentTest) // GET for agents, POST accepted too
	mux.HandleFunc("GET /api/graph", s.handleGraph)

	// Unknown API paths / methods must not fall through to the UI.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "endpoint tidak ditemukan")
	})

	// Web UI (also the fallback for client-side routes such as /n/<note>)
	mux.Handle("/", spaHandler(ui))

	return sameOriginOnly(mux), nil
}

// --- Notes ---

func (s *AppState) handleListNotes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.ListNotes())
}

func (s *AppState) handleNoteContent(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "name query param required")
		return
	}
	note, err := s.FindNote(name)
	if err != nil {
		writeError(w, http.StatusNotFound, "note '"+name+"' not found")
		return
	}
	writeJSON(w, http.StatusOK, note)
}

func (s *AppState) handleSaveNote(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	note, err := s.SaveNote(req.Name, req.Content)
	if err != nil {
		writeNoteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, note)
}

func (s *AppState) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		writeError(w, http.StatusBadRequest, "name query param required")
		return
	}
	rel, err := s.DeleteNote(name)
	if err != nil {
		writeNoteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": rel})
}

func (s *AppState) handleRenameNote(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.OldName) == "" || strings.TrimSpace(req.NewName) == "" {
		writeError(w, http.StatusBadRequest, "old_name and new_name are required")
		return
	}
	note, err := s.RenameNote(req.OldName, req.NewName)
	if err != nil {
		writeNoteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "renamed",
		"old_name": noteID(req.OldName),
		"new_name": note.Name,
		"note":     note,
	})
}

// --- Connections ---

func (s *AppState) handleListConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Connections())
}

func (s *AppState) handleSaveConnection(w http.ResponseWriter, r *http.Request) {
	var c Connection
	if !decodeJSON(w, r, &c) {
		return
	}
	if c.Alias == "" || c.URI == "" {
		writeError(w, http.StatusBadRequest, "alias and uri required")
		return
	}
	conns, err := s.SetConnection(c)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "gagal menyimpan koneksi: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, conns)
}

func (s *AppState) handleDeleteConnection(w http.ResponseWriter, r *http.Request) {
	alias := r.URL.Query().Get("alias")
	if alias == "" {
		writeError(w, http.StatusBadRequest, "alias query param required")
		return
	}
	conns, err := s.DeleteConnection(alias)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "gagal menyimpan koneksi: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, conns)
}

// --- Execution / agent / graph ---

func (s *AppState) handleRun(w http.ResponseWriter, r *http.Request) {
	var req ExecRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	writeJSON(w, http.StatusOK, s.ExecuteBlock(0, req))
}

func (s *AppState) handleAgentTest(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("note")
	if name == "" {
		writeError(w, http.StatusBadRequest, "note query param required")
		return
	}
	report, err := s.RunNoteTest(name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

func (s *AppState) handleGraph(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.BuildGraph())
}

// --- Web UI ---

// spaHandler serves embedded static files, falling back to index.html so
// client-side routes keep working on reload.
func spaHandler(ui fs.FS) http.Handler {
	files := http.FileServer(http.FS(ui))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if f, err := ui.Open(name); err == nil {
				_ = f.Close()
				files.ServeHTTP(w, r)
				return
			}
		}

		index, err := fs.ReadFile(ui, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusNotFound)
			return
		}
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	})
}

// --- Security ---

// sameOriginOnly blocks cross-site requests to /api/*. RunMD executes code on
// the host, so a random web page must not be able to drive it from the
// visitor's browser (CSRF / DNS rebinding). Non-browser clients such as curl
// send no Origin header and are unaffected.
func sameOriginOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != r.Host {
					writeError(w, http.StatusForbidden, "cross-origin request ditolak")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// --- Helpers ---

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}

func writeNoteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInvalidName):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, errNoteMissing):
		writeError(w, http.StatusNotFound, "source note not found")
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

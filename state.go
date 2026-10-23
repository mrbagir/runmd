package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"maps"
	"os"
	"sync"
)

// AppState holds the notes directory and the (mutable) connection registry.
// The connection map is guarded by mu; always go through the methods below
// instead of touching it directly.
type AppState struct {
	notesDir string
	connFile string

	mu          sync.RWMutex
	connections map[string]Connection
}

func NewAppState(notesDir, connFile string) (*AppState, error) {
	if err := os.MkdirAll(notesDir, 0o755); err != nil {
		return nil, fmt.Errorf("membuat direktori notes %q: %w", notesDir, err)
	}
	s := &AppState{
		notesDir:    notesDir,
		connFile:    connFile,
		connections: make(map[string]Connection),
	}
	s.loadConnections()
	return s, nil
}

// defaultConnections are written on first run so the sidebar is not empty.
func defaultConnections() map[string]Connection {
	return map[string]Connection{
		"pg_order": {
			Alias: "pg_order",
			Type:  "sql",
			URI:   "postgres://postgres:secret@localhost:5432/orders_db?sslmode=disable",
		},
		"redis_main": {
			Alias: "redis_main",
			Type:  "redis",
			URI:   "redis://localhost:6379/0",
		},
		"rmq_local": {
			Alias: "rmq_local",
			Type:  "rabbitmq",
			URI:   "amqp://guest:guest@localhost:5672/",
		},
		"mcp_fs": {
			Alias: "mcp_fs",
			Type:  "mcp",
			URI:   "npx -y @modelcontextprotocol/server-filesystem ./notes",
		},
	}
}

func (s *AppState) loadConnections() {
	data, err := os.ReadFile(s.connFile)
	if errors.Is(err, fs.ErrNotExist) {
		s.connections = defaultConnections()
		if err := s.saveLocked(); err != nil {
			log.Printf("peringatan: gagal menyimpan koneksi bawaan: %v", err)
		}
		return
	}
	if err != nil {
		log.Printf("peringatan: gagal membaca %s: %v", s.connFile, err)
		return
	}
	if err := json.Unmarshal(data, &s.connections); err != nil {
		log.Printf("peringatan: %s bukan JSON yang valid: %v", s.connFile, err)
		s.connections = make(map[string]Connection)
	}
}

// saveLocked persists the registry. The caller must hold mu (or be the only
// goroutine with access, as during start-up).
func (s *AppState) saveLocked() error {
	data, err := json.MarshalIndent(s.connections, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.connFile, data, 0o644)
}

// Connection looks up a single alias.
func (s *AppState) Connection(alias string) (Connection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.connections[alias]
	return c, ok
}

// Connections returns a snapshot that is safe to read and encode without
// holding the lock.
func (s *AppState) Connections() map[string]Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return maps.Clone(s.connections)
}

// SetConnection adds or replaces a connection and returns the new snapshot.
func (s *AppState) SetConnection(c Connection) (map[string]Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connections[c.Alias] = c
	return maps.Clone(s.connections), s.saveLocked()
}

// DeleteConnection removes an alias and returns the new snapshot.
func (s *AppState) DeleteConnection(alias string) (map[string]Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.connections, alias)
	return maps.Clone(s.connections), s.saveLocked()
}

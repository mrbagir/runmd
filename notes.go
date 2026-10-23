package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

var (
	errInvalidName = errors.New("nama note tidak valid")
	errNoteMissing = errors.New("note tidak ditemukan")
)

// notePath maps a user-supplied note name to a path inside notesDir.
// Cleaning against a virtual root ("/") makes "../" segments harmless, so a
// name can never escape the notes directory.
func (s *AppState) notePath(name string) (full, rel string, err error) {
	rel = strings.TrimPrefix(filepath.Clean("/"+filepath.ToSlash(name)), "/")
	rel = strings.TrimSuffix(rel, ".md")
	if rel == "" {
		return "", "", errInvalidName
	}
	rel += ".md"
	return filepath.Join(s.notesDir, rel), rel, nil
}

// walkNotes calls fn for every readable .md file under notesDir. id is the
// note ID (slash-separated, without ".md").
func (s *AppState) walkNotes(fn func(id string, raw []byte)) {
	_ = filepath.WalkDir(s.notesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		rel, err := filepath.Rel(s.notesDir, path)
		if err != nil {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		fn(noteID(rel), raw)
		return nil
	})
}

// ListNotes returns every note, fully parsed.
func (s *AppState) ListNotes() []Note {
	notes := []Note{}
	s.walkNotes(func(id string, raw []byte) {
		notes = append(notes, ParseNote(id, string(raw)))
	})
	return notes
}

// FindNote loads a note by its path or, failing that, by its bare file name
// anywhere in the tree (Obsidian-style link resolution).
func (s *AppState) FindNote(name string) (Note, error) {
	id := noteID(name)
	if full, _, err := s.notePath(id); err == nil {
		if raw, err := os.ReadFile(full); err == nil {
			return ParseNote(id, string(raw)), nil
		}
	}

	var found *Note
	base := filepath.Base(id)
	s.walkNotes(func(candidate string, raw []byte) {
		if found == nil && (candidate == id || filepath.Base(candidate) == base) {
			n := ParseNote(candidate, string(raw))
			found = &n
		}
	})
	if found == nil {
		return Note{}, fmt.Errorf("%w: %q di folder %s", errNoteMissing, name, s.notesDir)
	}
	return *found, nil
}

// SaveNote creates or overwrites a note.
func (s *AppState) SaveNote(name, content string) (Note, error) {
	full, rel, err := s.notePath(name)
	if err != nil {
		return Note{}, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return Note{}, err
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		return Note{}, err
	}
	return ParseNote(rel, content), nil
}

// DeleteNote removes a note; it returns the relative file name that was
// targeted. Deleting a note that is already gone is not an error.
func (s *AppState) DeleteNote(name string) (string, error) {
	full, rel, err := s.notePath(name)
	if err != nil {
		return "", err
	}
	if err := os.Remove(full); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	return rel, nil
}

// RenameNote moves a note (creating destination folders as needed).
func (s *AppState) RenameNote(oldName, newName string) (Note, error) {
	oldFull, _, err := s.notePath(oldName)
	if err != nil {
		return Note{}, err
	}
	newFull, newRel, err := s.notePath(newName)
	if err != nil {
		return Note{}, err
	}
	if _, err := os.Stat(oldFull); errors.Is(err, fs.ErrNotExist) {
		return Note{}, errNoteMissing
	}
	if err := os.MkdirAll(filepath.Dir(newFull), 0o755); err != nil {
		return Note{}, err
	}
	if err := os.Rename(oldFull, newFull); err != nil {
		return Note{}, err
	}
	raw, _ := os.ReadFile(newFull)
	return ParseNote(newRel, string(raw)), nil
}

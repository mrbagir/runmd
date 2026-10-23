package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseNote(t *testing.T) {
	content := "# T\nSee [[a]], [[b|alias]], [[a]], [[self]] and [[dir/c#h]].\n\n" +
		"```sql @conn=pg @assert=\"contains:X Y\"\nSELECT 1;\n```\n\n" +
		"```sh\necho hi\n```\n"

	n := ParseNote("./self.md", content)

	if n.Name != "self" {
		t.Errorf("Name = %q, want self", n.Name)
	}
	if want := []string{"a", "b", "dir/c"}; !reflect.DeepEqual(n.Links, want) {
		t.Errorf("Links = %v, want %v", n.Links, want)
	}
	if want := []string{"pg"}; !reflect.DeepEqual(n.UsedConns, want) {
		t.Errorf("UsedConns = %v, want %v", n.UsedConns, want)
	}
	if len(n.CodeBlocks) != 2 {
		t.Fatalf("CodeBlocks = %d, want 2", len(n.CodeBlocks))
	}
	if b := n.CodeBlocks[0]; b.Lang != "sql" || b.Conn != "pg" || b.Assert != "contains:X Y" || b.Code != "SELECT 1;" {
		t.Errorf("block 0 = %+v", b)
	}
}

func TestEvaluateAssertion(t *testing.T) {
	tests := []struct {
		rule, out string
		ok        bool
		want      bool
	}{
		{"", "x", true, true},
		{"contains:foo", "a foo b", true, true},
		{"contains:foo", "bar", true, false},
		{"not_contains:foo", "bar", true, true},
		{"not_contains:foo", "foo", true, false},
		{"status == 200", "HTTP/2 200", true, true},
		{"status == 200", "HTTP/2 500", true, false},
		{"rows > 0", "(2 rows)", true, true},
		{"rows > 0", "(0 rows)", true, false},
		{"rows > 0", "(1 row)", true, true},
		{"exit_code == 0", "", true, true},
		{"unknown rule", "x", true, false}, // typos must not pass silently
		{"contains:foo", "foo", false, false},
	}
	for _, tc := range tests {
		if got, _ := evaluateAssertion(tc.rule, tc.out, tc.ok); got != tc.want {
			t.Errorf("evaluateAssertion(%q, %q, %v) = %v, want %v", tc.rule, tc.out, tc.ok, got, tc.want)
		}
	}
}

func newTestState(t *testing.T) *AppState {
	t.Helper()
	dir := t.TempDir()
	s, err := NewAppState(filepath.Join(dir, "notes"), filepath.Join(dir, "conn.json"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNotePathCannotEscape(t *testing.T) {
	s := newTestState(t)
	for _, name := range []string{"../../etc/passwd", "/abs/../../x", "a/../../b"} {
		full, _, err := s.notePath(name)
		if err != nil {
			t.Fatalf("notePath(%q): %v", name, err)
		}
		if rel, err := filepath.Rel(s.notesDir, full); err != nil || rel == ".." || len(rel) > 2 && rel[:3] == "../" {
			t.Errorf("notePath(%q) escaped notes dir: %s", name, full)
		}
	}
	if _, _, err := s.notePath(".md"); err == nil {
		t.Error("empty name should be rejected")
	}
}

func TestNoteLifecycleAndGraph(t *testing.T) {
	s := newTestState(t)

	if _, err := s.SaveNote("dir/one", "[[two]] [[ghost]]\n```sh @conn=pg_order\ntrue\n```"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveNote("two", "hi"); err != nil {
		t.Fatal(err)
	}

	// Lookup by bare file name works like an Obsidian link.
	if n, err := s.FindNote("one"); err != nil || n.Name != "dir/one" {
		t.Fatalf("FindNote(one) = %v, %v", n.Name, err)
	}

	g := s.BuildGraph()
	groups := map[string]int{}
	for _, n := range g.Nodes {
		groups[n.Group]++
	}
	if groups["note"] != 2 || groups["unresolved"] != 1 || groups["connection"] < 1 {
		t.Errorf("unexpected node groups: %v", groups)
	}

	if _, err := s.RenameNote("two", "moved/two"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteNote("moved/two"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.FindNote("moved/two"); err == nil {
		t.Error("note should be gone after delete")
	}
}

func TestRunNoteTest(t *testing.T) {
	s := newTestState(t)
	_, _ = s.SaveNote("ok", "```sh @assert=\"contains:hi\"\necho hi\n```")
	_, _ = s.SaveNote("bad", "```sh @assert=\"contains:nope\"\necho hi\n```")

	if r, err := s.RunNoteTest("ok"); err != nil || !r.AllPassed || r.TotalBlocks != 1 {
		t.Errorf("ok report = %+v, %v", r, err)
	}
	if r, err := s.RunNoteTest("bad"); err != nil || r.AllPassed {
		t.Errorf("bad report = %+v, %v", r, err)
	}
	if _, err := s.RunNoteTest("missing"); err == nil {
		t.Error("missing note should error")
	}
}

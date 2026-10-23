package main

import (
	"path/filepath"
	"regexp"
	"strings"
)

var (
	wikiLinkRegex  = regexp.MustCompile(`\[\[([^\|\]#]+)(?:#[^\|\]]+)?(?:\|([^\]]+))?\]\]`)
	codeBlockRegex = regexp.MustCompile("(?s)```([a-zA-Z0-9_-]+)([^\n]*)\n(.*?)```")
	metaAttrRegex  = regexp.MustCompile(`@([a-zA-Z0-9_-]+)=("([^"]*)"|([^\s]+))`)
)

// noteID turns a file path or user-supplied name into the canonical note ID:
// forward slashes, no leading "./" or "/", no ".md" suffix.
func noteID(name string) string {
	id := filepath.ToSlash(name)
	id = strings.TrimPrefix(id, "./")
	id = strings.TrimPrefix(id, "/")
	return strings.TrimSuffix(id, ".md")
}

// ParseNote extracts [[wikilinks]], fenced code blocks and their @meta
// attributes (@conn, @assert, ...) from Markdown content.
func ParseNote(name, content string) Note {
	id := noteID(name)
	note := Note{
		Name:       id,
		Content:    content,
		Links:      []string{},
		UsedConns:  []string{},
		CodeBlocks: []CodeBlock{},
	}

	// 1. [[wikilinks]] (deduplicated, no self-links)
	seenLinks := make(map[string]bool)
	for _, m := range wikiLinkRegex.FindAllStringSubmatch(content, -1) {
		target := strings.TrimSuffix(strings.TrimSpace(m[1]), ".md")
		if target != "" && target != id && !seenLinks[target] {
			seenLinks[target] = true
			note.Links = append(note.Links, target)
		}
	}

	// 2. Code blocks and their metadata
	seenConns := make(map[string]bool)
	for idx, m := range codeBlockRegex.FindAllStringSubmatch(content, -1) {
		meta := parseMeta(m[2])

		if conn := meta["conn"]; conn != "" && !seenConns[conn] {
			seenConns[conn] = true
			note.UsedConns = append(note.UsedConns, conn)
		}

		note.CodeBlocks = append(note.CodeBlocks, CodeBlock{
			Index:  idx,
			Lang:   strings.ToLower(strings.TrimSpace(m[1])),
			Conn:   meta["conn"],
			Assert: meta["assert"],
			Meta:   meta,
			Code:   strings.TrimSpace(m[3]),
		})
	}

	return note
}

// parseMeta reads `@key=value` / `@key="quoted value"` pairs from a fence
// info string.
func parseMeta(header string) map[string]string {
	meta := make(map[string]string)
	for _, attr := range metaAttrRegex.FindAllStringSubmatch(header, -1) {
		val := attr[3]
		if val == "" {
			val = attr[4]
		}
		meta[attr[1]] = val
	}
	return meta
}

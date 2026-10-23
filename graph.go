package main

import (
	"path/filepath"
	"strings"
)

// BuildGraph links notes to each other ([[wikilinks]]) and to the connection
// aliases they use (@conn). Links that point nowhere become "unresolved"
// nodes, as in Obsidian.
func (s *AppState) BuildGraph() GraphData {
	nodes := make(map[string]GraphNode)
	degree := make(map[string]int)
	edges := []GraphEdge{}

	addConnNode := func(alias string) string {
		id := "conn:" + alias
		if _, ok := nodes[id]; !ok {
			nodes[id] = GraphNode{ID: id, Label: alias, Group: "connection"}
		}
		return id
	}
	link := func(from, to, label string) {
		edges = append(edges, GraphEdge{From: from, To: to, Label: label})
		degree[from]++
		degree[to]++
	}

	for alias := range s.Connections() {
		addConnNode(alias)
	}

	// 1. Scan notes; index them by full ID and by bare file name.
	notes := s.ListNotes()
	byName := make(map[string]string, len(notes)*2)
	for _, n := range notes {
		byName[n.Name] = n.Name
		byName[filepath.Base(n.Name)] = n.Name
		nodes[n.Name] = GraphNode{
			ID:    n.Name,
			Label: filepath.Base(n.Name),
			Path:  n.Name,
			Group: "note",
		}
	}

	// 2. Resolve links and connection usage.
	for _, n := range notes {
		for _, target := range n.Links {
			target = strings.TrimSuffix(filepath.ToSlash(target), ".md")

			resolved, ok := byName[target]
			if !ok {
				resolved, ok = byName[filepath.Base(target)]
			}
			if !ok {
				resolved = target
				if _, exists := nodes[target]; !exists {
					nodes[target] = GraphNode{
						ID:         target,
						Label:      filepath.Base(target),
						Group:      "unresolved",
						Unresolved: true,
					}
				}
			}
			link(n.Name, resolved, "wikilink")
		}

		for _, alias := range n.UsedConns {
			link(n.Name, addConnNode(alias), "uses")
		}
	}

	// 3. Assemble nodes with their computed degree.
	out := make([]GraphNode, 0, len(nodes))
	for id, node := range nodes {
		node.LinkCount = degree[id]
		out = append(out, node)
	}
	return GraphData{Nodes: out, Edges: edges}
}

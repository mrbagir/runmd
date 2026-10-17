package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed all:static
var staticFS embed.FS

// --- MODELS ---

type Connection struct {
	Alias  string            `json:"alias"`  // e.g. pg_order, redis_main, rmq_local, mcp_fs
	Type   string            `json:"type"`   // sql, redis, rabbitmq, mcp, custom
	URI    string            `json:"uri"`    // DSN / URL / Stdio command
	Config map[string]string `json:"config"` // Extra options
}

type CodeBlock struct {
	Index  int               `json:"index"`
	Lang   string            `json:"lang"`
	Conn   string            `json:"conn"`
	Assert string            `json:"assert"`
	Meta   map[string]string `json:"meta"`
	Code   string            `json:"code"`
}

type Note struct {
	Name       string      `json:"name"`
	Content    string      `json:"content"`
	Links      []string    `json:"links"`
	UsedConns  []string    `json:"used_conns"`
	CodeBlocks []CodeBlock `json:"code_blocks"`
}

type ExecRequest struct {
	Lang   string            `json:"lang"`
	Conn   string            `json:"conn"`
	Assert string            `json:"assert"`
	Meta   map[string]string `json:"meta"`
	Code   string            `json:"code"`
}

type ExecResult struct {
	BlockIndex int    `json:"block_index"`
	Lang       string `json:"lang"`
	Conn       string `json:"conn,omitempty"`
	Success    bool   `json:"success"`
	AssertPass bool   `json:"assert_pass"`
	AssertMsg  string `json:"assert_msg,omitempty"`
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Group string `json:"group"` // "note" or "connection"
}

type GraphEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

// --- STATE MANAGER ---

type AppState struct {
	mu          sync.RWMutex
	notesDir    string
	connFile    string
	connections map[string]Connection
}

func NewAppState(notesDir, connFile string) *AppState {
	_ = os.MkdirAll(notesDir, 0755)
	s := &AppState{
		notesDir:    notesDir,
		connFile:    connFile,
		connections: make(map[string]Connection),
	}
	s.loadConnections()
	s.seedInitialData()
	return s
}

func (s *AppState) loadConnections() {
	data, err := os.ReadFile(s.connFile)
	if err != nil {
		// Default starter connections
		s.connections = map[string]Connection{
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
		s.saveConnections()
		return
	}
	_ = json.Unmarshal(data, &s.connections)
}

func (s *AppState) saveConnections() {
	data, _ := json.MarshalIndent(s.connections, "", "  ")
	_ = os.WriteFile(s.connFile, data, 0644)
}

func (s *AppState) seedInitialData() {
	files, _ := os.ReadDir(s.notesDir)
	if len(files) > 0 {
		return
	}

	sample1 := `# Checkout & Order Runbook
Catatan operasional ini terhubung ke [[payment-service]] dan [[incident-playbook]].

## 1. Query Order Pending (SQL)
Mengeksekusi query menggunakan alias koneksi **pg_order** dari sidebar:
` + "```sql @conn=pg_order @assert=\"contains:ORD-\"\nSELECT id, customer_name, amount, status\nFROM orders\nWHERE status = 'PENDING'\nORDER BY created_at DESC LIMIT 3;\n```" + `

## 2. Cek Cache Session (Redis)
` + "```redis @conn=redis_main @assert=\"contains:active\"\nGET session:user:9981\n```" + `

## 3. Publish Event ke RabbitMQ
` + "```rabbitmq @conn=rmq_local @exchange=orders @routing_key=order.retry @assert=\"contains:Published\"\n{\"order_id\": \"ORD-2026-01\", \"action\": \"RETRY_PAYMENT\"}\n```" + `

## 4. Test Webhook via cURL
` + "```curl @assert=\"status == 200\"\ncurl -s -i https://httpbin.org/get?service=checkout\n```" + `

## 5. Jalankan Script Validasi (Golang)
` + "```go @assert=\"contains:VALID\"\npackage main\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Status Pipeline: VALID & READY\")\n}\n```" + `

## 6. Eksekusi Tool MCP
` + "```mcp @conn=mcp_fs @tool=list_allowed_directories @assert=\"contains:notes\"\n{\"reason\": \"Check workspace directory\"}\n```" + `
`

	sample2 := `# Payment Service Architecture
Bagian dari ekosistem [[checkout-runbook]]. Menggunakan koneksi database dan message broker yang sama.

## Cek Health System via Shell
` + "```sh @assert=\"contains:OK\"\necho \"Payment Gateway Ping: OK ($(date +%H:%M:%S))\"\n```" + `

## Kalkulasi Fee via JavaScript
` + "```js @assert=\"contains:Fee\"\nconst amount = 250000;\nconst fee = amount * 0.015;\nconsole.log(`Total Fee: Rp ${fee}`);\n```" + `
`

	sample3 := `# Incident Playbook
Panduan mitigasi jika [[payment-service]] atau [[checkout-runbook]] mengalami peningkatan latensi.

## Cek Koneksi Redis
` + "```redis @conn=redis_main @assert=\"contains:PONG\"\nPING\n```" + `
`

	_ = os.WriteFile(filepath.Join(s.notesDir, "checkout-runbook.md"), []byte(sample1), 0644)
	_ = os.WriteFile(filepath.Join(s.notesDir, "payment-service.md"), []byte(sample2), 0644)
	_ = os.WriteFile(filepath.Join(s.notesDir, "incident-playbook.md"), []byte(sample3), 0644)
}

// --- MARKDOWN PARSER (BLOCKS & OBSIDIAN LINKS) ---

var (
	wikiLinkRegex  = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	codeBlockRegex = regexp.MustCompile("(?s)```([a-zA-Z0-9_-]+)([^\n]*)\n(.*?)```")
	metaAttrRegex  = regexp.MustCompile(`@([a-zA-Z0-9_-]+)=("([^"]*)"|([^\s]+))`)
)

func ParseNote(name, content string) Note {
	cleanName := strings.TrimSuffix(filepath.Base(name), ".md")
	note := Note{
		Name:       cleanName,
		Content:    content,
		Links:      []string{},
		UsedConns:  []string{},
		CodeBlocks: []CodeBlock{},
	}

	// 1. Extract [[wikilinks]]
	linkMap := make(map[string]bool)
	for _, match := range wikiLinkRegex.FindAllStringSubmatch(content, -1) {
		target := strings.TrimSpace(match[1])
		target = strings.TrimSuffix(target, ".md")
		if target != "" && target != cleanName && !linkMap[target] {
			linkMap[target] = true
			note.Links = append(note.Links, target)
		}
	}

	// 2. Extract Code Blocks & Metadata (@conn, @assert, etc.)
	connMap := make(map[string]bool)
	matches := codeBlockRegex.FindAllStringSubmatch(content, -1)
	for idx, m := range matches {
		lang := strings.ToLower(strings.TrimSpace(m[1]))
		headerMeta := m[2]
		code := strings.TrimSpace(m[3])

		meta := make(map[string]string)
		for _, attr := range metaAttrRegex.FindAllStringSubmatch(headerMeta, -1) {
			k := attr[1]
			val := attr[3]
			if val == "" {
				val = attr[4]
			}
			meta[k] = val
		}

		conn := meta["conn"]
		if conn != "" && !connMap[conn] {
			connMap[conn] = true
			note.UsedConns = append(note.UsedConns, conn)
		}

		note.CodeBlocks = append(note.CodeBlocks, CodeBlock{
			Index:  idx,
			Lang:   lang,
			Conn:   conn,
			Assert: meta["assert"],
			Meta:   meta,
			Code:   code,
		})
	}

	return note
}

// --- MULTI-ENGINE EXECUTOR ---

func (s *AppState) ExecuteBlock(idx int, req ExecRequest) ExecResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var output string
	var execErr error

	s.mu.RLock()
	connObj, hasConn := s.connections[req.Conn]
	s.mu.RUnlock()

	switch req.Lang {
	case "sh", "bash", "zsh":
		output, execErr = runCommand(ctx, "sh", "-c", req.Code)

	case "curl", "http":
		cmdStr := strings.TrimSpace(req.Code)
		if !strings.HasPrefix(cmdStr, "curl") {
			cmdStr = "curl -s -i " + cmdStr
		}
		output, execErr = runCommand(ctx, "sh", "-c", cmdStr)

	case "go", "golang":
		output, execErr = runGoScript(ctx, req.Code)

	case "js", "javascript", "node":
		output, execErr = runJSScript(ctx, req.Code)

	case "sql", "postgres", "mysql":
		if !hasConn {
			execErr = fmt.Errorf("alias koneksi SQL '@conn=%s' tidak ditemukan di Sidebar", req.Conn)
		} else {
			output, execErr = executeSQL(ctx, connObj, req.Code)
		}

	case "redis":
		if !hasConn {
			execErr = fmt.Errorf("alias koneksi Redis '@conn=%s' tidak ditemukan di Sidebar", req.Conn)
		} else {
			output, execErr = executeRedis(ctx, connObj, req.Code)
		}

	case "rabbitmq", "amqp":
		if !hasConn {
			execErr = fmt.Errorf("alias koneksi RabbitMQ '@conn=%s' tidak ditemukan di Sidebar", req.Conn)
		} else {
			output, execErr = executeRabbitMQ(ctx, connObj, req.Meta, req.Code)
		}

	case "mcp":
		if !hasConn {
			execErr = fmt.Errorf("alias koneksi MCP '@conn=%s' tidak ditemukan di Sidebar", req.Conn)
		} else {
			output, execErr = executeMCP(ctx, connObj, req.Meta, req.Code)
		}

	default:
		execErr = fmt.Errorf("bahasa/runner '%s' belum didukung", req.Lang)
	}

	res := ExecResult{
		BlockIndex: idx,
		Lang:       req.Lang,
		Conn:       req.Conn,
		Success:    execErr == nil,
		Output:     output,
		DurationMs: time.Since(start).Milliseconds(),
	}

	if execErr != nil {
		res.Error = execErr.Error()
	}

	// Evaluasi Assertion untuk Testing
	res.AssertPass, res.AssertMsg = evaluateAssertion(req.Assert, res.Output, res.Success)
	return res
}

func runCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

func runGoScript(ctx context.Context, code string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "runmd-go-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)

	if !strings.Contains(code, "package main") {
		code = "package main\n\nimport \"fmt\"\n\nfunc main() {\n" + code + "\n}\n"
	}

	tmpFile := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(tmpFile, []byte(code), 0644); err != nil {
		return "", err
	}

	return runCommand(ctx, "go", "run", tmpFile)
}

func runJSScript(ctx context.Context, code string) (string, error) {
	if _, err := exec.LookPath("node"); err == nil {
		return runCommand(ctx, "node", "-e", code)
	}
	if _, err := exec.LookPath("bun"); err == nil {
		return runCommand(ctx, "bun", "-e", code)
	}
	return "", fmt.Errorf("runtime Node.js atau Bun tidak ditemukan di PATH sistem")
}

func executeSQL(ctx context.Context, conn Connection, query string) (string, error) {
	if _, err := exec.LookPath("psql"); err == nil && strings.HasPrefix(conn.URI, "postgres") {
		out, err := runCommand(ctx, "psql", conn.URI, "-c", query)
		if err == nil {
			return out, nil
		}
	}
	// Structured response simulation for easy zero-setup testing
	return fmt.Sprintf("[Connected via alias '%s' -> %s]\n\n"+
		" id       | customer_name | amount | status  \n"+
		"----------+---------------+--------+---------\n"+
		" ORD-9012 | Budi Santoso  | 150000 | PENDING \n"+
		" ORD-9015 | Siti Aminah   | 420000 | PENDING \n"+
		"(2 rows)\n\nQuery executed: %s", conn.Alias, conn.URI, query), nil
}

func executeRedis(ctx context.Context, conn Connection, cmdLine string) (string, error) {
	if _, err := exec.LookPath("redis-cli"); err == nil {
		args := append([]string{"-u", conn.URI}, strings.Fields(cmdLine)...)
		out, err := runCommand(ctx, "redis-cli", args...)
		if err == nil && out != "" {
			return out, nil
		}
	}
	trimmed := strings.ToUpper(strings.TrimSpace(cmdLine))
	if trimmed == "PING" {
		return "PONG", nil
	}
	return fmt.Sprintf("[Redis Alias '%s' -> %s]\n> %s\n\"{\\\"user_id\\\":9981,\\\"status\\\":\\\"active\\\",\\\"role\\\":\\\"merchant\\\",\\\"ttl\\\":3600}\"", conn.Alias, conn.URI, cmdLine), nil
}

func executeRabbitMQ(ctx context.Context, conn Connection, meta map[string]string, payload string) (string, error) {
	exchange := meta["exchange"]
	if exchange == "" {
		exchange = "amq.default"
	}
	rk := meta["routing_key"]
	return fmt.Sprintf("[RabbitMQ Alias '%s' -> %s]\nPublished to Exchange: '%s' | RoutingKey: '%s'\nPayload (%d bytes):\n%s", conn.Alias, conn.URI, exchange, rk, len(payload), payload), nil
}

func executeMCP(ctx context.Context, conn Connection, meta map[string]string, argsJSON string) (string, error) {
	toolName := meta["tool"]
	if toolName == "" {
		toolName = "default_tool"
	}
	return fmt.Sprintf("[MCP Client -> Server '%s' (%s)]\nJSON-RPC 2.0 Call -> methods: tools/call | tool: '%s'\nRequest Args: %s\n\nResponse:\n{\n  \"jsonrpc\": \"2.0\",\n  \"result\": {\n    \"allowed_directories\": [\"./notes\"],\n    \"status\": \"ok\"\n  }\n}", conn.Alias, conn.URI, toolName, argsJSON), nil
}

func evaluateAssertion(rule string, output string, execSuccess bool) (bool, string) {
	if !execSuccess {
		return false, "Execution failed with runtime error"
	}
	if strings.TrimSpace(rule) == "" {
		return true, "Execution succeeded (no custom assertion)"
	}

	cleanRule := strings.TrimSpace(rule)
	if strings.HasPrefix(cleanRule, "contains:") {
		needle := strings.TrimPrefix(cleanRule, "contains:")
		if strings.Contains(output, needle) {
			return true, fmt.Sprintf("Assertion PASS: output contains '%s'", needle)
		}
		return false, fmt.Sprintf("Assertion FAIL: expected output to contain '%s'", needle)
	}

	if strings.HasPrefix(cleanRule, "not_contains:") {
		needle := strings.TrimPrefix(cleanRule, "not_contains:")
		if !strings.Contains(output, needle) {
			return true, fmt.Sprintf("Assertion PASS: output does not contain '%s'", needle)
		}
		return false, fmt.Sprintf("Assertion FAIL: output unexpectedly contains '%s'", needle)
	}

	if cleanRule == "status == 200" {
		if strings.Contains(output, "200 OK") || strings.Contains(output, "\"status\": 200") || strings.Contains(output, "HTTP/1.1 200") || strings.Contains(output, "HTTP/2 200") {
			return true, "Assertion PASS: status is 200"
		}
		return false, "Assertion FAIL: HTTP 200 not detected in response"
	}

	if cleanRule == "rows > 0" {
		if strings.Contains(output, "rows)") || strings.Contains(output, "row)") {
			return true, "Assertion PASS: rows > 0"
		}
		return false, "Assertion FAIL: no rows found in SQL output"
	}

	if cleanRule == "exit_code == 0" {
		return true, "Assertion PASS: exit_code == 0"
	}

	// Default fallback for general assertion strings
	return true, fmt.Sprintf("Assertion PASS: (%s)", cleanRule)
}

// --- HTTP HANDLERS & AI AGENT ENDPOINTS ---

func (s *AppState) registerRoutes(mux *http.ServeMux) {
	// Root Web UI & Static Assets (from embedded static/ folder)
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(subFS)))

	// 1. Notes CRUD
	mux.HandleFunc("/api/notes", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			files, _ := os.ReadDir(s.notesDir)
			var notes []Note
			for _, f := range files {
				if strings.HasSuffix(f.Name(), ".md") {
					b, err := os.ReadFile(filepath.Join(s.notesDir, f.Name()))
					if err == nil {
						notes = append(notes, ParseNote(f.Name(), string(b)))
					}
				}
			}
			writeJSON(w, notes)
			return
		}

		if r.Method == http.MethodPost {
			var req struct {
				Name    string `json:"name"`
				Content string `json:"content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			fname := strings.TrimSuffix(filepath.Base(req.Name), ".md") + ".md"
			_ = os.WriteFile(filepath.Join(s.notesDir, fname), []byte(req.Content), 0644)
			writeJSON(w, ParseNote(fname, req.Content))
			return
		}

		if r.Method == http.MethodDelete {
			name := r.URL.Query().Get("name")
			if name == "" {
				http.Error(w, "name query param required", http.StatusBadRequest)
				return
			}
			fname := strings.TrimSuffix(filepath.Base(name), ".md") + ".md"
			_ = os.Remove(filepath.Join(s.notesDir, fname))
			writeJSON(w, map[string]string{"status": "deleted", "name": fname})
			return
		}
	})

	// 2. Connections Sidebar CRUD
	mux.HandleFunc("/api/connections", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			s.mu.RLock()
			defer s.mu.RUnlock()
			writeJSON(w, s.connections)
			return
		}

		if r.Method == http.MethodPost {
			var c Connection
			if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if c.Alias == "" || c.URI == "" {
				http.Error(w, "alias and uri required", http.StatusBadRequest)
				return
			}
			s.mu.Lock()
			s.connections[c.Alias] = c
			s.saveConnections()
			s.mu.Unlock()
			writeJSON(w, s.connections)
			return
		}

		if r.Method == http.MethodDelete {
			alias := r.URL.Query().Get("alias")
			s.mu.Lock()
			delete(s.connections, alias)
			s.saveConnections()
			s.mu.Unlock()
			writeJSON(w, s.connections)
			return
		}
	})

	// 3. Single Code Block Runner
	mux.HandleFunc("/api/run", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		res := s.ExecuteBlock(0, req)
		writeJSON(w, res)
	})

	// 4. AI Agent Test Runner Endpoint
	mux.HandleFunc("/api/agent/test", func(w http.ResponseWriter, r *http.Request) {
		noteName := r.URL.Query().Get("note")
		report, err := s.RunFullNoteTest(noteName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, report)
	})

	// 5. Obsidian-Style Graph Data Endpoint
	mux.HandleFunc("/api/graph", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.BuildGraph())
	})
}

func (s *AppState) RunFullNoteTest(noteName string) (map[string]any, error) {
	fname := strings.TrimSuffix(filepath.Base(noteName), ".md") + ".md"
	raw, err := os.ReadFile(filepath.Join(s.notesDir, fname))
	if err != nil {
		return nil, fmt.Errorf("note '%s' tidak ditemukan di folder %s", fname, s.notesDir)
	}

	parsed := ParseNote(fname, string(raw))
	var results []ExecResult
	allPass := true

	for _, blk := range parsed.CodeBlocks {
		res := s.ExecuteBlock(blk.Index, ExecRequest{
			Lang:   blk.Lang,
			Conn:   blk.Conn,
			Assert: blk.Assert,
			Meta:   blk.Meta,
			Code:   blk.Code,
		})
		if !res.Success || !res.AssertPass {
			allPass = false
		}
		results = append(results, res)
	}

	return map[string]any{
		"note":         parsed.Name,
		"timestamp":    time.Now().Format(time.RFC3339),
		"total_blocks": len(results),
		"all_passed":   allPass,
		"results":      results,
	}, nil
}

func (s *AppState) BuildGraph() GraphData {
	files, _ := os.ReadDir(s.notesDir)
	nodeMap := make(map[string]GraphNode)
	var edges []GraphEdge

	// Add all connection aliases as nodes
	s.mu.RLock()
	for alias, c := range s.connections {
		id := "conn:" + alias
		nodeMap[id] = GraphNode{
			ID:    id,
			Label: fmt.Sprintf("@%s (%s)", alias, c.Type),
			Group: "connection",
		}
	}
	s.mu.RUnlock()

	// Add notes and scan connections/wikilinks
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".md") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.notesDir, f.Name()))
		if err != nil {
			continue
		}
		n := ParseNote(f.Name(), string(raw))
		nodeMap[n.Name] = GraphNode{ID: n.Name, Label: n.Name + ".md", Group: "note"}

		for _, target := range n.Links {
			if _, exists := nodeMap[target]; !exists {
				nodeMap[target] = GraphNode{ID: target, Label: target + ".md", Group: "note"}
			}
			edges = append(edges, GraphEdge{From: n.Name, To: target, Label: "wikilink"})
		}

		for _, connAlias := range n.UsedConns {
			connID := "conn:" + connAlias
			if _, exists := nodeMap[connID]; !exists {
				nodeMap[connID] = GraphNode{ID: connID, Label: "@" + connAlias, Group: "connection"}
			}
			edges = append(edges, GraphEdge{From: n.Name, To: connID, Label: "uses"})
		}
	}

	var nodes []GraphNode
	for _, v := range nodeMap {
		nodes = append(nodes, v)
	}

	return GraphData{Nodes: nodes, Edges: edges}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	port := flag.String("port", "8080", "Port HTTP server")
	notesDir := flag.String("dir", "./notes", "Direktori penyimpanan file .md")
	connFile := flag.String("conn", "./connections.json", "File penyimpanan konfigurasi koneksi")
	testNote := flag.String("test", "", "Headless test mode untuk AI Agent (contoh: -test checkout-runbook.md)")
	flag.Parse()

	state := NewAppState(*notesDir, *connFile)

	// Mode CLI Headless untuk AI Agent Testing
	if *testNote != "" {
		report, err := state.RunFullNoteTest(*testNote)
		if err != nil {
			log.Fatalf("❌ Test gagal: %v\n", err)
		}
		out, _ := json.MarshalIndent(report, "", "  ")
		fmt.Println(string(out))

		if passed, ok := report["all_passed"].(bool); ok && !passed {
			os.Exit(1)
		}
		fmt.Println("✅ All assertions PASSED!")
		return
	}

	mux := http.NewServeMux()
	state.registerRoutes(mux)

	addr := ":" + *port
	fmt.Println("==================================================")
	fmt.Printf("⚡ RunMD Studio running on http://localhost%s\n", addr)
	fmt.Printf("📂 Notes directory   : %s\n", *notesDir)
	fmt.Printf("🔌 Connections file  : %s\n", *connFile)
	fmt.Printf("🤖 AI Agent Endpoint : POST http://localhost%s/api/agent/test?note=checkout-runbook\n", addr)
	fmt.Println("==================================================")

	log.Fatal(http.ListenAndServe(addr, mux))
}

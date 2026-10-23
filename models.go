package main

// Connection is a named, reusable endpoint (database, broker, MCP server...)
// referenced from code blocks with `@conn=<alias>`.
type Connection struct {
	Alias  string            `json:"alias"`  // e.g. pg_order, redis_main, rmq_local, mcp_fs
	Type   string            `json:"type"`   // sql, redis, rabbitmq, mcp, custom
	URI    string            `json:"uri"`    // DSN / URL / stdio command
	Config map[string]string `json:"config"` // extra options
}

// CodeBlock is one fenced block extracted from a note.
type CodeBlock struct {
	Index  int               `json:"index"`
	Lang   string            `json:"lang"`
	Conn   string            `json:"conn"`
	Assert string            `json:"assert"`
	Meta   map[string]string `json:"meta"`
	Code   string            `json:"code"`
}

// Note is a parsed Markdown file.
type Note struct {
	Name       string      `json:"name"`
	Content    string      `json:"content"`
	Links      []string    `json:"links"`
	UsedConns  []string    `json:"used_conns"`
	CodeBlocks []CodeBlock `json:"code_blocks"`
}

// ExecRequest asks the executor to run a single code block.
type ExecRequest struct {
	Lang   string            `json:"lang"`
	Conn   string            `json:"conn"`
	Assert string            `json:"assert"`
	Meta   map[string]string `json:"meta"`
	Code   string            `json:"code"`
}

// ExecResult is the outcome of running a single code block.
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

// TestReport is the result of running every block of a note (CLI -test and
// /api/agent/test).
type TestReport struct {
	Note        string       `json:"note"`
	Timestamp   string       `json:"timestamp"`
	TotalBlocks int          `json:"total_blocks"`
	AllPassed   bool         `json:"all_passed"`
	Results     []ExecResult `json:"results"`
}

// GraphData is the knowledge-graph payload served to the UI.
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Path       string `json:"path,omitempty"`
	Group      string `json:"group"` // "note", "connection", "unresolved"
	LinkCount  int    `json:"link_count"`
	Unresolved bool   `json:"unresolved,omitempty"`
}

type GraphEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

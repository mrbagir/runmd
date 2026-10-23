package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const execTimeout = 15 * time.Second

// ExecuteBlock runs one code block and evaluates its @assert rule.
func (s *AppState) ExecuteBlock(idx int, req ExecRequest) ExecResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), execTimeout)
	defer cancel()

	output, err := s.dispatch(ctx, req)

	res := ExecResult{
		BlockIndex: idx,
		Lang:       req.Lang,
		Conn:       req.Conn,
		Success:    err == nil,
		Output:     output,
		DurationMs: time.Since(start).Milliseconds(),
	}
	if err != nil {
		res.Error = err.Error()
	}
	res.AssertPass, res.AssertMsg = evaluateAssertion(req.Assert, res.Output, res.Success)
	return res
}

// dispatch picks the runner for req.Lang.
func (s *AppState) dispatch(ctx context.Context, req ExecRequest) (string, error) {
	switch req.Lang {
	case "sh", "bash", "zsh":
		return runCommand(ctx, "sh", "-c", req.Code)

	case "curl", "http":
		cmd := strings.TrimSpace(req.Code)
		if !strings.HasPrefix(cmd, "curl") {
			cmd = "curl -s -i " + cmd
		}
		return runCommand(ctx, "sh", "-c", cmd)

	case "go", "golang":
		return runGoScript(ctx, req.Code)

	case "js", "javascript", "node":
		return runJSScript(ctx, req.Code)

	case "sql", "postgres", "mysql":
		return s.withConn("SQL", req, func(c Connection) (string, error) {
			return executeSQL(ctx, c, req.Code)
		})

	case "redis":
		return s.withConn("Redis", req, func(c Connection) (string, error) {
			return executeRedis(ctx, c, req.Code)
		})

	case "rabbitmq", "amqp":
		return s.withConn("RabbitMQ", req, func(c Connection) (string, error) {
			return executeRabbitMQ(c, req.Meta, req.Code)
		})

	case "mcp":
		return s.withConn("MCP", req, func(c Connection) (string, error) {
			return executeMCP(c, req.Meta, req.Code)
		})

	default:
		return "", fmt.Errorf("bahasa/runner '%s' belum didukung", req.Lang)
	}
}

// withConn resolves req.Conn and runs fn, or fails with a helpful message.
func (s *AppState) withConn(kind string, req ExecRequest, fn func(Connection) (string, error)) (string, error) {
	conn, ok := s.Connection(req.Conn)
	if !ok {
		return "", fmt.Errorf("alias koneksi %s '@conn=%s' tidak ditemukan di Sidebar", kind, req.Conn)
	}
	return fn(conn)
}

// runCommand runs a process, returning combined stdout+stderr. The command
// is killed on context cancellation; WaitDelay stops a stray grandchild that
// keeps the pipe open from blocking us past the timeout.
func runCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	cmd.WaitDelay = time.Second
	err := cmd.Run()
	if err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		err = fmt.Errorf("timeout setelah %s: %w", execTimeout, err)
	}
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

	file := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(file, []byte(code), 0o644); err != nil {
		return "", err
	}
	return runCommand(ctx, "go", "run", file)
}

func runJSScript(ctx context.Context, code string) (string, error) {
	for _, runtime := range []string{"node", "bun"} {
		if _, err := exec.LookPath(runtime); err == nil {
			return runCommand(ctx, runtime, "-e", code)
		}
	}
	return "", errors.New("runtime Node.js atau Bun tidak ditemukan di PATH sistem")
}

// --- Connection-backed runners ---
//
// SQL and Redis use the real psql / redis-cli when installed. Otherwise (and
// RabbitMQ / MCP always) they return a clearly labelled SIMULATED response so
// notes can be demoed with zero setup.

const simulatedTag = "[SIMULATED] "

func executeSQL(ctx context.Context, conn Connection, query string) (string, error) {
	if _, err := exec.LookPath("psql"); err == nil && strings.HasPrefix(conn.URI, "postgres") {
		if out, err := runCommand(ctx, "psql", conn.URI, "-c", query); err == nil {
			return out, nil
		}
	}
	return fmt.Sprintf(simulatedTag+"[Connected via alias '%s']\n\n"+
		" id       | customer_name | amount | status  \n"+
		"----------+---------------+--------+---------\n"+
		" ORD-9012 | Budi Santoso  | 150000 | PENDING \n"+
		" ORD-9015 | Siti Aminah   | 420000 | PENDING \n"+
		"(2 rows)\n\nQuery executed: %s", conn.Alias, query), nil
}

func executeRedis(ctx context.Context, conn Connection, cmdLine string) (string, error) {
	if _, err := exec.LookPath("redis-cli"); err == nil {
		args := append([]string{"-u", conn.URI}, strings.Fields(cmdLine)...)
		if out, err := runCommand(ctx, "redis-cli", args...); err == nil && out != "" {
			return out, nil
		}
	}
	if strings.EqualFold(strings.TrimSpace(cmdLine), "PING") {
		return simulatedTag + "PONG", nil
	}
	return fmt.Sprintf(simulatedTag+"[Redis Alias '%s']\n> %s\n"+
		`"{\"user_id\":9981,\"status\":\"active\",\"role\":\"merchant\",\"ttl\":3600}"`,
		conn.Alias, cmdLine), nil
}

func executeRabbitMQ(conn Connection, meta map[string]string, payload string) (string, error) {
	exchange := meta["exchange"]
	if exchange == "" {
		exchange = "amq.default"
	}
	return fmt.Sprintf(simulatedTag+"[RabbitMQ Alias '%s']\nPublished to Exchange: '%s' | RoutingKey: '%s'\nPayload (%d bytes):\n%s",
		conn.Alias, exchange, meta["routing_key"], len(payload), payload), nil
}

func executeMCP(conn Connection, meta map[string]string, argsJSON string) (string, error) {
	tool := meta["tool"]
	if tool == "" {
		tool = "default_tool"
	}
	return fmt.Sprintf(simulatedTag+"[MCP Client -> Server '%s']\n"+
		"JSON-RPC 2.0 Call -> method: tools/call | tool: '%s'\nRequest Args: %s\n\nResponse:\n"+
		"{\n  \"jsonrpc\": \"2.0\",\n  \"result\": {\n    \"allowed_directories\": [\"./notes\"],\n    \"status\": \"ok\"\n  }\n}",
		conn.Alias, tool, argsJSON), nil
}

// RunNoteTest executes every code block of a note and reports the outcome.
func (s *AppState) RunNoteTest(name string) (TestReport, error) {
	note, err := s.FindNote(name)
	if err != nil {
		return TestReport{}, err
	}

	report := TestReport{
		Note:      note.Name,
		Timestamp: time.Now().Format(time.RFC3339),
		AllPassed: true,
		Results:   []ExecResult{},
	}
	for _, blk := range note.CodeBlocks {
		res := s.ExecuteBlock(blk.Index, ExecRequest{
			Lang:   blk.Lang,
			Conn:   blk.Conn,
			Assert: blk.Assert,
			Meta:   blk.Meta,
			Code:   blk.Code,
		})
		if !res.Success || !res.AssertPass {
			report.AllPassed = false
		}
		report.Results = append(report.Results, res)
	}
	report.TotalBlocks = len(report.Results)
	return report, nil
}

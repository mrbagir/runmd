package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// psql prints "(N rows)" / "(1 row)" after a result set.
var rowCountRegex = regexp.MustCompile(`\((\d+) rows?\)`)

// evaluateAssertion checks a block's output against its @assert rule.
//
// Supported rules:
//
//	contains:<text>      output contains text
//	not_contains:<text>  output does not contain text
//	status == 200        HTTP 200 detected in the response
//	rows > 0             SQL output reports at least one row
//	exit_code == 0       the block ran without error
//
// An unrecognised rule FAILS, so a typo can never silently pass a test.
func evaluateAssertion(rule, output string, execSuccess bool) (bool, string) {
	if !execSuccess {
		return false, "Execution failed with runtime error"
	}
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return true, "Execution succeeded (no custom assertion)"
	}

	if needle, ok := strings.CutPrefix(rule, "contains:"); ok {
		if strings.Contains(output, needle) {
			return true, fmt.Sprintf("Assertion PASS: output contains '%s'", needle)
		}
		return false, fmt.Sprintf("Assertion FAIL: expected output to contain '%s'", needle)
	}

	if needle, ok := strings.CutPrefix(rule, "not_contains:"); ok {
		if !strings.Contains(output, needle) {
			return true, fmt.Sprintf("Assertion PASS: output does not contain '%s'", needle)
		}
		return false, fmt.Sprintf("Assertion FAIL: output unexpectedly contains '%s'", needle)
	}

	switch rule {
	case "status == 200":
		for _, marker := range []string{"200 OK", `"status": 200`, "HTTP/1.1 200", "HTTP/2 200"} {
			if strings.Contains(output, marker) {
				return true, "Assertion PASS: status is 200"
			}
		}
		return false, "Assertion FAIL: HTTP 200 not detected in response"

	case "rows > 0":
		if m := rowCountRegex.FindStringSubmatch(output); m != nil {
			if n, _ := strconv.Atoi(m[1]); n > 0 {
				return true, "Assertion PASS: rows > 0"
			}
		}
		return false, "Assertion FAIL: no rows found in SQL output"

	case "exit_code == 0":
		return true, "Assertion PASS: exit_code == 0"
	}

	return false, fmt.Sprintf("Assertion FAIL: aturan tidak dikenal (%s)", rule)
}

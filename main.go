// RunMD is an executable Markdown notebook & knowledge graph in a single
// binary. See README.md for usage.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	host := flag.String("host", "127.0.0.1", "Alamat bind HTTP server (gunakan 0.0.0.0 hanya di jaringan tepercaya)")
	port := flag.String("port", "8080", "Port HTTP server")
	notesDir := flag.String("dir", "./notes", "Direktori penyimpanan file .md")
	connFile := flag.String("conn", "./connections.json", "File penyimpanan konfigurasi koneksi")
	testNote := flag.String("test", "", "Headless test mode untuk AI Agent (contoh: -test checkout-runbook.md)")
	flag.Parse()

	state, err := NewAppState(*notesDir, *connFile)
	if err != nil {
		log.Fatal(err)
	}

	if *testNote != "" {
		os.Exit(runHeadlessTest(state, *testNote))
	}

	handler, err := state.Handler()
	if err != nil {
		log.Fatalf("gagal menyiapkan UI: %v", err)
	}

	addr := net.JoinHostPort(*host, *port)
	displayHost := *host
	if displayHost == "127.0.0.1" || displayHost == "0.0.0.0" || displayHost == "" {
		displayHost = "localhost"
	}
	base := "http://" + net.JoinHostPort(displayHost, *port)

	fmt.Println("==================================================")
	fmt.Printf("⚡ RunMD Studio running on %s\n", base)
	fmt.Printf("📂 Notes directory   : %s\n", *notesDir)
	fmt.Printf("🔌 Connections file  : %s\n", *connFile)
	fmt.Printf("🤖 AI Agent Endpoint : GET %s/api/agent/test?note=checkout-runbook\n", base)
	fmt.Println("==================================================")

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

// runHeadlessTest prints the JSON report and returns the process exit code
// (0 = every block ran and every assertion passed).
func runHeadlessTest(state *AppState, note string) int {
	report, err := state.RunNoteTest(note)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Test gagal: %v\n", err)
		return 1
	}

	out, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(out))

	if !report.AllPassed {
		return 1
	}
	fmt.Println("✅ All assertions PASSED!")
	return 0
}

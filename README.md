# ⚡ RunMD

**RunMD** adalah aplikasi *Executable Markdown Notebook & Knowledge Graph* (kombinasi Jupyter Notebook + Postman/Database Client + Obsidian Graph + AI Agent Test Engine) berbasis **Full Golang** (Single Binary Architecture).

---

## 🌟 Fitur Utama

1. **Pure Markdown (`.md`) Source**:
   - Catatan disimpan dalam file `.md` biasa yang bersih, ramah version control (Git), dan bisa dibuka di editor mana pun.
   - Menggunakan sintaks Wikilinks `[[nama-catatan]]` untuk mengikat catatan satu sama lain.

2. **Multi-Protocol Execution Engine**:
   - Mendukung runner:
     - `sh` / `bash` / `zsh` (Command shell lokal)
     - `curl` / `http` (HTTP request & API testing)
     - `go` / `golang` (Eksekusi kode Go on-the-fly)
     - `js` / `javascript` (Eksekusi script Node.js / Bun)
     - `sql` (Query PostgreSQL / MySQL via alias `@conn`)
     - `redis` (CLI / command cache)
     - `rabbitmq` (Publish event / broker message)
     - `mcp` (Model Context Protocol JSON-RPC tool caller)

3. **Connection Manager & Aliases (`@conn`)**:
   - Atur koneksi DB, Redis, RabbitMQ, dan MCP Server melalui Sidebar UI.
   - Beri alias (misal: `@conn=pg_order`, `@conn=redis_main`) untuk memisahkan kredensial dari isi dokumen Markdown.

4. **Obsidian-Style Knowledge Graph**:
   - Visualisasi grafis interaktif antar-catatan (`.md`) dan alias koneksi (`@conn`).
   - Klik pada node catatan mana pun untuk langsung melompat ke catatan tersebut.

5. **AI Agent Automated Testing**:
   - Setiap blok kode mendukung atribut validasi `@assert="..."` (misal `@assert="contains:ORD-"`, `@assert="status == 200"`).
   - Mode CLI Headless untuk CI/CD atau AI Agent:
     ```bash
     ./runmd -test checkout-runbook.md
     ```
   - REST API Endpoint:
     ```bash
     curl -s "http://localhost:8080/api/agent/test?note=checkout-runbook"
     ```

---

## 🚀 Memulai

### 1. Build & Jalankan
```bash
cd ~/projects/runmd

# Build binary
go build -o runmd .

# Jalankan server
./runmd
```

Buka browser di:
👉 **[http://localhost:8080](http://localhost:8080)**

---

### 2. Opsi Flag CLI
| Flag | Default | Penjelasan |
|------|---------|------------|
| `-port` | `8080` | Port HTTP server |
| `-dir` | `./notes` | Direktori penyimpanan file `.md` |
| `-conn` | `./connections.json` | File konfigurasi koneksi |
| `-test` | `""` | Menjalankan pengujian otomatis untuk file tertentu (contoh: `-test checkout-runbook.md`) |

---

## 📝 Format Blok Markdown

Contoh blok kode dengan metadata koneksi dan assertion:

````markdown
# Checkout Runbook
Terhubung ke [[payment-service]].

```sql @conn=pg_order @assert="contains:ORD-"
SELECT id, customer_name, amount, status FROM orders WHERE status = 'PENDING';
```

```redis @conn=redis_main @assert="contains:active"
GET session:user:9981
```

```curl @assert="status == 200"
curl -s -i https://httpbin.org/get?service=checkout
```

```go @assert="contains:VALID"
package main
import "fmt"
func main() {
    fmt.Println("Status Pipeline: VALID & READY")
}
```
````

# Checkout & Order Runbook
Catatan operasional ini terhubung ke [[payment-service]] dan [[incident-playbook]].

## 1. Query Order Pending (SQL)
Mengeksekusi query menggunakan alias koneksi **pg_order** dari sidebar:

```sql @conn=pg_order @assert="contains:ORD-"
SELECT id, customer_name, amount, status
FROM orders
WHERE status = 'PENDING'
ORDER BY created_at DESC LIMIT 3;
```

## 2. Cek Cache Session (Redis)

```redis @conn=redis_main @assert="contains:active"
GET session:user:9981
```
```sh
echo "Hello world"
```

## 3. Publish Event ke RabbitMQ

```rabbitmq @conn=rmq_local @exchange=orders @routing_key=order.retry @assert="contains:Published"
{"order_id": "ORD-2026-01", "action": "RETRY_PAYMENT"}
```
```sh
echo "Hello world"
```
```sh
echo "Hello world"
```d

## 4. Test Webhook via cURL
```curl @assert="status == 200"
curl -s -i https://httpbin.org/get?service=checkout
```

## 5. Jalankan Script Validasi (Golang)

```go @assert="contains:VALID"
package main
import "fmt"

func main() {
	fmt.Println("Status Pipeline: VALID & READY")
}
```

## 6. Eksekusi Tool MCP

```mcp @conn=mcp_fs @tool=list_allowed_directories @assert="contains:notes"
{"reason": "Check workspace directory"}
```
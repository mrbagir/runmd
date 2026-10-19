# Checkout & Order Runbook
This operational runbook connects to [[payment-service]] and [[incident-playbook]].

## 1. Query Pending Orders (SQL)
Execute queries using the **pg_order** connection alias from the sidebar:

```sql @conn=pg_order @assert="contains:ORD-"
SELECT id, customer_name, amount, status
FROM orders
WHERE status = 'PENDING'
ORDER BY created_at DESC LIMIT 3;
```

## 2. Check Session Cache (Redis)

```redis @conn=redis_main @assert="contains:active"
GET session:user:9981
```

## 3. Publish Event to RabbitMQ

```rabbitmq @conn=rmq_local @exchange=orders @routing_key=order.retry @assert="contains:Published"
{"order_id": "ORD-2026-01", "action": "RETRY_PAYMENT"}
```

## 4. Test Webhook via cURL

```curl @assert="status == 200"
curl -s -i https://httpbin.org/get?service=checkout
```

## 5. Run Validation Script (Golang)

```go @assert="contains:VALID"
package main
import "fmt"

func main() {
	fmt.Println("Pipeline Status: VALID & READY")
}
```

## 6. Execute MCP Tool

```mcp @conn=mcp_fs @tool=list_allowed_directories @assert="contains:notes"
{"reason": "Check workspace directory"}
```

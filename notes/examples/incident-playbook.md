# Incident Playbook
Mitigation guide when [[payment-service]] or [[checkout-runbook]] experiences increased latency.

## Check Redis Connection
```redis @conn=redis_main @assert="contains:PONG"
PING
```

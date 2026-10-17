# Incident Playbook
Panduan mitigasi jika [[payment-service]] atau [[checkout-runbook]] mengalami peningkatan latensi.

## Cek Koneksi Redis
```redis @conn=redis_main @assert="contains:PONG"
PING
```

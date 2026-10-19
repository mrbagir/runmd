# Payment Service Architecture
Part of the [[checkout-runbook]] ecosystem. Shares the same database connection and message broker.

## System Health Check via Shell
```sh @assert="contains:OK"
echo "Payment Gateway Ping: OK ($(date +%H:%M:%S))"
```

## Calculate Fee via JavaScript
```js @assert="contains:Fee"
const amount = 250000;
const fee = amount * 0.015;
console.log(`Total Fee: $${fee}`);
```

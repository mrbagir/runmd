# Payment Service Architecture
Bagian dari ekosistem [[checkout-runbook]]. Menggunakan koneksi database dan message broker yang sama.

## Cek Health System via Shell
```sh @assert="contains:OK"
echo "Payment Gateway Ping: OK ($(date +%H:%M:%S))"
```

## Kalkulasi Fee via JavaScript
```js @assert="contains:Fee"
const amount = 250000;
const fee = amount * 0.015;
console.log(`Total Fee: Rp ${fee}`);
```

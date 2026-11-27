#!/usr/bin/env bash
set -euo pipefail
# Run on an Ubuntu VPS after installing Docker and Docker Compose.
cp .env.example .env
printf '\nEdit .env with your live Razorpay/Shiprocket/domain values, then press Enter.\n'
read -r _
docker compose up -d --build
echo 'Cutispro is running on port 3000. Put Nginx/Caddy + HTTPS in front of it.'

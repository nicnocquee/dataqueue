#!/bin/bash

# This script is used to run the cron jobs for the demo app during development.
# Run it with `pnpm cron` from the apps/demo directory.

set -a
source "$(dirname "$0")/.env.local"
set +a

if [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_SECRET environment variable is not set."
  exit 1
fi

while true; do
  echo "Processing jobs..."
  curl http://localhost:3000/api/cron/process -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 10 # sleep for 10 seconds
done &

while true; do
  echo "Reclaiming stuck jobs..."
  curl http://localhost:3000/api/cron/reclaim -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 20 # sleep for 20 seconds
done &

while true; do
  echo "Cleaning up old jobs..."
  curl http://localhost:3000/api/cron/cleanup -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 30 # sleep for 30 seconds
done &

wait
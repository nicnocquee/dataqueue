#!/bin/bash

# This script is used to run the cron jobs for the demo app during development.
# Run it with `pnpm cron` from the apps/demo directory.

set -a
source "$(dirname "$0")/.env.local"
set +a

if [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_SECRET environment variable is not set in .env.local"
  exit 1
fi

cleanup() {
  kill 0
  wait
}
trap cleanup SIGINT SIGTERM

while true; do
  echo "Processing jobs..."
  curl http://localhost:3000/api/dataqueue/manage/process -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 10 # Process jobs every 10 seconds
done &

while true; do
  echo "Reclaiming stuck jobs..."
  curl http://localhost:3000/api/dataqueue/manage/reclaim -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 20 # Reclaim stuck jobs every 20 seconds
done &

while true; do
  echo "Cleaning up old jobs..."
  curl http://localhost:3000/api/dataqueue/manage/cleanup -X POST -H "Authorization: Bearer $CRON_SECRET"
  echo ""
  sleep 30 # Cleanup old jobs every 30 seconds
done &

wait
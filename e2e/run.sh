#!/bin/sh
# Typecheck, lint and unit tests in the test image, then fresh stack + data and every spec in a headless browser inside the network.
#   ./run.sh                              OnlyOffice
#   OFFICE_PROVIDER=collabora ./run.sh    Collabora
#   ./run.sh shares.spec.ts               extra args go to `playwright test`
set -e
cd "$(dirname "$0")"
export OFFICE_PROVIDER="${OFFICE_PROVIDER:-onlyoffice}"
[ "$OFFICE_PROVIDER" = collabora ] && export OFFICE_URL="${OFFICE_URL:-http://collabora:9980}"

docker compose --profile "*" down
rm -rf data test-results && mkdir -p data
docker build --target test ..
docker build -t scatola:e2e ..
docker compose --profile "$OFFICE_PROVIDER" up -d --wait

# The Docker socket lets specs stop/restart instances and Valkey (failover tests).
docker run --rm --network scatola-e2e_default -u "$(id -u):$(id -g)" \
  --group-add "$(stat -c %g /var/run/docker.sock)" -v /var/run/docker.sock:/var/run/docker.sock \
  -e HOME=/tmp -e OFFICE_PROVIDER -v "$PWD:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.55.0-noble \
  sh -c "npm install --silent && npx playwright test $*"

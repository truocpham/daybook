#!/bin/sh
# Runs the browser tests against a throw-away container. Needs Docker and the image daybook:dev.
set -e
cd "$(dirname "$0")"
NAME=daybook-e2e
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e DAYBOOK_PUBLIC_URL=http://localhost:8080 daybook:dev >/dev/null
sleep 2
TOKEN_A=$(docker exec $NAME daybook invite alice@example.com | grep -o '[0-9a-f]\{64\}')
TOKEN_B=$(docker exec $NAME daybook invite bob@example.com | grep -o '[0-9a-f]\{64\}')
set +e
docker run --rm --network container:$NAME -e TOKEN_A=$TOKEN_A -e TOKEN_B=$TOKEN_B \
  -v "$(pwd):/e2e" -w /e2e mcr.microsoft.com/playwright:v1.49.1-jammy \
  sh -c "npm install --no-audit --no-fund >/dev/null && npx playwright test"
STATUS=$?
docker rm -f $NAME >/dev/null
exit $STATUS

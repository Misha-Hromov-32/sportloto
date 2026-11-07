#!/bin/sh
# Сквозная проверка в браузере (Chromium в Docker) против запущенного стека: docker compose up -d --wait.
# Снимки экрана — в scripts/e2e/shots (не коммитятся).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HERE/shots"
docker run --rm --network vmeste_default --ipc=host \
  -v "$HERE:/e2e:ro" -v "$HERE/shots:/shots" \
  mcr.microsoft.com/playwright/python:v1.49.0-jammy \
  sh -c "pip install -q --root-user-action=ignore playwright==1.49.0 && python /e2e/smoke.py"

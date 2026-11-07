#!/bin/sh
# Прогон сценария запросов к API в Docker (сервис backend-test): коды ответов и ответы 5xx.
# Использование: scripts/scenarios/run.sh <сценарий.json> [--expect коды.json] [--out коды.json]
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ $# -ge 1 ] || { echo "Использование: $0 <сценарий.json> [--expect коды.json] [--out коды.json]" >&2; exit 2; }
SCENARIO=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
shift
EXPECT=""
OUT=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "У $1 нет значения" >&2; exit 2; }
  case "$1" in
    --expect) EXPECT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2") ;;
    --out) OUT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2") ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
  shift 2
done
# Пути с кириллицей ломают сборщик bake в Docker Compose.
export COMPOSE_BAKE=false
COMPOSE="docker compose -f $ROOT/deploy/docker-compose.yml"

set -- /scenarios/run.py /scenario.json
VOLUMES="-v $ROOT/scripts/scenarios:/scenarios:ro -v $SCENARIO:/scenario.json:ro"
if [ -n "$EXPECT" ]; then
  VOLUMES="$VOLUMES -v $EXPECT:/expect.json:ro"
  set -- "$@" --expect /expect.json
fi
if [ -n "$OUT" ]; then
  : >> "$OUT"
  VOLUMES="$VOLUMES -v $OUT:/out.json"
  set -- "$@" --out /out.json
fi

$COMPOSE up -d --wait db
# shellcheck disable=SC2086
$COMPOSE --profile test run --rm -T $VOLUMES backend-test python "$@"

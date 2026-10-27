#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD/output/isolation/current_runs/20261027_streamer_mayhem_mvp"
cache="$root/twitch_cli/go-mod-cache"
binary="$root/twitch_chat_simulator"
[[ $# -eq 0 || ( $# -eq 1 && "$1" == '--serve' ) ]] || { echo 'Usage: bash scripts/run-chat-simulator.sh [--serve]' >&2; exit 2; }
for executable in go node lsof; do command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }; done
[[ -d "$cache/github.com/gorilla/websocket@v1.5.0" ]] || { echo 'Offline Gorilla WebSocket dependency is missing; see README' >&2; exit 1; }
if lsof -nP -iTCP:8091 -sTCP:LISTEN | grep -q LISTEN; then echo 'Mock port 8091 is already in use' >&2; exit 1; fi
(cd tests/twitch_simulator && GOMAXPROCS=2 GOFLAGS='-p=2 -mod=readonly' GOPROXY=off GOSUMDB=off GOCACHE="$root/go-cache" GOMODCACHE="$cache" go build -o "$binary" .)
if [[ ${1-} == '--serve' ]]; then exec "$binary"; fi
SIMULATOR_BIN="$binary" node tests/local_twitch_integration.mjs 2>&1 | tee logs/runtime/local_twitch_integration.log

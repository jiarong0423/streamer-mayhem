#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD/output/isolation/current_runs/20261027_streamer_mayhem_mvp"
asset="$root/twitch_cli"
cli="$asset/twitch-loopback"
injector="$asset/official_mock_inject"
config=/private/tmp/streamer-mayhem-missing-config.env
if [[ "$(uname -s)-$(uname -m)" != Darwin-arm64 ]]; then echo 'Requires macOS arm64 and sandbox-exec' >&2; exit 1; fi
for executable in go node lsof sandbox-exec shasum; do command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }; done
[[ $# -eq 0 || ( $# -eq 1 && "$1" == '--serve' ) ]] || { echo 'Usage: bash scripts/run-official-mock.sh [--serve]' >&2; exit 2; }
[[ -f "$asset/twitch.tar.gz" && -f "$asset/checksums.txt" && -x "$cli" ]] || { echo 'Loopback-patched CLI asset is missing' >&2; exit 1; }
expected=$(awk '/twitch-cli_1.1.24_Darwin_arm64.tar.gz$/ {print $1}' "$asset/checksums.txt")
actual=$(shasum -a 256 "$asset/twitch.tar.gz" | cut -d ' ' -f 1)
[[ -n "$expected" && "$expected" == "$actual" ]] || { echo 'Twitch CLI archive checksum mismatch' >&2; exit 1; }
installed_binary=$(shasum -a 256 "$cli" | cut -d ' ' -f 1)
[[ "$installed_binary" == '5c25b26e0caf2b6d281519ad15497be131f68b926c53363828e88a5f6d19b9f7' ]] || { echo 'Loopback CLI binary checksum mismatch' >&2; exit 1; }
[[ ! -e "$config" ]] || { echo 'Isolated config path already exists' >&2; exit 1; }
if lsof -nP -iTCP:44747 -iTCP:8080 -sTCP:LISTEN | grep -q LISTEN; then echo 'Required mock ports are in use' >&2; exit 1; fi
if [[ ${1-} == '--serve' ]]; then
  for name in ${!TWITCH_@}; do unset "$name"; done
  CI=true TWITCH_DISABLE_UPDATE_CHECKS=true exec sandbox-exec -p '(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))' "$cli" --config "$config" event websocket start-server --ip 127.0.0.1 --port 8080
fi
mkdir -p "$root/go-cache" logs/runtime
GOCACHE="$root/go-cache" GOPROXY=off go build -o "$injector" tests/official_mock_inject.go
TWITCH_CLI="$cli" node tests/mock_network_boundary.mjs 2>&1 | tee logs/runtime/mock_network_boundary.log
TWITCH_CLI="$cli" MOCK_INJECTOR="$injector" sandbox-exec -p '(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))' node tests/official_mock_test.mjs 2>&1 | tee logs/runtime/official_mock_test.log
TWITCH_CLI="$cli" MOCK_INJECTOR="$injector" sandbox-exec -p '(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))' node tests/official_mock_lifecycle.mjs 2>&1 | tee logs/runtime/official_mock_lifecycle.log
TWITCH_CLI="$cli" MOCK_INJECTOR="$injector" sandbox-exec -p '(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))' node tests/official_mock_product.mjs 2>&1 | tee logs/runtime/official_mock_product.log

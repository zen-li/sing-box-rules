#!/usr/bin/env bash
# Side-router daily cron wrapper (Plan A).
#
# Install on Ubuntu — copy the whole analyze-direct-timeouts/ directory:
#   cp -r analyze-direct-timeouts /Bucket/sing-box-side-router-docker/
#   chmod +x /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/run.sh
#
# Cron (root or user in docker group):
#   30 3 * * * /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/run.sh \
#     >> /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/logs/cron.log 2>&1
#
# Layout:
#   analyze-direct-timeouts/
#   ├── analyze.py          — main logic
#   ├── run.sh              — this script
#   ├── fixtures/           — local test logs (gitignored)
#   ├── reports/            — proxy-ips.txt, history.json, daily reports (gitignored)
#   └── logs/               — cron stdout (gitignored)
#
# Review on Mac:
#   scp ubuntu:/Bucket/.../analyze-direct-timeouts/reports/proxy-ips.txt .
#   diff sources/proxy-ips.txt proxy-ips.txt → npm run publish

set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-${TOOL_DIR}/reports}"
LOG_DIR="${LOG_DIR:-${TOOL_DIR}/logs}"
CONTAINER="${SING_BOX_CONTAINER:-sing-box-side-router}"
SINCE="${SING_BOX_LOG_SINCE:-24h}"
MIN_HITS="${SING_BOX_MIN_HITS:-3}"
PREFIX_LEN="${SING_BOX_PREFIX_LEN:-24}"
COUNTRY_SKIP="${SING_BOX_COUNTRY_SKIP:-CN,HK,MO}"
PROXY_IPS_FILE="${PROXY_IPS_FILE:-}"

mkdir -p "${OUTPUT_DIR}" "${LOG_DIR}"

ARGS=(
  python3 "${TOOL_DIR}/analyze.py"
  --container "${CONTAINER}"
  --since "${SINCE}"
  --output-dir "${OUTPUT_DIR}"
  --min-hits "${MIN_HITS}"
  --prefix-len "${PREFIX_LEN}"
  --country-skip "${COUNTRY_SKIP}"
)

if [[ -n "${PROXY_IPS_FILE}" ]]; then
  ARGS+=(--proxy-ips-file "${PROXY_IPS_FILE}")
fi

exec "${ARGS[@]}"

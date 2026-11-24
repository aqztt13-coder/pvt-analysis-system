#!/usr/bin/env bash
set -euo pipefail

# PVT Reservoir Fluids Division — Local LAN Server Launcher (Linux / macOS)
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"

echo "==========================================================="
echo " PVT Reservoir Fluids Division - Administrative System"
echo " Binding on http://${HOST}:${PORT} (Offline LAN Mode)"
echo "==========================================================="

if [ ! -d "dist" ]; then
  echo "Building production frontend assets..."
  npm run build
fi

exec npx tsx server.ts

#!/bin/bash
# Double-click to start OrbiT. Close this window (or press Ctrl+C) to stop it.
cd "$(dirname "$0")" || exit 1
clear
printf '\n  OrbiT\n  -----\n  Starting at http://localhost:8765\n  Your browser opens automatically. Keep this window open while you use OrbiT.\n  Close this window or press Ctrl+C to stop.\n\n'
if ! command -v python3 >/dev/null; then
  echo "  python3 not found. Install it from https://www.python.org/downloads/"
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi
python3 scripts/serve.py

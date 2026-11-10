#!/bin/sh
# Mini Plemiona – lokalny serwer (macOS / Linux)
cd "$(dirname "$0")"
URL=http://localhost:8080
( sleep 1; (command -v xdg-open >/dev/null && xdg-open $URL) || (command -v open >/dev/null && open $URL) ) >/dev/null 2>&1 &
if command -v node >/dev/null 2>&1; then node serve.js 8080
elif command -v python3 >/dev/null 2>&1; then python3 -m http.server 8080
else echo "Zainstaluj Node.js lub Pythona 3."; fi

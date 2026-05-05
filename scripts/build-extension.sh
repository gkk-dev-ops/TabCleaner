#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist
zip -r dist/tabcleaner.zip \
  manifest.json \
  background.js \
  popup.html \
  popup.css \
  popup.js \
  -x "*.DS_Store"

echo "Built dist/tabcleaner.zip"

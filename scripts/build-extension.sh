#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist

mapfile -t manifest_files < <(
  node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const files = new Set();

function addFile(value) {
  if (typeof value === 'string' && value.trim()) files.add(value);
}

function addIconMap(value) {
  if (!value || typeof value !== 'object') return;
  for (const iconPath of Object.values(value)) addFile(iconPath);
}

addFile(manifest.background?.service_worker);
addFile(manifest.action?.default_popup);
addIconMap(manifest.icons);
addIconMap(manifest.action?.default_icon);

for (const file of files) console.log(file);
"
)

bundle_files=(
  manifest.json
  background.js
  popup.html
  popup.css
  popup.js
)

if [[ -d icons ]]; then
  bundle_files+=(icons)
fi

for file in "${manifest_files[@]}"; do
  bundle_files+=("$file")
done

declare -A seen=()
unique_files=()
for file in "${bundle_files[@]}"; do
  if [[ -n "${seen[$file]+x}" ]]; then
    continue
  fi
  seen["$file"]=1
  if [[ -e "$file" ]]; then
    unique_files+=("$file")
  else
    echo "Warning: skipping missing manifest-referenced file: $file" >&2
  fi
done

zip -r dist/tabcleaner.zip "${unique_files[@]}" -x "*.DS_Store"

echo "Built dist/tabcleaner.zip"

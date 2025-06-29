#!/bin/bash

set -e

PKG_FILE="package.json"
TMP_FILE="package.tmp.json"

update_section() {
  local section=$1
  jq -r ".$section // {} | keys[]" "$PKG_FILE" | while read -r dep; do
    current=$(jq -r ".$section[\"$dep\"]" "$PKG_FILE")
    latest=$(npm view "$dep" version 2>/dev/null)
    if [[ -n "$latest" && "$current" != "^$latest" ]]; then
      echo "Updating $dep: $current -> ^$latest"
      jq ".$section[\"$dep\"] = \"^$latest\"" "$PKG_FILE" > "$TMP_FILE" && mv "$TMP_FILE" "$PKG_FILE"
    else
      echo "$dep is up-to-date ($current)"
    fi
  done
}

update_section "dependencies"
update_section "devDependencies"

echo "Done. Please run your package manager to install the updates." 
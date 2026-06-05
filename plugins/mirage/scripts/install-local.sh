#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$plugin_dir/../.." && pwd)"

codex plugin marketplace add "$repo_root"
codex plugin add mirage@mirage

echo "Mirage plugin installed. Start a new Codex thread to load the plugin skills and MCP config."

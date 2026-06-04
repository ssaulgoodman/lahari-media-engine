#!/usr/bin/env bash
set -euo pipefail

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$plugin_dir/../.." && pwd)"

codex plugin marketplace add "$repo_root/plugins"
codex plugin add mirage@mirage-local

echo "Mirage plugin installed. Start a new Codex thread to load the plugin skills and MCP config."

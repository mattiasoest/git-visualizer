#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: npm run release -- <patch|minor|major|x.y.z>" >&2
  exit 1
fi

npm version "$@"

echo
echo "Release commit and tag created. Push with:"
echo "  git push origin HEAD --follow-tags"

#!/bin/bash
set -euo pipefail

npm run publish:local

# git commit -a only stages tracked modifications; new rule files must be added explicitly
git add dist/ sources/ templates/ scripts/

if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

git commit -m "Update $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main

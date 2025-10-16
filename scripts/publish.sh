#!/bin/bash

npm run publish:local
git commit -a -m "Update $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main
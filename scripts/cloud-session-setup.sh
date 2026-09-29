#!/usr/bin/env bash
# Gets a Claude Code CLOUD session (claude.ai/code) ready to work on Clerque:
# packages, the shared types, the Prisma client (the same steps as CI in
# .github/workflows/ci.yml), and the Railway CLI for the production probes.
#
#   bash scripts/cloud-session-setup.sh
#
# Safe to run again: finished steps are skipped. On a desktop it does nothing
# (CLAUDE_CODE_REMOTE is "true" only in the cloud) unless given --force. Why
# the Railway CLI is pinned to 4.42.1 and built from crates.io:
# docs/OPERATIONS.md section 7.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "${1:-}" = "--force" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

say() { echo "[cloud-setup] $*"; }

if [ -f packages/shared-types/dist/index.js ] && [ -d node_modules/.prisma/client ]; then
  say "packages, shared types and Prisma client already in place."
else
  say "installing packages (a few minutes on a fresh session)..."
  if npm install --workspaces --include-workspace-root --no-audit --no-fund >/tmp/cloud-setup.log 2>&1 \
     && npm run build --workspace=packages/shared-types >>/tmp/cloud-setup.log 2>&1 \
     && npx prisma generate --schema=packages/db/prisma/schema.prisma >>/tmp/cloud-setup.log 2>&1; then
    say "ready: packages installed, shared types built, Prisma client generated."
  else
    say "SETUP FAILED - read /tmp/cloud-setup.log, fix, then rerun: bash scripts/cloud-session-setup.sh"
  fi
fi

# The Railway CLI takes several minutes to build, so it builds in the
# background, detached from this hook. Only worth it when the environment has
# a Railway token to use it with.
if command -v railway >/dev/null 2>&1 || [ -x "$HOME/.cargo/bin/railway" ]; then
  say "Railway CLI present: $("${HOME}/.cargo/bin/railway" --version 2>/dev/null || railway --version)"
elif [ -z "${RAILWAY_TOKEN:-}" ]; then
  say "no RAILWAY_TOKEN in this environment: production probes (apps/api/scripts/probes) are unavailable; see docs/OPERATIONS.md section 7."
elif [ -f /tmp/railway-install.pid ] && kill -0 "$(cat /tmp/railway-install.pid)" 2>/dev/null; then
  say "Railway CLI still building in the background (log: /tmp/railway-install.log)."
else
  setsid nohup bash -c 'cargo install railwayapp --version 4.42.1 --locked && echo "RAILWAY CLI READY"' \
    >/tmp/railway-install.log 2>&1 </dev/null &
  echo $! >/tmp/railway-install.pid
  say "building Railway CLI 4.42.1 in the background (about 5-10 minutes). Done when /tmp/railway-install.log ends with RAILWAY CLI READY; then use ~/.cargo/bin/railway."
fi
exit 0

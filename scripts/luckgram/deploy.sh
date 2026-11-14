#!/usr/bin/env bash
# Luckgram Web (luckgram-specs#137, W1) — deploys an assembled site to a Cloudflare Pages project.
#
#   deploy.sh <project> <directory>
#
# It goes to the project's production branch, whose name is asked from Cloudflare. There are no
# previews of pull requests (luckgram-specs#167).
# Needs CLOUDFLARE_API_TOKEN (Pages: Edit) and CLOUDFLARE_ACCOUNT_ID. Writes `url` and `alias`
# to $GITHUB_OUTPUT.
set -euo pipefail

PROJECT=$1
DIR=$2

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::error::The repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set."
  exit 1
fi

BRANCH=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT" |
  node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const b=JSON.parse(s).result?.production_branch;if(!b)process.exit(1);console.log(b)})') || {
  echo "::error::Could not read the production branch of Cloudflare Pages project $PROJECT."
  exit 1
}

echo "Deploying $DIR to $PROJECT, branch $BRANCH"
LOG=$(mktemp)
pnpm dlx wrangler@4 pages deploy "$DIR" --project-name "$PROJECT" --branch "$BRANCH" \
  --commit-hash "${LUCKGRAM_COMMIT:-}" --commit-message "build ${LUCKGRAM_BUILD:-0}" --commit-dirty=true 2>&1 | tee "$LOG"

URL=$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev' "$LOG" | head -1 || true)
ALIAS=$(grep -iE 'alias' "$LOG" | grep -oE 'https://[a-z0-9.-]+\.pages\.dev' | head -1 || true)

if [ -z "$URL" ]; then
  echo "::error::wrangler did not report a deployment URL."
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "url=$URL" >> "$GITHUB_OUTPUT"
  echo "alias=$ALIAS" >> "$GITHUB_OUTPUT"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Deployed \`${LUCKGRAM_COMMIT:0:7}\` to **$PROJECT** ($BRANCH): $URL ${ALIAS:+· $ALIAS}" >> "$GITHUB_STEP_SUMMARY"
fi

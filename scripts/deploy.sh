#!/usr/bin/env bash
# Build, apply the FFRS infra (aiops-tf-infra, module ffrs), publish widget.js.
set -euo pipefail

cd "$(dirname "$0")/.."
INFRA="${INFRA_DIR:-../aiops-tf-infra}"
[ -d "$INFRA" ] || { echo "infra repo not found at $INFRA — set INFRA_DIR" >&2; exit 1; }
export AWS_PROFILE="${AWS_PROFILE:-scaledaiops}"

npm run check
terraform -chdir="$INFRA" init -input=false >/dev/null
terraform -chdir="$INFRA" apply -input=false -var enable_ffrs=true "$@"

out() { terraform -chdir="$INFRA" output -json ffrs | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
# Short cache: the URL is fixed, so embedders pick up a new widget within minutes.
aws s3 cp widget/widget.js "s3://$(out assets_bucket)/widget.js" \
  --content-type 'text/javascript; charset=utf-8' --cache-control 'public, max-age=300'
aws s3 sync widget/vendor "s3://$(out assets_bucket)/vendor" --cache-control 'public, max-age=31536000, immutable'
aws cloudfront create-invalidation --distribution-id "$(out distribution_id)" --paths /widget.js \
  --query Invalidation.Id --output text >/dev/null
echo "$(out endpoint) — widget at $(out endpoint)/widget.js — CNAME ffrs → $(out distribution_domain)"

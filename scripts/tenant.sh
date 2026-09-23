#!/usr/bin/env bash
# Onboard and manage tenants: one SSM folder each, no deploy. Values are prompted, or taken from
# the environment (TENANT_NAME, TENANT_SITE_URL, ...) for scripted use; secrets are never echoed.
#   scripts/tenant.sh add|show|enable|disable|remove <slug>
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-scaledaiops}"
REGION="${AWS_REGION:-eu-central-1}"
PREFIX="${SSM_PREFIX:-/ffrs}"
cmd="${1:-}"; slug="${2:-}"
[[ -n "$cmd" && -n "$slug" ]] || { echo "usage: $0 add|show|enable|disable|remove <slug>" >&2; exit 2; }
[[ "$slug" =~ ^[a-z0-9-]{2,32}$ ]] || { echo "slug must be [a-z0-9-]{2,32}" >&2; exit 2; }
path="$PREFIX/tenants/$slug"

ssm() { aws ssm "$@" --region "$REGION"; }
put() { # name type value
  [[ -z "$3" ]] && return 0
  ssm put-parameter --name "$path/$1" --type "$2" --value "$3" --overwrite >/dev/null
}
ask() { # var prompt [secret]
  local var="$1" prompt="$2" secret="${3:-}" val
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    if [[ -n "$secret" ]]; then read -r -s -p "$prompt: " val; echo; else read -r -p "$prompt: " val; fi
  fi
  printf -v "$var" '%s' "$val"
}

case "$cmd" in
add)
  ask TENANT_NAME "Display name"
  ask TENANT_SITE_URL "Site URL (https://www.example.com)"
  ask TENANT_ORIGINS "Allowed origins, comma-separated (https://*.example.com = any subdomain)"
  ask TENANT_TRACKER_REPO "Tracker repo (owner/repo)"
  ask TENANT_GITHUB_TOKEN "GitHub token (Issues read/write on that repo)" secret
  ask TENANT_RESEARCH "Research export opt-in (true/false)"
  ask TENANT_ALERT_EMAIL "Alert email (blank = none)"
  ask TENANT_FEEDBACK_PAGE "Feedback/status page URL (blank = <site>/feedback/)"

  # One read call proves the token reaches the repo before anything is written.
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TENANT_GITHUB_TOKEN" "https://api.github.com/repos/$TENANT_TRACKER_REPO")
  [[ "$code" == "200" ]] || { echo "token cannot read $TENANT_TRACKER_REPO (HTTP $code)" >&2; exit 1; }

  # Pseudonym: next S<n>, assigned once, in order of joining.
  n=$(ssm get-parameters-by-path --path "$PREFIX/tenants/" --recursive --query "Parameters[?ends_with(Name, '/pseudonym')].Value" --output text | tr '\t' '\n' | sed -n 's/^S\([0-9]*\)$/\1/p' | sort -n | tail -1)
  pseudonym="S$(( ${n:-0} + 1 ))"
  existing=$(ssm get-parameter --name "$path/pseudonym" --query Parameter.Value --output text 2>/dev/null || true)
  [[ -n "$existing" ]] && pseudonym="$existing"

  put name String "$TENANT_NAME"
  put site_url String "$TENANT_SITE_URL"
  put origins String "$TENANT_ORIGINS"
  put tracker_repo String "$TENANT_TRACKER_REPO"
  put github_token SecureString "$TENANT_GITHUB_TOKEN"
  put research String "$TENANT_RESEARCH"
  put pseudonym String "$pseudonym"
  put alert_email String "$TENANT_ALERT_EMAIL"
  put feedback_page String "$TENANT_FEEDBACK_PAGE"
  put turnstile_secret SecureString "${TENANT_TURNSTILE_SECRET:-}"
  put webhook_secret SecureString "${TENANT_WEBHOOK_SECRET:-}"
  put enabled String true
  echo "tenant $slug written as $pseudonym — live within 5 minutes. Embed:"
  echo "  <script src=\"https://ffrs.scaledaiops.org/widget.js\" data-site=\"$slug\" defer></script>"
  ;;
show)
  ssm get-parameters-by-path --path "$path/" --query "Parameters[?Type=='String'].[Name,Value]" --output text | sed "s|$path/||"
  ssm get-parameters-by-path --path "$path/" --query "Parameters[?Type=='SecureString'].Name" --output text | sed "s|$path/|secret: |"
  ;;
enable)  put enabled String true;  echo "$slug enabled" ;;
disable) put enabled String false; echo "$slug disabled" ;;
remove)
  read -r -p "Delete tenant $slug's parameters and screenshots? Issues in its repo are untouched. [y/N] " ok
  [[ "$ok" == "y" ]] || exit 1
  names=$(ssm get-parameters-by-path --path "$path/" --query 'Parameters[].Name' --output text)
  [[ -n "$names" ]] && ssm delete-parameters --names $names >/dev/null
  bucket=$(aws lambda get-function-configuration --region "$REGION" --function-name ffrs-api --query 'Environment.Variables.DATA_BUCKET' --output text)
  aws s3 rm "s3://$bucket/screenshots/$slug/" --recursive --quiet
  echo "$slug removed"
  ;;
*) echo "unknown command $cmd" >&2; exit 2 ;;
esac

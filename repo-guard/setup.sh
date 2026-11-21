#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# -le 2 ]] || fail '使い方: bash setup.sh [コピー元の OWNER/REPO] [金庫を作る GitHub ID]'
requested=${1:-Melin55/Japancasino}
requested=${requested#https://github.com/}
requested=${requested%.git}
[[ "$requested" =~ ^[a-zA-Z0-9-]+/[a-zA-Z0-9_.-]+$ ]] || fail 'GitHub の OWNER/REPO を指定してください。'
requested_owner=${2:-}
if [[ -n "$requested_owner" && ! "$requested_owner" =~ ^[a-zA-Z0-9-]+$ ]]; then
  fail '金庫を作る GitHub ID を指定してください。'
fi
base_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export GH_HOST=github.com

login=$(gh api user --jq '.login') || fail 'GitHub CLI で認証中のアカウントを確認できませんでした。'
source=$(gh api "repos/$requested" --jq 'select(.visibility == "public" and .owner.type == "User") | .full_name')
[[ -n "$source" ]] || fail 'この手順は個人名義の公開リポジトリ専用です。'
owner=${requested_owner:-${source%%/*}}
[[ "$login" == "$owner" ]] || fail "認証中は $login です。金庫を作る $owner 本人の認証が必要です。GitHub は変更していません。"
repo_name=${source#*/}
vault=$owner/$repo_name-vault
watcher=$owner/$repo_name-backup

ensure_private_repo() {
  local repo=$1 description=$2 settings collaborators invitations
  if ! gh api "repos/$repo" --silent 2>/dev/null; then
    gh repo create "$repo" --private --add-readme --description "$description"
  fi
  settings=$(gh api "repos/$repo" --jq '[.visibility, .owner.login, .description, .archived, .fork] | @tsv')
  [[ "$settings" == "private"$'\t'"$owner"$'\t'"$description"$'\t'"false"$'\t'"false" ]] ||
    fail "$repo はこのスクリプトが管理する非公開リポジトリとして確認できません。"
  collaborators=$(gh api --paginate "repos/$repo/collaborators" --jq ".[] | select(.login != \"$owner\") | .login")
  invitations=$(gh api --paginate "repos/$repo/invitations" --jq '.[].id')
  [[ -z "$collaborators$invitations" ]] || fail "$repo に共同作業者または保留中の招待があります。"
}

put_file() {
  local file=$1 path=$2 endpoint current_sha encoded
  local sha_field=()
  endpoint="repos/$watcher/contents/$path"
  current_sha=$(gh api "$endpoint" --jq '.sha' 2>/dev/null || true)
  if [[ -n "$current_sha" ]]; then
    [[ "$current_sha" != "$(git hash-object "$file")" ]] || return 0
    sha_field=(-f "sha=$current_sha")
  fi
  encoded=$(base64 < "$file" | tr -d '\n')
  gh api --method PUT --silent "$endpoint" -f "message=Install $path" -f "content=$encoded" ${sha_field[@]+"${sha_field[@]}"}
}

ensure_vault_key() {
  local title=repo-guard:${watcher#*/} keys secret key_id
  keys=$(gh api --paginate "repos/$vault/keys" --jq ".[] | select(.title == \"$title\") | [.id, .read_only] | @tsv")
  secret=$(gh secret list -R "$watcher" --json name --jq '.[] | select(.name == "VAULT_SSH_KEY") | .name')
  if [[ "$keys" =~ ^[0-9]+$'\t'false$ && "$secret" == VAULT_SSH_KEY ]]; then
    return 0
  fi

  ssh-keygen -q -t ed25519 -N '' -C "$title" -f "$temp_dir/vault"
  gh api --method POST --silent "repos/$vault/keys" -f "title=$title" -f "key=$(cat "$temp_dir/vault.pub")" -F read_only=false
  gh secret set VAULT_SSH_KEY -R "$watcher" < "$temp_dir/vault"

  # If a setup was interrupted, retire only previous keys created by this script.
  while IFS=$'\t' read -r key_id _; do
    [[ -n "$key_id" ]] || continue
    gh api --method DELETE --silent "repos/$vault/keys/$key_id"
  done <<< "$keys"
}

umask 077
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT

ensure_private_repo "$vault" "Repo Guard vault for $source"
ensure_private_repo "$watcher" "Repo Guard backup runner for $source"

# Historical source branches can contain workflows. The vault must never run them.
gh api --method PUT --silent "repos/$vault/actions/permissions" -F enabled=false
[[ "$(gh api "repos/$vault/actions/permissions" --jq '.enabled')" == false ]] || fail '金庫の Actions を停止できませんでした。'
ensure_vault_key
gh variable set SOURCE_REPO -R "$watcher" --body "$source"
gh variable set VAULT_REPO -R "$watcher" --body "$vault"
put_file "$base_dir/backup.sh" backup.sh
put_file "$base_dir/backup.yml" .github/workflows/backup.yml

workflow_state=
for ((attempt = 0; attempt < 12; attempt++)); do
  workflow_state=$(gh api "repos/$watcher/actions/workflows/backup.yml" --jq '.state' 2>/dev/null || true)
  [[ -z "$workflow_state" ]] || break
  sleep 3
done
[[ -n "$workflow_state" ]] || fail "ワークフローを登録しました。https://github.com/$watcher/actions で認識されたら再実行してください。"
if [[ "$workflow_state" != active ]]; then
  gh workflow enable backup.yml -R "$watcher"
fi

run_tag="setup-$(date -u '+%Y%m%dT%H%M%SZ')-$RANDOM"
gh workflow run backup.yml -R "$watcher" -f "setup_run=$run_tag"
run_id=
for ((attempt = 0; attempt < 12; attempt++)); do
  run_id=$(gh run list -R "$watcher" --workflow backup.yml --event workflow_dispatch --limit 20 \
    --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"Backup $run_tag\") | .databaseId")
  [[ -z "$run_id" ]] || break
  sleep 3
done
[[ -n "$run_id" ]] || fail "実行を開始しました。https://github.com/$watcher/actions で結果を確認してください。"
printf '初回バックアップ: https://github.com/%s/actions/runs/%s\n' "$watcher" "$run_id"
gh run watch "$run_id" -R "$watcher" --exit-status --interval 5
gh api --silent "repos/$vault/git/ref/heads/backup-log"
printf '金庫: https://github.com/%s/tree/backup-log\n' "$vault"

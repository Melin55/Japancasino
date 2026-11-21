#!/usr/bin/env bash
set -euo pipefail

# This script only fetches Git objects. It never checks out or runs source code.
source_url=${1:?Usage: bash backup.sh SOURCE_URL VAULT_URL}
vault_url=${2:?Usage: bash backup.sh SOURCE_URL VAULT_URL}
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

git init --quiet --bare "$work_dir/objects"
cd "$work_dir/objects"
git fetch --quiet --no-tags -- "$source_url" 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
git for-each-ref --sort=refname --format='%(objectname) %(refname)' refs/heads refs/tags > "$work_dir/refs.txt"

log_ref=refs/heads/backup-log
git ls-remote --refs -- "$vault_url" "$log_ref" 'refs/tags/backup-objects/*' > "$work_dir/vault-refs"
previous=$(awk -v ref="$log_ref" '$2 == ref {print $1}' "$work_dir/vault-refs")
parent=()
if [[ -n "$previous" ]]; then
  git fetch --quiet --no-tags -- "$vault_url" "$previous"
  git show "$previous:refs.txt" > "$work_dir/previous-refs.txt"
  parent=(-p "$previous")
fi

# Preserve each object's identity, including an annotated tag's own object.
# Existing objects are shared across snapshots, even after source refs move.
cut -d ' ' -f 1 "$work_dir/refs.txt" | LC_ALL=C sort -u > "$work_dir/source-objects"
awk '$2 == "refs/tags/backup-objects/" $1 {print $1}' "$work_dir/vault-refs" |
  LC_ALL=C sort -u > "$work_dir/vault-objects"
LC_ALL=C comm -23 "$work_dir/source-objects" "$work_dir/vault-objects" > "$work_dir/missing-objects"

if [[ -n "$previous" ]] && cmp -s "$work_dir/refs.txt" "$work_dir/previous-refs.txt"; then
  if [[ ! -s "$work_dir/missing-objects" ]]; then
    echo 'ブランチとタグに変更はありません。前回のバックアップを保持しました。'
    exit 0
  fi
fi

blob=$(git hash-object -w "$work_dir/refs.txt")
tree=$(printf '100644 blob %s\trefs.txt\n' "$blob" | git mktree)
snapshot=$(git -c user.name='Repository backup' -c user.email='backup@users.noreply.github.com' \
  commit-tree "$tree" "${parent[@]}" -m "Backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')")

refspecs=("$snapshot:$log_ref")
while IFS= read -r object; do
  refspecs+=("$object:refs/tags/backup-objects/$object")
done < "$work_dir/missing-objects"

# Publish the manifest and its objects together. All writes are fast-forward or new refs.
git push --quiet --atomic -- "$vault_url" "${refspecs[@]}"
printf 'バックアップ完了: %s\n' "$snapshot"

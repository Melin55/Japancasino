# GitHub Free で自動バックアップ

`Melin55/Japancasino` の Git の履歴を、みきこさん名義の非公開リポジトリに保存します。元リポジトリへの変更や共同作業者の権限変更は不要です。約6時間おきに実行し、後から元のブランチやタグが削除・上書きされても、保存済みの履歴を金庫から復元できます。

## 初回設定

みきこさんの許可を得て作業します。`gh`、`git`、`ssh-keygen` を使える端末で、GitHub CLI にみきこさん本人が認証します。既に操作する人の `gh` が設定されている端末では、認証先を一時ディレクトリに分けることで普段のログインに影響しません。

```sh
repo_guard_gh=$(mktemp -d)
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$repo_guard_gh" \
  gh auth login --hostname github.com --web --scopes workflow
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$repo_guard_gh" \
  bash repo-guard/setup.sh Melin55/Japancasino
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$repo_guard_gh" \
  gh auth logout --hostname github.com --user Melin55
```

認証で使用するブラウザでは、みきこさんが表示された GitHub アカウントを確かめて許可します。`setup.sh` も実行前に所有者との一致を確認します。

- `Melin55/Japancasino-backup` が見張り役です。GitHub Actions で自動実行し、初回は手動で実行します。実行ログと金庫のリンクがターミナルに出ます。
- `Melin55/Japancasino-vault` が金庫です。見張り役だけが使う専用の SSH 鍵を設定し、金庫側の Actions は停止します。二つの非公開リポジトリに共同作業者を追加する必要はありません。
- 設定が途中で止まった場合は、同じアカウントで `setup.sh` を再実行できます。自分で作成した同名のリポジトリがある場合は処理を止めます。

## 復元

まず金庫の `backup-log` ブランチを確認します。各コミットの `refs.txt` には、当時のコミットやタグの ID と名前が記録されています。例えば、以前の `refs/heads/main` を別のローカルブランチとして取り出す手順は次のとおりです。

```sh
git clone --branch backup-log --single-branch --no-tags git@github.com:Melin55/Japancasino-vault.git
cd Japancasino-vault
git log --oneline
```

バックアップを選び、表示された ID を使います。

```sh
snapshot_commit='選んだバックアップのコミットID'
main_oid=$(git show "${snapshot_commit}:refs.txt" | awk '$2 == "refs/heads/main" {print $1}')
git fetch origin "refs/tags/backup-objects/$main_oid"
git switch --create recovered-main FETCH_HEAD
```

自動コピーは、実行時に Git にあるブランチとタグが対象です。次回の実行までに消えた未保存の変更、Issue、PR のコメント、Git LFS の実体、添付ファイルは対象外です。スケジュール実行は GitHub Actions の無料枠を使い、混雑時は遅れることがあります。

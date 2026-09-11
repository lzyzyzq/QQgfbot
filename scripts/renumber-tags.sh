#!/usr/bin/env bash
# 版本号重排：把历史 v4.2.59..v4.2.100 依次映射为 v0.0.1..v0.0.42，v1.0.0 起为当前版本线。
# 用法：
#   bash scripts/renumber-tags.sh            # 仅本地重建
#   PUSH=1 bash scripts/renumber-tags.sh     # 本地重建后 push 新 tag 并删除远程旧 tag
#   DELETE_LOCAL=0 bash scripts/renumber-tags.sh  # 不删除本地旧 tag
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mapfile -t olds < <(git tag -l 'v4.2.*' --sort=v:refname)
if [ "${#olds[@]}" -eq 0 ]; then
  echo "未找到 v4.2.* 旧 tag，可能已重排，退出。"
  exit 0
fi

news=()
i=1
echo "== 建立新 tag =="
for t in "${olds[@]}"; do
  commit="$(git rev-list -n1 "$t")"
  new="$(printf 'v0.0.%d' "$i")"
  git tag -f "$new" "$commit" >/dev/null
  news+=("$new")
  echo "  $t -> $new ($commit)"
  i=$((i + 1))
done

if [ "$i" -gt 100 ]; then
  echo "警告：新序号已超过 100，patch 超出 0-99 规则，请检查映射。" >&2
fi

if [ "${DELETE_LOCAL:-1}" = "1" ]; then
  echo "== 删除本地旧 tag =="
  git tag -d "${olds[@]}" >/dev/null
fi

echo "== 完成 =="
git tag -l 'v0.*' --sort=v:refname | tail -5
echo "共新建 ${#news[@]} 个新 tag。"

if [ "${PUSH:-0}" = "1" ]; then
  echo "== push 新 tag =="
  git push origin "${news[@]}"
  echo "== 删除远程旧 tag =="
  git push origin --delete "${olds[@]}"
  echo "远程重排完成。"
fi

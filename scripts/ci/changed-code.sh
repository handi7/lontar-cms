#!/usr/bin/env bash
# Decides whether a change needs the full CI suite.
#
# Usage: scripts/ci/changed-code.sh <base-ref> <head-ref>
# Prints `code=true` or `code=false`, followed by the reason, and appends
# `code=...` to $GITHUB_OUTPUT when it is set.
#
# `code=false` only when every changed file is documentation that no build,
# test or package step reads. Anything else, including files this script does
# not recognise, means `code=true`: when in doubt, run everything.
set -euo pipefail

base="${1:?base ref required}"
head="${2:?head ref required}"

result() {
  echo "code=$1"
  echo "$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "code=$1" >>"$GITHUB_OUTPUT"
  fi
  exit 0
}

# Markdown that the build, tests or package checks read. scripts/release/smoke-test.mjs
# requires README.md in every package tarball, so adding or removing one is not docs-only.
is_docs_path() {
  case "$1" in
    packages/*/src/* | examples/*/app/* | examples/*/src/*) return 1 ;;
    docs/* | *.md | .github/ISSUE_TEMPLATE/*) return 0 ;;
    *) return 1 ;;
  esac
}

changes="$(git diff --name-status --no-renames "$base" "$head")"
if [ -z "$changes" ]; then
  result true "No changed files detected; running the full suite."
fi

while IFS=$'\t' read -r status path; do
  if ! is_docs_path "$path"; then
    result true "Non-docs change: $path"
  fi
  case "$status:$path" in
    [AD]:packages/*/README.md) result true "Package README added or removed: $path" ;;
  esac
done <<<"$changes"

result false "Docs-only change; skipping lint, typecheck, build, package, test and e2e steps."

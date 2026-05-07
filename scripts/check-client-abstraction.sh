#!/usr/bin/env bash
# Guard CLAUDE.md abstraction rules and Conventional Commit messages.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/check-client-abstraction.sh --staged
  scripts/check-client-abstraction.sh --commit-msg <path>
USAGE
}

mode="${1:-}"

is_exempt_file() {
  case "$1" in
    CLAUDE.md|.githooks/*|scripts/check-client-abstraction.sh)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

scan_text() {
  local label="$1"
  local content="$2"
  local failed=0

  # Specific failures we have hit before: real reviewer names and internal
  # checkpoint metadata leaking into public specs, docs, or commit messages.
  local patterns=(
    'reviewed_by:[[:space:]]*["'"'"']?[A-Z][A-Za-z]+[[:space:]][A-Z][A-Za-z-]+'
    'agent:[[:space:]]*["'"'"']?c[l]aude[-_a-zA-Z0-9]*'
    '–[[:space:]]*c[l]aude[-_a-zA-Z0-9]*[[:space:]]*–'
    'Entire[-]Checkpoint:'
  )

  for pattern in "${patterns[@]}"; do
    if printf '%s' "$content" | grep -En "$pattern" >/tmp/client-abstraction-match.$$; then
      echo "Client abstraction guard failed in ${label}:" >&2
      cat /tmp/client-abstraction-match.$$ >&2
      echo "" >&2
      failed=1
    fi
  done

  rm -f /tmp/client-abstraction-match.$$
  return "$failed"
}

check_conventional_commit_message() {
  local msg_path="$1"
  local subject
  subject=$(grep -v '^[[:space:]]*#' "$msg_path" | sed -n '1p')
  local failed=0

  if [ -z "$subject" ]; then
    echo "Commit message guard failed: missing Conventional Commits description line." >&2
    return 1
  fi

  # Conventional Commits v1.0.0-beta.2:
  #   <type>[optional scope]: <description>
  # Types other than feat/fix are allowed by the spec. Keep the type lowercase
  # so changelog/release tooling can parse it predictably.
  if ! printf '%s\n' "$subject" | grep -Eq '^[a-z]+([_-][a-z]+)*(\([A-Za-z0-9._/-]+\))?: .+'; then
    echo "Commit message guard failed: subject must match '<type>[optional scope]: <description>'." >&2
    failed=1
  fi

  if printf '%s\n' "$subject" | grep -Eq '^[A-Z]'; then
    echo "Commit message guard failed: Conventional Commit type must be lowercase." >&2
    failed=1
  fi

  if grep -Eq '^BREAKING CHANGE($|[^:])' "$msg_path"; then
    echo "Commit message guard failed: BREAKING CHANGE must be followed by ': '." >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    echo "Use Conventional Commits v1.0.0-beta.2: <type>[optional scope]: <description>." >&2
    return 1
  fi
}

case "$mode" in
  --staged)
    mapfile -t files < <(git diff --cached --name-only --diff-filter=ACMR)
    failed=0
    for file in "${files[@]}"; do
      is_exempt_file "$file" && continue
      if ! git cat-file -e ":$file" 2>/dev/null; then
        continue
      fi
      if ! content=$(git show ":$file" 2>/dev/null); then
        continue
      fi
      if ! scan_text "$file" "$content"; then
        failed=1
      fi
    done
    if [ "$failed" -ne 0 ]; then
      echo "Replace real names/client/tool metadata with generic platform terms before committing." >&2
      exit 1
    fi
    ;;
  --commit-msg)
    msg_path="${2:-}"
    if [ -z "$msg_path" ] || [ ! -f "$msg_path" ]; then
      usage >&2
      exit 2
    fi
    if ! scan_text "commit message" "$(cat "$msg_path")"; then
      echo "Commit message violates CLAUDE.md Client Abstraction Rule." >&2
      exit 1
    fi
    if ! check_conventional_commit_message "$msg_path"; then
      exit 1
    fi
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

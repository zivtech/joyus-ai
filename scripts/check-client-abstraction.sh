#!/usr/bin/env bash
# Guard CLAUDE.md abstraction rules and Conventional Commit messages.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/check-client-abstraction.sh --staged
  scripts/check-client-abstraction.sh --all
  scripts/check-client-abstraction.sh --commit-msg <path>

  --staged      Scan files staged for commit (pre-commit hook).
  --all         Scan every tracked file in the working tree (CI).
  --commit-msg  Scan a commit message and check Conventional Commits format.
USAGE
}

mode="${1:-}"

# Specific failures we have hit before: real reviewer names and internal
# checkpoint metadata leaking into public specs, docs, or commit messages.
#
# Absolute home-directory paths (e.g. /Users/<name>/... or /home/<name>/...)
# leak a developer's real username and a machine-local layout. Repo artifacts
# MUST use repo-relative invocations instead. We match the home root followed
# by a username segment and a trailing slash so generic mentions of "/home"
# or "/Users" without a user segment do not trip the guard.
PATTERNS=(
  'reviewed_by:[[:space:]]*["'"'"']?[A-Z][A-Za-z]+[[:space:]][A-Z][A-Za-z-]+'
  'agent:[[:space:]]*["'"'"']?c[l]aude[-_a-zA-Z0-9]*'
  '–[[:space:]]*c[l]aude[-_a-zA-Z0-9]*[[:space:]]*–'
  'Entire[-]Checkpoint:'
  '/Users/[A-Za-z0-9._-]+/'
  '/home/[A-Za-z0-9._-]+/'
)

is_exempt_file() {
  case "$1" in
    CLAUDE.md|.githooks/*|scripts/check-client-abstraction.sh|kitty-specs/*/tasks/*)
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

  # Capture matches in a variable rather than a temp file: a redirect failure
  # inside an `if` condition is not caught by `set -e`, so an unwritable temp
  # dir used to make every pattern silently pass. grep exits 0 on a match,
  # 1 on no match, and >=2 on error; anything but 0/1 fails the check closed.
  local pattern matches status
  for pattern in "${PATTERNS[@]}"; do
    status=0
    matches=$(printf '%s' "$content" | grep -En -e "$pattern") || status=$?
    case "$status" in
      0)
        echo "Client abstraction guard failed in ${label}:" >&2
        printf '%s\n' "$matches" >&2
        echo "" >&2
        failed=1
        ;;
      1)
        ;;
      *)
        echo "Client abstraction guard error in ${label}: grep exited ${status} for pattern '${pattern}'; failing closed." >&2
        failed=1
        ;;
    esac
  done

  return "$failed"
}

# Full-tree scan. One `git grep` pass over all tracked files finds candidate
# files quickly; each candidate then goes through the same is_exempt_file and
# scan_text used by --staged, so exemptions and reporting have one definition.
# Binary files are skipped (-I). Any git error, unreadable path, or
# disagreement between git grep and scan_text fails closed.
scan_all() {
  # errexit is suppressed while this runs inside `if`, so check each step.
  local top
  if ! top=$(git rev-parse --show-toplevel) || ! cd "$top"; then
    echo "Client abstraction guard error: not inside a git work tree; failing closed." >&2
    return 1
  fi

  local grep_args=() pattern
  for pattern in "${PATTERNS[@]}"; do grep_args+=(-e "$pattern"); done

  local candidates status=0
  candidates=$(git -c core.quotePath=false grep -l -I -E "${grep_args[@]}" -- .) || status=$?
  case "$status" in
    0) ;;
    1) return 0 ;;
    *)
      echo "Client abstraction guard error: git grep exited ${status}; failing closed." >&2
      return 1
      ;;
  esac

  # Split on newlines with parameter expansion, not a heredoc or here-string:
  # bash may back those with a temp file, and a failed temp-file write would
  # skip the loop and pass silently.
  local failed=0 file content rest="${candidates}"$'\n'
  while [ -n "$rest" ]; do
    file=${rest%%$'\n'*}
    rest=${rest#*$'\n'}
    [ -n "$file" ] || continue
    is_exempt_file "$file" && continue
    if [ ! -f "$file" ] || ! content=$(cat -- "$file"); then
      echo "Client abstraction guard error: cannot read '${file}' reported by git grep; failing closed." >&2
      failed=1
      continue
    fi
    if scan_text "$file" "$content"; then
      echo "Client abstraction guard error: git grep matched '${file}' but scan_text did not; failing closed." >&2
    fi
    failed=1
  done

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
    files=()
    while IFS= read -r f; do files+=("$f"); done < <(git diff --cached --name-only --diff-filter=ACMR)
    if [ "${#files[@]}" -eq 0 ]; then exit 0; fi
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
  --all)
    if ! scan_all; then
      echo "Replace real names/client/tool metadata with generic platform terms." >&2
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

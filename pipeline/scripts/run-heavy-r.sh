#!/bin/sh
# POSIX counterpart of run-heavy-r.ps1 for the Raspberry Pi host (#1177).
set -eu
lock=/tmp/lusk-integration-contract-db.lock
(
  if ! flock -w 1 9; then
    printf 'Waiting for %s ...\n' "$lock" >&2
    flock -w 3599 9
  fi
  printf 'Heavy-run lock acquired: %s\n' "$lock"
  LUSK_HEAVY_TEST_LOCK_HELD=1 "$@"
) 9>"$lock"

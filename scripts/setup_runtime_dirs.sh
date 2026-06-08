#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

mkdir -p "$REPO_ROOT/EMA/runtime"
mkdir -p "$REPO_ROOT/EMA/runtime/materials/exports"
mkdir -p "$REPO_ROOT/EMA/runtime/logs"
mkdir -p "$REPO_ROOT/EMA/runtime/models"

echo "Runtime directories are ready under EMA/runtime."

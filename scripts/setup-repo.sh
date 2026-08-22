#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
git -C "$repo_root" config core.hooksPath .githooks
printf '%s\n' "Configured Git hooks from $repo_root/.githooks"

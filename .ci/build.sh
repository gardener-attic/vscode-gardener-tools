#!/usr/bin/env bash
set -e
if [ -z "$OUT_PATH" ]; then
  OUT_PATH="$(readlink -f $(dirname ${0})/../out)"
else
  OUT_PATH="$(readlink -f $OUT_PATH)"
fi

pushd "${MAIN_REPO_DIR}"

apk add npm
npm install

npm install -g vsce
vsce package -o "${OUT_PATH}/build-result"

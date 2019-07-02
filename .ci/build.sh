#!/usr/bin/env bash
set -e
if [ -z "$OUT_PATH" ]; then
  OUT_PATH="$(readlink -f $(dirname ${0})/../out)"
fi

apt-get install -y npm
npm install

npm install -g vsce
vsce package -o "${OUT_PATH}/build-result"
#!/bin/sh
# Builds the side-by-side demo (React 19, production builds of both libraries).
# Serve with: node bench/serve.mjs 5200 demo   (or: yarn demo)
set -e
cd "$(dirname "$0")"

# Stock react-select source, from the upstream commit this fork is based on.
if [ ! -d ../bench/upstream ]; then
  mkdir -p ../bench/upstream
  git -C .. archive 4b69480 packages/react-select/src | tar -x -C ../bench/upstream
fi

R19=../compat/react19/node_modules
[ -d "$R19/react" ] || (cd ../compat/react19 && npm ci --no-audit --no-fund --loglevel=error)

npx -y esbuild@0.24.0 demo.tsx --bundle --minify --outfile=demo.js \
  --define:process.env.NODE_ENV=\"production\" --jsx-factory=React.createElement \
  --alias:react=$R19/react --alias:react-dom=$R19/react-dom
echo "Built. Run: node bench/serve.mjs 5200 demo, then open http://127.0.0.1:5200/"

#!/bin/sh
# Builds the side-by-side benchmark: stock react-select (from the upstream
# commit this fork is based on) vs the working tree.
set -e
cd "$(dirname "$0")"
rm -rf upstream && mkdir upstream
git -C .. archive 4b69480 packages/react-select/src | tar -x -C upstream
ESBUILD="npx -y esbuild@0.24.0 bench.tsx --bundle --minify \
  --define:process.env.NODE_ENV=\"production\" --jsx-factory=React.createElement"

# React 16 (repo root node_modules)
$ESBUILD --outfile=bench.js --alias:bench-root=./root-legacy.tsx

# React 19 (compat/react19 toolchain; run compat/run.sh first to install it)
R19=../compat/react19/node_modules
if [ -d "$R19/react" ]; then
  $ESBUILD --outfile=bench-react19.js --alias:bench-root=./root-concurrent.tsx \
    --alias:react=$R19/react --alias:react-dom=$R19/react-dom
else
  echo "Skipping React 19 bench: compat/react19 not installed"
fi
echo "Built. Run: yarn bench:serve, open http://127.0.0.1:5199/ (or ?react=19) and call await runBench(5000) in the console."

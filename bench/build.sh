#!/bin/sh
# Builds the side-by-side benchmark: stock react-select (from the upstream
# commit this fork is based on) vs the working tree.
set -e
cd "$(dirname "$0")"
rm -rf upstream && mkdir upstream
git -C .. archive 4b69480 packages/react-select/src | tar -x -C upstream
npx -y esbuild@0.24.0 bench.tsx --bundle --minify --outfile=bench.js \
  --define:process.env.NODE_ENV='"production"' --jsx-factory=React.createElement
echo "Built. Run: yarn bench:serve, then open http://127.0.0.1:5199/ and call await runBench(5000) in the console."

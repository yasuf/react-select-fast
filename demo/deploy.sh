#!/bin/sh
# Builds the demo and publishes it to the gh-pages branch of origin, which
# GitHub Pages serves at https://<owner>.github.io/react-select-fast/.
# gh-pages holds only the built files; each deploy replaces it.
set -e
cd "$(dirname "$0")/.."

sh demo/build.sh
remote=$(git remote get-url origin)
sha=$(git rev-parse --short HEAD)
dirty=$(git status --porcelain -- demo packages/react-select/src | head -1)

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
cp demo/index.html demo/demo.css demo/demo.js "$out"/
touch "$out/.nojekyll" # serve files as-is, no Jekyll processing

cd "$out"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy demo from $sha${dirty:+ (with uncommitted changes)}"
git push -q --force "$remote" gh-pages
echo "Deployed $sha to gh-pages."

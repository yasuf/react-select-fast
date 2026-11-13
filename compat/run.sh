#!/bin/sh
# Runs the test suite on React 17, 18 and 19 against both the fork and stock
# react-select 5.10.2, and fails if any test fails on the fork but passes
# upstream. (A few upstream tests fail on newer React regardless; those are
# reported but not counted against the fork.)
set -e
cd "$(dirname "$0")/.."

[ -d bench/upstream ] || sh bench/build.sh
for v in 17 18 19; do
  [ -d compat/react$v/node_modules ] ||
    (cd compat/react$v && npm ci --no-audit --no-fund --loglevel=error)
done

for v in 17 18 19; do
  for src in upstream fast; do
    echo "React $v / $src..."
    REACT=$v SRC=$src npx jest -c compat/jest.config.js --ci --silent \
      --json --outputFile=compat/.result-$v-$src.json >/dev/null 2>&1 || true
  done
done

node -e '
const path = require("path");
const load = (v, src) => {
  const r = require(path.resolve("compat/.result-" + v + "-" + src + ".json"));
  const failed = r.testResults.flatMap((t) =>
    t.status === "failed" && !t.assertionResults.length
      ? [path.basename(t.name) + " :: <suite failed to run>"]
      : t.assertionResults
          .filter((a) => a.status === "failed")
          .map((a) => path.basename(t.name) + " :: " + a.fullName)
  );
  return { passed: r.numPassedTests, failed };
};
let bad = false;
for (const v of ["17", "18", "19"]) {
  const up = load(v, "upstream"), fast = load(v, "fast");
  const regressions = fast.failed.filter((f) => !up.failed.includes(f));
  console.log(
    `React ${v}: fork ${fast.passed} passed, ${fast.failed.length} failed | ` +
      `upstream ${up.passed} passed, ${up.failed.length} failed | ` +
      `fork-only failures: ${regressions.length}`
  );
  regressions.forEach((f) => console.log("  REGRESSION " + f));
  up.failed.forEach((f) => console.log("  (also fails upstream) " + f));
  if (regressions.length) bad = true;
}
process.exit(bad ? 1 : 0);
'

// Runs the react-select test suite against a pinned React version.
//
//   REACT=18 SRC=fast npx jest -c compat/jest.config.js
//
// REACT: 17 | 18 | 19 (toolchains in compat/react<N>, installed by compat/run.sh)
// SRC:   fast     -> packages/react-select/src (this fork)
//        upstream -> bench/upstream/packages/react-select/src (stock 5.10.2,
//                    extracted by bench/build.sh)
const path = require('path');

const react = process.env.REACT;
if (!['17', '18', '19'].includes(react)) {
  throw new Error('Set REACT to 17, 18 or 19');
}
const src = process.env.SRC === 'upstream' ? 'upstream' : 'fast';

const repo = path.resolve(__dirname, '..');
const toolchain = path.join(__dirname, `react${react}`, 'node_modules');
const srcDir =
  src === 'upstream'
    ? path.join(repo, 'bench/upstream/packages/react-select/src')
    : path.join(repo, 'packages/react-select/src');

module.exports = {
  rootDir: repo,
  roots: [srcDir],
  testRegex:
    'src/*(/(__tests?__/)([^_].*/)*?[^_][^/]*?\\.(test|spec)?\\.(ts|js)x?)$',
  setupFilesAfterEnv: [path.join(repo, 'test-setup.js')],
  snapshotSerializers: ['@emotion/jest/serializer'],
  // Every module (tests, react-select, emotion, user-event) must share one
  // React and one @testing-library/dom, or act() wrapping and hooks break.
  moduleNameMapper: {
    '^react$': path.join(toolchain, 'react'),
    '^react/(.*)$': path.join(toolchain, 'react/$1'),
    '^react-dom$': path.join(toolchain, 'react-dom'),
    '^react-dom/(.*)$': path.join(toolchain, 'react-dom/$1'),
    '^@testing-library/react$': path.join(toolchain, '@testing-library/react'),
    '^@testing-library/dom$': path.join(toolchain, '@testing-library/dom'),
  },
};

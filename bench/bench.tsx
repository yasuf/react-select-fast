// Side-by-side benchmark: stock react-select (git HEAD source) vs react-select-fast.
// Both are bundled into one page and run alternately so they share conditions.
// Each measurement is the time from dispatching a real DOM event until React
// has committed (we wait one macrotask, which covers React 18+'s microtask and
// scheduler flushes; React 16/17 commit synchronously), plus a forced layout
// so style recalculation is included.
//
// `bench-root` is aliased at build time to root-legacy.tsx (React 16) or
// root-concurrent.tsx (React 19); see build.sh.
import React from 'react';
// @ts-ignore resolved by the bundler alias
import { mount as mountRoot, reactVersion } from 'bench-root';
import UpstreamSelect from './upstream/packages/react-select/src/index';
import FastSelect from '../packages/react-select/src/index';

const IMPLS = { upstream: UpstreamSelect, fast: FastSelect } as const;
type ImplName = keyof typeof IMPLS;

const WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliett',
  'kilo',
  'lima',
  'mike',
  'november',
  'oscar',
  'papa',
  'quebec',
  'romeo',
  'sierra',
  'tango',
  'uniform',
  'victor',
  'whiskey',
  'xray',
  'yankee',
  'zulu',
  'café',
  'São Paulo',
  'Zürich',
  'Ærøskøbing',
];

const makeOptions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    value: `v${i}`,
    label: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${i}`,
  }));

const now = () => performance.now();
const forceLayout = () => document.body.offsetHeight;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const channel = new MessageChannel();
const macrotask = () =>
  new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

const timed = async (fn: () => void) => {
  const t0 = now();
  fn();
  await macrotask();
  forceLayout();
  return now() - t0;
};

interface Result {
  mount: number;
  hover: number;
  keyboard: number;
  typing: number;
}

// A custom styles.option forces react-select-fast onto its conservative path,
// where any prop change (e.g. typing) re-renders every visible option.
const CUSTOM_STYLES = {
  option: (base: object) => ({ ...base, letterSpacing: '0.01em' }),
};

async function runOnce(
  impl: ImplName,
  n: number,
  customStyles = false
): Promise<Result> {
  const Select = IMPLS[impl] as any;
  const host = document.createElement('div');
  host.style.width = '400px';
  document.getElementById('stage')!.appendChild(host);
  const options = makeOptions(n);

  let unmount = () => {};
  const mount = await timed(() => {
    unmount = mountRoot(
      <Select
        options={options}
        menuIsOpen
        classNamePrefix="rs"
        maxMenuHeight={300}
        styles={customStyles ? CUSTOM_STYLES : undefined}
      />,
      host
    );
  });

  // Hover: move the pointer across 40 consecutive options.
  const optionEls = host.querySelectorAll('.rs__option');
  const hovers: number[] = [];
  for (let i = 0; i < 40; i++) {
    hovers.push(
      await timed(() =>
        optionEls[i].dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true })
        )
      )
    );
  }

  // Keyboard: ArrowDown 40 times.
  const input = host.querySelector('input')!;
  const keys: number[] = [];
  for (let i = 0; i < 40; i++) {
    keys.push(
      await timed(() =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        )
      )
    );
  }

  // Typing: type a query one character at a time, then delete it.
  const typing: number[] = [];
  const sequence = [
    'a',
    'al',
    'alp',
    'al',
    'a',
    '',
    'e',
    'ec',
    'e',
    '',
    'z',
    'zu',
    'z',
    '',
  ];
  for (const value of sequence) {
    typing.push(await timed(() => setInputValue(input, value)));
  }

  unmount();
  host.remove();
  return {
    mount,
    hover: median(hovers),
    keyboard: median(keys),
    typing: median(typing),
  };
}

async function runBench(n: number, rounds = 5, customStyles = false) {
  const results: Record<ImplName, Result[]> = { upstream: [], fast: [] };
  // warm up JIT for both
  await runOnce('upstream', Math.min(n, 200), customStyles);
  await runOnce('fast', Math.min(n, 200), customStyles);
  for (let r = 0; r < rounds; r++) {
    const order: ImplName[] =
      r % 2 ? ['fast', 'upstream'] : ['upstream', 'fast'];
    for (const impl of order) {
      results[impl].push(await runOnce(impl, n, customStyles));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const summarize = (rs: Result[]) => ({
    mount: median(rs.map((r) => r.mount)),
    hover: median(rs.map((r) => r.hover)),
    keyboard: median(rs.map((r) => r.keyboard)),
    typing: median(rs.map((r) => r.typing)),
  });
  return {
    react: reactVersion,
    n,
    upstream: summarize(results.upstream),
    fast: summarize(results.fast),
  };
}

(window as any).runBench = runBench;
document.getElementById('status')!.textContent = 'ready';

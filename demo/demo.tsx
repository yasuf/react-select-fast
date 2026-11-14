// Side-by-side demo: stock react-select 5.10.2 vs react-select-fast, both on
// React 19 in the same page (and so on the same main thread).
//
// Latency is measured per panel from the input event (captured on the panel
// before React sees it) to the end of the React commit it causes, including
// style recalculation and layout. The commit is detected by a MenuList wrapper
// whose layout effect runs on every Select render. Both libraries get the same
// wrapper; react-select-fast's fast paths depend only on the Option component,
// which stays the default.
import React, {
  ComponentType,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import StockSelect, {
  components as stockComponents,
} from '../bench/upstream/packages/react-select/src/index';
import FastSelect, {
  components as fastComponents,
} from '../packages/react-select/src/index';
import StockAsync from '../bench/upstream/packages/react-select/src/Async';
import FastAsync from '../packages/react-select/src/Async';

// ==============================
// Data
// ==============================

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

interface DemoOption {
  value: string;
  label: string;
}

const makeOptions = (n: number): DemoOption[] =>
  Array.from({ length: n }, (_, i) => ({
    value: `v${i}`,
    label: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${i}`,
  }));

const COUNTS = [1000, 5000, 10000, 20000];

// ==============================
// Scenarios and the fake server
// ==============================

type Scenario = 'static' | 'fetched' | 'infinite' | 'multi';
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'static', label: 'Static list' },
  { id: 'fetched', label: 'Fetched (async search)' },
  { id: 'infinite', label: 'Infinite scroll' },
  { id: 'multi', label: 'Multiselect' },
];

/** Simulated network round trip, identical for both libraries. */
const FETCH_LATENCY = 250;
/** Infinite scroll loads the dataset in this many pages. */
const INFINITE_PAGES = 20;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Responses are fresh objects, as if parsed from JSON, so cached elements
// can't be reused across responses: the realistic case for fetched data.
const fromServer = (rows: DemoOption[]) => rows.map((o) => ({ ...o }));

const serverSearch = (dataset: DemoOption[], input: string) => {
  const q = input.trim().toLowerCase();
  return fromServer(
    q ? dataset.filter((o) => o.label.toLowerCase().includes(q)) : dataset
  );
};

// A custom styles.option puts react-select-fast in "styled" mode.
const CUSTOM_STYLES = {
  option: (base: object, state: { isFocused: boolean }) => ({
    ...base,
    borderLeft: `3px solid ${state.isFocused ? '#7c5cff' : 'transparent'}`,
  }),
};

// Multiselect: keep the chips area from pushing the menu out of the panel.
// (Only option styles affect react-select-fast's fast paths.)
const MULTI_STYLES = {
  valueContainer: (base: object) => ({
    ...base,
    maxHeight: 76,
    overflowY: 'auto',
  }),
};

// ==============================
// Measurement
// ==============================

type Kind = 'hover' | 'key' | 'type' | 'load' | 'select';
const KIND_LABELS: Record<Kind, string> = {
  hover: 'Hover',
  key: 'Arrow keys',
  type: 'Typing',
  load: 'Load → render',
  select: 'Select / remove',
};
/** The timers each scenario shows. */
const kindsFor = (scenario: Scenario): Kind[] => [
  'hover',
  'key',
  'type',
  ...(scenario === 'fetched' || scenario === 'infinite'
    ? (['load'] as Kind[])
    : []),
  ...(scenario === 'multi' ? (['select'] as Kind[]) : []),
];

interface Sample {
  kind: Kind;
  ms: number;
}

class Meter {
  samples: Sample[] = [];
  private version = 0;
  private pending: { kind: Kind; t0: number; end: number | null } | null = null;
  private finalizeScheduled = false;
  private listeners = new Set<() => void>();

  start(kind: Kind) {
    // A previous interaction that already committed is complete.
    this.finalize();
    this.pending = { kind, t0: performance.now(), end: null };
  }

  /** Called from a layout effect at the end of every Select commit. */
  commit() {
    if (!this.pending) return;
    void document.body.offsetHeight; // include style recalculation + layout
    this.pending.end = performance.now();
    // One interaction can cause several commits (e.g. typing). Keep the last
    // one until the next interaction starts or things have been quiet briefly.
    if (!this.finalizeScheduled) {
      this.finalizeScheduled = true;
      setTimeout(() => {
        this.finalizeScheduled = false;
        this.finalize();
      }, 80);
    }
  }

  private finalize() {
    const p = this.pending;
    if (!p || p.end === null) return;
    this.pending = null;
    this.samples.push({ kind: p.kind, ms: p.end - p.t0 });
    if (this.samples.length > 500) this.samples.splice(0, 100);
    this.emit();
  }

  reset() {
    this.samples = [];
    this.pending = null;
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

const NAV_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
]);

/** Starts a measurement for each interaction inside `root`. */
function useInteractionCapture(root: HTMLElement | null, meter: Meter) {
  useEffect(() => {
    if (!root) return;
    let lastHovered: Element | null = null;
    const onOver = (e: Event) => {
      const option = (e.target as Element).closest('[role="option"]');
      if (!option || option === lastHovered) return;
      lastHovered = option;
      meter.start('hover');
    };
    const onKey = (e: KeyboardEvent) => {
      if (NAV_KEYS.has(e.key)) meter.start('key');
      // Enter picks the focused option; Backspace removes the last value.
      else if (e.key === 'Enter' || e.key === 'Backspace') {
        meter.start('select');
      }
    };
    const onInput = () => meter.start('type');
    // Picking an option, or removing a chip with its ×.
    const onClick = (e: Event) => {
      const target = e.target as Element;
      if (
        target.closest('[role="option"]') ||
        target.closest('[class*="multi-value__remove"]')
      ) {
        meter.start('select');
      }
    };
    root.addEventListener('mouseover', onOver, true);
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('input', onInput, true);
    root.addEventListener('click', onClick, true);
    return () => {
      root.removeEventListener('mouseover', onOver, true);
      root.removeEventListener('keydown', onKey, true);
      root.removeEventListener('input', onInput, true);
      root.removeEventListener('click', onClick, true);
    };
  }, [root, meter]);
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const fmt = (ms: number) =>
  Number.isNaN(ms) ? '—' : ms < 10 ? ms.toFixed(1) : Math.round(ms).toString();
const tone = (ms: number) =>
  Number.isNaN(ms) ? 'none' : ms <= 16 ? 'good' : ms <= 50 ? 'warn' : 'bad';

// ==============================
// Scripted interaction
// ==============================

const channel = new MessageChannel();
const macrotask = () =>
  new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

/**
 * Counts frames that had to fall back to the timer. Background tabs (or a
 * hidden window) pause requestAnimationFrame, which stretches script times
 * for reasons that have nothing to do with rendering.
 */
let throttledFrames = 0;

const nextFrame = () =>
  new Promise<void>((resolve) => {
    // Background tabs pause requestAnimationFrame; fall back to a timer.
    const timer = setTimeout(() => {
      throttledFrames++;
      resolve();
    }, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Wait until the work an event caused is done and a frame could be shown.
 * React schedules non-discrete updates (like hover) as a task posted during
 * the event, so a task posted afterwards runs after it.
 */
const settle = async () => {
  await macrotask();
  await nextFrame();
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const TYPED = ['a', 'al', 'alp', 'alph', 'alpha', 'alph', 'alp', 'al', 'a', ''];
const HOVERS = 60;
const KEYS = 40;

// Multiselect script sizes.
const PICKS = 20;
const MULTI_HOVERS = 30;
const MULTI_KEYS = 20;
const REMOVES = 10;

const scriptSteps = (scenario: Scenario) =>
  scenario === 'multi'
    ? PICKS + MULTI_HOVERS + MULTI_KEYS + REMOVES
    : HOVERS +
      KEYS +
      (scenario === 'infinite' ? INFINITE_PAGES - 1 : TYPED.length);

const describeScript = (scenario: Scenario) =>
  scenario === 'static'
    ? `hover ${HOVERS} options, press ↓ ${KEYS} times, then type “alpha” and delete it`
    : scenario === 'fetched'
    ? `type “alpha” and delete it, waiting for each server response, then hover ${HOVERS} options and press ↓ ${KEYS} times`
    : scenario === 'infinite'
    ? `scroll to the bottom ${
        INFINITE_PAGES - 1
      } times, waiting for each page, then hover ${HOVERS} options and press ↓ ${KEYS} times`
    : `pick ${PICKS} options by clicking, hover ${MULTI_HOVERS} options, press ↓ ${MULTI_KEYS} times, then press Backspace ${REMOVES} times to remove values`;

/**
 * Wheel at the bottom of the menu, which is how react-select detects
 * "scrolled to bottom". The tiny upward wheel first clears its "already at
 * bottom" flag, as the list growing after a page load would.
 */
const scrollMenuToBottom = (root: HTMLElement) => {
  const list = root.querySelector('[role="listbox"]') as HTMLElement | null;
  if (!list) return;
  list.scrollTop = list.scrollHeight;
  const wheel = (deltaY: number) =>
    list.dispatchEvent(
      new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    );
  wheel(-1);
  wheel(100);
};

/**
 * Plays the scenario's script on a panel, one step per animation frame so it
 * is visible. Network waits are identical for both libraries; any extra time
 * is rendering. Returns the wall-clock time.
 */
async function runScript(
  scenario: Scenario,
  root: HTMLElement,
  onStep: (done: number) => void
) {
  const input = root.querySelector('input')!;
  const throttledBefore = throttledFrames;
  setInputValue(input, '');
  if (scenario === 'fetched') await sleep(FETCH_LATENCY + 50);
  await settle();
  const t0 = performance.now();
  let step = 0;
  const tick = () => onStep(++step);

  const hoverAndKeys = async (hovers = HOVERS, keys = KEYS) => {
    const list = root.querySelector('[role="listbox"]') as HTMLElement | null;
    if (list) list.scrollTop = 0;
    for (let i = 0; i < hovers; i++) {
      const option = root.querySelectorAll('[role="option"]')[i];
      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      tick();
      await settle();
    }
    for (let i = 0; i < keys; i++) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
      tick();
      await settle();
    }
  };

  if (scenario === 'static') {
    await hoverAndKeys();
    for (const value of TYPED) {
      setInputValue(input, value);
      tick();
      await settle();
    }
  } else if (scenario === 'fetched') {
    for (const value of TYPED) {
      setInputValue(input, value);
      tick();
      await sleep(FETCH_LATENCY + 30);
      await settle();
    }
    await hoverAndKeys();
  } else if (scenario === 'infinite') {
    for (let i = 0; i < INFINITE_PAGES - 1; i++) {
      scrollMenuToBottom(root);
      tick();
      await sleep(FETCH_LATENCY + 30);
      await settle();
    }
    await hoverAndKeys();
  } else {
    // Picked options leave the menu, so spread the picks over the list.
    for (let i = 0; i < PICKS; i++) {
      const options = root.querySelectorAll('[role="option"]');
      const option = options[(i * 7) % Math.min(options.length, 40)];
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      tick();
      await settle();
    }
    await hoverAndKeys(MULTI_HOVERS, MULTI_KEYS);
    for (let i = 0; i < REMOVES; i++) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
      tick();
      await settle();
    }
  }
  return {
    ms: performance.now() - t0,
    // A tab hidden during the run makes its total meaningless.
    throttled:
      throttledFrames > throttledBefore ||
      document.visibilityState !== 'visible',
  };
}

// ==============================
// Components
// ==============================

type Lib = 'stock' | 'fast';

interface ScriptState {
  done: number;
  ms: number | null;
  throttled?: boolean;
}
const LIBS: Record<
  Lib,
  {
    title: string;
    Select: ComponentType<any>;
    Async: ComponentType<any>;
    MenuList: ComponentType<any>;
  }
> = {
  stock: {
    title: 'react-select',
    Select: StockSelect,
    Async: StockAsync,
    MenuList: stockComponents.MenuList,
  },
  fast: {
    title: 'react-select-fast',
    Select: FastSelect,
    Async: FastAsync,
    MenuList: fastComponents.MenuList,
  },
};

const makeTimedMenuList = (Base: ComponentType<any>, meter: Meter) =>
  function TimedMenuList(props: any) {
    useLayoutEffect(() => meter.commit());
    return <Base {...props} />;
  };

/** Async search: every keystroke queries the fake server. */
function FetchedSelect({
  Async,
  common,
  dataset,
  meter,
}: {
  Async: ComponentType<any>;
  common: object;
  dataset: DemoOption[];
  meter: Meter;
}) {
  // The initial (defaultOptions) load happens on mount for both panels at
  // once; they share a React root, so it would be timed as one combined
  // commit. Only loads caused by the user's input are timed.
  const requests = useRef(0);
  const loadOptions = useCallback(
    (input: string) => {
      const timed = requests.current++ > 0;
      return new Promise<DemoOption[]>((resolve) =>
        setTimeout(() => {
          const results = serverSearch(dataset, input);
          if (timed) meter.start('load'); // arrived; time until on screen
          resolve(results);
        }, FETCH_LATENCY)
      );
    },
    [dataset, meter]
  );
  return (
    <Async
      {...common}
      defaultOptions
      loadOptions={loadOptions}
      placeholder="Type to search the server…"
    />
  );
}

/** Loads the next page when the menu is scrolled to the bottom. */
function InfiniteSelect({
  Select,
  common,
  dataset,
  meter,
}: {
  Select: ComponentType<any>;
  common: object;
  dataset: DemoOption[];
  meter: Meter;
}) {
  const pageSize = Math.max(50, Math.ceil(dataset.length / INFINITE_PAGES));
  const [options, setOptions] = useState(() =>
    fromServer(dataset.slice(0, pageSize))
  );
  const [loading, setLoading] = useState(false);
  const loaded = useRef(pageSize);
  const inFlight = useRef(false);

  const loadMore = useCallback(() => {
    if (inFlight.current || loaded.current >= dataset.length) return;
    inFlight.current = true;
    setLoading(true);
    setTimeout(() => {
      const next = fromServer(
        dataset.slice(loaded.current, loaded.current + pageSize)
      );
      loaded.current += next.length;
      inFlight.current = false;
      meter.start('load');
      setOptions((prev) => [...prev, ...next]);
      setLoading(false);
    }, FETCH_LATENCY);
  }, [dataset, meter, pageSize]);

  return (
    <Select
      {...common}
      options={options}
      isLoading={loading}
      onMenuScrollToBottom={loadMore}
      placeholder={`Scroll the list to load more · ${options.length.toLocaleString()} of ${dataset.length.toLocaleString()} loaded`}
    />
  );
}

// Memoized with stable props so the Select only re-renders from its own
// interactions and data, never from the stats around it.
const SelectHost = memo(function SelectHost({
  lib,
  scenario,
  dataset,
  styled,
  meter,
}: {
  lib: Lib;
  scenario: Scenario;
  dataset: DemoOption[];
  styled: boolean;
  meter: Meter;
}) {
  const { Select, Async, MenuList } = LIBS[lib];
  const common = useMemo(
    () => ({
      menuIsOpen: true,
      classNamePrefix: 'rs',
      maxMenuHeight: 300,
      components: { MenuList: makeTimedMenuList(MenuList, meter) },
      styles:
        scenario === 'multi'
          ? { ...(styled ? CUSTOM_STYLES : {}), ...MULTI_STYLES }
          : styled
          ? CUSTOM_STYLES
          : undefined,
      'aria-label': `${LIBS[lib].title} demo select`,
    }),
    [lib, MenuList, meter, styled, scenario]
  );
  if (scenario === 'fetched') {
    return (
      <FetchedSelect
        Async={Async}
        common={common}
        dataset={dataset}
        meter={meter}
      />
    );
  }
  if (scenario === 'infinite') {
    return (
      <InfiniteSelect
        Select={Select}
        common={common}
        dataset={dataset}
        meter={meter}
      />
    );
  }
  if (scenario === 'multi') {
    return (
      <Select
        {...common}
        isMulti
        closeMenuOnSelect={false}
        options={dataset}
        placeholder="Pick several…"
      />
    );
  }
  return <Select {...common} options={dataset} placeholder="Type to filter…" />;
});

function Stats({ meter, scenario }: { meter: Meter; scenario: Scenario }) {
  useSyncExternalStore(meter.subscribe, meter.getVersion);
  const { samples } = meter;
  const recent = samples.slice(-64);
  // Same fixed scale on both panels so their bars compare directly.
  const scale = 100;
  const last = samples[samples.length - 1];

  return (
    <div className="stats">
      <div className="stat-grid">
        {kindsFor(scenario).map((kind) => {
          const label = KIND_LABELS[kind];
          const xs = samples.filter((s) => s.kind === kind).slice(-50);
          const med = median(xs.map((s) => s.ms));
          return (
            <div className="stat" key={kind}>
              <div className="stat-label">{label}</div>
              <div className={`stat-value tone-${tone(med)}`}>
                {fmt(med)}
                <span className="unit">ms</span>
              </div>
              <div className="stat-sub">
                p95{' '}
                {fmt(
                  percentile(
                    xs.map((s) => s.ms),
                    0.95
                  )
                )}{' '}
                ms · n=
                {xs.length}
              </div>
            </div>
          );
        })}
      </div>
      <div className="spark" aria-label="Latency of recent interactions">
        {recent.length === 0 ? (
          <div className="spark-empty">
            Interact with the list to see each event’s latency
          </div>
        ) : (
          recent.map((s, i) => (
            <div
              key={i}
              className={`bar tone-${tone(s.ms)}`}
              style={{
                height: `${Math.min(100, Math.max(3, (s.ms / scale) * 100))}%`,
              }}
              title={`${s.kind}: ${s.ms.toFixed(1)} ms`}
            />
          ))
        )}
        <div
          className="spark-line"
          style={{ bottom: `${(16 / scale) * 100}%` }}
          title="16 ms (one 60 fps frame)"
        />
      </div>
      <div className="last">
        Last:{' '}
        {last ? (
          <b className={`tone-${tone(last.ms)}`}>
            {last.ms.toFixed(1)} ms ({last.kind})
          </b>
        ) : (
          '—'
        )}
      </div>
    </div>
  );
}

function Panel({
  lib,
  scenario,
  options,
  styled,
  meter,
  rootRef,
  script,
  onRun,
  busy,
}: {
  lib: Lib;
  scenario: Scenario;
  options: DemoOption[];
  styled: boolean;
  meter: Meter;
  rootRef: (el: HTMLDivElement | null) => void;
  script: ScriptState | undefined;
  onRun: () => void;
  busy: boolean;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useInteractionCapture(root, meter);
  // Stable ref callback, so progress re-renders don't re-attach listeners.
  const latestRootRef = useRef(rootRef);
  latestRootRef.current = rootRef;
  const setAreaRef = useCallback((el: HTMLDivElement | null) => {
    setRoot(el);
    latestRootRef.current(el);
  }, []);
  const { title } = LIBS[lib];
  return (
    <section className={`panel panel-${lib}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-actions">
          <button onClick={onRun} disabled={busy}>
            Run script
          </button>
          <button className="ghost" onClick={() => meter.reset()}>
            Reset
          </button>
        </div>
      </header>
      <div className="select-area" ref={setAreaRef}>
        <SelectHost
          key={`${scenario}-${options.length}-${styled}`}
          lib={lib}
          scenario={scenario}
          dataset={options}
          styled={styled}
          meter={meter}
        />
      </div>
      <div className="script">
        <div className="progress">
          <div
            className="progress-fill"
            style={{
              width: `${((script?.done ?? 0) / scriptSteps(scenario)) * 100}%`,
            }}
          />
        </div>
        <div className="script-time">
          {script?.ms != null
            ? `Script: ${(script.ms / 1000).toFixed(2)} s${
                script.throttled ? ' (tab was hidden)' : ''
              }`
            : script
            ? 'Running…'
            : `Script: ${scriptSteps(scenario)} steps`}
        </div>
      </div>
      <Stats meter={meter} scenario={scenario} />
    </section>
  );
}

/** Main-thread frame times, drawn on a canvas outside React. */
function FrameMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    let colors = { good: '', warn: '', bad: '', grid: '' };
    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      colors = {
        good: cs.getPropertyValue('--good').trim(),
        warn: cs.getPropertyValue('--warn').trim(),
        bad: cs.getPropertyValue('--bad').trim(),
        grid: cs.getPropertyValue('--border').trim(),
      };
    };
    readColors();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', readColors);

    const draw = (now: number) => {
      frames.push(now - last);
      last = now;
      if (frames.length > 240) frames.shift();
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const max = 100;
      const y16 = h - (16.7 / max) * h;
      ctx.strokeStyle = colors.grid;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y16);
      ctx.lineTo(w, y16);
      ctx.stroke();
      ctx.setLineDash([]);
      const bw = w / 240;
      frames.forEach((ft, i) => {
        const bh = Math.min(h, (ft / max) * h);
        ctx.fillStyle =
          ft <= 20 ? colors.good : ft <= 50 ? colors.warn : colors.bad;
        ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
      });
      const recent = frames.slice(-60);
      const worst = Math.max(...recent);
      const fps = 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length);
      if (labelRef.current) {
        labelRef.current.textContent = `${Math.round(
          fps
        )} fps · worst frame ${Math.round(worst)} ms`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', readColors);
    };
  }, []);
  return (
    <div className="frame-meter">
      <div className="frame-head">
        <span>Main thread</span>
        <span ref={labelRef} className="frame-label" />
      </div>
      <canvas ref={canvasRef} aria-label="Frame time graph" />
    </div>
  );
}

function App() {
  const [count, setCount] = useState(5000);
  const [styled, setStyled] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('static');
  const options = useMemo(() => makeOptions(count), [count]);
  const meters = useMemo(() => ({ stock: new Meter(), fast: new Meter() }), []);
  const roots = useRef<Record<Lib, HTMLElement | null>>({
    stock: null,
    fast: null,
  });
  const [scripts, setScripts] = useState<Partial<Record<Lib, ScriptState>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    meters.stock.reset();
    meters.fast.reset();
    setScripts({});
  }, [count, styled, scenario, meters]);

  const run = async (libs: Lib[]) => {
    setBusy(true);
    setScripts((s) => {
      const next = { ...s };
      libs.forEach((l) => delete next[l]);
      return next;
    });
    for (const lib of libs) {
      const root = roots.current[lib];
      if (!root) continue;
      setScripts((s) => ({ ...s, [lib]: { done: 0, ms: null } }));
      await nextFrame();
      const { ms, throttled } = await runScript(scenario, root, (done) =>
        setScripts((s) => ({ ...s, [lib]: { done, ms: null } }))
      );
      setScripts((s) => ({
        ...s,
        [lib]: { done: scriptSteps(scenario), ms, throttled },
      }));
    }
    setBusy(false);
  };

  const stockMs = scripts.stock?.ms;
  const fastMs = scripts.fast?.ms;
  const raceThrottled = !!(scripts.stock?.throttled || scripts.fast?.throttled);

  return (
    <main>
      <header className="top">
        <div className="title">
          <h1>react-select vs react-select-fast</h1>
          <p>
            The same Select, same data, side by side on React 19. Hover the
            lists, press ↑/↓ after clicking a list, type to filter, or scroll to
            load more. Each panel times every interaction from the input event,
            and every data load from its arrival, until React has committed and
            laid out.
          </p>
        </div>
        <div className="controls">
          <label>
            Scenario
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Scenario)}
              disabled={busy}
            >
              {SCENARIOS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {scenario === 'static' ? 'Options' : 'Dataset size'}
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={busy}
            >
              {COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Option styling
            <select
              value={styled ? 'styled' : 'default'}
              onChange={(e) => setStyled(e.target.value === 'styled')}
              disabled={busy}
            >
              <option value="default">Default</option>
              <option value="styled">Custom styles.option</option>
            </select>
          </label>
          <button
            className="primary"
            onClick={() => run(['stock', 'fast'])}
            disabled={busy}
          >
            Race both
          </button>
        </div>
      </header>

      {stockMs != null && fastMs != null && (
        <div className="race" role="status">
          <span>
            Same script ({SCENARIOS.find((x) => x.id === scenario)!.label},{' '}
            {count.toLocaleString()} options): stock{' '}
            <b>{(stockMs / 1000).toFixed(2)} s</b>, fast{' '}
            <b>{(fastMs / 1000).toFixed(2)} s</b>
          </span>
          {raceThrottled ? (
            <span className="race-warn">
              The tab was hidden during the run, which pauses animation frames,
              so these totals aren’t comparable. Keep the tab visible and race
              again.
            </span>
          ) : (
            <span className="race-x">
              {(stockMs / fastMs).toFixed(1)}× faster
            </span>
          )}
        </div>
      )}

      <FrameMeter />

      <div className="panels">
        {(['stock', 'fast'] as Lib[]).map((lib) => (
          <Panel
            key={lib}
            lib={lib}
            scenario={scenario}
            options={options}
            styled={styled}
            meter={meters[lib]}
            rootRef={(el) => {
              roots.current[lib] = el;
            }}
            script={scripts[lib]}
            onRun={() => run([lib])}
            busy={busy}
          />
        ))}
      </div>

      <footer className="foot">
        The script for this scenario: {describeScript(scenario)}, one step per
        animation frame.{' '}
        {scenario === 'static'
          ? `At 60 fps that takes about ${(
              (scriptSteps(scenario) * 16.7) /
              1000
            ).toFixed(1)} s; anything longer is time spent rendering.`
          : `Each request waits ${FETCH_LATENCY} ms of simulated network for both libraries, so the difference in total time is rendering.`}{' '}
        Fetched and loaded options arrive as new objects, like JSON from a real
        API. Both selects share one main thread, so the frame graph spikes
        whichever panel is busy.
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

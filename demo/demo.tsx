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

// A custom styles.option puts react-select-fast in "styled" mode.
const CUSTOM_STYLES = {
  option: (base: object, state: { isFocused: boolean }) => ({
    ...base,
    borderLeft: `3px solid ${state.isFocused ? '#7c5cff' : 'transparent'}`,
  }),
};

// ==============================
// Measurement
// ==============================

type Kind = 'hover' | 'key' | 'type';
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'hover', label: 'Hover' },
  { kind: 'key', label: 'Arrow keys' },
  { kind: 'type', label: 'Typing' },
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
    };
    const onInput = () => meter.start('type');
    root.addEventListener('mouseover', onOver, true);
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('input', onInput, true);
    return () => {
      root.removeEventListener('mouseover', onOver, true);
      root.removeEventListener('keydown', onKey, true);
      root.removeEventListener('input', onInput, true);
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

const nextFrame = () =>
  new Promise<void>((resolve) => {
    // Background tabs pause requestAnimationFrame; fall back to a timer.
    const timer = setTimeout(resolve, 100);
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
const SCRIPT_STEPS = 60 + 40 + TYPED.length;

/**
 * Plays the same interaction on a panel, one step per animation frame so it
 * is visible: a 60-option hover sweep, 40 ArrowDowns, then typing "alpha" and
 * deleting it. Returns the wall-clock time; a slow library stretches each
 * step past one frame.
 */
async function runScript(root: HTMLElement, onStep: (done: number) => void) {
  const input = root.querySelector('input')!;
  setInputValue(input, '');
  await nextFrame();
  const t0 = performance.now();
  let step = 0;
  for (let i = 0; i < 60; i++) {
    const option = root.querySelectorAll('[role="option"]')[i];
    option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    onStep(++step);
    await settle();
  }
  for (let i = 0; i < 40; i++) {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    onStep(++step);
    await settle();
  }
  for (const value of TYPED) {
    setInputValue(input, value);
    onStep(++step);
    await settle();
  }
  return performance.now() - t0;
}

// ==============================
// Components
// ==============================

type Lib = 'stock' | 'fast';
const LIBS: Record<
  Lib,
  {
    title: string;
    subtitle: string;
    Select: ComponentType<any>;
    MenuList: ComponentType<any>;
  }
> = {
  stock: {
    title: 'react-select',
    subtitle: 'stock 5.10.2',
    Select: StockSelect,
    MenuList: stockComponents.MenuList,
  },
  fast: {
    title: 'react-select-fast',
    subtitle: 'this fork',
    Select: FastSelect,
    MenuList: fastComponents.MenuList,
  },
};

const makeTimedMenuList = (Base: ComponentType<any>, meter: Meter) =>
  function TimedMenuList(props: any) {
    useLayoutEffect(() => meter.commit());
    return <Base {...props} />;
  };

// Memoized with stable props so the Select only re-renders from its own
// interactions, never from the stats around it.
const SelectHost = memo(function SelectHost({
  lib,
  options,
  styled,
  meter,
}: {
  lib: Lib;
  options: DemoOption[];
  styled: boolean;
  meter: Meter;
}) {
  const { Select, MenuList } = LIBS[lib];
  const components = useMemo(
    () => ({ MenuList: makeTimedMenuList(MenuList, meter) }),
    [MenuList, meter]
  );
  return (
    <Select
      options={options}
      menuIsOpen
      classNamePrefix="rs"
      maxMenuHeight={300}
      components={components}
      styles={styled ? CUSTOM_STYLES : undefined}
      placeholder="Type to filter…"
      aria-label={`${LIBS[lib].title} demo select`}
    />
  );
});

function Stats({ meter }: { meter: Meter }) {
  useSyncExternalStore(meter.subscribe, meter.getVersion);
  const { samples } = meter;
  const recent = samples.slice(-64);
  // Same fixed scale on both panels so their bars compare directly.
  const scale = 100;
  const last = samples[samples.length - 1];

  return (
    <div className="stats">
      <div className="stat-grid">
        {KINDS.map(({ kind, label }) => {
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
  options,
  styled,
  meter,
  rootRef,
  script,
  onRun,
  busy,
}: {
  lib: Lib;
  options: DemoOption[];
  styled: boolean;
  meter: Meter;
  rootRef: (el: HTMLDivElement | null) => void;
  script: { done: number; ms: number | null } | undefined;
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
  const { title, subtitle } = LIBS[lib];
  return (
    <section className={`panel panel-${lib}`}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <div className="panel-sub">{subtitle}</div>
        </div>
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
          key={`${options.length}-${styled}`}
          lib={lib}
          options={options}
          styled={styled}
          meter={meter}
        />
      </div>
      <div className="script">
        <div className="progress">
          <div
            className="progress-fill"
            style={{ width: `${((script?.done ?? 0) / SCRIPT_STEPS) * 100}%` }}
          />
        </div>
        <div className="script-time">
          {script?.ms != null
            ? `Script: ${(script.ms / 1000).toFixed(2)} s`
            : script
            ? 'Running…'
            : `Script: ${SCRIPT_STEPS} steps`}
        </div>
      </div>
      <Stats meter={meter} />
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
  const options = useMemo(() => makeOptions(count), [count]);
  const meters = useMemo(() => ({ stock: new Meter(), fast: new Meter() }), []);
  const roots = useRef<Record<Lib, HTMLElement | null>>({
    stock: null,
    fast: null,
  });
  const [scripts, setScripts] = useState<
    Partial<Record<Lib, { done: number; ms: number | null }>>
  >({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    meters.stock.reset();
    meters.fast.reset();
    setScripts({});
  }, [count, styled, meters]);

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
      const ms = await runScript(root, (done) =>
        setScripts((s) => ({ ...s, [lib]: { done, ms: null } }))
      );
      setScripts((s) => ({ ...s, [lib]: { done: SCRIPT_STEPS, ms } }));
    }
    setBusy(false);
  };

  const stockMs = scripts.stock?.ms;
  const fastMs = scripts.fast?.ms;

  return (
    <main>
      <header className="top">
        <div className="title">
          <h1>react-select vs react-select-fast</h1>
          <p>
            The same Select, same options, side by side on React 19. Hover the
            lists, press ↑/↓ after clicking a list, or type to filter. Each
            panel times every interaction from the input event until React has
            committed and laid out.
          </p>
        </div>
        <div className="controls">
          <label>
            Options
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
            Same script, {count.toLocaleString()} options: stock{' '}
            <b>{(stockMs / 1000).toFixed(2)} s</b>, fast{' '}
            <b>{(fastMs / 1000).toFixed(2)} s</b>
          </span>
          <span className="race-x">
            {(stockMs / fastMs).toFixed(1)}× faster
          </span>
        </div>
      )}

      <FrameMeter />

      <div className="panels">
        {(['stock', 'fast'] as Lib[]).map((lib) => (
          <Panel
            key={lib}
            lib={lib}
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
        A script runs one step per animation frame: hover 60 options, press ↓ 40
        times, then type “alpha” and delete it. At 60 fps that takes about{' '}
        {((SCRIPT_STEPS * 16.7) / 1000).toFixed(1)} s; anything longer is time
        spent rendering. Both selects share one main thread, so the frame graph
        spikes whichever panel is busy.
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

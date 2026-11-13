# react-select-fast

A fork of [react-select](https://github.com/JedWatson/react-select) 5.10.2 with the same API and the same output, but far less render work on large menus.

It's a drop-in replacement. Props, `components` overrides, `styles`, `classNames`, class names (including emotion hashes), ARIA messages, ref instance fields and `onChange` action metadata are all unchanged. The full upstream test suite (255 tests, 5 snapshots) passes unmodified on React 16. On React 17, 18 and 19 the fork passes every upstream test that stock react-select passes; see [React versions](#react-versions).

```sh
npm install react-select@npm:react-select-fast
```

## Results

Measured in a browser with React 16, production builds, one run of each version on the same page, median of 3–5 rounds. See [bench/](bench/). Times are upstream → fast.

With default option rendering (no custom `Option`, `formatOptionLabel`, `styles.option` or `classNames.option`):

| Options | Hover an option    | ArrowDown          | Type a character   | Mount        |
| ------- | ------------------ | ------------------ | ------------------ | ------------ |
| 100     | 0.9 → 0.2 ms       | 1.0 → 0.2 ms       | 1.2 → 0.4 ms       | 3.6 → 2.7 ms |
| 1,000   | 8.7 → 0.2 ms (44×) | 9.0 → 0.5 ms (18×) | 9.2 → 1.9 ms (5×)  | 21 → 19 ms   |
| 5,000   | 45 → 0.8 ms (56×)  | 47 → 2.7 ms (17×)  | 46 → 8.9 ms (5×)   | 111 → 93 ms  |

With a custom `styles.option` (styled mode: each option's styles are recomputed on a keystroke and the option is re-rendered only if they changed):

| Options | Hover an option    | ArrowDown          | Type a character    | Mount        |
| ------- | ------------------ | ------------------ | ------------------- | ------------ |
| 1,000   | 9.0 → 0.2 ms (45×) | 9.4 → 0.5 ms (19×) | 10.2 → 3.3 ms (3×)  | 24 → 24 ms   |
| 5,000   | 45 → 1.0 ms (45×)  | 47 → 2.8 ms (17×)  | 49 → 13.8 ms (3.5×) | 116 → 102 ms |

A custom `Option` component or `formatOptionLabel` makes typing re-render every visible option, as upstream does; hover and keyboard stay fast.

On React 19, at 5,000 options with default option rendering: hover 49 → 1.6 ms, ArrowDown 50 → 3.5 ms, typing 54 → 13 ms. Styled mode hasn't been benchmarked on React 19 yet. (Open the bench at `?react=19`.)

## Demo

```sh
yarn demo    # builds demo/ and serves it at http://127.0.0.1:5200/
```

The two libraries run side by side on React 19, with the same options and the same main thread. Hover the lists, use the arrow keys, or type. Each panel times every interaction from the input event until React has committed and laid out, and shows the median, p95 and a bar per interaction (both panels use the same 0–100 ms scale). **Run script** plays the same 110-step interaction (hover sweep, arrow keys, typing) one step per frame, and **Race both** runs it on each panel and compares wall-clock time. The main-thread graph at the top shows dropped frames. Switch the option count (1k–20k) and default vs custom `styles.option` at the top.

Keep the tab in the foreground: browsers pause animation frames and throttle background tabs, which distorts the numbers.

## What changed

All changes are in `packages/react-select/src`:

1. **Option element reuse** (`Select.tsx`, `renderMenu`). Upstream keeps `focusedOption` on the root component, so moving the highlight re-rendered every option. Option elements are now cached and returned as the same object when nothing they depend on has changed, so React skips them. A hover or arrow-key press re-renders 2 options instead of N. When to throw the cache away depends on the configuration (`getOptionElementEpoch`):
   - **Default option rendering** (default `Option`, no `formatOptionLabel`, no `styles.option` or `classNames.option`). An option's output depends only on its own fields, its focus and selection state, `theme`, `unstyled`, `classNamePrefix` and `isAppleDevice`. The cache survives other prop changes, so typing re-renders only the options that newly appear or change focus. Elements for options that are filtered out are kept too, so deleting characters doesn't recompute their styles.
   - **Styled mode** (default `Option` and label, plus `styles.option` and/or `classNames.option`). Here the default Option's output is fully determined by the option's fields and flags, `classNamePrefix`, `isAppleDevice`, the computed style object and the user's option class names. When a prop changes, each option's styles are computed again (one `styles.option` call per option, as upstream makes while rendering) and compared structurally with the styles its cached element was rendered with. If they match, the element is reused. If not, the option re-renders and `getStyles`/`getClassNames` hand it the styles just computed, so the user's function isn't called twice. Style functions that read other props (e.g. `state.selectProps.inputValue`) still restyle correctly.
   - **Anything custom.** Rendering may read any prop (for example `selectProps.inputValue`), so the cache is thrown away whenever any prop or `selectValue` changes. Changing any prop then re-renders every option, just as upstream does.
2. **Derived-option cache** (`Select.tsx`, `getDerivedOptions`). Upstream ran `filterOption`, `getOptionLabel` and the other option callbacks over every option 3 times per render, plus 2 more times in `getDerivedStateFromProps` on each keystroke and once more on each hover. The result is now cached until a prop or `selectValue` changes, so each input change does 1 pass and a hover does 0.

   Both caches compare props **shallowly**, like `PureComponent`, not by identity. React 19 resolves class `defaultProps` on every render, so `this.props` is a new object even after a state-only update, and identity checks would never hit.
3. **Filter normalization cache** (`filters.ts`). `createFilter` now caches each candidate string after trimming, lowercasing and stripping diacritics. It also resolves its config once, when the filter is created, instead of on every call.
4. **ASCII fast path** (`diacritics.ts`). Every remapped diacritic is outside the ASCII range, so pure-ASCII strings skip the diacritic regex.

## Compatibility notes

These are the only behaviours that differ. All of them are about how often callbacks run, not what they return:

- Your callbacks (`filterOption`, `getOptionLabel`, `getOptionValue`, `isOptionDisabled`, `isOptionSelected`, `formatOptionLabel`) and custom `Option` components are called less often. Code that read **mutable outside state without passing it as a prop** used to pick it up on incidental re-renders (hover, keyboard focus, a parent re-rendering with unchanged props). Now it sees stale values until some prop actually changes. Passing changed state as a prop, or giving a callback a new identity when its inputs change (e.g. `useCallback` deps), works the same as upstream.
- A `theme` function is called again only when the `theme` prop identity changes (or something else invalidates the cache). A theme function with the same identity that returns different values based on mutable outside state won't be picked up by already-rendered options.
- `createFilter(config)` reads `config` once when the filter is created. Mutating the config object afterwards has no effect.
- The filter cache holds at most 100k normalized strings per filter.

## React versions

`yarn test:compat` ([compat/run.sh](compat/run.sh)) runs the whole suite on React 17.0.2, 18.3.1 (`createRoot` via Testing Library 14) and 19.1.0 (Testing Library 16). It runs it against both this fork and stock react-select, and fails on any test that fails only on the fork.

| React | Fork        | Stock react-select | Fork-only failures |
| ----- | ----------- | ------------------ | ------------------ |
| 16    | 281 / 281   | 255 / 255          | 0                  |
| 17    | 279 / 281   | 253 / 255          | 0                  |
| 18    | 279 / 281   | 253 / 255          | 0                  |
| 19    | 279 / 281   | 253 / 255          | 0                  |

The 2 failures on React 17+ are upstream's own autofocus tests ("should call auto focus only once"). They fail the same way on stock react-select.

## Development

```sh
npx yarn@1.22.22 install --ignore-engines   # set CYPRESS_INSTALL_BINARY=0 to skip Cypress
npx jest                                    # upstream suite + __tests__/fast.test.tsx (React 16)
yarn test:compat                            # React 17/18/19 vs stock react-select
yarn bench:build && yarn bench:serve        # open http://127.0.0.1:5199/ (or ?react=19), run `await runBench(5000)`
```

`__tests__/fast.test.tsx` checks that the new filter returns exactly what upstream's returns, using thousands of random inputs including diacritics. It also counts renders and callback calls to lock in the gains. The workspace is trimmed to `packages/*`; the docs site, Storybook and Cypress from upstream are not wired up.

## Next steps

- **Opt-in virtualization** for 10k+ options. Mount time and clearing the input still create one DOM node per option, which bounds both.
- A custom `Option` component or `formatOptionLabel` still re-renders every visible option on each keystroke. That can't be avoided without knowing what the custom code reads.

Original README: [UPSTREAM_README.md](UPSTREAM_README.md). MIT, same as upstream.

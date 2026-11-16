# react-select-fast

An exploration of how to make react-select faster.

A fork of [react-select](https://github.com/JedWatson/react-select) 5.10.2.

[Original project](https://github.com/JedWatson/react-select).


## Getting Started

```sh
npm install react-select-fast
```

```js
import Select from 'react-select-fast';
```

Or keep your existing `react-select` imports untouched by installing it under the `react-select` name:

```sh
npm install react-select@npm:react-select-fast
```

**[Try the live side-by-side demo →](https://yasuf.github.io/react-select-fast/)**

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

Live at **https://yasuf.github.io/react-select-fast/**.

```sh
yarn demo          # build demo/ and serve it at http://127.0.0.1:5200/
yarn demo:deploy   # build and publish it to the gh-pages branch (GitHub Pages)
```

The two libraries run side by side on React 19, with the same options and the same main thread. Hover the lists, use the arrow keys, or type. Each panel times every interaction from the input event until React has committed and laid out, and shows the median, p95 and a bar per interaction (both panels use the same 0–100 ms scale). **Run script** plays a fixed interaction script for the scenario (hover sweep, arrow keys, typing, and loads or picks where relevant) one step per frame, and **Race both** runs it on each panel and compares wall-clock time. The main-thread graph at the top shows dropped frames. Switch the option count (1k–20k) and default vs custom `styles.option` at the top.

## Compatibility notes

These are the only behaviours that differ. All of them are about how often callbacks run, not what they return:

- Your callbacks (`filterOption`, `getOptionLabel`, `getOptionValue`, `isOptionDisabled`, `isOptionSelected`, `formatOptionLabel`) and custom `Option` components are called less often. Code that read **mutable outside state without passing it as a prop** used to pick it up on incidental re-renders (hover, keyboard focus, a parent re-rendering with unchanged props). Now it sees stale values until some prop actually changes. Passing changed state as a prop, or giving a callback a new identity when its inputs change (e.g. `useCallback` deps), works the same as upstream.
- A `theme` function is called again only when the `theme` prop identity changes (or something else invalidates the cache). A theme function with the same identity that returns different values based on mutable outside state won't be picked up by already-rendered options.
- Mutating option *objects* in place (same object, new `label`) isn't picked up until a prop changes. Mutating the options *array* in place (`push`, `splice`, sort) is detected, so infinite-scroll code that appends to the same array works.
- `createFilter(config)` reads `config` once when the filter is created. Mutating the config object afterwards has no effect.
- The filter cache holds at most 100k normalized strings per filter.

## Development

```sh
npx yarn@1.22.22 install --ignore-engines   # set CYPRESS_INSTALL_BINARY=0 to skip Cypress
npx jest                                    # upstream suite + __tests__/fast.test.tsx (React 16)
yarn test:compat                            # React 17/18/19 vs stock react-select
yarn bench:build && yarn bench:serve        # open http://127.0.0.1:5199/ (or ?react=19), run `await runBench(5000)`
```

`__tests__/fast.test.tsx` checks that the new filter returns exactly what upstream's returns, using thousands of random inputs including diacritics. It also counts renders and callback calls to lock in the gains. The workspace is trimmed to `packages/*`; the docs site, Storybook and Cypress from upstream are not wired up.

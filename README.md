# react-select-fast

A fork of [react-select](https://github.com/JedWatson/react-select) 5.10.2 with the same API and the same output, but far less render work on large menus.

It's a drop-in replacement. Props, `components` overrides, `styles`, `classNames`, class names (including emotion hashes), ARIA messages, ref instance fields and `onChange` action metadata are all unchanged. The full upstream test suite (255 tests, 5 snapshots) passes unmodified.

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

With a custom `styles.option`, typing re-renders every visible option, just as upstream does. Hover and keyboard are unaffected:

| Options | Hover an option    | ArrowDown          | Type a character   | Mount        |
| ------- | ------------------ | ------------------ | ------------------ | ------------ |
| 1,000   | 9.1 → 0.2 ms (46×) | 9.4 → 0.5 ms (19×) | 10.6 → 6.1 ms      | 24 → 19 ms   |
| 5,000   | 47 → 0.9 ms (52×)  | 48 → 2.5 ms (19×)  | 49 → 30 ms         | 118 → 94 ms  |

## What changed

All changes are in `packages/react-select/src`:

1. **Option element reuse** (`Select.tsx`, `renderMenu`). Upstream keeps `focusedOption` on the root component, so moving the highlight re-rendered every option. Option elements are now cached and returned as the same object when nothing they depend on has changed, so React skips them. A hover or arrow-key press re-renders 2 options instead of N. When to throw the cache away depends on the configuration (`getOptionElementEpoch`):
   - **Default option rendering** (default `Option`, no `formatOptionLabel`, no `styles.option` or `classNames.option`). An option's output depends only on its own fields, its focus and selection state, `theme`, `unstyled`, `classNamePrefix` and `isAppleDevice`. The cache survives other prop changes, so typing re-renders only the options that newly appear or change focus. Elements for options that are filtered out are kept too, so deleting characters doesn't recompute their styles.
   - **Anything custom.** Rendering may read any prop (for example `selectProps.inputValue`), so the cache is thrown away whenever the props object or `selectValue` changes. A parent re-render then re-renders every option, just as upstream does.
2. **Derived-option cache** (`Select.tsx`, `getDerivedOptions`). Upstream ran `filterOption`, `getOptionLabel` and the other option callbacks over every option 3 times per render, plus 2 more times in `getDerivedStateFromProps` on each keystroke and once more on each hover. The result is now cached by props identity and `selectValue`, so each input change does 1 pass and a hover does 0.
3. **Filter normalization cache** (`filters.ts`). `createFilter` now caches each candidate string after trimming, lowercasing and stripping diacritics. It also resolves its config once, when the filter is created, instead of on every call.
4. **ASCII fast path** (`diacritics.ts`). Every remapped diacritic is outside the ASCII range, so pure-ASCII strings skip the diacritic regex.

## Compatibility notes

These are the only behaviours that differ. All of them are about how often callbacks run, not what they return:

- Your callbacks (`filterOption`, `getOptionLabel`, `getOptionValue`, `isOptionDisabled`, `isOptionSelected`, `formatOptionLabel`) and custom `Option` components are called less often. Code that relied on extra calls during internal re-renders (hover, keyboard focus) to pick up **mutable outside state without re-rendering `Select`** will see stale values until the next prop change. Passing changed state as a prop, or re-rendering the parent, works the same as upstream.
- A `theme` function is called again only when the `theme` prop identity changes (or something else invalidates the cache). A theme function with the same identity that returns different values based on mutable outside state won't be picked up by already-rendered options.
- `createFilter(config)` reads `config` once when the filter is created. Mutating the config object afterwards has no effect.
- The filter cache holds at most 100k normalized strings per filter.

## Development

```sh
npx yarn@1.22.22 install --ignore-engines   # set CYPRESS_INSTALL_BINARY=0 to skip Cypress
npx jest                                    # upstream suite + __tests__/fast.test.tsx
yarn bench:build && yarn bench:serve        # open http://127.0.0.1:5199/, run `await runBench(5000)`
```

`__tests__/fast.test.tsx` checks that the new filter returns exactly what upstream's returns, using thousands of random inputs including diacritics. It also counts renders and callback calls to lock in the gains. The workspace is trimmed to `packages/*`; the docs site, Storybook and Cypress from upstream are not wired up.

## Next steps

- **Custom option styling still re-renders on every keystroke.** Memoizing emotion serialization of `getStyles` output would help, as would opt-in virtualization for 10k+ options. Virtualization would also cut mount time and the cost of clearing the input, since 5,000 DOM nodes still have to be created.
- Make sure every change works on React 17, 18 and 19. The upstream suite runs on React 16 only.

Original README: [UPSTREAM_README.md](UPSTREAM_README.md). MIT, same as upstream.

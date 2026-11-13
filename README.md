# react-select-fast

A fork of [react-select](https://github.com/JedWatson/react-select) 5.10.2 with the same API and the same output, but far less render work on large menus.

It's a drop-in replacement. Props, `components` overrides, `styles`, `classNames`, class names (including emotion hashes), ARIA messages, ref instance fields and `onChange` action metadata are all unchanged. The full upstream test suite (255 tests, 5 snapshots) passes unmodified.

```sh
npm install react-select@npm:react-select-fast
```

## Results

Measured in a browser with React 16, production builds, one run of each version on the same page, median of 3–5 rounds. See [bench/](bench/).

| Options | Hover an option    | ArrowDown         | Type a character  | Mount         |
| ------- | ------------------ | ----------------- | ----------------- | ------------- |
| 100     | 0.9 → 0.2 ms       | 0.9 → 0.2 ms      | 1.0 → 0.7 ms      | 3.2 → 3.2 ms  |
| 1,000   | 7.8 → 0.2 ms (39×) | 8.2 → 0.5 ms (16×) | 8.4 → 5.1 ms      | 23 → 20 ms    |
| 5,000   | 42 → 0.8 ms (53×)  | 44 → 2.1 ms (21×) | 45 → 29 ms        | 102 → 86 ms   |

## What changed

All changes are in `packages/react-select/src`:

1. **Option element reuse** (`Select.tsx`, `renderMenu`). Upstream keeps `focusedOption` on the root component, so moving the highlight re-rendered every option. Option elements are now cached and returned as the same object when nothing they depend on has changed, so React skips them. A hover or arrow-key press re-renders 2 options instead of N. The cache is thrown away whenever the props object, `selectValue`, `isAppleDevice` or the `Option` component changes. Any parent re-render therefore still re-renders every option, just as upstream does.
2. **Derived-option cache** (`Select.tsx`, `getDerivedOptions`). Upstream ran `filterOption`, `getOptionLabel` and the other option callbacks over every option 3 times per render, plus 2 more times in `getDerivedStateFromProps` on each keystroke and once more on each hover. The result is now cached by props identity and `selectValue`, so each input change does 1 pass and a hover does 0.
3. **Filter normalization cache** (`filters.ts`). `createFilter` now caches each candidate string after trimming, lowercasing and stripping diacritics. It also resolves its config once, when the filter is created, instead of on every call.
4. **ASCII fast path** (`diacritics.ts`). Every remapped diacritic is outside the ASCII range, so pure-ASCII strings skip the diacritic regex.

## Compatibility notes

These are the only behaviours that differ. All of them are about how often callbacks run, not what they return:

- Your callbacks (`filterOption`, `getOptionLabel`, `getOptionValue`, `isOptionDisabled`, `isOptionSelected`, `formatOptionLabel`) and custom `Option` components are called less often. Code that relied on extra calls during internal re-renders (hover, keyboard focus) to pick up **mutable outside state without re-rendering `Select`** will see stale values until the next prop change. Passing changed state as a prop, or re-rendering the parent, works the same as upstream.
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

- **Typing is still O(matches)**: every visible option re-renders and emotion re-serializes its styles. Caching default style serialization, plus opt-in virtualization for 10k+ options, would address this.
- Make sure every change works on React 17, 18 and 19. The upstream suite runs on React 16 only.

Original README: [UPSTREAM_README.md](UPSTREAM_README.md). MIT, same as upstream.

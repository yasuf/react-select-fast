# react-select-fast

A fork of [react-select](https://github.com/JedWatson/react-select) 5.10.2 with the same API and the same output, but far less render work on large menus.

This project is inspired by, and built on, the original react-select by Jed Watson and its contributors. Its API, components and design are theirs; this fork only changes how much work it does. react-select-fast is an independent, unofficial fork and is not affiliated with or endorsed by the react-select maintainers. For anything not about performance, see the [original project](https://github.com/JedWatson/react-select) and its [documentation](https://react-select.com).

**[Live side-by-side demo →](https://yasuf.github.io/react-select-fast/)** · [Source, benchmarks and details](https://github.com/yasuf/react-select-fast)

## Install

Keep your existing `react-select` imports by installing it under that name:

```sh
npm install react-select@npm:react-select-fast
```

Or install it under its own name and change your imports:

```sh
npm install react-select-fast
```

```jsx
import Select from 'react-select-fast';
import AsyncSelect from 'react-select-fast/async';
import CreatableSelect from 'react-select-fast/creatable';
import AsyncCreatableSelect from 'react-select-fast/async-creatable';
import makeAnimated from 'react-select-fast/animated';
```

Works with React 16.8 through 19.

## What's faster

It's a drop-in replacement: props, `components` overrides, `styles`, `classNames`, class names, ARIA messages and `onChange` metadata are unchanged, and the full upstream test suite passes.

- **Hover and arrow keys** re-render 2 options instead of every option. At 5,000 options: 45 → 0.8 ms per hover.
- **Typing** filters each option once per keystroke instead of about five times, and caches each option's normalized search text. At 5,000 options: 46 → 8.9 ms per keystroke.
- **Custom `styles.option` / `classNames.option`** keep most of the gains; options are re-rendered only when their computed styles change.
- **Custom `Option` components or `formatOptionLabel`**: hover and arrow keys stay fast; typing re-renders every option, as upstream does.
- Works with grouped options, multiselect, async loading and infinite scroll (including arrays appended to in place).

## Compatibility notes

Results are the same; what changes is how often your callbacks run. `filterOption`, `getOptionLabel`, `getOptionValue`, `isOptionDisabled`, `isOptionSelected`, `formatOptionLabel` and custom `Option` components are called less often, so code that reads mutable outside state without passing it as a prop may see stale values until a prop changes. Mutating an option object in place (same object, new `label`) also isn't picked up until a prop changes. See the [full notes](https://github.com/yasuf/react-select-fast#compatibility-notes).

## License

MIT. Copyright (c) 2022 Jed Watson, with react-select-fast modifications copyright (c) 2026 Yasu Flores. See [LICENSE](LICENSE).

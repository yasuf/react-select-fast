// Tests for the react-select-fast optimizations: they must be invisible to
// consumers (identical results) while doing measurably less work.
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

import Select from '../Select';
import { components } from '../components/index';
import { OptionProps } from '../components/Option';
import { createFilter } from '../filters';
import { createFilter as upstreamCreateFilter } from './_upstream/filters';
import { OPTIONS, OPTIONS_ACCENTED, Option } from './constants';
import { matchers } from '@emotion/jest';

expect.extend(matchers);

// ==============================
// Filter equivalence
// ==============================

// Deterministic PRNG so failures are reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const ALPHABET = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...'  \t\n-_.',
  ...'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
  ...'ŁłŒœßÆæØøĳǅ①Ⓐａｂ€中文',
];

const randomString = (next: () => number, maxLength: number) => {
  const length = Math.floor(next() * maxLength);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[Math.floor(next() * ALPHABET.length)];
  }
  return result;
};

const CONFIGS = [
  undefined,
  { ignoreCase: false },
  { ignoreAccents: false },
  { trim: false },
  { matchFrom: 'start' as const },
  { ignoreCase: false, ignoreAccents: false, trim: false },
  {
    matchFrom: 'start' as const,
    stringify: (option: { label: string }) => option.label,
  },
];

describe('createFilter matches upstream exactly', () => {
  CONFIGS.forEach((config, configIndex) => {
    test(`config #${configIndex}: ${JSON.stringify(config)}`, () => {
      const next = rng(configIndex + 1);
      const fast = createFilter<unknown>(config);
      const upstream = upstreamCreateFilter<unknown>(config);
      const options = Array.from({ length: 300 }, () => ({
        label: randomString(next, 12),
        value: randomString(next, 8),
        data: {},
      }));
      // Short inputs, plus substrings of real candidates, so plenty match.
      const inputs = [
        '',
        ' ',
        ...Array.from({ length: 40 }, () => randomString(next, 3)),
        ...options.slice(0, 40).map((o) => o.label.slice(1, 4)),
      ];
      // Run every input twice so the second pass exercises the caches.
      for (let pass = 0; pass < 2; pass++) {
        for (const input of inputs) {
          for (const option of options) {
            expect([input, option.label, fast(option, input)]).toEqual([
              input,
              option.label,
              upstream(option, input),
            ]);
          }
        }
      }
    });
  });

  test('new (creatable) options always match', () => {
    const fast = createFilter();
    expect(
      fast({ label: 'x', value: 'x', data: { __isNew__: true } }, 'zzz')
    ).toBe(true);
  });
});

// ==============================
// Render work
// ==============================

const countingOption = () => {
  const renders = new Map<string, number>();
  const CountingOption = (props: OptionProps<Option, boolean>) => {
    renders.set(props.label, (renders.get(props.label) || 0) + 1);
    return <components.Option {...props} />;
  };
  const total = () => Array.from(renders.values()).reduce((a, b) => a + b, 0);
  return { CountingOption, renders, total };
};

const MENU_OPEN_PROPS = {
  classNamePrefix: 'react-select',
  menuIsOpen: true,
  inputValue: '',
  onChange: () => {},
  onInputChange: () => {},
  onMenuOpen: () => {},
  onMenuClose: () => {},
  value: null,
};

describe('option rendering', () => {
  test('hovering an option re-renders only the old and new focused options', () => {
    const { CountingOption, renders, total } = countingOption();
    const { container } = render(
      <Select
        {...MENU_OPEN_PROPS}
        options={OPTIONS}
        components={{ Option: CountingOption }}
      />
    );
    const options = container.querySelectorAll('.react-select__option');
    expect(total()).toBe(OPTIONS.length);
    renders.clear();

    fireEvent.mouseOver(options[3]);
    // nothing was focused yet (no value), so only option 3 changes
    expect(Array.from(renders.keys()).sort()).toEqual(['3']);
    expect(
      container.querySelector('.react-select__option--is-focused')!.textContent
    ).toBe('3');

    renders.clear();
    fireEvent.mouseOver(options[7]);
    expect(Array.from(renders.keys()).sort()).toEqual(['3', '7']);
  });

  test('keyboard navigation re-renders only the old and new focused options', () => {
    const { CountingOption, renders } = countingOption();
    const { container } = render(
      <Select
        {...MENU_OPEN_PROPS}
        options={OPTIONS}
        components={{ Option: CountingOption }}
      />
    );
    const arrowDown = () =>
      fireEvent.keyDown(container.querySelector('.react-select__menu')!, {
        keyCode: 40,
        key: 'ArrowDown',
      });
    arrowDown(); // focuses option 0
    renders.clear();
    arrowDown();
    expect(Array.from(renders.keys()).sort()).toEqual(['0', '1']);
    expect(
      container.querySelector('.react-select__option--is-focused')!.textContent
    ).toBe('1');
  });

  test('any prop change re-renders every option', () => {
    const { CountingOption, renders } = countingOption();
    const props = {
      ...MENU_OPEN_PROPS,
      options: OPTIONS,
      components: { Option: CountingOption },
    };
    const { rerender } = render(<Select {...props} />);
    renders.clear();
    // Same values, new props object: options must not be served stale, since
    // callbacks like formatOptionLabel may close over changed outer state.
    rerender(<Select {...props} />);
    expect(renders.size).toBe(OPTIONS.length);
  });

  test('changing formatOptionLabel output is reflected', () => {
    const { container, rerender } = render(
      <Select
        {...MENU_OPEN_PROPS}
        options={OPTIONS}
        formatOptionLabel={(o: Option) => `A-${o.label}`}
      />
    );
    expect(container.querySelector('.react-select__option')!.textContent).toBe(
      'A-0'
    );
    rerender(
      <Select
        {...MENU_OPEN_PROPS}
        options={OPTIONS}
        formatOptionLabel={(o: Option) => `B-${o.label}`}
      />
    );
    expect(container.querySelector('.react-select__option')!.textContent).toBe(
      'B-0'
    );
  });

  test('selecting a value updates selected state on cached options', () => {
    const { container, rerender } = render(
      <Select {...MENU_OPEN_PROPS} options={OPTIONS} />
    );
    fireEvent.mouseOver(container.querySelectorAll('.react-select__option')[2]);
    rerender(
      <Select {...MENU_OPEN_PROPS} options={OPTIONS} value={OPTIONS[2]} />
    );
    const selected = container.querySelectorAll(
      '.react-select__option--is-selected'
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('2');
  });
});

describe('filter callbacks', () => {
  test('filterOption runs once per option per input change, not per render', () => {
    const filterOption = jest.fn(createFilter());
    const props = {
      ...MENU_OPEN_PROPS,
      options: OPTIONS_ACCENTED,
      filterOption,
    };
    const { container, rerender } = render(<Select {...props} />);
    filterOption.mockClear();

    rerender(<Select {...props} inputValue="o" />);
    // upstream: 5 passes (2 in getDerivedStateFromProps, 3 in render)
    expect(filterOption).toHaveBeenCalledTimes(OPTIONS_ACCENTED.length);

    filterOption.mockClear();
    const options = container.querySelectorAll('.react-select__option');
    fireEvent.mouseOver(options[options.length - 1]);
    // upstream: 4 passes (hover handler + 3 in render)
    expect(filterOption).not.toHaveBeenCalled();
  });
});

describe('default option rendering across prop changes', () => {
  const optionTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.react-select__option')).map(
      (el) => el.textContent
    );

  test('typing does not re-render options that stay visible', () => {
    const getOptionLabel = jest.fn((o: Option) => o.label);
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS, getOptionLabel };
    const { container, rerender } = render(<Select {...props} />);

    getOptionLabel.mockClear();
    rerender(<Select {...props} inputValue="e" />);
    const visible = optionTexts(container).length;
    expect(visible).toBeGreaterThan(1);
    // One call per option for filtering, plus 2 for the newly focused first
    // match (its re-render and the live region announcement). Upstream also
    // re-rendered every visible option, calling it once more for each.
    expect(getOptionLabel).toHaveBeenCalledTimes(OPTIONS.length + 2);
  });

  test('deleting characters restores options in the original order', () => {
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS };
    const { container, rerender } = render(<Select {...props} />);
    const all = optionTexts(container);
    rerender(<Select {...props} inputValue="tw" />);
    expect(optionTexts(container)).toEqual(['2', '12']);
    rerender(<Select {...props} inputValue="t" />);
    rerender(<Select {...props} inputValue="" />);
    expect(optionTexts(container)).toEqual(all);
  });

  test('classNamePrefix changes are applied to cached options', () => {
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS };
    const { container, rerender } = render(<Select {...props} />);
    rerender(<Select {...props} classNamePrefix="other" />);
    expect(container.querySelectorAll('.other__option')).toHaveLength(
      OPTIONS.length
    );
    expect(container.querySelector('.react-select__option')).toBeNull();
  });

  test('adding styles.option later is applied', () => {
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS };
    const { container, rerender } = render(<Select {...props} />);
    rerender(
      <Select
        {...props}
        styles={{ option: (base) => ({ ...base, color: 'red' }) }}
      />
    );
    expect(container.querySelector('.react-select__option')).toHaveStyleRule(
      'color',
      'red'
    );
  });

  test('a new theme is applied', () => {
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS, value: OPTIONS[0] };
    const { container, rerender } = render(<Select {...props} />);
    rerender(
      <Select
        {...props}
        theme={(theme) => ({
          ...theme,
          colors: { ...theme.colors, primary: 'hotpink' },
        })}
      />
    );
    expect(
      container.querySelector('.react-select__option--is-selected')
    ).toHaveStyleRule('background-color', 'hotpink');
  });

  test('unstyled toggles are applied', () => {
    const props = { ...MENU_OPEN_PROPS, options: OPTIONS };
    const { container, rerender } = render(<Select {...props} />);
    expect(container.querySelector('.react-select__option')).toHaveStyleRule(
      'padding',
      '8px 12px'
    );
    rerender(<Select {...props} unstyled />);
    expect(
      container.querySelector('.react-select__option')
    ).not.toHaveStyleRule('padding', expect.anything());
  });
});

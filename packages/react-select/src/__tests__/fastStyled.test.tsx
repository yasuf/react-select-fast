// Tests for 'styled' mode: the default Option with user styles.option or
// classNames.option. On prop changes, cached option elements are reused only
// if their recomputed styles are unchanged.
import React from 'react';
import { render } from '@testing-library/react';
import { matchers } from '@emotion/jest';

import Select from '../Select';
import { OPTIONS, Option } from './constants';
import { StylesConfig } from '../styles';

expect.extend(matchers);

// Count mockRenders of the real default Option component. Mocking the module
// keeps the identity Select uses to detect the default Option.
const mockRenders: string[] = [];
jest.mock('../components/Option', () => {
  const actual = jest.requireActual('../components/Option');
  const CountedOption = (props: { label: string }) => {
    mockRenders.push(props.label);
    return actual.default(props);
  };
  return { __esModule: true, ...actual, default: CountedOption };
});

const BASE_PROPS = {
  classNamePrefix: 'react-select',
  menuIsOpen: true,
  inputValue: '',
  onChange: () => {},
  onInputChange: () => {},
  onMenuOpen: () => {},
  onMenuClose: () => {},
  value: null,
  options: OPTIONS,
};

const optionEls = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.react-select__option'));

beforeEach(() => {
  mockRenders.length = 0;
});

test('typing re-renders no unchanged options and calls styles.option once per option', () => {
  const optionStyle = jest.fn((base: object) => ({ ...base, color: 'navy' }));
  const styles: StylesConfig<Option, false> = { option: optionStyle };
  const { container, rerender } = render(
    <Select {...BASE_PROPS} styles={styles} />
  );
  expect(mockRenders).toHaveLength(OPTIONS.length);

  mockRenders.length = 0;
  optionStyle.mockClear();
  rerender(<Select {...BASE_PROPS} styles={styles} inputValue="e" />);
  const visible = optionEls(container).length;
  expect(visible).toBeGreaterThan(1);
  // Upstream re-renders every visible option, calling styles.option once
  // each. Here it is called once per visible option for verification, and
  // only the newly focused first option re-renders (reusing those styles).
  expect(optionStyle).toHaveBeenCalledTimes(visible);
  expect(mockRenders).toEqual([optionEls(container)[0].textContent]);
  expect(optionEls(container)[1]).toHaveStyleRule('color', 'navy');
});

test('styles that depend on other props are re-applied', () => {
  const styles: StylesConfig<Option, false> = {
    option: (base, state) => ({
      ...base,
      color: state.selectProps.inputValue === 'e' ? 'red' : 'blue',
    }),
  };
  const { container, rerender } = render(
    <Select {...BASE_PROPS} styles={styles} />
  );
  expect(optionEls(container)[1]).toHaveStyleRule('color', 'blue');
  rerender(<Select {...BASE_PROPS} styles={styles} inputValue="e" />);
  optionEls(container).forEach((el) =>
    expect(el).toHaveStyleRule('color', 'red')
  );
  rerender(<Select {...BASE_PROPS} styles={styles} inputValue="" />);
  optionEls(container).forEach((el) =>
    expect(el).toHaveStyleRule('color', 'blue')
  );
});

test('classNames.option that depend on other props are re-applied', () => {
  const classNames = {
    option: (state: { selectProps: { inputValue: string } }) =>
      state.selectProps.inputValue ? 'filtering' : 'idle',
  };
  const { container, rerender } = render(
    <Select {...BASE_PROPS} classNames={classNames} />
  );
  expect(container.querySelectorAll('.idle')).toHaveLength(OPTIONS.length);
  rerender(<Select {...BASE_PROPS} classNames={classNames} inputValue="e" />);
  expect(container.querySelectorAll('.idle')).toHaveLength(0);
  expect(container.querySelectorAll('.filtering')).toHaveLength(
    optionEls(container).length
  );
});

test('a changed option re-renders with the styles computed for it', () => {
  // Styles keyed on focus: hovering must restyle exactly the focus change.
  const optionStyle = jest.fn(
    (base: object, state: { isFocused: boolean }) => ({
      ...base,
      outline: state.isFocused ? '1px solid red' : 'none',
    })
  );
  const styles = { option: optionStyle } as StylesConfig<Option, false>;
  const { container, rerender } = render(
    <Select {...BASE_PROPS} styles={styles} />
  );
  rerender(<Select {...BASE_PROPS} styles={styles} inputValue="e" />);
  const first = optionEls(container)[0];
  expect(first).toHaveClass('react-select__option--is-focused');
  expect(first).toHaveStyleRule('outline', '1px solid red');
  expect(optionEls(container)[1]).toHaveStyleRule('outline', 'none');
});

test('classNamePrefix changes are applied in styled mode', () => {
  const styles: StylesConfig<Option, false> = {
    option: (base) => ({ ...base, color: 'navy' }),
  };
  const { container, rerender } = render(
    <Select {...BASE_PROPS} styles={styles} />
  );
  rerender(<Select {...BASE_PROPS} styles={styles} classNamePrefix="other" />);
  expect(container.querySelectorAll('.other__option')).toHaveLength(
    OPTIONS.length
  );
});

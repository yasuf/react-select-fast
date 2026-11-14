// Multiselect: every pick changes the selected values, and by default
// selected options are hidden from the menu, so this stresses both the
// option-list cache and the option element cache. These tests also pass on
// stock react-select (see compat/run.sh), so they pin upstream behavior.
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';

import Select from '../stateManager';
import { Option, OPTIONS } from './constants';

const labels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.react-select__option')).map(
    (el) => el.textContent
  );
const chips = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll('.react-select__multi-value__label')
  ).map((el) => el.textContent);
const selectedLabels = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll('.react-select__option--is-selected')
  ).map((el) => el.textContent);
const focusedLabel = (container: HTMLElement) =>
  container.querySelector('.react-select__option--is-focused')?.textContent;
const clickOption = (container: HTMLElement, label: string) =>
  fireEvent.click(
    Array.from(container.querySelectorAll('.react-select__option')).find(
      (el) => el.textContent === label
    )!
  );
const key = (container: HTMLElement, k: string, keyCode: number) =>
  fireEvent.keyDown(container.querySelector('.react-select')!, {
    key: k,
    keyCode,
  });

const ALL = OPTIONS.map((o) => o.label);
const without = (...remove: string[]) => ALL.filter((l) => !remove.includes(l));

const BASE = {
  classNamePrefix: 'react-select',
  className: 'react-select',
  isMulti: true as const,
  menuIsOpen: true,
  closeMenuOnSelect: false,
  options: OPTIONS,
};

describe('multiselect', () => {
  test('picking options adds chips and hides them from the menu', () => {
    const onChange = jest.fn();
    const { container } = render(<Select {...BASE} onChange={onChange} />);
    clickOption(container, '3');
    clickOption(container, '7');
    clickOption(container, '0');
    expect(chips(container)).toEqual(['3', '7', '0']);
    expect(labels(container)).toEqual(without('3', '7', '0'));
    expect(onChange).toHaveBeenLastCalledWith(
      [OPTIONS[3], OPTIONS[7], OPTIONS[0]],
      expect.objectContaining({ action: 'select-option', option: OPTIONS[0] })
    );
  });

  test('hovering after picks highlights the right option', () => {
    const { container } = render(<Select {...BASE} />);
    clickOption(container, '1');
    clickOption(container, '2');
    const options = container.querySelectorAll('.react-select__option');
    fireEvent.mouseOver(options[4]);
    expect(focusedLabel(container)).toBe(options[4].textContent);
    fireEvent.mouseOver(options[1]);
    expect(focusedLabel(container)).toBe(options[1].textContent);
    expect(
      container.querySelectorAll('.react-select__option--is-focused')
    ).toHaveLength(1);
  });

  test('keyboard select with Enter, then removal with Backspace', () => {
    const onChange = jest.fn();
    const { container } = render(<Select {...BASE} onChange={onChange} />);
    key(container, 'ArrowDown', 40); // focus 0
    key(container, 'ArrowDown', 40); // focus 1
    key(container, 'Enter', 13); // pick 1
    expect(chips(container)).toEqual(['1']);
    key(container, 'ArrowDown', 40);
    key(container, 'Enter', 13);
    expect(chips(container)).toHaveLength(2);
    const second = chips(container)[1]!;
    expect(labels(container)).toEqual(without('1', second));

    key(container, 'Backspace', 8); // pops the last chip
    expect(chips(container)).toEqual(['1']);
    expect(labels(container)).toEqual(without('1'));
    expect(onChange).toHaveBeenLastCalledWith(
      [OPTIONS[1]],
      expect.objectContaining({ action: 'pop-value' })
    );
  });

  test('removing a chip with its x restores the option in its original place', () => {
    const { container } = render(<Select {...BASE} />);
    clickOption(container, '4');
    clickOption(container, '9');
    fireEvent.click(
      container.querySelectorAll('.react-select__multi-value__remove')[0]
    );
    expect(chips(container)).toEqual(['9']);
    expect(labels(container)).toEqual(without('9'));
  });

  test('clearing restores every option', () => {
    const { container } = render(<Select {...BASE} />);
    ['2', '5', '11'].forEach((l) => clickOption(container, l));
    fireEvent.mouseDown(
      container.querySelector('.react-select__clear-indicator')!,
      { button: 0 }
    );
    expect(chips(container)).toEqual([]);
    expect(labels(container)).toEqual(ALL);
  });

  test('with hideSelectedOptions={false}, selected state is shown and toggled', () => {
    const onChange = jest.fn();
    const { container } = render(
      <Select {...BASE} hideSelectedOptions={false} onChange={onChange} />
    );
    clickOption(container, '6');
    clickOption(container, '8');
    expect(labels(container)).toEqual(ALL);
    expect(selectedLabels(container)).toEqual(['6', '8']);
    const six = Array.from(
      container.querySelectorAll('.react-select__option')
    ).find((el) => el.textContent === '6')!;
    expect(six.getAttribute('aria-selected')).toBe('true');

    clickOption(container, '6'); // clicking a selected option deselects it
    expect(selectedLabels(container)).toEqual(['8']);
    expect(chips(container)).toEqual(['8']);
    expect(onChange).toHaveBeenLastCalledWith(
      [OPTIONS[8]],
      expect.objectContaining({ action: 'deselect-option', option: OPTIONS[6] })
    );
  });

  test('a controlled value of new objects matches options by value', () => {
    // Values from a server are new objects; isOptionSelected falls back to
    // comparing getOptionValue.
    const Controlled = () => {
      const [value, setValue] = useState<readonly Option[]>([
        { ...OPTIONS[2] },
        { ...OPTIONS[3] },
      ]);
      return (
        <Select
          {...BASE}
          hideSelectedOptions={false}
          value={value}
          onChange={(v) => setValue(v.map((o) => ({ ...o })))}
        />
      );
    };
    const { container } = render(<Controlled />);
    expect(selectedLabels(container)).toEqual(['2', '3']);
    clickOption(container, '10');
    expect(selectedLabels(container)).toEqual(['2', '3', '10']);
    expect(chips(container)).toEqual(['2', '3', '10']);
  });

  test('a parent re-render with an equal value array keeps state consistent', () => {
    const Parent = () => {
      const [value, setValue] = useState<readonly Option[]>([]);
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          <Select {...BASE} value={value} onChange={(v) => setValue([...v])} />
        </>
      );
    };
    const { container, getByText } = render(<Parent />);
    clickOption(container, '1');
    clickOption(container, '2');
    fireEvent.click(getByText('tick'));
    expect(chips(container)).toEqual(['1', '2']);
    expect(labels(container)).toEqual(without('1', '2'));
  });

  test('filtering while values are selected excludes them from results', () => {
    const { container } = render(<Select {...BASE} />);
    clickOption(container, '1');
    clickOption(container, '10');
    fireEvent.change(container.querySelector('input')!, {
      target: { value: '1' },
    });
    expect(labels(container)).toEqual(
      ALL.filter((l) => l.includes('1') && l !== '1' && l !== '10')
    );
  });
});

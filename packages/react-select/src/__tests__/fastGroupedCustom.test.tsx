// Categorized (grouped) options and custom-rendered options. Options inside
// groups share the option element cache with flat lists (keyed by group and
// option index), and a custom Option or formatOptionLabel switches the cache
// to 'props' mode. The behavior tests also pass on stock react-select (see
// compat/run.sh); the render-count tests pin the fork's savings.
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

import Select from '../stateManager';
import { components } from '../components/index';
import { OptionProps } from '../components/Option';

interface Fruit {
  label: string;
  value: string;
}
interface Category {
  label: string;
  options: Fruit[];
}

const fruit = (label: string): Fruit => ({ label, value: label });
const GROUPS: Category[] = [
  {
    label: 'Citrus',
    options: ['lemon', 'lime', 'orange', 'grapefruit'].map(fruit),
  },
  { label: 'Berries', options: ['strawberry', 'blueberry', 'raspberry'].map(fruit) },
  { label: 'Stone fruit', options: ['peach', 'plum', 'cherry', 'apricot'].map(fruit) },
];
const ALL = GROUPS.flatMap((g) => g.options.map((o) => o.label));

const BASE = {
  classNamePrefix: 'rs',
  className: 'rs',
  menuIsOpen: true,
  options: GROUPS,
};

const labels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.rs__option')).map((el) => el.textContent);
const headings = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.rs__group-heading')).map(
    (el) => el.textContent
  );
const focused = (c: HTMLElement) =>
  c.querySelector('.rs__option--is-focused')?.textContent;
const type = (c: HTMLElement, value: string) =>
  fireEvent.change(c.querySelector('input')!, { target: { value } });
const key = (c: HTMLElement, k: string, keyCode: number) =>
  fireEvent.keyDown(c.querySelector('.rs')!, { key: k, keyCode });
const optionEl = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('.rs__option')).find(
    (el) => el.textContent === label
  )!;

const countingOption = () => {
  const renders = new Map<string, number>();
  const CountingOption = (props: OptionProps<Fruit, boolean>) => {
    renders.set(props.label, (renders.get(props.label) || 0) + 1);
    return <components.Option {...props} />;
  };
  return { CountingOption, renders };
};

// ==============================
// Categorized options
// ==============================

describe('categorized options', () => {
  test('renders every group heading with its options in order', () => {
    const { container } = render(<Select {...BASE} />);
    expect(headings(container)).toEqual(['Citrus', 'Berries', 'Stone fruit']);
    expect(labels(container)).toEqual(ALL);
    const groups = container.querySelectorAll('.rs__group');
    expect(groups[1].querySelectorAll('.rs__option')).toHaveLength(3);
  });

  test('typing hides empty groups and deleting brings them back', () => {
    const { container } = render(<Select {...BASE} />);
    type(container, 'berry');
    expect(headings(container)).toEqual(['Berries']);
    expect(labels(container)).toEqual(['strawberry', 'blueberry', 'raspberry']);
    type(container, 'r');
    expect(headings(container)).toEqual(['Citrus', 'Berries', 'Stone fruit']);
    expect(labels(container)).toEqual(ALL.filter((l) => l.includes('r')));
    type(container, '');
    expect(headings(container)).toEqual(['Citrus', 'Berries', 'Stone fruit']);
    expect(labels(container)).toEqual(ALL);
  });

  test('arrow keys move across group boundaries', () => {
    const { container } = render(<Select {...BASE} />);
    key(container, 'ArrowDown', 40); // lemon
    for (let i = 0; i < 4; i++) key(container, 'ArrowDown', 40);
    expect(focused(container)).toBe('strawberry');
    key(container, 'ArrowUp', 38);
    expect(focused(container)).toBe('grapefruit');
    expect(container.querySelectorAll('.rs__option--is-focused')).toHaveLength(
      1
    );
  });

  test('hover, then filtering, keeps exactly one correct focus', () => {
    const { container } = render(<Select {...BASE} />);
    fireEvent.mouseOver(optionEl(container, 'plum'));
    expect(focused(container)).toBe('plum');
    type(container, 'p');
    // The focused option still matches, so it keeps focus.
    expect(focused(container)).toBe('plum');
    type(container, 'pe');
    // It no longer matches: focus moves to the first result.
    expect(focused(container)).toBe('grapefruit');
    expect(container.querySelectorAll('.rs__option--is-focused')).toHaveLength(
      1
    );
    fireEvent.mouseOver(optionEl(container, 'peach'));
    expect(focused(container)).toBe('peach');
  });

  test('selecting from a group shows the value and marks it selected', () => {
    const onChange = jest.fn();
    const { container } = render(
      <Select {...BASE} onChange={onChange} closeMenuOnSelect={false} />
    );
    fireEvent.click(optionEl(container, 'cherry'));
    expect(onChange).toHaveBeenLastCalledWith(
      GROUPS[2].options[2],
      expect.objectContaining({ action: 'select-option' })
    );
    expect(container.querySelector('.rs__single-value')!.textContent).toBe(
      'cherry'
    );
    expect(
      container.querySelector('.rs__option--is-selected')!.textContent
    ).toBe('cherry');
  });

  test('multiselect hides picked options from their group, and empties groups', () => {
    const { container } = render(
      <Select {...BASE} isMulti closeMenuOnSelect={false} />
    );
    ['strawberry', 'blueberry', 'raspberry'].forEach((l) =>
      fireEvent.click(optionEl(container, l))
    );
    expect(headings(container)).toEqual(['Citrus', 'Stone fruit']);
    key(container, 'Backspace', 8);
    expect(headings(container)).toEqual(['Citrus', 'Berries', 'Stone fruit']);
    expect(labels(container)).toEqual(
      ALL.filter((l) => l !== 'strawberry' && l !== 'blueberry')
    );
  });

  test('formatGroupLabel is applied', () => {
    const { container } = render(
      <Select
        {...BASE}
        formatGroupLabel={(g: Category) => `${g.label} (${g.options.length})`}
      />
    );
    expect(headings(container)).toEqual([
      'Citrus (4)',
      'Berries (3)',
      'Stone fruit (4)',
    ]);
  });

  test('hovering in a group re-renders only the old and new focused options', () => {
    const { CountingOption, renders } = countingOption();
    const { container } = render(
      <Select {...BASE} components={{ Option: CountingOption }} />
    );
    fireEvent.mouseOver(optionEl(container, 'lime'));
    renders.clear();
    fireEvent.mouseOver(optionEl(container, 'peach'));
    expect(Array.from(renders.keys()).sort()).toEqual(['lime', 'peach']);
  });
});

// ==============================
// Custom-rendered options
// ==============================

describe('custom-rendered options', () => {
  test('a custom Option that reads selectProps updates on typing', () => {
    // Highlights the typed text, so its output depends on inputValue.
    const Highlight = (props: OptionProps<Fruit, false>) => {
      const q = props.selectProps.inputValue;
      const i = q ? props.label.indexOf(q) : -1;
      return (
        <components.Option {...props}>
          {i < 0 ? (
            props.label
          ) : (
            <>
              {props.label.slice(0, i)}
              <mark>{q}</mark>
              {props.label.slice(i + q.length)}
            </>
          )}
        </components.Option>
      );
    };
    const { container } = render(
      <Select {...BASE} components={{ Option: Highlight }} />
    );
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    type(container, 'an');
    expect(
      Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)
    ).toEqual(['an']); // orange
    type(container, 'a');
    expect(container.querySelectorAll('mark')).toHaveLength(
      ALL.filter((l) => l.includes('a')).length
    );
    type(container, '');
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  test('a custom Option sees focus and selection changes', () => {
    const Marked = (props: OptionProps<Fruit, false>) => (
      <components.Option {...props}>
        {props.isFocused ? '> ' : ''}
        {props.label}
        {props.isSelected ? ' ✓' : ''}
      </components.Option>
    );
    const { container } = render(
      <Select
        {...BASE}
        closeMenuOnSelect={false}
        components={{ Option: Marked }}
      />
    );
    const byLabel = (l: string) =>
      Array.from(container.querySelectorAll('.rs__option')).find((el) =>
        el.textContent!.includes(l)
      )!;
    fireEvent.mouseOver(byLabel('plum'));
    expect(byLabel('plum').textContent).toBe('> plum');
    fireEvent.mouseOver(byLabel('lime'));
    expect(byLabel('plum').textContent).toBe('plum');
    fireEvent.click(byLabel('lime'));
    expect(byLabel('lime').textContent).toBe('> lime ✓');
  });

  test('formatOptionLabel renders differently in the menu and the value', () => {
    const { container } = render(
      <Select
        {...BASE}
        closeMenuOnSelect={false}
        formatOptionLabel={(o: Fruit, { context }) =>
          context === 'menu' ? `🍎 ${o.label}` : o.label.toUpperCase()
        }
      />
    );
    expect(labels(container)[0]).toBe('🍎 lemon');
    fireEvent.click(optionEl(container, '🍎 peach'));
    expect(container.querySelector('.rs__single-value')!.textContent).toBe(
      'PEACH'
    );
    type(container, 'pe');
    expect(labels(container)).toEqual(['🍎 grapefruit', '🍎 peach']);
  });

  test('a custom Option on a flat list re-renders only focus changes on hover', () => {
    const { CountingOption, renders } = countingOption();
    const flat = GROUPS.flatMap((g) => g.options);
    const { container } = render(
      <Select
        {...BASE}
        options={flat}
        components={{ Option: CountingOption }}
      />
    );
    fireEvent.mouseOver(optionEl(container, 'orange'));
    renders.clear();
    fireEvent.mouseOver(optionEl(container, 'plum'));
    fireEvent.mouseOver(optionEl(container, 'cherry'));
    expect(renders.get('orange')).toBe(1);
    expect(renders.get('plum')).toBe(2);
    expect(renders.get('cherry')).toBe(1);
    expect(renders.size).toBe(3);
  });
});

// Fetched options and infinite scroll: the caches must never serve a stale
// option list when options arrive asynchronously, are appended page by page,
// or are mutated in place.
import React, { useReducer, useRef, useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';

import Select from '../stateManager';
import AsyncSelect from '../Async';
import { Option, OPTIONS } from './constants';

const labels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.react-select__option')).map(
    (el) => el.textContent
  );

const PAGE = 5;
const ALL: Option[] = Array.from({ length: 40 }, (_, i) => ({
  label: `item ${i}`,
  value: `v${i}`,
}));
const page = (n: number) => ALL.slice(n * PAGE, (n + 1) * PAGE);

// jsdom has no layout, so the list never becomes taller after a page loads
// and react-select's "reached bottom" flag would stay set. A small upward
// wheel resets it, as a growing list does in a real browser.
const scrollMenuToBottom = (container: HTMLElement) => {
  const list = container.querySelector('.react-select__menu-list')!;
  fireEvent.wheel(list, { deltaY: -1 });
  fireEvent.wheel(list, { deltaY: 100 });
};

const arrowDown = (container: HTMLElement) =>
  fireEvent.keyDown(container.querySelector('.react-select__menu')!, {
    keyCode: 40,
    key: 'ArrowDown',
  });

const focusedLabel = (container: HTMLElement) =>
  container.querySelector('.react-select__option--is-focused')?.textContent;

// ==============================
// Fetched (async) options
// ==============================

describe('fetched options', () => {
  // A fake server whose responses the test releases explicitly.
  const createServer = () => {
    const pending: { input: string; resolve: (o: Option[]) => void }[] = [];
    const loadOptions = jest.fn(
      (input: string) =>
        new Promise<Option[]>((resolve) => pending.push({ input, resolve }))
    );
    const respond = async () => {
      const req = pending.shift()!;
      await act(async () => {
        req.resolve(ALL.filter((o) => o.label.includes(req.input)));
      });
    };
    return { loadOptions, respond, pending };
  };

  test('each response replaces the shown options', async () => {
    const server = createServer();
    const { container } = render(
      <AsyncSelect
        classNamePrefix="react-select"
        menuIsOpen
        defaultOptions
        loadOptions={server.loadOptions}
      />
    );
    await server.respond(); // initial ''
    expect(labels(container)).toHaveLength(ALL.length);

    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '1' } });
    await server.respond();
    expect(labels(container)).toEqual(
      ALL.filter((o) => o.label.includes('1')).map((o) => o.label)
    );

    fireEvent.change(input, { target: { value: '12' } });
    await server.respond();
    expect(labels(container)).toEqual(['item 12']);

    // Hover and keyboard work on fetched options.
    fireEvent.change(input, { target: { value: '3' } });
    await server.respond();
    const options = container.querySelectorAll('.react-select__option');
    fireEvent.mouseOver(options[2]);
    expect(focusedLabel(container)).toBe(options[2].textContent);
    arrowDown(container);
    expect(focusedLabel(container)).toBe(options[3].textContent);
  });

  test('a stale response for an older input is ignored', async () => {
    const server = createServer();
    const { container } = render(
      <AsyncSelect
        classNamePrefix="react-select"
        menuIsOpen
        loadOptions={server.loadOptions}
      />
    );
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '2' } });
    // '1' answers after '2' was typed: must not be shown.
    await server.respond();
    await server.respond();
    expect(labels(container)).toEqual(
      ALL.filter((o) => o.label.includes('2')).map((o) => o.label)
    );
  });

  test('cacheOptions shows cached results when returning to an input', async () => {
    const server = createServer();
    const { container } = render(
      <AsyncSelect
        classNamePrefix="react-select"
        menuIsOpen
        cacheOptions
        loadOptions={server.loadOptions}
      />
    );
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '3' } });
    await server.respond();
    const forThree = labels(container);
    fireEvent.change(input, { target: { value: '39' } });
    await server.respond();
    expect(labels(container)).toEqual(['item 39']);
    fireEvent.change(input, { target: { value: '3' } });
    expect(server.pending).toHaveLength(0); // served from the cache
    expect(labels(container)).toEqual(forThree);
  });

  test('a response with the same option objects in a new order is shown in that order', async () => {
    let order: Option[] = OPTIONS.slice(0, 5);
    const loadOptions = () => Promise.resolve(order);
    const { container } = render(
      <AsyncSelect
        classNamePrefix="react-select"
        menuIsOpen
        loadOptions={loadOptions}
      />
    );
    const input = container.querySelector('input')!;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'x' } });
    });
    expect(labels(container)).toEqual(['0', '1', '2', '3', '4']);
    order = [...order].reverse();
    await act(async () => {
      fireEvent.change(input, { target: { value: 'xy' } });
    });
    expect(labels(container)).toEqual(['4', '3', '2', '1', '0']);
  });
});

// ==============================
// Infinite scroll
// ==============================

describe('infinite scroll', () => {
  test('appending pages immutably shows every new page', () => {
    const InfiniteImmutable = () => {
      const [options, setOptions] = useState(page(0));
      return (
        <Select
          classNamePrefix="react-select"
          menuIsOpen
          captureMenuScroll
          options={options}
          onMenuScrollToBottom={() =>
            setOptions((prev) => [...prev, ...page(prev.length / PAGE)])
          }
        />
      );
    };
    const { container } = render(<InfiniteImmutable />);
    expect(labels(container)).toEqual(page(0).map((o) => o.label));
    for (let n = 1; n <= 3; n++) {
      scrollMenuToBottom(container);
      expect(labels(container)).toEqual(
        ALL.slice(0, (n + 1) * PAGE).map((o) => o.label)
      );
    }
    // Keyboard reaches options from the newest page. Loading a page focuses
    // the first option, so 19 presses land on the 20th.
    for (let i = 0; i < 4 * PAGE - 1; i++) arrowDown(container);
    expect(focusedLabel(container)).toBe(`item ${4 * PAGE - 1}`);
  });

  test('appending pages to a mutated-in-place array shows every new page', () => {
    // Some apps push into the same array and force a re-render.
    const InfiniteMutable = () => {
      const options = useRef<Option[]>([...page(0)]);
      const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
      return (
        <Select
          classNamePrefix="react-select"
          menuIsOpen
          captureMenuScroll
          options={options.current}
          onMenuScrollToBottom={() => {
            options.current.push(...page(options.current.length / PAGE));
            forceUpdate();
          }}
        />
      );
    };
    const { container } = render(<InfiniteMutable />);
    for (let n = 1; n <= 3; n++) {
      scrollMenuToBottom(container);
      expect(labels(container)).toEqual(
        ALL.slice(0, (n + 1) * PAGE).map((o) => o.label)
      );
    }
  });

  test('a mutated array is picked up by a Select-internal re-render (hover)', () => {
    // Upstream recomputes options on every render, so even a hover would
    // reveal items pushed into the same array.
    const options: Option[] = [...page(0)];
    const { container } = render(
      <Select classNamePrefix="react-select" menuIsOpen options={options} />
    );
    options.push(...page(1));
    fireEvent.mouseOver(container.querySelectorAll('.react-select__option')[1]);
    expect(labels(container)).toEqual(
      ALL.slice(0, 2 * PAGE).map((o) => o.label)
    );
  });

  test('an array sorted in place is shown in its new order', () => {
    const options: Option[] = [...page(0)];
    const { container } = render(
      <Select classNamePrefix="react-select" menuIsOpen options={options} />
    );
    options.reverse();
    fireEvent.mouseOver(container.querySelectorAll('.react-select__option')[1]);
    expect(labels(container)).toEqual(
      [...page(0)].reverse().map((o) => o.label)
    );
  });

  test('appending to a group mutated in place shows the new items', () => {
    const groups = [{ label: 'Group', options: [...page(0)] }];
    const Grouped = () => {
      const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
      return (
        <Select
          classNamePrefix="react-select"
          menuIsOpen
          captureMenuScroll
          options={groups}
          onMenuScrollToBottom={() => {
            groups[0].options.push(...page(1));
            forceUpdate();
          }}
        />
      );
    };
    const { container } = render(<Grouped />);
    scrollMenuToBottom(container);
    expect(labels(container)).toEqual(
      ALL.slice(0, 2 * PAGE).map((o) => o.label)
    );
  });

  test('filtering while pages load keeps results consistent', () => {
    const Filtered = () => {
      const [options, setOptions] = useState(page(0));
      const [input, setInput] = useState('');
      return (
        <Select
          classNamePrefix="react-select"
          menuIsOpen
          captureMenuScroll
          options={options}
          inputValue={input}
          onInputChange={(v) => setInput(v)}
          onMenuScrollToBottom={() =>
            setOptions((prev) => [...prev, ...page(prev.length / PAGE)])
          }
        />
      );
    };
    const { container } = render(<Filtered />);
    scrollMenuToBottom(container); // 0-9 loaded
    fireEvent.change(container.querySelector('input')!, {
      target: { value: '1' },
    });
    expect(labels(container)).toEqual(['item 1']);
    scrollMenuToBottom(container); // 10-14 loaded
    expect(labels(container)).toEqual([
      'item 1',
      'item 10',
      'item 11',
      'item 12',
      'item 13',
      'item 14',
    ]);
  });
});

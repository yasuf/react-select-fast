import memoizeOne from 'memoize-one';
import { stripDiacritics } from './diacritics';

export interface FilterOptionOption<Option> {
  readonly label: string;
  readonly value: string;
  readonly data: Option;
}

interface Config<Option> {
  readonly ignoreCase?: boolean;
  readonly ignoreAccents?: boolean;
  readonly stringify?: (option: FilterOptionOption<Option>) => string;
  readonly trim?: boolean;
  readonly matchFrom?: 'any' | 'start';
}

const trimString = (str: string) => str.replace(/^\s+|\s+$/g, '');
const defaultStringify = <Option>(option: FilterOptionOption<Option>) =>
  `${option.label} ${option.value}`;

// Upper bound on cached normalized candidates per filter, so long-lived filters
// fed ever-changing options can't grow without limit.
const MAX_CACHED_CANDIDATES = 100000;

export const createFilter = <Option>(config?: Config<Option>) => {
  const { ignoreCase, ignoreAccents, stringify, trim, matchFrom } = {
    ignoreCase: true,
    ignoreAccents: true,
    stringify: defaultStringify,
    trim: true,
    matchFrom: 'any',
    ...config,
  };

  const normalize = (str: string) => {
    let result = trim ? trimString(str) : str;
    if (ignoreCase) result = result.toLowerCase();
    if (ignoreAccents) result = stripDiacritics(result);
    return result;
  };

  // Normalizing a candidate (trim, lowercase, strip diacritics) is pure and is
  // by far the most expensive part of filtering. Cache it by the raw string so
  // each option is normalized once rather than on every keystroke and render.
  const candidateCache = new Map<string, string>();
  const normalizeCandidate = (raw: string) => {
    let normalized = candidateCache.get(raw);
    if (normalized === undefined) {
      if (candidateCache.size >= MAX_CACHED_CANDIDATES) candidateCache.clear();
      normalized = normalize(raw);
      candidateCache.set(raw, normalized);
    }
    return normalized;
  };
  const normalizeInput = memoizeOne(normalize);

  return (option: FilterOptionOption<Option>, rawInput: string): boolean => {
    // eslint-disable-next-line no-underscore-dangle
    if ((option.data as { __isNew__?: unknown }).__isNew__) return true;
    const input = normalizeInput(rawInput);
    const candidate = normalizeCandidate(stringify(option));
    return matchFrom === 'start'
      ? candidate.substr(0, input.length) === input
      : candidate.indexOf(input) > -1;
  };
};

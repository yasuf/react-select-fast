// React 18/19: createRoot. The initial render is flushed synchronously so mount
// time is comparable; event-driven updates are awaited by the bench itself.
import { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync, version } from 'react-dom';

export const reactVersion = version;

export function mount(element: ReactElement, host: HTMLElement) {
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return () => root.unmount();
}

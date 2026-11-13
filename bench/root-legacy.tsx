// React 16/17: ReactDOM.render, which renders synchronously.
import { ReactElement } from 'react';
import ReactDOM from 'react-dom';

export const reactVersion = (ReactDOM as any).version as string;

export function mount(element: ReactElement, host: HTMLElement) {
  ReactDOM.render(element, host);
  return () => {
    ReactDOM.unmountComponentAtNode(host);
  };
}

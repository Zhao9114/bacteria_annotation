// Lightweight toast notifications in the bottom-right corner.

import { icon } from './icons';

let host: HTMLDivElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3500): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast glass ${kind === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : 'check')}<span></span>`;
  el.querySelector('span')!.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

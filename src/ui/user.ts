// Top-bar user menu: shows who is annotating, lets them change their name,
// and (online) sign out.

import type { Store, User } from '../storage/store';
import { icon } from './icons';
import { toast } from './toast';

export function annotatorName(user: User | null): string {
  return user?.displayName || user?.email || 'Unnamed annotator';
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function mountUserMenu(container: HTMLElement, store: Store): void {
  const user = store.currentUser();
  const name = annotatorName(user);
  container.innerHTML = /* html */ `
    <button class="ghost" data-act="menu" title="Your name on annotations${store.kind === 'supabase' ? ', and sign out' : ''}">
      <span class="avatar">${initials(name)}</span><span class="muted user-name"></span>
    </button>`;
  container.querySelector('.user-name')!.textContent = name;
  container.querySelector('[data-act="menu"]')!.addEventListener('click', () => openUserDialog(store));
}

export function openUserDialog(store: Store, opts: { required?: boolean } = {}): Promise<void> {
  const user = store.currentUser();
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = /* html */ `
    <form method="dialog">
      <h2>${opts.required ? 'Welcome! What is your name?' : 'Your profile'}</h2>
      <label class="muted" style="display:flex;flex-direction:column;gap:6px">
        Name shown on your annotations
        <input type="text" name="name" required maxlength="80" placeholder="e.g. Dr. Smith" />
      </label>
      ${user?.email ? `<div class="muted">Signed in as <b></b></div>` : ''}
      <div class="actions">
        ${store.kind === 'supabase' && !opts.required ? `<button type="button" class="danger" data-act="signout">${icon('logout')} Sign out</button><span class="spacer"></span>` : ''}
        ${opts.required ? '' : '<button type="button" data-act="cancel">Cancel</button>'}
        <button class="primary" value="save">Save</button>
      </div>
    </form>`;
  const input = dialog.querySelector<HTMLInputElement>('input[name="name"]')!;
  input.value = user?.displayName ?? '';
  const emailEl = dialog.querySelector('b');
  if (emailEl) emailEl.textContent = user?.email ?? '';
  document.body.append(dialog);

  return new Promise((resolve) => {
    const close = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    dialog.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
    dialog.querySelector('[data-act="signout"]')?.addEventListener('click', async () => {
      await store.signOut();
      close();
    });
    // A required name can't be dismissed with Esc.
    dialog.addEventListener('cancel', (e) => {
      if (opts.required) e.preventDefault();
    });
    dialog.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      try {
        await store.setDisplayName(name);
        close();
        // Re-render the current screen so the new name shows everywhere.
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(`Could not save your name: ${(err as Error).message}`, 'error');
      }
    });
    dialog.showModal();
    input.focus();
  });
}

/** Shown after following a password-reset link: choose a new password. */
export function openNewPasswordDialog(store: Store): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = /* html */ `
    <form method="dialog">
      <h2>Choose a new password</h2>
      <label class="muted" style="display:flex;flex-direction:column;gap:6px">
        New password
        <input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters" />
      </label>
      <label class="muted" style="display:flex;flex-direction:column;gap:6px">
        Repeat it
        <input type="password" name="repeat" required minlength="6" autocomplete="new-password" />
      </label>
      <div class="actions">
        <button type="button" data-act="cancel">Not now</button>
        <button class="primary" value="save">Save password</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const [pw, repeat] = dialog.querySelectorAll<HTMLInputElement>('input');

  return new Promise((resolve) => {
    const close = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    dialog.querySelector('[data-act="cancel"]')!.addEventListener('click', close);
    dialog.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pw.value.length < 6) return toast('Please choose a password with at least 6 characters.', 'error');
      if (pw.value !== repeat.value) return toast('The two passwords are different.', 'error');
      try {
        await store.setPassword(pw.value);
        toast('Password changed.');
        close();
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    });
    dialog.showModal();
    pw.focus();
  });
}

// Sign-in screen (online version only): email a one-time sign-in link.
// No passwords to remember, which suits occasional users like students.

import type { Store } from '../storage/store';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';

export function mountSignInScreen(root: HTMLElement, store: Store): () => void {
  root.innerHTML = /* html */ `
    <div class="signin">
      <form class="card-form glass" data-ref="form">
        <a class="brand"><span class="logo">${icon('logo')}</span>Cell Annotator</a>
        <h1>Sign in</h1>
        <p class="muted" style="margin:0">We'll email you a link. Click it to sign in, no password needed.</p>
        <label>Email address
          <input type="email" name="email" required autocomplete="email" placeholder="you@university.edu" />
        </label>
        <button class="primary" type="submit">${icon('mail')} Email me a sign-in link</button>
      </form>
      <div class="card-form glass hidden" data-ref="sent">
        <div class="big-icon" style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:var(--accent-soft);color:var(--accent-hover)">${icon('mail')}</div>
        <h1>Check your email</h1>
        <p class="muted" style="margin:0">We sent a sign-in link to <b data-ref="email"></b>. Open it on this device to continue. You can close this tab.</p>
        <button class="ghost" data-ref="again">Use a different email</button>
      </div>
    </div>`;
  const form = root.querySelector<HTMLFormElement>('[data-ref="form"]')!;
  const sent = root.querySelector<HTMLElement>('[data-ref="sent"]')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = new FormData(form).get('email')!.toString().trim();
    button.disabled = true;
    try {
      await store.signIn(email);
      root.querySelector('[data-ref="email"]')!.textContent = email;
      form.classList.add('hidden');
      sent.classList.remove('hidden');
    } catch (err) {
      toast(`Could not send the link: ${(err as Error).message}`, 'error', 7000);
    } finally {
      button.disabled = false;
    }
  });
  root.querySelector('[data-ref="again"]')!.addEventListener('click', () => {
    sent.classList.add('hidden');
    form.classList.remove('hidden');
  });
  form.querySelector('input')!.focus();
  return () => {};
}

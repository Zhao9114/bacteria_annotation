// Sign-in screen (online version only): email + password, with sign-up and
// password reset, plus "Continue with Google" when Google is enabled in Supabase.

import type { Auth } from '../storage/store';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';

const GOOGLE_LOGO = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style="stroke:none">
  <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.3h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.2z"/>
  <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23z"/>
  <path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.4-.4-2s.1-1.4.4-2V7.1H2a11 11 0 0 0 0 9.8z"/>
  <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 7.1L5.7 10c.9-2.6 3.4-4.6 6.3-4.6z"/>
</svg>`;

type Mode = 'signin' | 'signup';

export function mountSignInScreen(root: HTMLElement, auth: Auth): () => void {
  root.innerHTML = /* html */ `
    <div class="signin">
      <form class="card-form glass" data-ref="form" novalidate>
        <a class="brand"><span class="logo">${icon('logo')}</span>Cell Annotator</a>
        <div class="segmented full" data-ref="tabs">
          <button type="button" data-mode="signin">Sign in</button>
          <button type="button" data-mode="signup">Create account</button>
        </div>
        <label data-ref="nameField">Your name (shown on your annotations)
          <input type="text" name="name" autocomplete="name" maxlength="80" placeholder="e.g. Dr. Smith" />
        </label>
        <label>Email
          <input type="email" name="email" required autocomplete="email" placeholder="you@university.edu" />
        </label>
        <label>Password
          <input type="password" name="password" required minlength="6" autocomplete="current-password" />
        </label>
        <button class="primary" type="submit" data-ref="submit"></button>
        <button type="button" class="ghost" data-ref="forgot">Forgot password?</button>
        <div class="or hidden" data-ref="googleBox"><span>or</span></div>
        <button type="button" class="hidden" data-ref="google">${GOOGLE_LOGO} Continue with Google</button>
      </form>
      <div class="card-form glass hidden" data-ref="notice">
        <div class="big-icon" style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:var(--accent-soft);color:var(--accent-hover)">${icon('mail')}</div>
        <h1 data-ref="noticeTitle"></h1>
        <p class="muted" style="margin:0" data-ref="noticeText"></p>
        <button class="ghost" type="button" data-ref="back">${icon('chevronLeft')} Back to sign in</button>
      </div>
    </div>`;
  const q = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const form = q<HTMLFormElement>('form');
  const submit = q<HTMLButtonElement>('submit');
  const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]')!;
  const passwordInput = form.querySelector<HTMLInputElement>('input[name="password"]')!;
  let mode: Mode = 'signin';

  function setMode(m: Mode): void {
    mode = m;
    for (const b of q('tabs').querySelectorAll<HTMLElement>('[data-mode]')) b.classList.toggle('active', b.dataset.mode === m);
    q('nameField').classList.toggle('hidden', m === 'signin');
    q('forgot').classList.toggle('hidden', m === 'signup');
    submit.textContent = m === 'signin' ? 'Sign in' : 'Create account';
    passwordInput.autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    passwordInput.placeholder = m === 'signup' ? 'At least 6 characters' : '';
  }

  function showNotice(title: string, text: string): void {
    q('noticeTitle').textContent = title;
    q('noticeText').textContent = text;
    form.classList.add('hidden');
    q('notice').classList.remove('hidden');
  }

  async function busy(button: HTMLButtonElement, work: () => Promise<void>): Promise<void> {
    button.disabled = true;
    try {
      await work();
    } catch (err) {
      toast((err as Error).message, 'error', 7000);
    } finally {
      button.disabled = false;
    }
  }

  q('tabs').addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
    if (m) setMode(m);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const name = nameInput.value.trim();
    if (mode === 'signup' && !name) return toast('Please enter your name.', 'error');
    if (!emailInput.checkValidity()) return toast('Please enter a valid email address.', 'error');
    if (password.length < 6) return toast('Please choose a password with at least 6 characters.', 'error');
    void busy(submit, async () => {
      if (mode === 'signin') {
        await auth.signInWithPassword(email, password); // the router takes over once signed in
      } else if ((await auth.signUp(name, email, password)) === 'confirm_email') {
        showNotice('Confirm your email', `We sent a confirmation link to ${email}. Click it, then sign in here.`);
      }
    });
  });

  q('forgot').addEventListener('click', () => {
    const email = emailInput.value.trim();
    if (!emailInput.checkValidity() || !email) {
      toast('Type your email address above first, then click “Forgot password?” again.', 'error');
      emailInput.focus();
      return;
    }
    void busy(q('forgot'), async () => {
      await auth.sendPasswordReset(email);
      showNotice('Check your email', `If ${email} has an account, we sent it a link to choose a new password.`);
    });
  });

  q('back').addEventListener('click', () => {
    q('notice').classList.add('hidden');
    form.classList.remove('hidden');
    setMode('signin');
  });

  q('google').addEventListener('click', () => void busy(q('google'), () => auth.signInWithGoogle()));
  // Only offer Google once it is switched on in Supabase; otherwise it leads to an error page.
  void auth.providers().then(({ google }) => {
    q('googleBox').classList.toggle('hidden', !google);
    q('google').classList.toggle('hidden', !google);
  });

  setMode('signin');
  emailInput.focus();
  return () => {};
}

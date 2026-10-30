import './styles.css';
import { mountAnnotateScreen } from './screens/annotate';
import { mountLibraryScreen } from './screens/library';
import { createStore } from './storage';
import type { Store } from './storage/store';
import { toast } from './ui/toast';
import { openUserDialog } from './ui/user';

// Hash routes (no server rewrites needed on static hosting):
//   #/library          image library (default)
//   #/image/<id>       annotate one image

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing');
const app = root;

let cleanup: (() => void) | null = null;

function route(store: Store): void {
  cleanup?.();
  cleanup = null;
  const image = /^#\/image\/([\w-]+)$/.exec(location.hash);
  if (image) cleanup = mountAnnotateScreen(app, store, image[1]);
  else {
    if (location.hash !== '#/library') history.replaceState(null, '', '#/library');
    cleanup = mountLibraryScreen(app, store);
  }
}

async function start(): Promise<void> {
  let store: Store;
  try {
    store = await createStore();
  } catch (e) {
    app.innerHTML = `<div class="signin"><div class="card glass card-form"><h1>Could not start</h1><p class="muted"></p></div></div>`;
    app.querySelector('p')!.textContent = (e as Error).message;
    return;
  }
  window.addEventListener('hashchange', () => route(store));
  route(store);
  // Annotations carry the annotator's name, so ask for it once.
  if (!store.currentUser()?.displayName) await openUserDialog(store, { required: true });
}

window.addEventListener('unhandledrejection', (e) => toast(`Something went wrong: ${e.reason?.message ?? e.reason}`, 'error'));
void start();

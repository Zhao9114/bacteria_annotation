// Sidebar sections for the annotation screen.

import { DEFAULT_DISPLAY, type Channel, type DisplaySettings } from '../canvas/filters';

const CHANNEL_LABELS: Record<Channel, string> = {
  rgb: 'Original colours',
  red: 'Red only',
  green: 'Green only (clearest)',
  blue: 'Blue only',
};

export interface DisplayControls {
  /** Refresh the controls from current settings (e.g. after a keyboard shortcut). */
  sync(): void;
}

export function mountDisplayControls(
  container: HTMLElement,
  settings: DisplaySettings,
  onChange: () => void,
): DisplayControls {
  container.innerHTML = /* html */ `
    <h2>Image display</h2>
    <div class="field" title="Which colour of the photo to show. Green usually shows the cell edges best. Shortcut: G">
      <label for="disp-channel">Colours</label>
      <select id="disp-channel">
        ${(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => `<option value="${c}">${CHANNEL_LABELS[c]}</option>`).join('')}
      </select>
      <span></span>
    </div>
    <label class="check" title="Spread the darkest and brightest parts of the photo across the full range so faint edges stand out">
      <input type="checkbox" id="disp-stretch" /> Boost contrast automatically
    </label>
    <div class="field" title="Make the whole image lighter or darker">
      <label for="disp-brightness">Brightness</label>
      <input type="range" id="disp-brightness" min="-100" max="100" step="1" />
      <span class="value" id="disp-brightness-val"></span>
    </div>
    <div class="field" title="Increase or reduce the difference between light and dark">
      <label for="disp-contrast">Contrast</label>
      <input type="range" id="disp-contrast" min="-100" max="100" step="1" />
      <span class="value" id="disp-contrast-val"></span>
    </div>
    <button id="disp-reset" title="Go back to the recommended display settings">Reset display</button>
    <p class="note">These settings only change how the image looks on screen. The photo itself is never changed.</p>
  `;
  const q = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const channel = q<HTMLSelectElement>('disp-channel');
  const stretch = q<HTMLInputElement>('disp-stretch');
  const brightness = q<HTMLInputElement>('disp-brightness');
  const contrast = q<HTMLInputElement>('disp-contrast');
  const brightnessVal = q('disp-brightness-val');
  const contrastVal = q('disp-contrast-val');

  function sync(): void {
    channel.value = settings.channel;
    stretch.checked = settings.stretch;
    brightness.value = String(settings.brightness);
    contrast.value = String(settings.contrast);
    brightnessVal.textContent = String(settings.brightness);
    contrastVal.textContent = String(settings.contrast);
  }

  const changed = () => {
    sync();
    onChange();
  };
  channel.addEventListener('change', () => {
    settings.channel = channel.value as Channel;
    changed();
  });
  stretch.addEventListener('change', () => {
    settings.stretch = stretch.checked;
    changed();
  });
  brightness.addEventListener('input', () => {
    settings.brightness = Number(brightness.value);
    changed();
  });
  contrast.addEventListener('input', () => {
    settings.contrast = Number(contrast.value);
    changed();
  });
  q('disp-reset').addEventListener('click', () => {
    Object.assign(settings, DEFAULT_DISPLAY);
    changed();
  });

  sync();
  return { sync };
}

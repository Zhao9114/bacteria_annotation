// Inspector panels for the annotation screen. Each mounts into a panel body;
// the panel headings live in the screen template.

import { DEFAULT_DISPLAY, type Channel, type DisplaySettings } from '../canvas/filters';
import { INNER_COLOR, OUTER_COLOR, RAY_KEPT_COLOR, RAY_REJECTED_COLOR } from '../canvas/render';
import type { Cell } from '../io/schema';
import type { CellMeasurements, MeasurementSettings } from '../measure/measure';
import { icon } from './icons';

const CHANNEL_LABELS: Record<Channel, string> = {
  rgb: 'Original colours',
  red: 'Red only',
  green: 'Green only (clearest edges)',
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
    <div class="field" title="Which colour of the photo to show. Green often shows the cell edges best. Shortcut: G">
      <label for="disp-channel">Colours</label>
      <select id="disp-channel" style="grid-column: span 2">
        ${(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => `<option value="${c}">${CHANNEL_LABELS[c]}</option>`).join('')}
      </select>
    </div>
    <label class="switch" title="Spread the darkest and brightest parts of the photo across the full range so faint edges stand out">
      Boost contrast automatically <input type="checkbox" id="disp-stretch" />
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
    <button id="disp-reset" class="ghost" style="margin-top: 6px" title="Show the photo as it was taken">Reset to original</button>
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

// ---------------------------------------------------------------------------

export interface CellPanelCallbacks {
  onAdd(): void;
  onSelect(id: number): void;
  onDelete(id: number): void;
  onToggleBand(show: boolean): void;
}

/** What the cell list shows. */
export interface CellListView {
  /** A cell is being drawn (Add cell is disabled meanwhile). */
  drawing: boolean;
  cells: readonly Cell[];
  selectedId: number | null;
  /** Changes whenever the cells change; the list is only rebuilt then. */
  revision: number;
  showBand: boolean;
}

export interface CellPanel {
  update(view: CellListView): void;
}

export function mountCellPanel(container: HTMLElement, cb: CellPanelCallbacks): CellPanel {
  container.innerHTML = /* html */ `
    <button class="primary add-cell" data-act="add" title="Mark a new cell: first the outer ring, then the dark center. Shortcut: N">${icon('plus')} Add cell</button>
    <div class="legend">
      <span style="--c: ${OUTER_COLOR}">Outer ring</span>
      <span style="--c: ${INNER_COLOR}">Dark center</span>
    </div>
    <label class="switch" title="Shade the area between the outer ring and the dark center">
      Shade the distance band <input type="checkbox" data-act="band" />
    </label>
    <ul class="cell-list"></ul>
  `;
  const addBtn = container.querySelector<HTMLButtonElement>('[data-act="add"]')!;
  const band = container.querySelector<HTMLInputElement>('[data-act="band"]')!;
  const list = container.querySelector<HTMLUListElement>('.cell-list')!;

  addBtn.addEventListener('click', () => cb.onAdd());
  band.addEventListener('change', () => cb.onToggleBand(band.checked));
  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const li = target.closest<HTMLLIElement>('li[data-id]');
    if (!li) return;
    const id = Number(li.dataset.id);
    if (target.closest('[data-act="delete"]')) cb.onDelete(id);
    else if (target.closest('[data-act="select"]')) cb.onSelect(id);
  });

  let lastKey = '';
  function update(view: CellListView): void {
    addBtn.disabled = view.drawing;
    band.checked = view.showBand;

    const key = `${view.revision}|${view.selectedId}`;
    if (key === lastKey) return;
    lastKey = key;

    if (view.cells.length === 0) {
      list.innerHTML = `<li class="empty-list">No cells yet. Click “Add cell” to mark the first one.</li>`;
      return;
    }
    list.innerHTML = view.cells
      .map((c) => {
        const selected = c.id === view.selectedId;
        return /* html */ `
        <li data-id="${c.id}" class="${selected ? 'selected' : ''}">
          <button class="cell-row" data-act="select" title="Select this cell to see all its measurements">
            <span class="name">Cell ${c.id}</span>
            ${c.draw_mode === 'freehand' ? '<span class="tag">freehand</span>' : ''}
            ${c.measurements.inner_inside_outer ? '' : '<span class="warn-badge" title="The dark center goes outside the outer ring">check</span>'}
            <span class="main" title="Median distance from the dark center edge to the outer ring">${fmt(c.measurements.gap_median)} px</span>
          </button>
          ${
            selected
              ? /* html */ `<div class="cell-detail">
                  ${cellDetail(c)}
                  <div class="cell-actions">
                    <button class="danger" data-act="delete" title="Remove this cell (Delete)">${icon('trash')} Delete cell</button>
                  </div>
                </div>`
              : ''
          }
        </li>`;
      })
      .join('');
  }

  return { update };
}

function fmt(x: number | null, digits = 1): string {
  return x === null || !Number.isFinite(x) ? '—' : x.toFixed(digits);
}

function pct(x: number | null): string {
  return x === null ? '—' : `${(x * 100).toFixed(1)}%`;
}

function row(label: string, value: string, tip: string): string {
  return `<tr title="${tip}"><th>${label}</th><td>${value}</td></tr>`;
}

function group(label: string): string {
  return `<tr class="group"><th colspan="2">${label}</th></tr>`;
}

function cellDetail(c: Cell): string {
  const m: CellMeasurements = c.measurements;
  const used = m.n_rays_valid - m.n_rays_rejected;
  const warnings: string[] = [];
  if (!m.inner_inside_outer) {
    warnings.push('The dark center goes outside the outer ring. Please check both outlines.');
  }
  if (m.gap_median === null) {
    warnings.push('No distance could be measured. The dark center may not be inside the outer ring.');
  }
  const leftOut = m.n_rays_rejected
    ? ` (${m.n_rays_rejected} unusual line${m.n_rays_rejected === 1 ? '' : 's'} left out)`
    : '';
  return /* html */ `
    ${warnings.map((w) => `<div class="warn">${w}</div>`).join('')}
    <table class="stats">
      ${group('Distance: dark center edge to outer ring')}
      ${row('Median', `${fmt(m.gap_median)} px`, 'The middle value of all measured distances. This is the main number.')}
      ${row('Average', `${fmt(m.gap_mean)} px`, 'Mean of the measured distances')}
      ${row('Shortest', `${fmt(m.gap_min)} px`, 'Smallest measured distance')}
      ${row('Longest', `${fmt(m.gap_max)} px`, 'Largest measured distance')}
      ${row('Typical range', `${fmt(m.gap_p10)} – ${fmt(m.gap_p90)} px`, '10th to 90th percentile of the distances')}
      ${row('Variation', `${fmt(m.gap_std)} px`, 'Standard deviation: how much the distance changes around the cell')}
      ${row('Lines used', `${used} of ${m.num_rays}${leftOut}`, 'Measurement lines from the center that hit both outlines')}
      ${group('Size')}
      ${row('Outer ring width', `${fmt(m.outer.equiv_diameter)} px`, 'Diameter of a circle with the same area as the outer ring')}
      ${row('Dark center width', `${fmt(m.inner.equiv_diameter)} px`, 'Diameter of a circle with the same area as the dark center')}
      ${row('Outer ring longest', `${fmt(m.outer.max_feret)} px`, 'Longest straight line across the outer ring')}
      ${row('Dark center longest', `${fmt(m.inner.max_feret)} px`, 'Longest straight line across the dark center')}
      ${row('Outer ring roundness', fmt(m.outer.circularity, 2), '1.00 is a perfect circle; lower is more stretched or irregular')}
      ${row('Dark center roundness', fmt(m.inner.circularity, 2), '1.00 is a perfect circle; lower is more stretched or irregular')}
      ${group('Ratios (comparable between photos)')}
      ${row('Distance ÷ outer radius', fmt(m.gap_over_outer_radius, 3), 'Median distance divided by half the outer ring width')}
      ${row('Center ÷ outer width', fmt(m.inner_over_outer_diameter, 3), 'Dark center width divided by outer ring width')}
      ${row('Band share of area', pct(m.ring_area_fraction), 'Part of the outer ring area that is outside the dark center')}
      ${row('Center off-middle', fmt(m.center_offset, 3), 'How far the dark center sits from the middle of the outer ring, relative to the outer radius')}
    </table>
    <p class="note">Pixel (px) values depend on the zoom of each photo, so only compare them within the same photo. The ratios can be compared across photos.</p>
  `;
}

// ---------------------------------------------------------------------------

export interface MeasurementControls {
  /** Show these values (e.g. after a keyboard shortcut or loading an annotation). */
  sync(view: { showRays: boolean; settings: Readonly<MeasurementSettings> }): void;
}

export function mountMeasurementControls(
  container: HTMLElement,
  on: { rays(show: boolean): void; settings(change: Partial<MeasurementSettings>): void },
): MeasurementControls {
  container.innerHTML = /* html */ `
    <label class="switch" title="Show the lines used to measure the selected cell. Shortcut: R">
      Show measurement lines <input type="checkbox" data-act="rays" />
    </label>
    <div class="legend" style="margin: 0 0 8px">
      <span style="--c: ${RAY_KEPT_COLOR}">Used</span>
      <span style="--c: ${RAY_REJECTED_COLOR}">Left out (unusual)</span>
    </div>
    <div class="field" title="How many evenly spaced lines are drawn from the center of each cell. The analysis program uses 32.">
      <label for="meas-rays">Lines per cell</label>
      <input type="number" id="meas-rays" min="4" max="360" step="1" style="grid-column: span 2" />
    </div>
    <label class="switch" title="Ignore lines whose distance is very different from the rest (same rule as the analysis program)">
      Leave out unusual lines <input type="checkbox" data-act="mad" />
    </label>
  `;
  const rays = container.querySelector<HTMLInputElement>('[data-act="rays"]')!;
  const num = container.querySelector<HTMLInputElement>('#meas-rays')!;
  const mad = container.querySelector<HTMLInputElement>('[data-act="mad"]')!;
  let lastRays = 32;

  function sync(view: { showRays: boolean; settings: Readonly<MeasurementSettings> }): void {
    rays.checked = view.showRays;
    num.value = String(view.settings.num_rays);
    mad.checked = view.settings.mad_reject;
    lastRays = view.settings.num_rays;
  }
  rays.addEventListener('change', () => on.rays(rays.checked));
  num.addEventListener('change', () => {
    const n = Math.round(Number(num.value));
    if (Number.isFinite(n) && n >= 4 && n <= 360) on.settings({ num_rays: n });
    else num.value = String(lastRays);
  });
  mad.addEventListener('change', () => on.settings({ mad_reject: mad.checked }));
  return { sync };
}

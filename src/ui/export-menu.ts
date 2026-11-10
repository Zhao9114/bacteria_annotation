// "Export" button with a small menu: measurements as CSV, or everything as JSON.

import { download, toCsv, toJson, type ExportItem } from '../io/export';
import { icon } from './icons';
import { toast } from './toast';

/**
 * Mounts the menu into `container`. `gather` collects what to export when a
 * format is chosen; files are named `<baseName>-<kind>-<date>.<ext>`.
 * `signal` is the screen's: leaving the screen removes the menu's listeners.
 */
export function mountExportMenu(
  container: HTMLElement,
  baseName: () => string,
  gather: () => Promise<ExportItem[]>,
  signal: AbortSignal,
): void {
  container.innerHTML = /* html */ `
    <details class="menu">
      <summary title="Download the results to compare them with the network">${icon('download')} Export</summary>
      <div class="menu-panel glass">
        <button data-fmt="csv">Measurements (CSV)<small>One row per cell, for spreadsheets</small></button>
        <button data-fmt="json">Outlines and measurements (JSON)<small>Every outline, for comparing shapes</small></button>
      </div>
    </details>`;
  const menu = container.querySelector('details')!;
  // Close when clicking anywhere else.
  document.addEventListener(
    'click',
    (e) => {
      if (!menu.contains(e.target as Node)) menu.open = false;
    },
    { signal },
  );
  menu.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
    if (!btn) return;
    menu.open = false;
    try {
      const items = await gather();
      const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
      const annotated = items.filter((i) => i.doc && i.doc.cells.length > 0).length;
      if (annotated === 0) {
        toast('Nothing to export yet: no cells have been marked here.', 'error');
        return;
      }
      if (btn.dataset.fmt === 'csv') download(`${baseName()}-measurements-${date}.csv`, toCsv(items), 'text/csv');
      else download(`${baseName()}-annotations-${date}.json`, toJson(items), 'application/json');
      toast(`Exported ${annotated} annotated image${annotated === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(`Could not export: ${(err as Error).message}`, 'error');
    }
  });
}

/** "iPhone 14 Pro (lab)" → "iphone-14-pro-lab", for file names. */
export function slug(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';
}

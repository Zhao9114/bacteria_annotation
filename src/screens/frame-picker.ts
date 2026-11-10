// Picking frames from a video. Opens over the library: reads the video, scores
// every frame for sharpness, suggests the sharpest frame in each stretch of the
// clip, and lets the person change the choice before the chosen frames are
// saved as images. The video file itself is not stored.

import type { LibraryStore, VideoRecord } from '../storage/store';
import { prepareFrame, sha256Hex } from '../storage/upload';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { VideoClip } from '../video/clip';
import { formatTime, frameFilename, guessPhone, guessPixelSize, suggestFrames } from '../video/frames';

const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;
const THUMB_W = 96;

const TEMPLATE = /* html */ `
<div class="picker-backdrop" role="dialog" aria-modal="true" aria-label="Pick frames from a video">
  <div class="picker glass">
    <header class="picker-head">
      <span class="picker-icon">${icon('film')}</span>
      <div class="picker-title">
        <h2>Pick frames to annotate</h2>
        <div class="muted" data-ref="file"></div>
      </div>
      <button class="ghost icon-btn" data-ref="close" title="Cancel (Esc)">${icon('x')}</button>
    </header>
    <div class="picker-loading" data-ref="loading">
      <div data-ref="loadText">Reading the video…</div>
      <div class="progress"><div data-ref="bar"></div></div>
    </div>
    <div class="picker-main hidden" data-ref="main">
      <div class="picker-fields">
        <label>Phone <input type="text" data-ref="phone" maxlength="80" placeholder="e.g. iPhone 14 Pro" /></label>
        <label title="The phone sensor's pixel size, as reported. Stored with the video; measurements stay in pixels.">
          Pixel size (µm) <input type="number" data-ref="pixel" min="0" step="0.01" placeholder="optional" />
        </label>
        <div class="muted picker-info" data-ref="info"></div>
      </div>
      <div class="picker-note hidden" data-ref="existing"></div>
      <div class="picker-preview">
        <canvas data-ref="preview"></canvas>
      </div>
      <div class="picker-caption">
        <span data-ref="caption"></span>
        <span class="spacer"></span>
        <button data-ref="toggle"></button>
      </div>
      <div class="picker-timeline" title="Sharpness of every frame. Click or drag to look at a frame. ← → move one frame, Shift+← → ten.">
        <canvas data-ref="timeline"></canvas>
      </div>
      <div class="picker-legend muted">
        <span class="swatch-line sel"></span> chosen
        <span class="swatch-line saved"></span> already saved
        <span class="swatch-line bars"></span> sharpness
      </div>
      <div class="picker-suggest">
        <span>Suggest</span>
        <input type="number" data-ref="count" min="1" max="${MAX_COUNT}" value="${DEFAULT_COUNT}" />
        <span>frames, the sharpest in each part of the video</span>
        <button class="ghost" data-ref="suggest">Suggest again</button>
      </div>
      <div class="picker-strip" data-ref="strip"></div>
    </div>
    <footer class="picker-foot">
      <span class="muted" data-ref="status"></span>
      <span class="spacer"></span>
      <button data-ref="cancel">Cancel</button>
      <button class="primary" data-ref="save" disabled>Save frames</button>
    </footer>
  </div>
</div>`;

/** Resolves with the video the frames were saved to, or null if cancelled. */
export function openFramePicker(file: File, library: LibraryStore): Promise<VideoRecord | null> {
  const host = document.createElement('div');
  host.innerHTML = TEMPLATE;
  document.body.append(host);
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => host.querySelector<T>(`[data-ref="${name}"]`)!;
  const abort = new AbortController();
  const { signal } = abort;
  ref('file').textContent = file.name;

  let finish!: (v: VideoRecord | null) => void;
  const result = new Promise<VideoRecord | null>((resolve) => (finish = resolve));
  let saving = false;
  function close(video: VideoRecord | null): void {
    abort.abort();
    host.remove();
    finish(video);
  }
  const cancel = () => {
    if (!saving) close(null);
  };
  ref('close').addEventListener('click', cancel);
  ref('cancel').addEventListener('click', cancel);

  void (async () => {
    try {
      const bar = ref('bar');
      const [clip, sha256] = await Promise.all([VideoClip.open(file), sha256Hex(file)]);
      const existing = await library.findVideo(sha256);
      const savedFrames = existing ? await library.listFrames(existing.id) : [];
      const saved = new Set(savedFrames.map((f) => f.frame!.index));
      ref('loadText').textContent = `Checking the sharpness of ${clip.info.frameCount} frames…`;
      const scores = await clip.scan((done, total) => (bar.style.width = `${(100 * done) / total}%`), signal);
      ref('loading').classList.add('hidden');
      ref('main').classList.remove('hidden');
      startPicking(clip, scores, sha256, existing, saved);
    } catch (e) {
      if (signal.aborted) return;
      ref('loadText').textContent = (e as Error).message;
      ref('loading').classList.add('error');
    }
  })();

  function startPicking(clip: VideoClip, scores: Float64Array, sha256: string, existing: VideoRecord | null, saved: Set<number>): void {
    const n = clip.info.frameCount;
    const { fps, duration, width, height } = clip.info;
    const phoneInput = ref<HTMLInputElement>('phone');
    const pixelInput = ref<HTMLInputElement>('pixel');
    phoneInput.value = existing?.phone ?? guessPhone(file.name);
    pixelInput.value = String(existing?.pixel_size_um ?? guessPixelSize(file.name) ?? '');
    ref('info').textContent = `${n} frames · ${fps.toFixed(Number.isInteger(fps) ? 0 : 2)} fps · ${formatTime(duration)} · ${width}×${height}`;
    if (existing) {
      const note = ref('existing');
      note.classList.remove('hidden');
      note.textContent = `You added this video before: ${saved.size} frame${saved.size === 1 ? ' is' : 's are'} already saved (green marks). New frames are added to it.`;
    }

    const sorted = [...scores].sort((a, b) => a - b);
    const rankOf = (s: number) => Math.round((100 * sorted.findIndex((x) => x >= s)) / Math.max(1, n - 1));
    let selected = new Set(suggestFrames(scores, DEFAULT_COUNT, saved));
    let current = [...selected][0] ?? 0;

    // ---------- timeline ----------
    const timeline = ref<HTMLCanvasElement>('timeline');
    const tctx = timeline.getContext('2d')!;
    const maxScore = Math.max(...scores, 1e-9);
    function drawTimeline(): void {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(timeline.clientWidth * dpr));
      const h = Math.max(1, Math.round(timeline.clientHeight * dpr));
      if (timeline.width !== w || timeline.height !== h) Object.assign(timeline, { width: w, height: h });
      tctx.clearRect(0, 0, w, h);
      const top = 10 * dpr;
      tctx.fillStyle = 'rgba(160, 172, 205, 0.55)';
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x * n) / w);
        const b = Math.max(a + 1, Math.floor(((x + 1) * n) / w));
        let s = 0;
        for (let i = a; i < b && i < n; i++) s = Math.max(s, scores[i]);
        const bh = (s / maxScore) * (h - top);
        tctx.fillRect(x, h - bh, 1, bh);
      }
      const xOf = (i: number) => ((i + 0.5) * w) / n;
      const mark = (i: number, color: string, width: number) => {
        tctx.fillStyle = color;
        tctx.fillRect(Math.round(xOf(i) - width / 2), 0, width, h);
      };
      for (const i of saved) mark(i, '#3ccf8e', 2 * dpr);
      for (const i of selected) {
        mark(i, '#8b95ff', 2 * dpr);
        tctx.beginPath();
        tctx.moveTo(xOf(i) - 5 * dpr, 0);
        tctx.lineTo(xOf(i) + 5 * dpr, 0);
        tctx.lineTo(xOf(i), 7 * dpr);
        tctx.fill();
      }
      mark(current, '#ffffff', 2 * dpr);
    }
    const frameAt = (clientX: number) => {
      const r = timeline.getBoundingClientRect();
      return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
    };
    let dragging = false;
    timeline.addEventListener('pointerdown', (e) => {
      dragging = true;
      timeline.setPointerCapture(e.pointerId);
      go(frameAt(e.clientX));
    });
    timeline.addEventListener('pointermove', (e) => dragging && go(frameAt(e.clientX)));
    timeline.addEventListener('pointerup', () => (dragging = false));
    timeline.addEventListener('pointercancel', () => (dragging = false));
    new ResizeObserver(drawTimeline).observe(timeline);

    // ---------- preview of the current frame ----------
    const preview = ref<HTMLCanvasElement>('preview');
    let previewToken = 0;
    async function showPreview(): Promise<void> {
      const token = ++previewToken;
      const frame = await clip.preview(current);
      if (token !== previewToken || signal.aborted) {
        if (frame instanceof ImageBitmap) frame.close();
        return;
      }
      preview.width = frame.width;
      preview.height = frame.height;
      preview.getContext('2d')!.drawImage(frame, 0, 0);
      if (frame instanceof ImageBitmap) frame.close();
    }
    function updateCaption(): void {
      ref('caption').innerHTML =
        `<b>Frame ${current}</b> · ${formatTime(clip.timeOf(current))} · ` +
        `sharper than ${rankOf(scores[current])}% of frames`;
      const toggle = ref<HTMLButtonElement>('toggle');
      toggle.disabled = saved.has(current);
      toggle.className = selected.has(current) ? '' : 'primary';
      toggle.innerHTML = saved.has(current)
        ? `${icon('check')} Already saved`
        : selected.has(current)
          ? `${icon('x')} Don't use this frame`
          : `${icon('plus')} Use this frame`;
    }

    // ---------- chosen frames ----------
    const thumbs = new Map<number, HTMLCanvasElement>();
    async function thumb(i: number): Promise<HTMLCanvasElement> {
      let c = thumbs.get(i);
      if (!c) {
        const frame = await clip.preview(i);
        c = document.createElement('canvas');
        c.width = THUMB_W;
        c.height = Math.round((THUMB_W * frame.height) / frame.width);
        c.getContext('2d')!.drawImage(frame, 0, 0, c.width, c.height);
        if (frame instanceof ImageBitmap) frame.close();
        thumbs.set(i, c);
      }
      return c;
    }
    const strip = ref('strip');
    function renderStrip(): void {
      const list = [...selected].sort((a, b) => a - b);
      strip.innerHTML = list.length
        ? list
            .map(
              (i) => /* html */ `
              <div class="strip-item ${i === current ? 'current' : ''}" data-frame="${i}">
                <button class="strip-view" data-frame="${i}" title="Look at frame ${i}"><span class="strip-thumb"></span>
                  <span>#${i} · ${formatTime(clip.timeOf(i))}</span></button>
                <button class="ghost icon-btn strip-x" data-remove="${i}" title="Don't use this frame">${icon('x')}</button>
              </div>`,
            )
            .join('')
        : '<div class="muted">No frames chosen. Click the timeline to look at frames, or suggest again.</div>';
      for (const i of list) {
        void thumb(i).then((src) => {
          const slot = strip.querySelector(`.strip-item[data-frame="${i}"] .strip-thumb`);
          if (!slot || slot.firstChild) return;
          const c = document.createElement('canvas');
          copyCanvas(src, c);
          slot.append(c);
        });
      }
      const m = selected.size;
      const save = ref<HTMLButtonElement>('save');
      save.disabled = m === 0 || saving;
      save.textContent = `Save ${m} frame${m === 1 ? '' : 's'}`;
      ref('status').textContent = existing ? `${saved.size} saved before` : '';
    }
    strip.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const remove = t.closest<HTMLElement>('[data-remove]');
      if (remove) {
        selected.delete(Number(remove.dataset.remove));
        refresh();
        return;
      }
      const view = t.closest<HTMLElement>('[data-frame]');
      if (view) go(Number(view.dataset.frame));
    });

    function go(i: number): void {
      if (i === current) return;
      current = i;
      void showPreview();
      updateCaption();
      drawTimeline();
      for (const el of strip.querySelectorAll<HTMLElement>('.strip-item')) el.classList.toggle('current', Number(el.dataset.frame) === i);
    }
    function refresh(): void {
      updateCaption();
      drawTimeline();
      renderStrip();
    }
    function toggleCurrent(): void {
      if (saved.has(current)) return;
      if (selected.has(current)) selected.delete(current);
      else selected.add(current);
      refresh();
    }
    ref('toggle').addEventListener('click', toggleCurrent);
    ref('suggest').addEventListener('click', () => {
      const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(ref<HTMLInputElement>('count').value) || DEFAULT_COUNT)));
      ref<HTMLInputElement>('count').value = String(count);
      selected = new Set(suggestFrames(scores, count, saved));
      refresh();
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (saving) return;
        if (e.key === 'Escape') return cancel();
        if ((e.target as HTMLElement).closest('input')) return;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') go(Math.max(0, current - step));
        else if (e.key === 'ArrowRight') go(Math.min(n - 1, current + step));
        else if (e.key === 'Enter' || e.key === ' ') toggleCurrent();
        else return;
        e.preventDefault();
      },
      { signal, capture: true },
    );

    // ---------- saving ----------
    ref('save').addEventListener('click', async () => {
      const pixelText = pixelInput.value.trim();
      const pixel = pixelText === '' ? null : Number(pixelText);
      if (pixel !== null && !(pixel > 0)) {
        toast('The pixel size should be a positive number of micrometres, or empty.', 'error');
        pixelInput.focus();
        return;
      }
      const phone = phoneInput.value.trim();
      saving = true;
      for (const b of host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) b.disabled = true;
      const status = ref('status');
      const frames = [...selected].sort((a, b) => a - b);
      let video: VideoRecord | null = existing;
      let added = 0;
      let same = 0;
      try {
        if (!video) {
          video = await library.addVideo({
            filename: file.name, sha256, phone, pixel_size_um: pixel, width, height, fps, frame_count: n, duration,
          });
        } else if (video.phone !== phone || video.pixel_size_um !== pixel) {
          await library.updateVideo(video.id, { phone, pixel_size_um: pixel });
        }
        for (const [k, i] of frames.entries()) {
          status.textContent = `Saving frame ${k + 1} of ${frames.length}…`;
          const png = await (await clip.frame(i)).convertToBlob({ type: 'image/png' });
          const prepared = await prepareFrame(png, frameFilename(phone || video.filename, i), {
            video_id: video.id, index: i, time: clip.timeOf(i),
          });
          if ((await library.addImage(prepared)) === 'duplicate') same++;
          else added++;
        }
        toast(`Saved ${added} frame${added === 1 ? '' : 's'} from ${phone || file.name}.`);
        if (same) toast(`${same} frame${same === 1 ? ' was' : 's were'} identical to a frame already saved and skipped.`);
        close(video);
      } catch (e) {
        toast(`Could not save the frames: ${(e as Error).message}`, 'error', 8000);
        if (video && added) close(video); // keep what was saved
        else {
          saving = false;
          for (const b of host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) b.disabled = false;
          refresh();
        }
      }
    });

    void showPreview();
    refresh();
  }

  return result;
}

function copyCanvas(from: HTMLCanvasElement, to: HTMLCanvasElement): void {
  to.width = from.width;
  to.height = from.height;
  to.getContext('2d')!.drawImage(from, 0, 0);
}

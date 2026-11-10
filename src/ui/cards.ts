// Library cards for images, video frames and videos. Markup only; the screens
// handle clicks through the data attributes (data-id, data-video, data-act).

import type { ImageStatus } from '../io/schema';
import { videoStatus, type ImageSummary, type VideoSummary } from '../storage/store';
import { formatTime } from '../video/frames';
import { icon } from './icons';

export const STATUS_LABEL: Record<ImageStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};
const STATUS_CLASS: Record<ImageStatus, string> = { not_started: '', in_progress: 'warn', done: 'ok' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const statusPill = (s: ImageStatus) => `<span class="pill ${STATUS_CLASS[s]}">${STATUS_LABEL[s]}</span>`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * An image or a video frame. Frames are titled by frame number and time and
 * have no share button (they are shared with their video).
 */
export function imageCard(i: ImageSummary, opts: { mine: boolean; canShare: boolean }): string {
  const frame = i.frame;
  const title = frame ? `Frame ${frame.index} · ${formatTime(frame.time)}` : i.filename;
  const shareBtn =
    opts.mine && opts.canShare && !frame
      ? `<button class="${i.shared ? 'on' : ''}" data-act="share" title="${
          i.shared ? 'Shared with everyone signed in. Click to make private.' : 'Private. Click to share with everyone signed in.'
        }">${icon('share')}</button>`
      : '';
  const deleteBtn = opts.mine
    ? `<button data-act="delete" title="Delete this ${frame ? 'frame' : 'image'} and its annotations">${icon('trash')}</button>`
    : '';
  const owner = !opts.mine
    ? `<span class="pill info plain">${icon('users')} ${escapeHtml(i.owner_name ?? 'Someone')}</span>`
    : i.shared && !frame
      ? `<span class="pill info plain">${icon('share')} Shared</span>`
      : '';
  return /* html */ `
    <article class="card" data-id="${i.id}" tabindex="0" title="Open ${escapeHtml(title)}">
      <div class="thumb" style="background-image: url('${i.thumbUrl}')"></div>
      <div class="actions">${shareBtn}${deleteBtn}</div>
      <div class="meta">
        <div class="title">${escapeHtml(title)}</div>
        <div class="row">
          ${statusPill(i.status)}
          <span>${plural(i.cellCount, 'cell')}</span>
          ${owner}
        </div>
      </div>
    </article>`;
}

/** A video: its first saved frame, phone, and how many frames are done. */
export function videoCard(v: VideoSummary, opts: { mine: boolean }): string {
  const name = v.phone || v.filename;
  const owner = !opts.mine
    ? `<span class="pill info plain">${icon('users')} ${escapeHtml(v.owner_name ?? 'Someone')}</span>`
    : v.shared
      ? `<span class="pill info plain">${icon('share')} Shared</span>`
      : '';
  return /* html */ `
    <article class="card video-card" data-video="${v.id}" tabindex="0" title="Open the frames of ${escapeHtml(name)}">
      <div class="thumb" style="background-image: url('${v.thumbUrl}')">
        <span class="film-badge">${icon('film')} Video</span>
      </div>
      <div class="meta">
        <div class="title">${escapeHtml(name)}</div>
        <div class="row">
          ${statusPill(videoStatus(v))}
          <span>${v.done} of ${plural(v.frames, 'frame')} done</span>
          ${owner}
        </div>
      </div>
    </article>`;
}

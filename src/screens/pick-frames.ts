// Opens the frame picker, loading it (and its video decoder) only when a video
// is added, so the library doesn't download it on every visit.

import type { openFramePicker } from './frame-picker';

export async function pickFrames(...args: Parameters<typeof openFramePicker>): ReturnType<typeof openFramePicker> {
  const picker = await import('./frame-picker');
  return picker.openFramePicker(...args);
}

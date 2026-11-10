// A video file opened for frame picking: reads the MP4/MOV container with
// mp4box and decodes frames exactly with the browser's VideoDecoder (WebCodecs).
// Frames are numbered in display order from 0, the same numbering OpenCV uses,
// so "frame 312" means the same picture everywhere.

import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';
import { sharpness, toGray } from './frames';

export interface ClipInfo {
  /** Size of the picture as shown (after the phone's rotation flag). */
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  /** Seconds. */
  duration: number;
  codec: string;
}

/** Longest side frames are scaled to for scoring and previews; keeps 4K originals fast. */
const SCORE_SIZE = 640;
const PREVIEW_QUALITY = 0.85;

export class VideoClip {
  /** Decode order index of each frame (frames in display order). */
  private readonly decodeIndexOfFrame: number[];
  /** Frame index of each decoded picture, by its timestamp in µs. */
  private readonly frameOfTimestamp = new Map<number, number>();
  /** Composition time of frame 0, in track units. */
  private readonly firstCts: number;
  /** Small JPEG of every frame, made while scanning, for instant previews. */
  private previews: Promise<Blob>[] = [];

  private constructor(
    readonly info: ClipInfo,
    private readonly config: VideoDecoderConfig,
    /** Samples in decode order. */
    private readonly samples: Sample[],
    private readonly timescale: number,
    /** Degrees clockwise the picture is shown rotated by. */
    private readonly rotation: 0 | 90 | 180 | 270,
  ) {
    const byDisplay = samples.map((s, i) => ({ cts: s.cts, i })).sort((a, b) => a.cts - b.cts);
    this.decodeIndexOfFrame = byDisplay.map((x) => x.i);
    byDisplay.forEach((x, frame) => this.frameOfTimestamp.set(this.timestamp(samples[x.i]), frame));
    this.firstCts = byDisplay[0]?.cts ?? 0;
  }

  static async open(file: Blob): Promise<VideoClip> {
    if (typeof VideoDecoder === 'undefined') {
      throw new Error('This browser cannot read video frames. Please use a recent Chrome, Edge or Safari.');
    }
    const { movie, mp4, samples } = demux(await file.arrayBuffer());
    const track = movie.videoTracks[0];
    if (!track?.video) throw new Error('This file has no video track.');
    if (samples.length === 0) throw new Error('This video has no frames.');
    if (samples.length < track.nb_samples) throw new Error('This video file seems to be incomplete.');

    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description: decoderDescription(mp4, track.id),
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      throw new Error(
        `This browser can't decode this video's format (${track.codec}). Try Chrome or Edge, or convert the video to an H.264 MP4.`,
      );
    }
    const rotation = rotationOf(track.matrix);
    const turned = rotation === 90 || rotation === 270;
    const duration = samples.reduce((t, s) => t + s.duration, 0) / track.timescale;
    const info: ClipInfo = {
      width: turned ? track.video.height : track.video.width,
      height: turned ? track.video.width : track.video.height,
      frameCount: samples.length,
      fps: duration > 0 ? samples.length / duration : 0,
      duration,
      codec: track.codec,
    };
    return new VideoClip(info, config, samples, track.timescale, rotation);
  }

  /** Seconds from the first frame to frame `index`. */
  timeOf(index: number): number {
    return (this.samples[this.decodeIndexOfFrame[index]].cts - this.firstCts) / this.timescale;
  }

  /**
   * Decode every frame once, score its sharpness and keep a small preview.
   * `onProgress(done, total)` is called as frames come out; aborting stops the
   * scan with an AbortError.
   */
  async scan(onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Float64Array> {
    const n = this.info.frameCount;
    const scores = new Float64Array(n);
    const k = Math.min(1, SCORE_SIZE / Math.max(this.info.width, this.info.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(this.info.width * k)), Math.max(1, Math.round(this.info.height * k)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let done = 0;
    await this.decode(this.samples, signal, (frame, index) => {
      this.draw(ctx, frame, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      scores[index] = sharpness(toGray(px, canvas.width, canvas.height), canvas.width, canvas.height);
      this.previews[index] = canvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY });
      if (++done % 10 === 0 || done === n) onProgress(done, n);
    });
    return scores;
  }

  /**
   * Frame `index` for looking at: the scan's small copy when there is one
   * (instant), otherwise the decoded frame. Use frame() for what gets saved.
   */
  async preview(index: number): Promise<CanvasImageSource & { width: number; height: number }> {
    const blob = this.previews[index];
    return blob ? createImageBitmap(await blob) : this.frame(index);
  }

  /** Frame `index` at full size, exactly as stored in the video. */
  async frame(index: number): Promise<OffscreenCanvas> {
    const pos = this.decodeIndexOfFrame[index];
    let start = pos;
    while (start > 0 && !this.samples[start].is_sync) start--;
    let end = pos + 1;
    while (end < this.samples.length && !this.samples[end].is_sync) end++;
    const canvas = new OffscreenCanvas(this.info.width, this.info.height);
    let found = false;
    const onFrame = (frame: VideoFrame, i: number) => {
      if (i !== index) return;
      this.draw(canvas.getContext('2d')!, frame, canvas.width, canvas.height);
      found = true;
    };
    // Keyframes can be hundreds of frames apart: stop feeding once it's out.
    await this.decode(this.samples.slice(start, end), undefined, onFrame, () => found);
    if (!found) throw new Error(`Could not decode frame ${index}.`);
    return canvas;
  }

  private timestamp(s: Sample): number {
    return Math.round((s.cts * 1e6) / this.timescale);
  }

  /**
   * Feed `samples` (decode order, starting at a keyframe) to a fresh decoder,
   * until they run out or `enough()` says the wanted frames have come out.
   */
  private async decode(
    samples: Sample[],
    signal: AbortSignal | undefined,
    onFrame: (frame: VideoFrame, index: number) => void,
    enough: () => boolean = () => false,
  ): Promise<void> {
    let failure: unknown = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const index = this.frameOfTimestamp.get(frame.timestamp);
          if (index !== undefined) onFrame(frame, index);
        } finally {
          frame.close();
        }
      },
      error: (e) => (failure = e),
    });
    try {
      decoder.configure(this.config);
      for (const s of samples) {
        signal?.throwIfAborted();
        if (failure || enough()) break;
        decoder.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: this.timestamp(s),
            duration: Math.round((s.duration * 1e6) / this.timescale),
            data: s.data!,
          }),
        );
        // Don't queue the whole video at once: let the decoder catch up. The
        // dequeue event is quickest; the timeout covers browsers without it.
        while (decoder.decodeQueueSize > 12 && !failure) {
          await new Promise((r) => {
            decoder.addEventListener('dequeue', r, { once: true });
            setTimeout(r, 20);
          });
        }
      }
      if (!failure) await decoder.flush();
    } finally {
      if (decoder.state !== 'closed') decoder.close();
    }
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    signal?.throwIfAborted();
  }

  /** Draw a decoded frame upright into a `w`×`h` canvas. */
  private draw(ctx: OffscreenCanvasRenderingContext2D, frame: VideoFrame, w: number, h: number): void {
    ctx.save();
    if (this.rotation === 90) ctx.setTransform(0, 1, -1, 0, w, 0);
    else if (this.rotation === 180) ctx.setTransform(-1, 0, 0, -1, w, h);
    else if (this.rotation === 270) ctx.setTransform(0, -1, 1, 0, 0, h);
    const turned = this.rotation === 90 || this.rotation === 270;
    ctx.drawImage(frame, 0, 0, turned ? h : w, turned ? w : h);
    ctx.restore();
  }
}

/**
 * Read the container and every sample of the first video track in one pass.
 * Samples must be requested from onReady, before mp4box processes (and may
 * release) the rest of the file.
 */
function demux(buffer: ArrayBuffer): { movie: Movie; mp4: ReturnType<typeof createFile>; samples: Sample[] } {
  const mp4 = createFile();
  let movie: Movie | null = null;
  let error: string | null = null;
  const samples: Sample[] = [];
  mp4.onError = (_module, message) => (error = message);
  mp4.onReady = (m) => {
    movie = m;
    const track = m.videoTracks[0];
    if (!track) return;
    mp4.onSamples = (_id, _user, batch) => samples.push(...batch);
    mp4.setExtractionOptions(track.id, undefined, { nbSamples: 500 });
    mp4.start();
  };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0));
  mp4.flush();
  if (!movie) throw new Error(error ? `Could not read this video: ${error}` : 'Could not read this video. Please use an MP4 or MOV file.');
  return { movie, mp4, samples };
}

/** The codec setup (avcC / hvcC / vpcC / av1C box body) VideoDecoder needs. */
function decoderDescription(mp4: ReturnType<typeof createFile>, trackId: number): Uint8Array | undefined {
  const trak = mp4.getTrackById(trackId) as unknown as {
    mdia: { minf: { stbl: { stsd: { entries: Record<string, { write(s: unknown): void } | undefined>[] } } } };
  };
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // skip the box header
    }
  }
  return undefined;
}

/** Rotation from the track's display matrix (16.16 fixed point a, b, …). */
function rotationOf(matrix: ArrayLike<number> | undefined): 0 | 90 | 180 | 270 {
  if (!matrix) return 0;
  const deg = (Math.round((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI / 90) * 90 + 360) % 360;
  return deg as 0 | 90 | 180 | 270;
}

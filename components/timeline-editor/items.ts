import { Trimmable } from '@designcombo/timeline';
import { getAudioData, getWaveformPortion } from '@remotion/media-utils';

type LoadedAudioData = Awaited<ReturnType<typeof getAudioData>>;

// The base Trimmable in @designcombo/timeline declares these fields but does
// NOT assign them from props — the default resize handler then crashes on
// `this.trim.to` during drag. Each subclass must copy the props through.
const assignTrimmableProps = (self: any, props: any) => {
  if (props.trim) self.trim = props.trim;
  if (props.display) self.display = props.display;
  if (props.duration != null) self.duration = props.duration;
  if (props.playbackRate != null) self.playbackRate = props.playbackRate;
  if (props.src) self.src = props.src;
  if (props.metadata) self.metadata = props.metadata;
};

// Draw the clip's human-readable name on the canvas. We read it from
// `metadata.displayName` — the timeline engine only spreads a narrow subset
// of the track item onto the instance (src, text, srcs, background…), but
// `metadata` *is* forwarded verbatim, so it's our only safe place to stash
// arbitrary labels without conflicting with internal fields.
const drawLabel = (obj: any, ctx: CanvasRenderingContext2D, fallback: string) => {
  const name = obj?.metadata?.displayName || fallback;
  ctx.save();
  ctx.translate(-obj.width / 2, -obj.height / 2);
  ctx.beginPath();
  ctx.rect(0, 0, obj.width, obj.height);
  ctx.clip();
  ctx.translate(10, 16);
  ctx.font = "600 11px 'Geist', sans-serif";
  ctx.fillStyle = '#f4f4f5';
  ctx.textAlign = 'left';
  ctx.fillText(name, 0, 0);
  ctx.restore();
};

export class Video extends Trimmable {
  static type = 'Video';
  constructor(props: any) {
    super(props);
    assignTrimmableProps(this, props);
  }
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'video');
    this.updateSelected(ctx);
  }
}

// Audio clips render a real amplitude waveform so artists can cut to the beat.
// Peaks come from @remotion/media-utils getAudioData (client-side decode,
// Remotion-cached), exactly as the upstream designcombo editor does. The bars
// are recomputed only when the clip's pixel width or trim changes (the cache
// key), so a normal render just blits the cached set.
export class Audio extends Trimmable {
  static type = 'Audio';
  private audioData: LoadedAudioData | null = null;
  private waveBars: { amplitude: number }[] = [];
  private waveKey = '';

  constructor(props: any) {
    super(props);
    assignTrimmableProps(this, props);
    this.loadWaveform();
  }

  private async loadWaveform() {
    const src = (this as any).src as string | undefined;
    if (!src) return;
    try {
      this.audioData = await getAudioData(src);
      this.waveKey = '';
      (this as any).canvas?.requestRenderAll();
    } catch {
      // Decode/CORS failure: fall back to the plain labelled clip.
      this.audioData = null;
    }
  }

  private computeBars(width: number) {
    if (!this.audioData) {
      this.waveBars = [];
      return;
    }
    const trim = (this as any).trim || {};
    const fromMs = Number(trim.from) || 0;
    const toMs = Number(trim.to ?? (this as any).duration ?? 0) || 0;
    const trimmedSec = Math.max(0, (toMs - fromMs) / 1000);
    const key = `${Math.round(width)}:${fromMs}:${toMs}`;
    if (key === this.waveKey && this.waveBars.length) return;
    this.waveKey = key;
    this.waveBars = getWaveformPortion({
      audioData: this.audioData,
      startTimeInSeconds: fromMs / 1000,
      durationInSeconds: trimmedSec || this.audioData.durationInSeconds,
      // ~1 bar / 4px, capped so a zoomed-in long clip stays cheap to draw.
      numberOfSamples: Math.min(2000, Math.max(1, Math.floor(width / 4))),
    });
  }

  private drawWaveform(ctx: CanvasRenderingContext2D) {
    if (!this.audioData) return;
    const width = (this as any).width as number;
    const height = (this as any).height as number;
    this.computeBars(width);
    const bars = this.waveBars;
    if (!bars.length) return;

    ctx.save();
    ctx.translate(-width / 2, -height / 2);
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    const barWidth = width / bars.length;
    const maxBarHeight = Math.max(2, height - 24); // leave the top row for the label
    const midY = height / 2 + 6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.beginPath();
    for (let i = 0; i < bars.length; i++) {
      const amplitude = bars[i]?.amplitude || 0;
      const barHeight = Math.max(1, amplitude * maxBarHeight);
      ctx.rect(i * barWidth, midY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    }
    ctx.fill();
    ctx.restore();
  }

  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    this.drawWaveform(ctx);
    drawLabel(this, ctx, 'audio');
    this.updateSelected(ctx);
  }
}

export class Image extends Trimmable {
  static type = 'Image';
  constructor(props: any) {
    super(props);
    assignTrimmableProps(this, props);
  }
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'image');
    this.updateSelected(ctx);
  }
}

export class Text extends Trimmable {
  static type = 'Text';
  public text?: string;
  constructor(props: any) {
    super(props);
    assignTrimmableProps(this, props);
    if (props.text) this.text = props.text;
  }
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, this.text || 'text');
    this.updateSelected(ctx);
  }
}

import { Trimmable } from '@designcombo/timeline';

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
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'video');
    this.updateSelected(ctx);
  }
}

export class Audio extends Trimmable {
  static type = 'Audio';
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'audio');
    this.updateSelected(ctx);
  }
}

export class Image extends Trimmable {
  static type = 'Image';
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'image');
    this.updateSelected(ctx);
  }
}

export class Text extends Trimmable {
  static type = 'Text';
  public text?: string;
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, this.text || 'text');
    this.updateSelected(ctx);
  }
}

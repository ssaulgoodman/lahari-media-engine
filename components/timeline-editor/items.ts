import { Trimmable } from '@designcombo/timeline';

const drawLabel = (obj: any, ctx: CanvasRenderingContext2D, label: string) => {
  ctx.save();
  ctx.translate(-obj.width / 2, -obj.height / 2);
  ctx.translate(8, 14);
  ctx.font = "600 12px 'Geist', sans-serif";
  ctx.fillStyle = '#f4f4f5';
  ctx.textAlign = 'left';
  ctx.fillText(label, 0, 0);
  ctx.restore();
};

export class Video extends Trimmable {
  static type = 'Video';
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'Video');
    this.updateSelected(ctx);
  }
}

export class Audio extends Trimmable {
  static type = 'Audio';
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'Audio');
    this.updateSelected(ctx);
  }
}

export class Image extends Trimmable {
  static type = 'Image';
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, 'Image');
    this.updateSelected(ctx);
  }
}

export class Text extends Trimmable {
  static type = 'Text';
  public text?: string;
  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    drawLabel(this, ctx, this.text || 'Text');
    this.updateSelected(ctx);
  }
}

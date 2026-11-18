// 扎结遮罩光栅化：把矢量扎结/夹板/缝缀图层栅格化为"进色率"纹理
import type { TieDocument, TieLayer } from '../types';

export interface RasterResult {
  canvas: HTMLCanvasElement;
  /** 留白占比 0..1（进色率低于 0.5 的像素比例） */
  reserveRatio: number;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function strokePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], size: number, close: boolean) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x * size, pts[0].y * size);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * size, pts[i].y * size);
  if (close) ctx.closePath();
}

/** 松紧度 -> 边缘羽化（px），越紧边界越锐利 */
function tightnessBlur(tightness: number): number {
  return 26 * (1 - tightness) + 2;
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: TieLayer, size: number) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; // 多层扎结效果叠加（进色率相乘）
  const blur = tightnessBlur(layer.tightness);
  // 扎死区灰度：越紧越白（在 multiply 下白色=不影响，黑色=扎死），用反相蒙版
  const layerMask = makeCanvas(size);
  const m = layerMask.getContext('2d')!;
  m.fillStyle = '#ffffff';
  m.fillRect(0, 0, size, size);
  m.filter = `blur(${blur.toFixed(1)}px)`;

  if (layer.kind === 'rubber') {
    // 橡皮筋：沿路径画粗线 + 扎点圆，lineWidth 与 radius、松紧相关
    m.strokeStyle = `rgba(0,0,0,${0.55 + layer.tightness * 0.4})`;
    m.lineCap = 'round';
    m.lineJoin = 'round';
    for (const p of layer.paths) {
      m.lineWidth = Math.max(4, p.radius * size * (0.7 + layer.tightness * 0.8));
      strokePath(m, p.points, size, p.closed);
      m.stroke();
      // 捆扎点：局部扎死圆
      for (const pt of p.points) {
        const r = p.radius * size * 0.55 * (0.6 + layer.tightness * 0.7);
        m.beginPath();
        m.arc(pt.x * size, pt.y * size, r, 0, Math.PI * 2);
        m.fillStyle = `rgba(0,0,0,${0.7 + layer.tightness * 0.3})`;
        m.fill();
      }
    }
  } else if (layer.kind === 'clamp') {
    // 夹板：多边形夹压区，pressure 越高越扎死
    for (const poly of layer.clamps) {
      const alpha = 0.45 + poly.pressure * 0.55;
      m.fillStyle = `rgba(0,0,0,${alpha})`;
      strokePath(m, poly.points, size, true);
      m.fill();
    }
    for (const p of layer.paths) {
      m.strokeStyle = `rgba(0,0,0,${0.4 + layer.tightness * 0.5})`;
      m.lineWidth = Math.max(6, p.radius * size);
      m.lineCap = 'round';
      strokePath(m, p.points, size, p.closed);
      m.stroke();
    }
  } else {
    // 缝缀抽褶：细路径 + 抽褶强度决定两侧扎死宽度
    const gather = layer.gather ?? 0.6;
    m.strokeStyle = `rgba(0,0,0,${0.35 + gather * 0.5})`;
    m.lineCap = 'round';
    for (const p of layer.paths) {
      m.lineWidth = Math.max(3, p.radius * size * (0.5 + gather));
      strokePath(m, p.points, size, p.closed);
      m.stroke();
    }
  }
  m.filter = 'none';
  ctx.drawImage(layerMask, 0, 0);
  ctx.restore();
}

export function rasterizeTie(tie: TieDocument, size: number): RasterResult {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // 进色率初值 1.0（白色）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (const layer of tie.layers) drawLayer(ctx, layer, size);

  const data = ctx.getImageData(0, 0, size, size).data;
  let blocked = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 128) blocked++;
  }
  return { canvas, reserveRatio: blocked / (size * size) };
}

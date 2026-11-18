// 蜡防光栅化：RGBA = r 进色率 / g 蜡层厚度 / b 脆度 / a 浮色积累(初始0)
import type { WaxDocument, WaxStroke } from '../types';

export function rasterizeWax(wax: WaxDocument, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // r=255 完全进色，g=b=a=0
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, size, size);

  for (const s of wax.strokes) drawStroke(ctx, s, size);
  // 蜡刀冰纹：裂纹处蜡膜断开 -> 进色率回升
  drawCracks(ctx, wax, size);
  return canvas;
}

function drawStroke(ctx: CanvasRenderingContext2D, s: WaxStroke, size: number) {
  // 蜂蜡多 -> 软而厚、韧；石蜡多 -> 薄脆
  const thickness = s.thickness;
  const brittleness = s.brittleness;
  // 封蜡强度（进色阻挡）：厚蜡近完全阻挡，薄蜡半透
  const block = Math.round(60 + thickness * 195); // r 通道越低挡得越死
  const g = Math.round(thickness * 255);
  const b = Math.round(brittleness * 255);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, s.width * size);
  ctx.strokeStyle = `rgba(${255 - block},${g},${b},0)`;
  // 用多层叠加模拟蜡层堆叠
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(s.points[0].x * size, s.points[0].y * size);
  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * size, s.points[i].y * size);
  ctx.stroke();
  // 薄蜡半透：再叠一层低厚度柔光，使边缘进色率处于中间值（毛边）
  ctx.globalAlpha = 0.25 * (1 - thickness);
  ctx.lineWidth *= 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawCracks(ctx: CanvasRenderingContext2D, wax: WaxDocument, size: number) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const c of wax.cracks) {
    ctx.beginPath();
    ctx.moveTo(c.points[0].x * size, c.points[0].y * size);
    for (let i = 1; i < c.points.length; i++) ctx.lineTo(c.points[i].x * size, c.points[i].y * size);
    // 裂纹：恢复进色（r 拉高），厚度清零
    ctx.strokeStyle = 'rgba(255,0,0,0.9)';
    ctx.lineWidth = Math.max(1, c.width * size);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 按脆度与密度自动生成冰纹（确定性伪随机，保证同一文档结果稳定）
 */
export function generateCracks(wax: WaxDocument, size: number): WaxDocument {
  if (wax.strokes.length === 0) return wax;
  const cracks = [];
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const total = wax.crackDensity * 4;
  const baseAng = wax.crackDirection ?? rand() * Math.PI * 2;
  for (let i = 0; i < total; i++) {
    // 落点优先落在蜡层范围内
    const stroke = wax.strokes[Math.floor(rand() * wax.strokes.length)];
    const anchor = stroke.points[Math.floor(rand() * stroke.points.length)];
    const x = anchor.x + (rand() - 0.5) * stroke.width * 2;
    const y = anchor.y + (rand() - 0.5) * stroke.width * 2;
    const ang = baseAng + (rand() - 0.5) * 1.2;
    const len = 0.02 + rand() * 0.06;
    const segs = 3 + Math.floor(rand() * 3);
    const points = [{ x, y }];
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const jitter = (rand() - 0.5) * 0.5;
      points.push({
        x: x + Math.cos(ang + jitter) * len * t,
        y: y + Math.sin(ang + jitter) * len * t,
      });
    }
    // 脆度越高裂纹越宽
    const brittleness = wax.strokes.reduce((a, s) => a + s.brittleness, 0) / wax.strokes.length;
    cracks.push({
      id: `crack_${i}_${Date.now()}`,
      points,
      width: 0.002 + brittleness * 0.005,
    });
  }
  return { ...wax, cracks, updatedAt: Date.now() };
}

// 画布编辑器共用：指针事件 -> 归一化坐标，工具切换
import type { Pt } from '../types';

export interface EditorCanvas {
  canvas: HTMLCanvasElement;
  getPoint: (e: PointerEvent) => Pt;
}

export function makeEditorCanvas(size = 560): EditorCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.aspectRatio = '1 / 1';
  const getPoint = (e: PointerEvent): Pt => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };
  return { canvas, getPoint };
}

export function fileInput(accept: string, onFile: (f: File) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = accept;
  el.style.display = 'none';
  el.addEventListener('change', () => {
    const f = el.files?.[0];
    if (f) onFile(f);
    el.value = '';
  });
  document.body.append(el);
  return el;
}

/** 简易矢量路径渲染（编辑器叠加层用） */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): void {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function hitTest(p: Pt, pts: Pt[], threshold = 0.03): number {
  for (let i = 0; i < pts.length; i++) {
    if (dist(p, pts[i]) < threshold) return i;
  }
  return -1;
}

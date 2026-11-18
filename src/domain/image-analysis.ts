// 布面照片织纹识别：Sobel 梯度估计每格主走向与疏密分布，生成纤维走向场
import type { OrientationField } from '../types';
import { loadImage } from '../util/math';

const GRID = 16;

export async function analyzeOrientation(photoDataUrl: string): Promise<OrientationField> {
  const img = await loadImage(photoDataUrl);
  const W = 256;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // 中心裁剪为正方形
  const side = Math.min(img.width, img.height);
  ctx.drawImage(
    img,
    (img.width - side) / 2,
    (img.height - side) / 2,
    side,
    side,
    0,
    0,
    W,
    H,
  );
  const { data } = ctx.getImageData(0, 0, W, H);
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  }

  const samples: number[][] = [];
  const cw = W / GRID;
  const ch = H / GRID;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      let sxx = 0, syy = 0, sxy = 0, edgeSum = 0;
      const x0 = Math.floor(gx * cw), x1 = Math.floor((gx + 1) * cw);
      const y0 = Math.floor(gy * ch), y1 = Math.floor((gy + 1) * ch);
      for (let y = y0 + 1; y < y1 - 1; y++) {
        for (let x = x0 + 1; x < x1 - 1; x++) {
          const i = y * W + x;
          const gxV = lum[i + 1] - lum[i - 1];
          const gyV = lum[i + W] - lum[i - W];
          const mag = gxV * gxV + gyV * gyV;
          // 结构张量：主特征向量方向即织纹走向
          sxx += gxV * gxV;
          syy += gyV * gyV;
          sxy += gxV * gyV;
          edgeSum += mag;
        }
      }
      // 主方向（结构张量最大特征向量）
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      // 纹理走向与梯度垂直
      const tx = Math.cos(angle + Math.PI / 2);
      const ty = Math.sin(angle + Math.PI / 2);
      // 疏密：边缘能量归一，能量越密纱线越密
      const area = (x1 - x0) * (y1 - y0);
      const density = Math.min(1, Math.sqrt(edgeSum / area) * 4);
      samples.push([tx, ty, density]);
    }
  }
  return { gridW: GRID, gridH: GRID, samples, source: 'photo', photoDataUrl };
}

/** 程序化走向场（无照片时的兜底） */
export function proceduralOrientation(): OrientationField {
  const samples: number[][] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const ang = Math.PI / 2 + 0.1 * Math.sin((x / GRID) * Math.PI * 2);
      samples.push([Math.cos(ang), Math.sin(ang), 0.55]);
    }
  }
  return { gridW: GRID, gridH: GRID, samples, source: 'procedural' };
}

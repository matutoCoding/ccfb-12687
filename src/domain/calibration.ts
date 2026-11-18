// 坯布标定：标准花稿仿真试条 + 与实拍试条的色差/晕边误差比对
import type { Fabric, StandardValidation, TieDocument } from '../types';
import { SimEngine } from '../gl/sim-engine';
import { seedRecipeSteps } from '../data/seed';
import { loadImage, deltaE, uid } from '../util/math';

/** 三幅标准花稿：散点 / 同心环 / 方格 */
export function standardPattern(patternId: StandardValidation['patternId']): TieDocument {
  const layers: TieDocument['layers'] = [];
  if (patternId === 'spots') {
    layers.push({
      id: uid('lyr'), name: '散点捆扎', kind: 'rubber', visible: true, tightness: 0.8, gather: 0,
      clamps: [],
      paths: [
        { id: uid('p'), closed: false, radius: 0.05, points: [{ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }] },
        { id: uid('p'), closed: false, radius: 0.05, points: [{ x: 0.65, y: 0.55 }, { x: 0.65, y: 0.55 }] },
        { id: uid('p'), closed: false, radius: 0.04, points: [{ x: 0.45, y: 0.75 }, { x: 0.45, y: 0.75 }] },
      ],
    });
  } else if (patternId === 'rings') {
    layers.push({
      id: uid('lyr'), name: '同心环夹板', kind: 'clamp', visible: true, tightness: 0.7, gather: 0,
      clamps: [
        { id: uid('c'), pressure: 0.8, points: circle(0.5, 0.5, 0.22, 24) },
        { id: uid('c'), pressure: 0.6, points: circle(0.5, 0.5, 0.12, 20) },
      ],
      paths: [],
    });
  } else {
    layers.push({
      id: uid('lyr'), name: '方格缝缀', kind: 'stitch', visible: true, tightness: 0.75, gather: 0.8,
      clamps: [],
      paths: [
        { id: uid('p'), closed: false, radius: 0.02, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }] },
        { id: uid('p'), closed: false, radius: 0.02, points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] },
        { id: uid('p'), closed: false, radius: 0.02, points: [{ x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }] },
        { id: uid('p'), closed: false, radius: 0.02, points: [{ x: 0.35, y: 0.15 }, { x: 0.35, y: 0.85 }] },
        { id: uid('p'), closed: false, radius: 0.02, points: [{ x: 0.65, y: 0.15 }, { x: 0.65, y: 0.85 }] },
      ],
    });
  }
  return { layers, reserveRatio: 0, updatedAt: Date.now() };
}

function circle(cx: number, cy: number, r: number, n: number) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** 跑一条标准花稿仿真试条（独立临时引擎，不影响项目） */
export async function runStandardStrip(
  fabric: Fabric,
  patternId: StandardValidation['patternId'],
): Promise<string> {
  const canvas = document.createElement('canvas');
  const engine = new SimEngine(canvas);
  try {
    const out = await engine.run({
      fabric,
      tie: standardPattern(patternId),
      wax: { strokes: [], cracks: [], crackDensity: 0, crackDirection: null, updatedAt: Date.now() },
      recipe: {
        id: 'calib', name: '标定配方', locked: false, origin: 'seed',
        steps: seedRecipeSteps(), createdAt: Date.now(),
      },
      dyeColorOf: () => [0.05, 0.11, 0.22],
    });
    return out.result.finalDataUrl;
  } finally {
    engine.dispose();
  }
}

const DELTA_E_LIMIT = 6;      // 平均 ΔE 门禁
const BLEED_LIMIT_MM = 1.5;   // 晕边宽度误差门禁（mm）

/** 仿真试条与实拍试条比对 */
export async function compareStrips(
  simDataUrl: string,
  realDataUrl: string,
  fabric: Fabric,
): Promise<{ deltaE: number; bleedErrorMm: number; passed: boolean }> {
  const N = 96;
  const sim = await toPixels(simDataUrl, N);
  const real = await toPixels(realDataUrl, N);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < sim.data.length; i += 4) {
    // 实拍照片做亮度归一，抵消拍摄光线差异
    sum += deltaE(
      [sim.data[i] / 255, sim.data[i + 1] / 255, sim.data[i + 2] / 255],
      [real.data[i] / 255, real.data[i + 1] / 255, real.data[i + 2] / 255],
    );
    count++;
  }
  const meanDeltaE = sum / count;

  // 晕边宽度：统计高梯度像素，折算毫米（96px 对应布面 20cm 试条）
  const mmPerPx = 200 / N;
  const bleedPx =
    (avgGradient(sim.data, N) - avgGradient(real.data, N)) * N * 0.25;
  const bleedErrorMm = Math.abs(bleedPx) * mmPerPx;

  return {
    deltaE: round2(meanDeltaE),
    bleedErrorMm: round2(bleedErrorMm),
    passed: meanDeltaE <= DELTA_E_LIMIT && bleedErrorMm <= BLEED_LIMIT_MM,
  };
}

async function toPixels(src: string, n: number): Promise<ImageData> {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, n, n);
  return ctx.getImageData(0, 0, n, n);
}

function avgGradient(data: Uint8ClampedArray, n: number): number {
  let g = 0;
  let cnt = 0;
  const lum = (i: number) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = (y * n + x) * 4;
      g += Math.abs(lum(i + 4) - lum(i - 4)) + Math.abs(lum(i + n * 4) - lum(i - n * 4));
      cnt++;
    }
  }
  return g / cnt;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/** 三幅标准花稿全部通过才允许入库 */
export function gateCheck(fabric: Fabric): boolean {
  const v = fabric.calibration.validations;
  return v.length === 3 && v.every((x) => x.passed);
}

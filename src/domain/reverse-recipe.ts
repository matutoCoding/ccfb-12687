// 来样反推：照片取色 -> 从染料库反推靛蓝浓度与浸染道数，产出候选配方
import type { Dye, Recipe, RecipeStep } from '../types';
import { hexToRgb01, loadImage, srgbToLinear, uid, clamp } from '../util/math';

export interface SampleColor {
  rgb: [number, number, number];
  /** 采样点标签 */
  label: string;
}

/** 从照片提取主色（九宫格中心加权平均 + 中位亮度） */
export async function extractSampleColors(dataUrl: string): Promise<SampleColor[]> {
  const img = await loadImage(dataUrl);
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);
  const zones = [
    { label: '整体主色', fn: () => true },
    { label: '深色区', fn: (l: number) => l < 0.35 },
    { label: '浅色区', fn: (l: number) => l > 0.6 },
  ];
  return zones.map((z) => {
    let r = 0, g = 0, b = 0, cnt = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      if (!z.fn(lum)) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; cnt++;
    }
    return {
      label: z.label,
      rgb: [r / cnt / 255 || 0, g / cnt / 255 || 0, b / cnt / 255 || 0] as [number, number, number],
    };
  });
}

export interface CandidateRecipe {
  recipe: Recipe;
  /** 预测发色与样品的色差 ΔE（越小越匹配） */
  predictedDeltaE: number;
  dips: number;
  concentration: number;
}

/**
 * 反推模型：目标深度 D = -ln(目标反射率/坯布反射率)，
 * 单道吸色量近似 k*conc，道数 n 与浓度 c 满足 D ∝ n * sqrt(c)（经验式）
 */
export function reverseEngineer(
  targetRgb: [number, number, number],
  dye: Dye,
  sampleDataUrl: string,
): CandidateRecipe[] {
  const cloth: [number, number, number] = [0.93, 0.9, 0.82];
  const tLin = targetRgb.map(srgbToLinear);
  const cLin = cloth.map(srgbToLinear);
  const dyeLin = dye.rgb.map(srgbToLinear);
  // 目标等效吸收深度
  const depth =
    -(Math.log(Math.max(tLin[0], 0.02) / cLin[0]) * dyeLin[0] +
      Math.log(Math.max(tLin[1], 0.02) / cLin[1]) * dyeLin[1] +
      Math.log(Math.max(tLin[2], 0.02) / cLin[2]) * dyeLin[2]) / 3 / 0.8;

  const candidates: CandidateRecipe[] = [];
  // 给出 2/3/4 道浸染三个候选，浓度按经验式反解
  for (const dips of [2, 3, 4]) {
    const concentration = clamp(Math.pow(depth / (0.18 * dips), 2), 2, 24);
    const recipe = buildRecipe(dye.id, dips, Math.round(concentration * 10) / 10);
    // 预测色差：用相同指数模型回算
    const k = (0.18 * dips * Math.sqrt(concentration)) / Math.max(dips, 1);
    const pred = cLin.map((c, i) => c * Math.exp(-dyeLin[i] * k * 2.4 * dips / 3));
    const de = simpleDeltaE(pred, tLin);
    candidates.push({
      recipe: { ...recipe, name: `${dye.name} ${dips}道反推配方`, sourceSampleDataUrl: sampleDataUrl },
      predictedDeltaE: Math.round(de * 10) / 10,
      dips,
      concentration,
    });
  }
  return candidates.sort((a, b) => a.predictedDeltaE - b.predictedDeltaE);
}

function buildRecipe(dyeId: string, dips: number, concentration: number): Recipe {
  const steps: RecipeStep[] = Array.from({ length: dips }, (_, i) => ({
    id: uid('step'),
    type: 'dip' as const,
    concentration: Math.round(concentration * (1 + i * 0.15) * 10) / 10,
    oxidizeMinutes: 15,
    liquorRatio: 20,
    dipMinutes: 10,
    dyeId,
    note: `反推第 ${i + 1} 道`,
  }));
  // 三道以上插入一道媒染
  if (dips >= 3) {
    steps.splice(1, 0, {
      id: uid('step'),
      type: 'mordant',
      concentration: 0,
      oxidizeMinutes: 10,
      liquorRatio: 15,
      dipMinutes: 8,
      dyeId: null,
      mordantName: '明矾',
      note: '媒染固色',
    });
  }
  return {
    id: uid('rec'),
    name: '反推候选',
    steps,
    locked: false,
    origin: 'reverse',
    createdAt: Date.now(),
  };
}

function simpleDeltaE(a: number[], b: number[]): number {
  // 线性 RGB 上的欧氏距离近似 ΔE
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2 * 120, 0));
}

export function lockAsBaseline(recipe: Recipe): Recipe {
  return { ...recipe, locked: true, lockedAt: Date.now() };
}

export function rgbToHex(rgb: [number, number, number]): string {
  const h = rgb.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
  return `#${h}`;
}

export { hexToRgb01 };

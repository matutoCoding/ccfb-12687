// 初始种子数据：染料库、示例坯布、示例花稿与标准多道靛蓝配方
import type { Dye, Fabric, Recipe, RecipeStep, TieDocument, WaxDocument } from '../types';
import { uid } from '../util/math';

export const SEED_DYES: Dye[] = [
  { id: 'dye_indigo', name: '靛蓝（菘蓝）', color: '#1f3a5f', family: 'indigo', rgb: [0.05, 0.11, 0.22] },
  { id: 'dye_tea', name: '茶棕（红茶）', color: '#7a4a2b', family: 'tea', rgb: [0.36, 0.22, 0.12] },
  { id: 'dye_shuliang', name: '薯莨', color: '#5c2417', family: 'shuliang', rgb: [0.28, 0.09, 0.06] },
  { id: 'dye_iron', name: '铁媒灰', color: '#3c3f41', family: 'iron', rgb: [0.18, 0.19, 0.2] },
];

export function emptyTie(): TieDocument {
  return { layers: [], reserveRatio: 0, updatedAt: Date.now() };
}

export function emptyWax(): WaxDocument {
  return { strokes: [], cracks: [], crackDensity: 6, crackDirection: null, updatedAt: Date.now() };
}

export function seedRecipeSteps(): RecipeStep[] {
  const mk = (i: number): RecipeStep => ({
    id: uid('step'),
    type: 'dip',
    concentration: 8 + i * 2,
    oxidizeMinutes: 15,
    liquorRatio: 20,
    dipMinutes: 10,
    dyeId: 'dye_indigo',
    note: `第 ${i + 1} 道浸染`,
  });
  return [mk(0), mk(1), mk(2)];
}

export function seedRecipe(): Recipe {
  return {
    id: uid('rec'),
    name: '三道靛蓝基准配方',
    steps: seedRecipeSteps(),
    locked: false,
    origin: 'seed',
    createdAt: Date.now(),
  };
}

/** 生成一台演示用坯布（未标定，引导用户走标定流程） */
export function seedFabric(): Fabric {
  const gridW = 16;
  const gridH = 16;
  const samples: number[][] = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      // 程序化走向场：经向为主，带轻微正弦扰动
      const ang = (Math.PI / 2) + 0.12 * Math.sin((x / gridW) * Math.PI * 2);
      samples.push([Math.cos(ang), Math.sin(ang), 0.55 + 0.08 * Math.sin((y / gridH) * Math.PI)]);
    }
  }
  return {
    id: uid('fab'),
    name: '纯棉平纹坯布 40×40',
    warpDensity: 40,
    weftDensity: 40,
    weight: 120,
    fibers: [{ name: '棉', ratio: 1 }],
    widthCm: 140,
    orientation: { gridW, gridH, samples, source: 'procedural' },
    calibration: {
      uptakeRate: 0.32,
      capillaryCoeff: 0.22,
      status: 'uncalibrated',
      validations: [],
      updatedAt: Date.now(),
    },
    approved: false,
    createdAt: Date.now(),
    notes: '种子示例布，需完成三幅标准花稿标定后方可入库',
  };
}

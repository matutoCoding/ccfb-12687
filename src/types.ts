// 全局领域模型：坯布 / 扎结 / 蜡防 / 染程 / 项目 / 排产 / 批注

export type ID = string;

export interface FiberComponent {
  /** 纤维名称，如 棉 / 苎麻 / 丝 */
  name: string;
  /** 质量占比 0..1，所有组分之和为 1 */
  ratio: number;
}

/** 纤维走向场（网格采样，单位向量分量编码为 0..255） */
export interface OrientationField {
  gridW: number;
  gridH: number;
  /** 长度 = gridW*gridH，每项 [dx, dy, 疏密 0..1] */
  samples: number[][];
  source: 'manual' | 'photo' | 'procedural';
  photoDataUrl?: string;
}

export interface Calibration {
  /** 吸色速率 k（无量纲，每道浸染的一阶吸收系数） */
  uptakeRate: number;
  /** 毛细扩散系数（像素²/道，仿真内部再按分辨率折算） */
  capillaryCoeff: number;
  /** 标定状态 */
  status: 'uncalibrated' | 'pending' | 'passed' | 'failed';
  /** 三幅标准花稿的验证记录 */
  validations: StandardValidation[];
  updatedAt: number;
}

export interface StandardValidation {
  patternId: 'spots' | 'rings' | 'grid';
  simStripDataUrl: string;
  realStripDataUrl?: string;
  /** 平均色差 ΔE（CIE76 近似） */
  deltaE: number;
  /** 晕边宽度误差（毫米） */
  bleedErrorMm: number;
  passed: boolean;
  checkedAt: number;
}

export interface Fabric {
  id: ID;
  name: string;
  /** 经密（根/英寸） */
  warpDensity: number;
  /** 纬密（根/英寸） */
  weftDensity: number;
  /** 平方米克重 g/m² */
  weight: number;
  fibers: FiberComponent[];
  widthCm: number;
  orientation: OrientationField;
  calibration: Calibration;
  /** 标定门禁：三幅标准花稿全部通过才允许入库报价 */
  approved: boolean;
  createdAt: number;
  notes?: string;
}

// ---------------- 扎结 ----------------

export type TieKind = 'rubber' | 'clamp' | 'stitch';

export interface TieLayer {
  id: ID;
  name: string;
  kind: TieKind;
  visible: boolean;
  /** 松紧度 0..1，影响留白范围与边缘硬度 */
  tightness: number;
  /** 矢量路径（画布归一化坐标 0..1） */
  paths: VecPath[];
  /** 夹板轮廓 / 夹压区域（多边形） */
  clamps: Polygon[];
  /** 缝缀抽褶路径单独的抽褶强度 0..1 */
  gather?: number;
}

export interface VecPath {
  id: ID;
  points: Pt[];
  /** 橡皮筋捆扎半径（归一化） */
  radius: number;
  closed: boolean;
}

export interface Polygon {
  id: ID;
  points: Pt[];
  /** 夹压强度 0..1 */
  pressure: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface TieDocument {
  layers: TieLayer[];
  /** 自动计算出的留白统计（占布面百分比） */
  reserveRatio: number;
  updatedAt: number;
}

// ---------------- 蜡防 ----------------

export interface WaxStroke {
  id: ID;
  points: Pt[];
  /** 笔刷宽度（归一化） */
  width: number;
  /** 蜂蜡占比 0..1，其余为石蜡 */
  beeswaxRatio: number;
  /** 蜡层厚度 0..1（由配比与绘制速度推导，可手改） */
  thickness: number;
  /** 脆度 0..1（石蜡越高越脆，冰纹越多） */
  brittleness: number;
}

export interface WaxCrack {
  id: ID;
  /** 折线（归一化坐标） */
  points: Pt[];
  width: number;
}

export interface WaxDocument {
  strokes: WaxStroke[];
  cracks: WaxCrack[];
  /** 裂纹密度（条/100px，自动生成时使用） */
  crackDensity: number;
  /** 用户指定的裂纹走向（弧度），null 为随机 */
  crackDirection: number | null;
  updatedAt: number;
}

// ---------------- 染程 ----------------

export type StepType = 'dip' | 'oxidize' | 'mordant';

export interface Dye {
  id: ID;
  name: string;
  color: string;
  /** 染料类型 */
  family: 'indigo' | 'tea' | 'shuliang' | 'iron' | 'custom';
  /** 标准浓度下的 sRGB 发色（归一化 0..1） */
  rgb: [number, number, number];
}

export interface RecipeStep {
  id: ID;
  type: StepType;
  /** 浸染：靛蓝/染液浓度 g/L */
  concentration: number;
  /** 氧化时长（分钟），浸染与氧化步骤均记录 */
  oxidizeMinutes: number;
  /** 浴比 1:liquorRatio */
  liquorRatio: number;
  /** 浸染分钟数 */
  dipMinutes: number;
  /** 选用染液（mordant 步骤可为 null） */
  dyeId: ID | null;
  /** 媒染剂名称 */
  mordantName?: string;
  note?: string;
}

export interface Recipe {
  id: ID;
  name: string;
  steps: RecipeStep[];
  locked: boolean;
  lockedAt?: number;
  /** 来源：手工 / 来样反推候选 */
  origin: 'manual' | 'reverse' | 'seed';
  sourceSampleDataUrl?: string;
  createdAt: number;
}

// ---------------- 项目 / 仿真 ----------------

export interface DesignProject {
  id: ID;
  name: string;
  fabricId: ID;
  tie: TieDocument;
  wax: WaxDocument;
  recipeId: ID;
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'shared' | 'locked' | 'change-order';
  /** 锁定后变更单 */
  changeOrders: ChangeOrder[];
}

export interface ChangeOrder {
  id: ID;
  createdAt: number;
  author: string;
  summary: string;
  before: string;
  after: string;
}

export interface Defect {
  id: ID;
  kind: '色花' | '色档' | '阴阳面';
  /** 归一化中心点 */
  x: number;
  y: number;
  /** 影响半径（归一化） */
  radius: number;
  severity: number; // 0..1
  /** 反查到的工序索引（Recipe.steps） */
  stepIndex: number;
  /** 诱因参数说明 */
  cause: string;
  /** 调参建议 */
  suggestion: string;
}

export interface SimResult {
  projectId: ID;
  /** 各道浸染后的结果纹理（dataURL），用于增量与对照 */
  stepTextures: string[];
  finalDataUrl: string;
  defects: Defect[];
  /** 每道工序的耗时（ms） */
  timings: number[];
  simulatedAt: number;
  /** 参与仿真的配方快照哈希，变化即失效 */
  recipeHash: string;
}

// ---------------- 排产 ----------------

export interface OrderItem {
  id: ID;
  projectId: ID;
  customer: string;
  /** 色系标签，用于拼缸 */
  colorTag: string;
  meters: number;
  dueDate: string; // yyyy-mm-dd
  priority: number; // 越大越急
  status: 'planned' | 'vatted' | 'done';
}

export interface Vat {
  id: ID;
  name: string;
  /** 当前染液浓度 g/L */
  concentration: number;
  /** 初始浓度，用于衰减提醒 */
  initialConcentration: number;
  colorTag: string;
  /** 已染批次 */
  batches: number;
}

export interface VatSlot {
  id: ID;
  vatId: ID;
  date: string;
  startHour: number;
  hours: number;
  orderIds: ID[];
  /** 换缸风险（前后色系冲突） */
  conflictRisk: boolean;
  conflictReason?: string;
  /** 补料提醒 */
  replenish?: string;
}

export interface ProductionPlan {
  vats: Vat[];
  slots: VatSlot[];
  updatedAt: number;
}

// ---------------- 分享 / 批注 ----------------

export interface ShareToken {
  token: string;
  projectId: ID;
  createdAt: number;
  /** 只读快照 dataURL */
  snapshotDataUrl: string;
}

export interface Annotation {
  id: ID;
  token: string;
  x: number;
  y: number;
  text: string;
  resolved: boolean;
  createdAt: number;
  author: string;
}

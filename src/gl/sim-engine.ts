// WebGL2 扎染/蜡染渗化仿真引擎
// 状态纹理 r=累计固着吸色 g=游离染液 b=本道固着量 a=预留
import type { Defect, Fabric, Recipe, RecipeStep, SimResult, TieDocument, WaxDocument } from '../types';
import { clamp, hashString, hexToRgb01 } from '../util/math';
import {
  createGl,
  drawQuad,
  makeFbo,
  makeProgram,
  makeQuadVao,
  makeTexture,
  uploadCanvasTexture,
  type GLProgram,
} from './gl-helpers';
import { COMPOSITE_FS, DIFFUSE_FS, FIXATE_FS, METRIC_FS, UPTAKE_FS, VERT } from './shaders';
import { rasterizeTie } from './raster-tie';
import { rasterizeWax } from './raster-wax';

export const SIM_SIZE = 512;
const MASK_SIZE = 512;
const METRIC_SIZE = 64;

interface PingPong {
  a: WebGLTexture;
  b: WebGLTexture;
  fboA: WebGLFramebuffer;
  fboB: WebGLFramebuffer;
}

export interface SimInput {
  fabric: Fabric;
  tie: TieDocument;
  wax: WaxDocument;
  recipe: Recipe;
  dyeColorOf: (dyeId: string | null) => [number, number, number];
  /** 增量重算起点；不传则整缸从头跑 */
  fromStep?: number;
  onProgress?: (pct: number, label: string) => void;
}

export interface SimOutput {
  result: Omit<SimResult, 'projectId'>;
  canvas: HTMLCanvasElement;
  reserveRatio: number;
}

export class SimEngine {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private programs: Record<string, GLProgram>;
  private state!: PingPong;
  private metricTex: WebGLTexture;
  private metricFbo: WebGLFramebuffer;
  /** 每道浸染后的吸色量快照（64²，用于疵点归因与增量复用判定） */
  private stepSnapshots: Float32Array[] = [];
  private stepHashes: string[] = [];

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SIM_SIZE;
    canvas.height = SIM_SIZE;
    this.gl = createGl(canvas);
    const gl = this.gl;
    this.vao = makeQuadVao(gl);
    this.programs = {
      uptake: makeProgram(gl, VERT, UPTAKE_FS),
      diffuse: makeProgram(gl, VERT, DIFFUSE_FS),
      fixate: makeProgram(gl, VERT, FIXATE_FS),
      composite: makeProgram(gl, VERT, COMPOSITE_FS),
      metric: makeProgram(gl, VERT, METRIC_FS),
    };
    this.state = this.makePingPong();
    this.metricTex = makeTexture(gl, METRIC_SIZE, METRIC_SIZE, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.metricFbo = makeFbo(gl, this.metricTex);
  }

  private makePingPong(): PingPong {
    const gl = this.gl;
    const opts = [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST] as const;
    const a = makeTexture(gl, SIM_SIZE, SIM_SIZE, ...opts);
    const b = makeTexture(gl, SIM_SIZE, SIM_SIZE, ...opts);
    return { a, b, fboA: makeFbo(gl, a), fboB: makeFbo(gl, b) };
  }

  private use(name: string): GLProgram {
    const p = this.programs[name];
    this.gl.useProgram(p.program);
    return p;
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private swap() {
    const s = this.state;
    this.state = { a: s.b, b: s.a, fboA: s.fboB, fboB: s.fboA };
  }

  private target(fbo: WebGLFramebuffer) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
  }

  private clearState() {
    const gl = this.gl;
    this.target(this.state.fboA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private buildOrientationTexture(fabric: Fabric): WebGLTexture {
    const gl = this.gl;
    const { gridW, gridH, samples } = fabric.orientation;
    const data = new Uint8Array(gridW * gridH * 4);
    samples.forEach((s, i) => {
      data[i * 4] = Math.round(clamp(s[0] * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round(clamp(s[1] * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round(clamp(s[2]) * 255);
      data[i * 4 + 3] = 255;
    });
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private snapshotState(): Float32Array {
    const gl = this.gl;
    this.target(this.metricFbo);
    gl.viewport(0, 0, METRIC_SIZE, METRIC_SIZE);
    const p = this.use('metric');
    this.bindTex(0, this.state.a, p.uniforms.u_state);
    gl.uniform2f(p.uniforms.u_texel, 1 / SIM_SIZE, 1 / SIM_SIZE);
    drawQuad(gl, this.vao);
    const buf = new Float32Array(METRIC_SIZE * METRIC_SIZE * 4);
    gl.readPixels(0, 0, METRIC_SIZE, METRIC_SIZE, gl.RGBA, gl.FLOAT, buf);
    this.target(this.state.fboA);
    gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
    return buf;
  }

  async run(input: SimInput): Promise<SimOutput> {
    const { fabric, tie, wax, recipe, dyeColorOf } = input;
    const gl = this.gl;
    const t0 = performance.now();
    const timings: number[] = [];

    // 1. 遮罩与走向纹理
    const tieRaster = rasterizeTie(tie, MASK_SIZE);
    const waxCanvas = rasterizeWax(wax, MASK_SIZE);
    const tieTex = uploadCanvasTexture(gl, tieRaster.canvas);
    const waxTex = uploadCanvasTexture(gl, waxCanvas);
    const orientTex = this.buildOrientationTexture(fabric);

    // 2. 增量判定：找到第一个配方哈希变化的浸染工序
    const dipSteps = recipe.steps.map((s, i) => ({ s, i })).filter((x) => x.s.type === 'dip');
    const hashes = recipe.steps.map((s, i) =>
      hashString(JSON.stringify({ ...s, fabric: fabric.calibration.capillaryCoeff, idx: i })),
    );
    let startDip = 0;
    if (input.fromStep !== undefined) startDip = input.fromStep;
    else {
      for (let k = 0; k < dipSteps.length; k++) {
        if (this.stepHashes[k] !== hashes[dipSteps[k].i]) {
          startDip = k;
          break;
        }
        startDip = k + 1;
      }
    }

    if (startDip === 0 || this.stepSnapshots.length === 0) {
      this.clearState();
      this.stepSnapshots = [];
      this.stepHashes = [];
      startDip = 0;
    } else {
      // 从上一道缓存快照恢复状态（简化：重放吸色量到 r 通道）
      this.restoreSnapshot(this.stepSnapshots[startDip - 1]);
    }

    // 3. 逐道浸染
    const stepTextures: string[] = [];
    const cap = fabric.calibration.capillaryCoeff * 0.9;
    for (let k = startDip; k < dipSteps.length; k++) {
      const { s: step, i: stepIndex } = dipSteps[k];
      const label = `第 ${k + 1}/${dipSteps.length} 道浸染`;
      input.onProgress?.((k / dipSteps.length) * 90, label);
      const ts = performance.now();

      // 3.1 吸色
      let p = this.use('uptake');
      this.bindTex(0, this.state.a, p.uniforms.u_state);
      this.bindTex(1, tieTex, p.uniforms.u_tie);
      this.bindTex(2, waxTex, p.uniforms.u_wax);
      const concNorm = clamp(step.concentration / 20);
      gl.uniform1f(p.uniforms.u_uptake, fabric.calibration.uptakeRate * (0.4 + concNorm * 1.6));
      gl.uniform1f(p.uniforms.u_dipTime, clamp(step.dipMinutes / 20));
      gl.uniform1f(p.uniforms.u_liquor, step.liquorRatio);
      this.target(this.state.fboB);
      drawQuad(gl, this.vao);
      this.swap();

      // 3.2 毛细扩散（多次迭代，模拟浸染期间渗化）
      p = this.use('diffuse');
      const iters = 6;
      for (let it = 0; it < iters; it++) {
        this.bindTex(0, this.state.a, p.uniforms.u_state);
        this.bindTex(1, orientTex, p.uniforms.u_orient);
        gl.uniform1f(p.uniforms.u_cap, cap);
        gl.uniform2f(p.uniforms.u_texel, 1 / SIM_SIZE, 1 / SIM_SIZE);
        this.target(this.state.fboB);
        drawQuad(gl, this.vao);
        this.swap();
      }

      // 3.3 氧化固着
      p = this.use('fixate');
      this.bindTex(0, this.state.a, p.uniforms.u_state);
      this.bindTex(1, tieTex, p.uniforms.u_tie);
      gl.uniform1f(p.uniforms.u_oxidize, clamp(step.oxidizeMinutes / 30));
      this.target(this.state.fboB);
      drawQuad(gl, this.vao);
      this.swap();

      // 3.4 媒染步骤对后道的影响：固着增益在相邻 mordant 步骤上体现
      const next = recipe.steps[stepIndex + 1];
      if (next && next.type === 'mordant') {
        p = this.use('fixate');
        this.bindTex(0, this.state.a, p.uniforms.u_state);
        this.bindTex(1, tieTex, p.uniforms.u_tie);
        gl.uniform1f(p.uniforms.u_oxidize, 0.25); // 媒染促染
        this.target(this.state.fboB);
        drawQuad(gl, this.vao);
        this.swap();
      }

      this.stepSnapshots[k] = this.snapshotState();
      this.stepHashes[k] = hashes[stepIndex];
      stepTextures[k] = this.compositeToDataUrl(step, dyeColorOf, waxTex, orientTex, dipSteps.length, true);
      timings[k] = performance.now() - ts;
      await new Promise((r) => setTimeout(r, 0)); // 让出主线程，避免卡顿
    }

    // 4. 最终合成（退蜡前/后两张）
    const lastDip = dipSteps[dipSteps.length - 1]?.s;
    const finalDataUrl = this.compositeToDataUrl(
      lastDip,
      dyeColorOf,
      waxTex,
      orientTex,
      dipSteps.length,
      false,
    );

    // 5. 疵点扫描与归因
    input.onProgress?.(95, '疵点扫描');
    const metric = this.stepSnapshots[this.stepSnapshots.length - 1] ?? this.snapshotState();
    const defects = this.detectDefects(metric, recipe, dipSteps.map((d) => d.i));

    // 6. 资源回收
    gl.deleteTexture(tieTex);
    gl.deleteTexture(waxTex);
    gl.deleteTexture(orientTex);

    return {
      result: {
        stepTextures: stepTextures.filter(Boolean),
        finalDataUrl,
        defects,
        timings: timings.filter((x) => x !== undefined),
        simulatedAt: Date.now(),
        recipeHash: hashString(JSON.stringify(recipe.steps)),
      },
      canvas: gl.canvas as HTMLCanvasElement,
      reserveRatio: tieRaster.reserveRatio,
    };
  }

  private restoreSnapshot(snap: Float32Array) {
    // 用 metric 快照重建全尺寸状态：最近邻放大由 GPU 线性过滤完成
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      METRIC_SIZE,
      METRIC_SIZE,
      0,
      gl.RGBA,
      gl.FLOAT,
      snap,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = makeFbo(gl, tex);
    this.target(fbo);
    // 直接把小图 blit 到全尺寸状态纹理
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.state.fboA);
    gl.blitFramebuffer(0, 0, METRIC_SIZE, METRIC_SIZE, 0, 0, SIM_SIZE, SIM_SIZE, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.state.fboA);
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
  }

  private compositeToDataUrl(
    step: RecipeStep | undefined,
    dyeColorOf: (id: string | null) => [number, number, number],
    waxTex: WebGLTexture,
    orientTex: WebGLTexture,
    totalDips: number,
    waxOn: boolean,
  ): string {
    const gl = this.gl;
    const p = this.use('composite');
    this.bindTex(0, this.state.a, p.uniforms.u_state);
    this.bindTex(1, waxTex, p.uniforms.u_wax);
    this.bindTex(2, orientTex, p.uniforms.u_orient);
    // 染液 sRGB 本色直接作为减法混色目标
    const rgb = dyeColorOf(step?.dyeId ?? null);
    gl.uniform3fv(p.uniforms.u_dyeRgb, rgb);
    gl.uniform3f(p.uniforms.u_clothRgb, 0.94, 0.91, 0.84); // 本白坯布（sRGB 0..1）
    gl.uniform1f(p.uniforms.u_waxOn, waxOn ? 1 : 0);
    gl.uniform1f(p.uniforms.u_totalDips, totalDips);
    gl.uniform1f(p.uniforms.u_bleedSigma, 1);
    this.target(this.state.fboB);
    drawQuad(gl, this.vao);
    // 拷回默认 framebuffer 供 toDataURL
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.state.fboB);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, SIM_SIZE, SIM_SIZE, 0, 0, SIM_SIZE, SIM_SIZE, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.state.fboA);
    return (gl.canvas as HTMLCanvasElement).toDataURL('image/png');
  }

  /** 疵点检测：色花（高频不均匀）、色档（横向条带）、阴阳面（左右不对称） */
  private detectDefects(metric: Float32Array, recipe: Recipe, dipStepIdx: number[]): Defect[] {
    const defects: Defect[] = [];
    const n = METRIC_SIZE;
    const at = (x: number, y: number, ch: number) => metric[(y * n + x) * 4 + ch];

    // 分块统计，块大小 8x8 -> 8x8 个区域
    const blocks = 8;
    const bs = n / blocks;
    const flower: number[][] = [];
    const band: number[] = new Array(blocks).fill(0);
    for (let by = 0; by < blocks; by++) {
      flower[by] = [];
      for (let bx = 0; bx < blocks; bx++) {
        let gSum = 0;
        let cnt = 0;
        for (let y = by * bs; y < (by + 1) * bs; y++) {
          for (let x = bx * bs; x < (bx + 1) * bs; x++) {
            gSum += at(x, y, 1);
            cnt++;
          }
        }
        const v = gSum / cnt;
        flower[by][bx] = v;
        band[by] += v;
      }
      band[by] /= blocks;
    }

    // 色花：局部梯度过高的块（阈值按实测均匀区 ~0.01、扎结边缘 ~0.2 标定）
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        if (flower[by][bx] > 0.006) {
          const stepIndex = this.attributeStep(metric, bx, by, bs, dipStepIdx);
          const step = recipe.steps[stepIndex];
          defects.push({
            id: `def_flower_${bx}_${by}`,
            kind: '色花',
            x: (bx + 0.5) / blocks,
            y: (by + 0.5) / blocks,
            radius: 0.09,
            severity: clamp((flower[by][bx] - 0.005) / 0.012),
            stepIndex,
            cause: `第 ${stepIndex + 1} 道（${step?.type === 'dip' ? '浸染' : '媒染'}）吸色不均，浓度 ${step?.concentration ?? '-'} g/L`,
            suggestion: '降低该道浓度 10–15% 或延长氧化时间，保证染液循环均匀后再下缸',
          });
        }
      }
    }

    // 色档：相邻水平条带均值突变
    for (let by = 1; by < blocks; by++) {
      const d = Math.abs(band[by] - band[by - 1]);
      if (d > 0.0015) {
        const stepIndex = dipStepIdx[Math.min(dipStepIdx.length - 1, by % dipStepIdx.length)];
        defects.push({
          id: `def_band_${by}`,
          kind: '色档',
          x: 0.5,
          y: by / blocks,
          radius: 0.16,
          severity: clamp(d / 0.004),
          stepIndex,
          cause: `布面横向出现接档，通常为第 ${stepIndex + 1} 道浸染停留时间过长或浴比 ${recipe.steps[stepIndex]?.liquorRatio} 偏小`,
          suggestion: '缩短浸染分钟数、加大浴比并避免布面堆叠，入缸时保持匀速摆动',
        });
      }
    }

    // 阴阳面：左右半幅不对称
    let asymSum = 0;
    let asymMax = { x: 0.5, y: 0.5, v: 0 };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n / 2; x++) {
        const v = at(x, y, 3);
        asymSum += v;
        if (v > asymMax.v) asymMax = { x: x / n, y: y / n, v };
      }
    }
    const asymMean = asymSum / (n * n * 0.5);
    if (asymMean > 0.001) {
      const stepIndex = dipStepIdx[0];
      defects.push({
        id: 'def_yinyang',
        kind: '阴阳面',
        x: asymMax.x,
        y: asymMax.y,
        radius: 0.22,
        severity: clamp((asymMean - 0.0008) / 0.002),
        stepIndex,
        cause: `左右半幅吸色差异显著，首道浸染（浓度 ${recipe.steps[stepIndex]?.concentration} g/L）布面带液不均`,
        suggestion: '入缸前充分浸透拧匀，翻面次数加倍；检查扎结松紧是否左右对称',
      });
    }

    return defects.sort((a, b) => b.severity - a.severity).slice(0, 12);
  }

  /** 归因：比较各道快照在该块的吸色增量，贡献最大的道即责任工序 */
  private attributeStep(metric: Float32Array, bx: number, by: number, bs: number, dipStepIdx: number[]): number {
    let best = 0;
    let bestDelta = -1;
    let prev = 0;
    for (let k = 0; k < this.stepSnapshots.length; k++) {
      const snap = this.stepSnapshots[k];
      let sum = 0;
      for (let y = by * bs; y < (by + 1) * bs; y += 2) {
        for (let x = bx * bs; x < (bx + 1) * bs; x += 2) {
          sum += snap[(y * METRIC_SIZE + x) * 4];
        }
      }
      const delta = sum - prev;
      if (delta > bestDelta) {
        bestDelta = delta;
        best = k;
      }
      prev = sum;
    }
    return dipStepIdx[Math.min(best, dipStepIdx.length - 1)] ?? 0;
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

export function dyeRgb(hex: string): [number, number, number] {
  return hexToRgb01(hex);
}

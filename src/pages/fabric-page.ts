// 坯布库页：建档 / 照片织纹识别 / 吸色与毛细标定 / 三幅标准花稿试条门禁
import { h, mount, clear, label, numInput, toast, rangeInput } from '../ui/dom';
import { fileInput, makeEditorCanvas } from '../ui/canvas-editor';
import { store } from '../state/store';
import type { Fabric, FiberComponent, StandardValidation } from '../types';
import { uid, readFileAsDataUrl } from '../util/math';
import { analyzeOrientation, proceduralOrientation } from '../domain/image-analysis';
import { compareStrips, gateCheck, runStandardStrip } from '../domain/calibration';

const PATTERNS: StandardValidation['patternId'][] = ['spots', 'rings', 'grid'];
const PATTERN_NAMES: Record<StandardValidation['patternId'], string> = {
  spots: '散点捆扎',
  rings: '同心环夹板',
  grid: '方格缝缀',
};

export function renderFabricPage(root: HTMLElement): void {
  const fabrics = store.state.fabrics;
  const current = store.currentFabric() ?? fabrics[0];
  if (current) store.state.currentFabricId = current.id;

  const listPanel = h('div', { class: 'panel' },
    h('div', { class: 'page-head' },
      h('h3', {}, '坯布档案'),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'primary small',
        onclick: () => createFabric(),
      }, '＋ 新建坯布'),
    ),
    h('div', { class: 'card-grid', id: 'fab-cards' }, ...fabrics.map((f) => fabricCard(f, current?.id))),
  );

  const detail = h('div', { id: 'fab-detail' });
  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '坯布库'),
      h('span', { class: 'muted small-text' }, '每种坯布须通过三幅标准花稿标定门禁，才允许用于客户报价'),
    ),
    h('div', { class: 'layout-2' }, listPanel, detail),
  ));
  if (current) renderDetail(current);
}

function fabricCard(f: Fabric, selectedId?: string) {
  const badge = f.approved
    ? h('span', { class: 'badge ok' }, '已入库 · 可报价')
    : h('span', { class: 'badge warn' }, `标定 ${f.calibration.validations.length}/3`);
  return h('div', {
    class: `card ${f.id === selectedId ? 'selected' : ''}`,
    onclick: () => {
      store.state.currentFabricId = f.id;
      renderFabricPage(document.getElementById('view')!);
    },
  },
    h('div', { class: 'title' }, f.name),
    badge,
    h('div', { class: 'meta' },
      `经密 ${f.warpDensity} × 纬密 ${f.weftDensity} 根/英寸`,
      h('br'),
      `克重 ${f.weight} g/m² · 幅宽 ${f.widthCm} cm`,
      h('br'),
      `纤维：${f.fibers.map((x) => `${x.name} ${Math.round(x.ratio * 100)}%`).join(' / ')}`,
    ),
  );
}

function createFabric() {
  const f: Fabric = {
    id: uid('fab'),
    name: `新坯布 ${store.state.fabrics.length + 1}`,
    warpDensity: 40,
    weftDensity: 40,
    weight: 120,
    fibers: [{ name: '棉', ratio: 1 }],
    widthCm: 140,
    orientation: proceduralOrientation(),
    calibration: {
      uptakeRate: 0.3,
      capillaryCoeff: 0.2,
      status: 'uncalibrated',
      validations: [],
      updatedAt: Date.now(),
    },
    approved: false,
    createdAt: Date.now(),
  };
  store.saveFabric(f);
  store.state.currentFabricId = f.id;
  renderFabricPage(document.getElementById('view')!);
}

function renderDetail(f: Fabric) {
  const host = document.getElementById('fab-detail')!;
  const photoPick = fileInput('image/*', async (file) => {
    toast('正在识别织纹走向与疏密分布…');
    const dataUrl = await readFileAsDataUrl(file);
    f.orientation = await analyzeOrientation(dataUrl);
    await store.saveFabric(f);
    toast('纤维走向场已生成', 'ok');
    renderDetail(f);
  });

  const realPickers = PATTERNS.map((pid) =>
    fileInput('image/*', async (file) => uploadRealStrip(f, pid, file)),
  );

  const fiberEditor = h('div', {},
    ...f.fibers.map((fiber, idx) =>
      h('div', { class: 'row' },
        label('纤维', h('input', {
          value: fiber.name,
          oninput: (e: Event) => { fiber.name = (e.target as HTMLInputElement).value; },
        })),
        label('占比 %', numInput(Math.round(fiber.ratio * 100), 5, (v) => {
          fiber.ratio = v / 100;
          normalizeFibers(f.fibers, idx);
        })),
        h('button', {
          class: 'small danger',
          onclick: () => {
            if (f.fibers.length > 1) {
              f.fibers.splice(idx, 1);
              normalizeFibers(f.fibers, -1);
              store.saveFabric(f);
              renderDetail(f);
            }
          },
        }, '删'),
      ),
    ),
    h('button', {
      class: 'small',
      onclick: () => {
        f.fibers.push({ name: '麻', ratio: 0 });
        normalizeFibers(f.fibers, -1);
        store.saveFabric(f);
        renderDetail(f);
      },
    }, '＋ 添加纤维组分'),
  );

  mount(host, h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
    // 1. 基础档案
    h('div', { class: 'panel' },
      h('h3', {}, '基础档案'),
      label('坯布名称', h('input', { value: f.name, oninput: (e: Event) => { f.name = (e.target as HTMLInputElement).value; } })),
      h('div', { class: 'row' },
        label('经密（根/英寸）', numInput(f.warpDensity, 1, (v) => (f.warpDensity = v))),
        label('纬密（根/英寸）', numInput(f.weftDensity, 1, (v) => (f.weftDensity = v))),
      ),
      h('div', { class: 'row' },
        label('克重 g/m²', numInput(f.weight, 1, (v) => (f.weight = v))),
        label('幅宽 cm', numInput(f.widthCm, 1, (v) => (f.widthCm = v))),
      ),
      h('h3', { style: 'margin-top:14px' }, '纤维配比'),
      fiberEditor,
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'primary', onclick: () => { store.saveFabric(f); toast('档案已保存', 'ok'); } }, '保存档案'),
      ),
    ),

    // 2. 织纹识别与走向场
    h('div', { class: 'panel' },
      h('h3', {}, '织纹识别与纤维走向场'),
      h('div', { class: 'two-col' },
        orientationPreview(f),
        h('div', {},
          h('p', { class: 'muted small-text' },
          '对着布面拍照上传，系统用结构张量分析每格纱线主走向（箭头）与疏密分布（底色深浅），生成 16×16 纤维走向场，仿真时驱动各向异性毛细扩散。'),
          h('div', { class: 'toolbar' },
            h('button', { onclick: () => photoPick.click() }, '📷 上传布面照片识别'),
            h('button', {
              onclick: () => { f.orientation = proceduralOrientation(); store.saveFabric(f); renderDetail(f); },
            }, '生成程序化走向场'),
          ),
          f.orientation.photoDataUrl
            ? h('figure', { style: 'margin-top:10px' },
                h('img', { src: f.orientation.photoDataUrl, style: 'max-width:100%;border-radius:8px' }),
                h('figcaption', {}, '识别源照片'),
              )
            : null,
        ),
      ),
    ),

    // 3. 吸色/毛细标定
    h('div', { class: 'panel' },
      h('h3', {}, '吸色速率与毛细扩散系数标定'),
      h('div', { class: 'row' },
        label(`吸色速率 k = ${f.calibration.uptakeRate.toFixed(2)}`,
          rangeInput(f.calibration.uptakeRate, 0.05, 0.9, 0.01, (v) => {
            f.calibration.uptakeRate = v;
            f.calibration.updatedAt = Date.now();
          })),
        label(`毛细扩散系数 D = ${f.calibration.capillaryCoeff.toFixed(2)}`,
          rangeInput(f.calibration.capillaryCoeff, 0.02, 0.8, 0.01, (v) => {
            f.calibration.capillaryCoeff = v;
            f.calibration.updatedAt = Date.now();
          })),
      ),
      h('div', { class: 'toolbar' },
        h('button', { class: 'primary', onclick: () => { store.saveFabric(f); toast('标定参数已保存', 'ok'); } }, '保存标定'),
      ),
    ),

    // 4. 标准花稿试条门禁
    h('div', { class: 'panel' },
      h('h3', {}, '标准花稿渗化试条与入库门禁'),
      h('p', { class: 'muted small-text' },
        '门禁：平均色差 ΔE ≤ 6 且晕边宽度误差 ≤ 1.5 mm，三幅标准花稿全部通过才允许入库报价。'),
      h('div', { class: 'card-grid' },
        ...PATTERNS.map((pid, i) => validationCard(f, pid, realPickers[i])),
      ),
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        h('button', {
          class: f.approved ? 'ok' : 'primary',
          disabled: f.approved,
          onclick: () => finalizeGate(f),
        }, f.approved ? '✓ 已通过入库门禁' : '执行入库门禁判定'),
      ),
    ),
  ));
}

function normalizeFibers(fibers: FiberComponent[], keep: number) {
  const sum = fibers.reduce((a, x) => a + x.ratio, 0) || 1;
  fibers.forEach((x, i) => {
    if (i === keep) x.ratio = Math.max(0, x.ratio + (1 - sum));
  });
  const s2 = fibers.reduce((a, x) => a + x.ratio, 0);
  if (Math.abs(s2 - 1) > 0.001) fibers[0].ratio += 1 - s2;
}

function orientationPreview(f: Fabric) {
  const { canvas } = makeEditorCanvas(300);
  const ctx = canvas.getContext('2d')!;
  const { gridW, gridH, samples } = f.orientation;
  const cw = canvas.width / gridW;
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const [dx, dy, dens] = samples[gy * gridW + gx];
      const shade = Math.round(40 + dens * 90);
      ctx.fillStyle = `rgb(${shade},${shade + 8},${shade + 18})`;
      ctx.fillRect(gx * cw, gy * cw, cw, cw);
      const cx = gx * cw + cw / 2;
      const cy = gy * cw + cw / 2;
      ctx.strokeStyle = '#8fc2ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - dx * cw * 0.42, cy - dy * cw * 0.42);
      ctx.lineTo(cx + dx * cw * 0.42, cy + dy * cw * 0.42);
      ctx.stroke();
    }
  }
  return h('div', { class: 'canvas-wrap' }, canvas);
}

function validationCard(f: Fabric, pid: StandardValidation['patternId'], picker: HTMLInputElement) {
  const existing = f.calibration.validations.find((v) => v.patternId === pid);
  return h('div', { class: 'card', style: 'cursor:default' },
    h('div', { class: 'title' }, PATTERN_NAMES[pid]),
    existing
      ? h('div', {},
          h('div', { class: 'side-by-side' },
            h('figure', {}, h('img', { src: existing.simStripDataUrl }), h('figcaption', {}, '仿真试条')),
            h('figure', {},
              existing.realStripDataUrl ? h('img', { src: existing.realStripDataUrl }) : h('div', { class: 'muted' }, '未上传实拍'),
              h('figcaption', {}, '染坊实拍'),
            ),
          ),
          h('p', { class: `small-text ${existing.passed ? '' : 'muted'}` },
            `ΔE ${existing.deltaE} · 晕边误差 ${existing.bleedErrorMm} mm`,
            existing.passed ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, '合格')
              : h('span', { class: 'badge bad', style: 'margin-left:6px' }, '超标'),
          ),
        )
      : h('p', { class: 'muted small-text' }, '尚未运行仿真试条'),
    h('div', { class: 'toolbar' },
      h('button', {
        class: 'small',
        onclick: async () => {
          toast(`${PATTERN_NAMES[pid]} 仿真试条计算中…`);
          const dataUrl = await runStandardStrip(f, pid);
          upsertValidation(f, {
            patternId: pid,
            simStripDataUrl: dataUrl,
            deltaE: existing?.deltaE ?? 0,
            bleedErrorMm: existing?.bleedErrorMm ?? 0,
            passed: false,
            checkedAt: Date.now(),
          });
          toast('仿真试条已生成，请上传实拍试条比对', 'ok');
          renderDetail(f);
        },
      }, '跑仿真试条'),
      h('button', { class: 'small', onclick: () => picker.click() }, '上传实拍比对'),
    ),
  );
}

async function uploadRealStrip(f: Fabric, pid: StandardValidation['patternId'], file: File) {
  const real = await readFileAsDataUrl(file);
  const existing = f.calibration.validations.find((v) => v.patternId === pid);
  if (!existing?.simStripDataUrl) {
    toast('请先跑仿真试条，再上传实拍', 'warn');
    return;
  }
  const metrics = await compareStrips(existing.simStripDataUrl, real, f);
  upsertValidation(f, { ...existing, realStripDataUrl: real, ...metrics, checkedAt: Date.now() });
  f.calibration.status = metrics.passed ? 'passed' : 'failed';
  await store.saveFabric(f);
  toast(metrics.passed ? '该花稿标定合格' : `超标：ΔE ${metrics.deltaE} / 晕边 ${metrics.bleedErrorMm}mm`, metrics.passed ? 'ok' : 'warn');
  renderDetail(f);
}

function upsertValidation(f: Fabric, v: StandardValidation) {
  const arr = f.calibration.validations.filter((x) => x.patternId !== v.patternId);
  arr.push(v);
  f.calibration.validations = arr;
  store.saveFabric(f);
}

function finalizeGate(f: Fabric) {
  if (f.calibration.validations.length < 3) {
    toast('三幅标准花稿试条尚未全部完成', 'warn');
    return;
  }
  const ok = gateCheck(f);
  f.approved = ok;
  f.calibration.status = ok ? 'passed' : 'failed';
  store.saveFabric(f);
  if (ok) toast('门禁通过，坯布已入库，可用于客户报价', 'ok');
  else toast('门禁未通过：色差或晕边误差超标，禁止用于报价', 'bad');
  renderDetail(f);
}

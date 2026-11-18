// 蜡防编辑页：蜡刀笔刷封蜡、蜂蜡/石蜡配比驱动厚度脆度、裂纹走向密度、实时蜡层预览
import { h, mount, toast, rangeInput, label } from '../ui/dom';
import { makeEditorCanvas, drawOverlay } from '../ui/canvas-editor';
import { store } from '../state/store';
import type { DesignProject, Pt, WaxStroke } from '../types';
import { uid } from '../util/math';
import { rasterizeWax, generateCracks } from '../gl/raster-wax';

export function renderWaxPage(root: HTMLElement): void {
  const project = store.currentProject();
  if (!project) {
    mount(root, h('div', { class: 'panel' }, '请先创建花稿项目'));
    return;
  }
  const wax = project.wax;
  const editor = makeEditorCanvas(560);
  const preview = document.createElement('canvas');
  preview.width = 320;
  preview.height = 320;

  // 笔刷参数
  let beeswaxRatio = 0.6;
  let width = 0.025;
  let drawing: WaxStroke | null = null;

  /** 蜂蜡多 -> 厚而韧；石蜡多 -> 薄而脆 */
  function thicknessFromRatio() {
    return 0.35 + beeswaxRatio * 0.6;
  }
  function brittlenessFromRatio() {
    return 0.15 + (1 - beeswaxRatio) * 0.8;
  }

  function refreshPreview() {
    const raster = rasterizeWax(wax, 320);
    preview.getContext('2d')!.drawImage(raster, 0, 0);
  }

  function redrawOverlay() {
    drawOverlay(editor.canvas, (ctx, size) => {
      for (const s of wax.strokes) {
        ctx.strokeStyle = `rgba(240,220,160,${0.5 + s.thickness * 0.4})`;
        ctx.lineWidth = Math.max(2, s.width * size);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(s.points[0].x * size, s.points[0].y * size);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x * size, s.points[i].y * size);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ff9d92';
      ctx.lineWidth = 1.5;
      for (const c of wax.cracks) {
        ctx.beginPath();
        ctx.moveTo(c.points[0].x * size, c.points[0].y * size);
        for (let i = 1; i < c.points.length; i++) ctx.lineTo(c.points[i].x * size, c.points[i].y * size);
        ctx.stroke();
      }
    });
    refreshPreview();
  }

  editor.canvas.addEventListener('pointerdown', (e) => {
    editor.canvas.setPointerCapture(e.pointerId);
    const p = editor.getPoint(e);
    drawing = {
      id: uid('wax'),
      points: [p],
      width,
      beeswaxRatio,
      thickness: thicknessFromRatio(),
      brittleness: brittlenessFromRatio(),
    };
    wax.strokes.push(drawing);
  });
  editor.canvas.addEventListener('pointermove', (e) => {
    if (!drawing || e.buttons !== 1) return;
    const p = editor.getPoint(e);
    const last = drawing.points[drawing.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.006) {
      drawing.points.push(p);
      redrawOverlay();
    }
  });
  editor.canvas.addEventListener('pointerup', () => {
    if (drawing) {
      drawing = null;
      void store.saveProject(project);
    }
  });

  const crackDirLabel = h('span', { class: 'small-text muted' },
    wax.crackDirection === null ? '随机走向' : `${Math.round((wax.crackDirection * 180) / Math.PI)}°`);
  const thicknessHint = h('p', { id: 'wax-hint', class: 'small-text muted' },
    `推导蜡层厚度 ${thicknessFromRatio().toFixed(2)} · 脆度 ${brittlenessFromRatio().toFixed(2)}`);

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '蜡防编辑'),
      h('span', { class: 'muted small-text' }, '蜂蜡韧而厚、边界锐；石蜡脆而易裂、薄蜡半透毛边。裂纹在浸染时导液形成冰纹'),
    ),
    h('div', { class: 'layout-3' },
      // 左：参数
      h('div', { class: 'panel' },
        h('h3', {}, '蜡刀与蜡料参数'),
        label(`笔刷宽度 ${(width * 100).toFixed(1)}% 布幅`, rangeInput(width, 0.005, 0.08, 0.001, (v) => (width = v))),
        label(`蜂蜡占比 ${Math.round(beeswaxRatio * 100)}%（其余石蜡）`,
          rangeInput(beeswaxRatio, 0, 1, 0.01, (v) => {
            beeswaxRatio = v;
            thicknessHint.textContent = `推导蜡层厚度 ${thicknessFromRatio().toFixed(2)} · 脆度 ${brittlenessFromRatio().toFixed(2)}`;
          })),
        thicknessHint,
        h('h3', { style: 'margin-top:16px' }, '冰纹（蜡裂）控制'),
        label(`裂纹密度 ${wax.crackDensity} 组`, rangeInput(wax.crackDensity, 0, 20, 1, (v) => (wax.crackDensity = v))),
        h('div', { class: 'row' },
          h('button', {
            class: 'small',
            onclick: () => {
              wax.crackDirection = null;
              crackDirLabel.textContent = '随机走向';
            },
          }, '随机走向'),
          h('button', {
            class: 'small',
            onclick: () => {
              wax.crackDirection = Math.PI / 2;
              crackDirLabel.textContent = '90°（经向）';
            },
          }, '经向'),
          h('button', {
            class: 'small',
            onclick: () => {
              wax.crackDirection = 0;
              crackDirLabel.textContent = '0°（纬向）';
            },
          }, '纬向'),
          crackDirLabel,
        ),
        h('div', { class: 'toolbar', style: 'margin-top:10px' },
          h('button', {
            class: 'primary small',
            onclick: () => {
              if (wax.strokes.length === 0) {
                toast('请先绘制封蜡线条', 'warn');
                return;
              }
              const next = generateCracks(wax, 560);
              project.wax = next;
              void store.saveProject(project);
              toast(`已生成 ${next.cracks.length} 条冰纹`, 'ok');
              renderWaxPage(root);
            },
          }, '按脆度自动生成冰纹'),
          h('button', {
            class: 'small',
            onclick: () => {
              wax.cracks = [];
              void store.saveProject(project);
              redrawOverlay();
            },
          }, '清除裂纹'),
        ),
        h('div', { class: 'toolbar', style: 'margin-top:8px' },
          h('button', {
            class: 'small danger',
            onclick: () => {
              wax.strokes = [];
              wax.cracks = [];
              void store.saveProject(project);
              redrawOverlay();
            },
          }, '清空全部封蜡'),
          h('button', {
            class: 'small',
            onclick: () => { void store.saveProject(project); toast('蜡防图纸已本地保存', 'ok'); },
          }, '保存图纸'),
        ),
      ),
      // 中：编辑画布
      h('div', { class: 'panel' },
        h('h3', {}, '布面封蜡绘制'),
        h('div', { class: 'canvas-wrap' }, editor.canvas),
        h('p', { class: 'muted small-text', style: 'margin-top:6px' },
          `已绘 ${wax.strokes.length} 笔 · 冰纹 ${wax.cracks.length} 条`),
      ),
      // 右：蜡层纹理
      h('div', { class: 'panel' },
        h('h3', {}, '蜡层纹理（R 进色 / G 厚度 / B 脆度）'),
        h('div', { class: 'canvas-wrap' }, preview),
        h('p', { class: 'muted small-text', style: 'margin-top:8px' },
          '仿真时封蜡区阻挡染液；薄蜡半透渗化出毛边，裂纹处染液渗入形成冰纹。退蜡前后效果在成品页一键切换。'),
      ),
    ),
  ));
  redrawOverlay();
}

// 扎结设计页：橡皮筋捆扎 / 夹板夹花 / 缝缀抽褶，分层管理 + 留白范围自动计算
import { h, mount, toast, rangeInput, label, confirmDialog } from '../ui/dom';
import { makeEditorCanvas, drawOverlay, type EditorCanvas } from '../ui/canvas-editor';
import { store } from '../state/store';
import type { DesignProject, Pt, TieKind, TieLayer, VecPath, Polygon } from '../types';
import { uid } from '../util/math';
import { rasterizeTie } from '../gl/raster-tie';

const KIND_LABEL: Record<TieKind, string> = { rubber: '橡皮筋捆扎', clamp: '夹板夹花', stitch: '缝缀抽褶' };

export function renderTiePage(root: HTMLElement): void {
  const maybeProject = store.currentProject();
  if (!maybeProject) {
    mount(root, h('div', { class: 'panel' }, '请先在坯布库创建坯布与花稿'));
    return;
  }
  const project: DesignProject = maybeProject;
  const editor = makeEditorCanvas(560);
  let activeLayerId = project.tie.layers[0]?.id ?? '';
  let draft: Pt[] = [];
  let mode: 'path' | 'clamp' | 'inspect' = 'path' as 'path' | 'clamp' | 'inspect';

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = 320;
  maskCanvas.height = 320;
  const maskWrap = h('div', { class: 'canvas-wrap' }, maskCanvas);
  const reserveLabel = h('span', { class: 'badge info' }, '留白 0%');

  function activeLayer(): TieLayer | undefined {
    return project.tie.layers.find((l) => l.id === activeLayerId);
  }

  function refreshMask() {
    const { canvas, reserveRatio } = rasterizeTie(project.tie, 320);
    const ctx = maskCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 320, 320);
    ctx.drawImage(canvas, 0, 0);
    project.tie.reserveRatio = reserveRatio;
    reserveLabel.textContent = `留白 ${(reserveRatio * 100).toFixed(1)}%`;
  }

  function redraw() {
    drawOverlay(editor.canvas, (ctx, size) => {
      // 已保存图层
      for (const layer of project.tie.layers) {
        if (!layer.visible) continue;
        const isActive = layer.id === activeLayerId;
        ctx.strokeStyle = isActive ? '#6ea8fe' : 'rgba(110,168,254,0.45)';
        ctx.fillStyle = isActive ? 'rgba(110,168,254,0.18)' : 'rgba(110,168,254,0.08)';
        ctx.lineWidth = 2;
        for (const p of layer.paths) {
          drawPoints(ctx, p.points, size, p.closed);
          ctx.lineWidth = Math.max(2, p.radius * size);
          ctx.stroke();
          for (const pt of p.points) {
            ctx.beginPath();
            ctx.arc(pt.x * size, pt.y * size, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#9cc4ff';
            ctx.fill();
          }
          ctx.lineWidth = 2;
        }
        for (const c of layer.clamps) {
          drawPoints(ctx, c.points, size, true);
          ctx.fillStyle = `rgba(232,168,74,${0.12 + c.pressure * 0.25})`;
          ctx.fill();
          ctx.strokeStyle = '#e8a84a';
          ctx.stroke();
        }
      }
      // 草稿
      if (draft.length) {
        ctx.strokeStyle = '#7ee0b0';
        drawPoints(ctx, draft, size, false);
        ctx.stroke();
        for (const pt of draft) {
          ctx.beginPath();
          ctx.arc(pt.x * size, pt.y * size, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#7ee0b0';
          ctx.fill();
        }
      }
    });
    refreshMask();
  }

  editor.canvas.addEventListener('pointerdown', (e) => {
    const layer = activeLayer();
    if (!layer || mode === 'inspect') return;
    editor.canvas.setPointerCapture(e.pointerId);
    draft.push(editor.getPoint(e));
    redraw();
  });
  editor.canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1 || draft.length === 0) return;
    const p = editor.getPoint(e);
    const last = draft[draft.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.012) {
      draft.push(p);
      redraw();
    }
  });
  editor.canvas.addEventListener('pointerup', commitDraft);

  function commitDraft() {
    const layer = activeLayer();
    if (!layer || draft.length === 0) return;
    if (mode === 'clamp' && layer.kind === 'clamp') {
      const poly: Polygon = { id: uid('poly'), points: draft, pressure: 1 - layer.tightness * 0.3 };
      layer.clamps.push(poly);
    } else {
      const path: VecPath = {
        id: uid('path'),
        points: draft,
        radius: layer.kind === 'stitch' ? 0.02 : 0.045,
        closed: false,
      };
      layer.paths.push(path);
    }
    draft = [];
    void store.saveProject(project);
    redraw();
  }

  function addLayer(kind: TieKind) {
    const layer: TieLayer = {
      id: uid('lyr'),
      name: `${KIND_LABEL[kind]} ${project.tie.layers.filter((l) => l.kind === kind).length + 1}`,
      kind,
      visible: true,
      tightness: 0.7,
      gather: kind === 'stitch' ? 0.6 : 0,
      paths: [],
      clamps: [],
    };
    project.tie.layers.push(layer);
    activeLayerId = layer.id;
    mode = kind === 'clamp' ? 'clamp' : 'path';
    void store.saveProject(project);
    renderTiePage(root);
  }

  const layerListHost = h('div', { class: 'layer-list' });

  function renderLayers() {
    layerListHost.replaceChildren(
      ...project.tie.layers.map((layer) => {
        const item = h('div', { class: `layer-item ${layer.id === activeLayerId ? 'active' : ''}` },
          h('div', { class: 'head' },
            h('input', {
              type: 'checkbox',
              checked: layer.visible,
              onchange: (e: Event) => {
                layer.visible = (e.target as HTMLInputElement).checked;
                void store.saveProject(project);
                redraw();
                renderLayers();
              },
              style: 'width:auto',
            }),
            h('b', {}, layer.name),
            h('span', { class: 'badge info' }, KIND_LABEL[layer.kind]),
            h('button', {
              class: 'small ghost',
              onclick: () => { activeLayerId = layer.id; mode = layer.kind === 'clamp' ? 'clamp' : 'path'; renderLayers(); redraw(); },
            }, '编辑'),
          ),
          h('div', { class: 'small-text muted' },
            `路径 ${layer.paths.length} · 夹板 ${layer.clamps.length}`),
          layer.id === activeLayerId ? layerControls(layer) : null,
          h('div', { class: 'row' },
            h('button', {
              class: 'small danger',
              onclick: async () => {
                if (!(await confirmDialog('删除该扎结图层？'))) return;
                project.tie.layers = project.tie.layers.filter((x) => x.id !== layer.id);
                if (activeLayerId === layer.id) activeLayerId = project.tie.layers[0]?.id ?? '';
                void store.saveProject(project);
                renderTiePage(root);
              },
            }, '删除图层'),
          ),
        );
        return item;
      }),
    );
  }

  function layerControls(layer: TieLayer) {
    return h('div', {},
      label(`松紧度 ${layer.tightness.toFixed(2)}（越紧留白越锐）`,
        rangeInput(layer.tightness, 0.1, 1, 0.01, (v) => {
          layer.tightness = v;
          void store.saveProject(project);
          redraw();
        })),
      layer.kind === 'stitch'
        ? label(`抽褶强度 ${(layer.gather ?? 0.6).toFixed(2)}`,
            rangeInput(layer.gather ?? 0.6, 0.1, 1, 0.01, (v) => {
              layer.gather = v;
              void store.saveProject(project);
              redraw();
            }))
        : null,
      layer.kind === 'clamp' && layer.clamps.length > 0
        ? label(`当前夹板夹压 ${layer.clamps[layer.clamps.length - 1].pressure.toFixed(2)}`,
            rangeInput(layer.clamps[layer.clamps.length - 1].pressure, 0.1, 1, 0.01, (v) => {
              layer.clamps[layer.clamps.length - 1].pressure = v;
              void store.saveProject(project);
              redraw();
            }))
        : null,
    );
  }

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '扎结设计'),
      h('span', { class: 'muted small-text' }, '按住拖拽画路径/夹板轮廓，双击或松开自动成组；扎死区在右侧实时计算留白'),
      h('div', { class: 'spacer' }),
      reserveLabel,
    ),
    h('div', { class: 'layout-3' },
      // 左：图层
      h('div', { class: 'panel' },
        h('h3', {}, '扎结图层（分层管理）'),
        h('div', { class: 'toolbar', style: 'margin-bottom:10px' },
          h('button', { class: 'small', onclick: () => addLayer('rubber') }, '＋ 橡皮筋'),
          h('button', { class: 'small', onclick: () => addLayer('clamp') }, '＋ 夹板'),
          h('button', { class: 'small', onclick: () => addLayer('stitch') }, '＋ 缝缀'),
        ),
        layerListHost,
      ),
      // 中：编辑器
      h('div', { class: 'panel' },
        h('div', { class: 'toolbar', style: 'margin-bottom:10px' },
          h('button', {
            class: `small ${mode === 'path' ? 'primary' : ''}`,
            onclick: () => { mode = 'path'; },
          }, '路径/捆扎笔'),
          h('button', {
            class: `small ${mode === 'clamp' ? 'primary' : ''}`,
            onclick: () => { mode = 'clamp'; },
          }, '夹板轮廓'),
          h('button', {
            class: 'small',
            onclick: () => {
              const layer = activeLayer();
              if (!layer) return;
              layer.paths = [];
              layer.clamps = [];
              void store.saveProject(project);
              redraw();
              toast('当前图层路径已清空');
            },
          }, '清空当前层'),
          h('button', {
            class: 'small',
            onclick: () => { draft = []; redraw(); },
          }, '撤销草稿'),
        ),
        h('div', { class: 'canvas-wrap' }, editor.canvas),
      ),
      // 右：留白预览
      h('div', { class: 'panel' },
        h('h3', {}, '扎死留白预览（进色率蒙版）'),
        maskWrap,
        h('p', { class: 'muted small-text', style: 'margin-top:8px' },
          '白色 = 自由进色；黑色 = 扎死不进色；灰阶为松紧过渡区。该蒙版直接作为仿真引擎的进色率纹理。'),
        h('button', {
          class: 'primary small',
          style: 'margin-top:8px',
          onclick: () => { void store.saveProject(project); toast('扎结图纸已存入浏览器本地', 'ok'); },
        }, '保存图纸'),
      ),
    ),
  ));
  renderLayers();
  redraw();
}

function drawPoints(ctx: CanvasRenderingContext2D, pts: Pt[], size: number, closed: boolean) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x * size, pts[0].y * size);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * size, pts[i].y * size);
  if (closed) ctx.closePath();
}

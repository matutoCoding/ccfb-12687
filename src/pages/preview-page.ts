// 成品预览页：四方连续平铺、平接/跳接接版、布卷收放、疵点热力图归因、退蜡前后对照、导出
import { h, mount, toast, label, rangeInput, selectInput, fmtTime } from '../ui/dom';
import { store } from '../state/store';
import type { Defect, SimResult, DesignProject, ChangeOrder, ShareToken } from '../types';
import { get, put, getAll } from '../data/idb';
import { loadImage, download, uid } from '../util/math';
import {
  createGl, drawQuad, makeProgram, makeQuadVao, uploadCanvasTexture,
} from '../gl/gl-helpers';
import { PREVIEW_FS, VERT } from '../gl/shaders';

export async function renderPreviewPage(root: HTMLElement): Promise<void> {
  const project = store.currentProject();
  if (!project) {
    mount(root, h('div', { class: 'panel' }, '请先创建花稿项目'));
    return;
  }
  const sim = await get<SimResult>('sims', project.id);

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '成品预览与疵点分析'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'small', onclick: () => exportPackage(project, sim) }, '⬇ 导出图纸配方文件'),
      h('button', { class: 'small primary', onclick: () => createShareLink(project, sim) }, '🔗 生成只读分享链接'),
      h('button', {
        class: 'small',
        onclick: () => toggleLock(project),
      }, project.status === 'locked' ? '新建变更单' : '定稿锁定'),
    ),
    sim ? buildPreview(project, sim) : h('div', { class: 'panel' },
      h('p', {}, '尚无仿真结果'),
      h('button', { class: 'primary', onclick: () => { location.hash = '/recipe'; } }, '去染程页跑仿真'),
    ),
  ));
}

function buildPreview(project: DesignProject, sim: SimResult) {
  // ---- 平铺 WebGL 预览 ----
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 600;
  tileCanvas.height = 420;
  let gl: WebGL2RenderingContext;
  let program: ReturnType<typeof makeProgram>;
  let vao: WebGLVertexArrayObject;
  let tileTex: WebGLTexture | null = null;
  const state = { repeatX: 4, repeatY: 3, halfDrop: 0, curl: 0 };

  function glReady(): boolean {
    try {
      gl = createGl(tileCanvas);
      program = makeProgram(gl, VERT, PREVIEW_FS);
      vao = makeQuadVao(gl);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  async function setTile(dataUrl: string) {
    const img = await loadImage(dataUrl);
    if (tileTex) gl.deleteTexture(tileTex);
    tileTex = uploadCanvasTexture(gl, img, true);
    render();
  }

  function render() {
    if (!tileTex) return;
    gl.viewport(0, 0, tileCanvas.width, tileCanvas.height);
    gl.useProgram(program.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tileTex);
    gl.uniform1i(program.uniforms.u_tile, 0);
    gl.uniform2f(program.uniforms.u_repeat, state.repeatX, state.repeatY);
    gl.uniform1f(program.uniforms.u_halfDrop, state.halfDrop);
    gl.uniform1f(program.uniforms.u_curl, state.curl);
    gl.uniform1f(program.uniforms.u_time, 0);
    drawQuad(gl, vao);
  }

  const glOk = glReady();

  // ---- 疵点热力图叠加 ----
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = 480;
  heatCanvas.height = 480;
  const heatWrap = h('div', { class: 'canvas-wrap', style: 'position:relative' }, heatCanvas);

  function drawHeatmap() {
    const ctx = heatCanvas.getContext('2d')!;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
      ctx.drawImage(img, 0, 0, heatCanvas.width, heatCanvas.height);
      for (const d of sim.defects) {
        const el = h('div', {
          class: 'defect-marker',
          style: `left:${d.x * 100}%;top:${d.y * 100}%;width:${d.radius * 200}%;height:${d.radius * 200}%;`,
          title: `${d.kind} 严重度 ${(d.severity * 100).toFixed(0)}%`,
          onclick: () => showDefectDetail(d),
        });
        heatWrap.append(el);
      }
    };
    img.src = sim.finalDataUrl;
  }

  const defectDetail = h('div', { class: 'panel' },
    h('h3', {}, '疵点反查与调参建议'),
    h('p', { class: 'muted small-text' }, '点击布面红圈查看责任工序与参数诱因；改完参数在染程页只重算受影响工序段。'),
    h('div', { id: 'defect-detail' }, renderDefectList()),
  );

  function showDefectDetail(d: Defect) {
    document.getElementById('defect-detail')!.replaceChildren(
      h('div', {},
        h('p', {}, h('span', { class: 'badge bad' }, d.kind),
          ` 严重度 ${(d.severity * 100).toFixed(0)}% · 位置 (${(d.x * 100).toFixed(0)}%, ${(d.y * 100).toFixed(0)}%)`),
        h('p', {}, h('b', {}, '责任工序：'), `第 ${d.stepIndex + 1} 道`),
        h('p', {}, h('b', {}, '诱因：'), d.cause),
        h('p', {}, h('b', {}, '调参建议：'), d.suggestion),
        h('button', {
          class: 'small primary',
          onclick: () => { location.hash = '/recipe'; },
        }, '去调整该道参数'),
      ),
    );
  }

  function renderDefectList() {
    if (sim.defects.length === 0) return h('p', { class: 'badge ok' }, '✓ 未检出明显疵点');
    return h('div', {}, ...sim.defects.map((d) =>
      h('div', {
        class: 'checklist-item',
        style: 'cursor:pointer',
        onclick: () => showDefectDetail(d),
      },
        h('span', { class: `badge ${d.severity > 0.6 ? 'bad' : 'warn'}` }, d.kind),
        h('div', {},
          h('div', { class: 'small-text' }, d.cause),
          h('div', { class: 'muted small-text' }, `第 ${d.stepIndex + 1} 道 · ${d.suggestion}`),
        ),
      ),
    ));
  }

  // ---- 退蜡前后对照 ----
  const waxCompare = h('div', { class: 'side-by-side' },
    h('figure', {}, h('img', { src: sim.stepTextures.at(-1) ?? sim.finalDataUrl }), h('figcaption', {}, '退蜡前（蜡面浮色）')),
    h('figure', {}, h('img', { src: sim.finalDataUrl }), h('figcaption', {}, '退蜡后（蜡痕深色圈）')),
  );

  // ---- 变更单 ----
  const changeBox = h('div', { class: 'panel' },
    h('h3', {}, '变更单记录'),
    project.changeOrders.length === 0 ? h('p', { class: 'muted small-text' }, '锁定后修改将在此留痕') :
      h('div', {}, ...project.changeOrders.map((c: ChangeOrder) =>
        h('div', { class: 'checklist-item' },
          h('div', {},
            h('b', {}, c.summary),
            h('div', { class: 'muted small-text' }, `${c.author} · ${fmtTime(c.createdAt)}`),
            h('div', { class: 'small-text' }, `${c.before} → ${c.after}`),
          ),
        ),
      )),
  );

  // ---- 接版控制 ----
  const seamControls = h('div', { class: 'panel' },
    h('h3', {}, '整匹布接版与收放'),
    label('接版方式', selectInput(
      [['0', '平接（网格对齐）'], ['1', '跳接（1/2 错位）']],
      String(state.halfDrop),
      (v) => { state.halfDrop = Number(v); render(); },
    )),
    label(`横向循环 ${state.repeatX} 单元`, rangeInput(state.repeatX, 1, 10, 1, (v) => { state.repeatX = v; render(); })),
    label(`纵向循环 ${state.repeatY} 单元`, rangeInput(state.repeatY, 1, 8, 1, (v) => { state.repeatY = v; render(); })),
    label(`布卷收放 ${(state.curl * 100).toFixed(0)}%`, rangeInput(state.curl, 0, 1, 0.01, (v) => { state.curl = v; render(); })),
    h('p', { class: 'muted small-text' }, '接缝错位一眼可见；GPU 实例化平铺，办公机缩放平移不依赖 CPU 重绘。'),
  );

  if (glOk) void setTile(sim.finalDataUrl);
  drawHeatmap();

  // 工序结果时间轴
  const stepStrip = h('div', { class: 'panel' },
    h('h3', {}, `逐道浸染结果（${sim.stepTextures.length} 道，点击查看该道）`),
    h('div', { class: 'toolbar', style: 'overflow-x:auto' },
      ...sim.stepTextures.map((url, i) =>
        h('figure', {
          style: 'margin:0;min-width:110px;cursor:pointer',
          onclick: () => { if (glOk) void setTile(url); toast(`已切换到第 ${i + 1} 道结果`); },
        },
          h('img', { src: url, style: 'width:110px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--line)' }),
          h('figcaption', {}, `第 ${i + 1} 道 ${sim.timings[i] ? sim.timings[i].toFixed(0) + 'ms' : ''}`),
        ),
      ),
    ),
  );

  return h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '整匹布四方连续预览'),
        glOk ? h('div', { class: 'canvas-wrap' }, tileCanvas) : h('div', { class: 'error-box' }, 'WebGL2 不可用'),
      ),
      seamControls,
    ),
    stepStrip,
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '疵点热力图（色花 / 色档 / 阴阳面）'),
        heatWrap,
      ),
      defectDetail,
    ),
    h('div', { class: 'panel' },
      h('h3', {}, '退蜡前后一键对照'),
      waxCompare,
    ),
    changeBox,
  );
}

async function exportPackage(project: DesignProject, sim?: SimResult) {
  const fabric = store.state.fabrics.find((f) => f.id === project.fabricId);
  const recipe = store.state.recipes.find((r) => r.id === project.recipeId);
  const payload = {
    schema: 'indigo-studio/v1',
    exportedAt: new Date().toISOString(),
    project: { ...project, changeOrders: project.changeOrders },
    fabric: fabric ? {
      name: fabric.name,
      warpDensity: fabric.warpDensity,
      weftDensity: fabric.weftDensity,
      fibers: fabric.fibers,
      calibration: {
        uptakeRate: fabric.calibration.uptakeRate,
        capillaryCoeff: fabric.calibration.capillaryCoeff,
        approved: fabric.approved,
      },
    } : null,
    recipe,
    tie: project.tie,
    wax: project.wax,
    simulation: sim ? {
      defects: sim.defects,
      recipeHash: sim.recipeHash,
      simulatedAt: sim.simulatedAt,
      finalImage: sim.finalDataUrl,
    } : null,
  };
  download(`${project.name.replace(/[\\/:*?"<>|]/g, '_')}_染坊制作包.json`, JSON.stringify(payload, null, 2));
  if (sim) download(`${project.name}_成品仿真图.png`, await (await fetch(sim.finalDataUrl)).blob());
  toast('制作包已导出，发给染坊照着下缸', 'ok');
}

async function createShareLink(project: DesignProject, sim?: SimResult) {
  if (!sim) {
    toast('先跑仿真再分享', 'warn');
    return;
  }
  const token = uid('share');
  const share: ShareToken = { token, projectId: project.id, createdAt: Date.now(), snapshotDataUrl: sim.finalDataUrl };
  await put('shares', share);
  project.status = 'shared';
  await store.saveProject(project);
  const url = `${location.origin}${location.pathname}#/share?token=${token}`;
  await navigator.clipboard?.writeText(url).catch(() => undefined);
  toast(`只读链接已复制：${url}`, 'ok');
}

async function toggleLock(project: DesignProject) {
  if (project.status !== 'locked') {
    project.status = 'locked';
    await store.saveProject(project);
    toast('花稿已定稿锁定，后续修改须新建变更单', 'ok');
    renderPreviewPage(document.getElementById('view')!);
    return;
  }
  const summary = window.prompt('变更单标题：');
  if (!summary) return;
  const order: ChangeOrder = {
    id: uid('co'),
    createdAt: Date.now(),
    author: '设计员',
    summary,
    before: '锁定版本',
    after: summary,
  };
  project.changeOrders.push(order);
  project.status = 'change-order';
  await store.saveProject(project);
  toast('变更单已记录', 'ok');
  renderPreviewPage(document.getElementById('view')!);
}

// 来样反推页：拍照取色 -> 染料库反推浓度与道数 -> 候选直接进仿真 -> 锁定基准配方
import { h, mount, toast } from '../ui/dom';
import { fileInput } from '../ui/canvas-editor';
import { store } from '../state/store';
import type { CandidateRecipe } from '../domain/reverse-recipe';
import { extractSampleColors, reverseEngineer, lockAsBaseline } from '../domain/reverse-recipe';
import { readFileAsDataUrl, download } from '../util/math';
import { SimEngine } from '../gl/sim-engine';
import { put } from '../data/idb';
import type { SimResult } from '../types';

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function renderReversePage(root: HTMLElement): void {
  const project = store.currentProject();
  const fabric = project ? store.state.fabrics.find((f) => f.id === project.fabricId) : undefined;
  let candidates: CandidateRecipe[] = [];

  const previewHost = h('div', { style: 'margin-top:12px' });
  const swatchHost = h('div', { style: 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap' });
  const resultHost = h('div', {});

  const picker = fileInput('image/*', async (file) => {
    const dataUrl = await readFileAsDataUrl(file);
    previewHost.replaceChildren(h('img', {
      src: dataUrl,
      style: 'max-width:100%;border-radius:8px;border:1px solid var(--line)',
    }));
    toast('正在提取样品颜色…');
    const colors = await extractSampleColors(dataUrl);
    swatchHost.replaceChildren(...colors.map((c) => {
      const hex = rgbToHexLocal(c.rgb);
      return h('div', { class: 'card', style: 'padding:8px;cursor:default;min-width:120px' },
        h('div', { style: `width:100%;height:42px;border-radius:6px;background:${hex}` }),
        h('div', { class: 'small-text' }, c.label),
        h('div', { class: 'muted small-text mono' }, hex),
      );
    }));
    const dye = store.state.dyes[0];
    candidates = reverseEngineer(colors[0].rgb, dye, dataUrl);
    renderCandidates();
  });

  function renderCandidates() {
    resultHost.replaceChildren(
      h('div', { class: 'panel' },
        h('h3', {}, '候选配方（按预测 ΔE 排序）'),
        h('p', { class: 'muted small-text' }, '每个候选可直接跑仿真看效果，选定后锁为染坊基准配方。'),
        h('div', { class: 'card-grid' },
          ...candidates.map((c, idx) =>
            h('div', { class: 'card', style: 'cursor:default' },
              h('div', { class: 'title' }, c.recipe.name),
              h('div', { class: 'meta' },
                `${c.dips} 道浸染 · 首道浓度 ${c.concentration.toFixed(1)} g/L`,
                h('br'),
                `预测色差 ΔE ${c.predictedDeltaE}`,
                idx === 0 ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, '最匹配') : null,
              ),
              h('div', { class: 'toolbar' },
                h('button', { class: 'small primary', onclick: () => void runCandidate(c, idx) }, '▶ 跑仿真'),
                h('button', {
                  class: 'small',
                  onclick: async () => {
                    const locked = lockAsBaseline(c.recipe);
                    await store.saveRecipe(locked);
                    if (project) {
                      project.recipeId = locked.id;
                      await store.saveProject(project);
                    }
                    toast('已锁定为基准配方，染坊按此下缸', 'ok');
                  },
                }, '🔒 选它并锁定'),
              ),
              h('div', { id: `cand-${idx}`, class: 'cand-result' }),
            ),
          ),
        ),
      ),
    );
  }

  async function runCandidate(c: CandidateRecipe, idx: number) {
    if (!project || !fabric) {
      toast('缺少当前花稿或坯布，无法仿真', 'bad');
      return;
    }
    const host = document.getElementById(`cand-${idx}`)!;
    host.replaceChildren(h('p', { class: 'small-text muted' }, 'GPU 仿真中…'));
    const canvas = document.createElement('canvas');
    const engine = new SimEngine(canvas);
    try {
      const out = await engine.run({
        fabric,
        tie: project.tie,
        wax: project.wax,
        recipe: c.recipe,
        dyeColorOf: (id) => store.dyeColor(id),
      });
      host.replaceChildren(
        h('img', {
          src: out.result.finalDataUrl,
          style: 'width:100%;border-radius:8px;border:1px solid var(--line)',
        }),
        h('p', { class: 'small-text muted' },
          `检出疵点 ${out.result.defects.length} 个 · GPU 用时 ${out.result.timings.reduce((a: number, b: number) => a + b, 0).toFixed(0)} ms`),
        h('button', {
          class: 'small',
          onclick: () => download('候选仿真.png', dataUrlToBlob(out.result.finalDataUrl)),
        }, '存图'),
      );
      const sim: SimResult = { projectId: project.id, ...out.result };
      await put('sims', sim);
    } catch (err) {
      host.replaceChildren(h('p', { class: 'badge bad' }, `仿真失败：${(err as Error).message}`));
    } finally {
      engine.dispose();
    }
  }

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '来样反推配方'),
      h('span', { class: 'muted small-text' }, '拍客户来样 → 取色 → 反推靛蓝浓度与浸染道数 → 仿真挑选 → 锁定基准'),
    ),
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '1. 上传来样照片'),
        h('div', { class: 'toolbar' },
          h('button', { class: 'primary', onclick: () => picker.click() }, '📷 选择照片'),
        ),
        previewHost,
        swatchHost,
      ),
      resultHost,
    ),
  ));
}

function rgbToHexLocal(rgb: [number, number, number]): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

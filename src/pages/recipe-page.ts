// 染程配方页：浸染工序拖拽排序、靛蓝浓度/氧化/浴比、多道套色、媒染标注、仿真与增量重算
import { h, mount, toast, label, numInput, selectInput, confirmDialog } from '../ui/dom';
import { store } from '../state/store';
import type { Recipe, RecipeStep, StepType, SimResult, DesignProject } from '../types';
import { uid, hashString } from '../util/math';
import { SimEngine } from '../gl/sim-engine';
import { put, get } from '../data/idb';

const STEP_LABEL: Record<StepType, string> = { dip: '浸染', oxidize: '氧化', mordant: '媒染' };

export function renderRecipePage(root: HTMLElement): void {
  const maybeProject = store.currentProject();
  if (!maybeProject) {
    mount(root, h('div', { class: 'panel' }, '请先创建花稿项目'));
    return;
  }
  const project: DesignProject = maybeProject;
  const recipe = store.state.recipes.find((r) => r.id === project.recipeId) ?? store.state.recipes[0];
  if (!recipe) {
    mount(root, h('div', { class: 'panel' }, '尚无配方，请新建'));
    return;
  }
  project.recipeId = recipe.id;
  let running = false;
  let lastFromStep: number | undefined;

  const progressBox = h('div', { class: 'panel', hidden: true },
    h('h3', {}, '仿真进度'),
    h('div', { class: 'progress-bar' }, h('div', { id: 'sim-bar', style: 'width:0%' })),
    h('p', { id: 'sim-label', class: 'small-text muted', style: 'margin-top:6px' }, '准备中…'),
  );

  function renderSteps() {
    listHost.replaceChildren();
    recipe.steps.forEach((step, i) => {
      const card = h('div', {
        class: `step-card ${step.type}`,
        draggable: recipe.locked ? 'false' : 'true',
      },
        h('div', { class: 'row' },
          h('b', {}, `${i + 1}. ${STEP_LABEL[step.type]}`),
          h('div', { class: 'spacer' }),
          step.type === 'mordant' ? h('span', { class: 'badge ok' }, '媒染步骤') : null,
          h('button', {
            class: 'small ghost',
            disabled: recipe.locked,
            onclick: () => {
              recipe.steps.splice(i, 1);
              void store.saveRecipe(recipe);
              renderSteps();
            },
          }, '✕'),
        ),
        step.type === 'dip'
          ? h('div', { class: 'row' },
              label('染液', selectInput(
                store.state.dyes.map((d): [string, string] => [d.id, d.name]),
                step.dyeId ?? store.state.dyes[0].id,
                (v) => { step.dyeId = v; void store.saveRecipe(recipe); },
              )),
              label('浓度 g/L', numInput(step.concentration, 0.5, (v) => { step.concentration = v; void store.saveRecipe(recipe); })),
            )
          : null,
        step.type === 'mordant'
          ? label('媒染剂', h('input', {
              value: step.mordantName ?? '明矾',
              oninput: (e: Event) => { step.mordantName = (e.target as HTMLInputElement).value; void store.saveRecipe(recipe); },
            }))
          : null,
        h('div', { class: 'row' },
          label('浸染 min', numInput(step.dipMinutes, 1, (v) => { step.dipMinutes = v; void store.saveRecipe(recipe); })),
          label('氧化 min', numInput(step.oxidizeMinutes, 1, (v) => { step.oxidizeMinutes = v; void store.saveRecipe(recipe); })),
          label('浴比 1:', numInput(step.liquorRatio, 1, (v) => { step.liquorRatio = v; void store.saveRecipe(recipe); })),
        ),
      );
      (card as HTMLElement).dataset.stepId = step.id;
      // 拖拽排序：直接在 DOM 上移动，松手后按元素顺序重建 steps
      card.addEventListener('dragstart', () => card.classList.add('dragging'));
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        const next = Array.from(listHost.querySelectorAll<HTMLElement>('.step-card'))
          .map((el) => recipe.steps.find((s) => s.id === el.dataset.stepId))
          .filter((s): s is RecipeStep => Boolean(s));
        if (next.length === recipe.steps.length) {
          recipe.steps = next;
          void store.saveRecipe(recipe);
          renderSteps();
        }
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = listHost.querySelector('.dragging');
        if (!dragging || dragging === card) return;
        const rect = card.getBoundingClientRect();
        const after = (e as DragEvent).clientY > rect.top + rect.height / 2;
        listHost.insertBefore(dragging, after ? card.nextSibling : card);
      });
      listHost.append(card);
    });
  }

  const listHost = h('div', {});

  function addStep(type: StepType) {
    if (recipe.locked) return;
    const dye = store.state.dyes[0];
    recipe.steps.push({
      id: uid('step'),
      type,
      concentration: type === 'dip' ? 10 : 0,
      oxidizeMinutes: 15,
      liquorRatio: 20,
      dipMinutes: 10,
      dyeId: type === 'dip' ? dye.id : null,
      mordantName: type === 'mordant' ? '明矾' : undefined,
      note: '',
    });
    void store.saveRecipe(recipe);
    renderSteps();
  }

  async function runSim(fromStep?: number) {
    if (running) return;
    const fabric = store.state.fabrics.find((f) => f.id === project.fabricId);
    if (!fabric) {
      toast('项目缺少坯布', 'bad');
      return;
    }
    if (!fabric.approved) {
      const ok = await confirmDialog('该坯布未通过标定门禁，仿真结果不可用于报价。仍要试跑？');
      if (!ok) return;
    }
    running = true;
    progressBox.hidden = false;
    const bar = document.getElementById('sim-bar')!;
    const lbl = document.getElementById('sim-label')!;
    const canvas = document.createElement('canvas');
    const engine = new SimEngine(canvas);
    try {
      const out = await engine.run({
        fabric,
        tie: project.tie,
        wax: project.wax,
        recipe,
        dyeColorOf: (id) => store.dyeColor(id),
        fromStep,
        onProgress: (pct, label2) => {
          bar.style.width = `${pct}%`;
          lbl.textContent = label2;
        },
      });
      const prev = await get<SimResult>('sims', project.id);
      const result: SimResult = {
        projectId: project.id,
        ...out.result,
        stepTextures: fromStep !== undefined && prev
          ? prev.stepTextures.slice(0, fromStep).concat(out.result.stepTextures)
          : out.result.stepTextures,
      };
      await put('sims', result);
      bar.style.width = '100%';
      lbl.textContent = `完成：${result.defects.length} 个疵点 · 留白 ${(out.reserveRatio * 100).toFixed(1)}%`;
      lastFromStep = undefined;
      toast(fromStep !== undefined ? '受影响工序段已重算' : '整缸仿真完成，可去成品预览查看', 'ok');
    } catch (err) {
      console.error(err);
      toast(`仿真失败：${(err as Error).message}`, 'bad');
    } finally {
      engine.dispose();
      running = false;
    }
  }

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '染程配方'),
      h('input', {
        value: recipe.name,
        style: 'max-width:260px',
        disabled: recipe.locked,
        oninput: (e: Event) => { recipe.name = (e.target as HTMLInputElement).value; },
      }),
      recipe.locked ? h('span', { class: 'badge ok' }, '🔒 基准配方已锁定') : h('span', { class: 'badge info' }, '可编辑'),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'small',
        disabled: recipe.locked,
        onclick: async () => {
          if (await confirmDialog('锁定为基准配方？锁定后修改需走变更单')) {
            recipe.locked = true;
            recipe.lockedAt = Date.now();
            await store.saveRecipe(recipe);
            toast('已锁定为染坊下缸基准配方', 'ok');
            renderRecipePage(root);
          }
        },
      }, '🔒 锁定基准配方'),
    ),
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '工序序列（拖拽调整顺序）'),
        h('div', { class: 'toolbar', style: 'margin-bottom:10px' },
          h('button', { class: 'small', disabled: recipe.locked, onclick: () => addStep('dip') }, '＋ 浸染'),
          h('button', { class: 'small', disabled: recipe.locked, onclick: () => addStep('oxidize') }, '＋ 氧化'),
          h('button', { class: 'small', disabled: recipe.locked, onclick: () => addStep('mordant') }, '＋ 媒染'),
          h('button', {
            class: 'small',
            onclick: () => {
              const dipIdx = recipe.steps.findIndex((s) => s.type === 'dip');
              lastFromStep = dipIdx >= 0 ? dipIdx : 0;
              void runSim(lastFromStep);
            },
          }, '只重算受影响工序段'),
        ),
        listHost,
        h('p', { class: 'small-text muted', style: 'margin-top:8px' },
          `配方哈希 ${hashString(JSON.stringify(recipe.steps)).slice(0, 10)} · 共 ${recipe.steps.filter((s) => s.type === 'dip').length} 道浸染`),
      ),
      h('div', {},
        h('div', { class: 'panel' },
          h('h3', {}, '仿真执行'),
          h('p', { class: 'muted small-text' },
            '整缸仿真在 GPU 上逐道执行：吸色 → 沿纤维场毛细扩散 → 氧化固着。改参数后可只从变化的工序段重算，前道结果走缓存。'),
          h('div', { class: 'toolbar' },
            h('button', { class: 'primary', onclick: () => void runSim() }, '▶ 整缸仿真'),
            h('button', {
              onclick: () => {
                location.hash = '/preview';
              },
            }, '前往成品预览 →'),
          ),
        ),
        progressBox,
        h('div', { class: 'panel', style: 'margin-top:14px' },
          h('h3', {}, '套色染液库'),
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '染液'), h('th', {}, '色系'), h('th', {}, '发色'))),
            h('tbody', {}, ...store.state.dyes.map((d) =>
              h('tr', {},
                h('td', {}, d.name),
                h('td', {}, d.family),
                h('td', {}, h('span', {
                  style: `display:inline-block;width:16px;height:16px;border-radius:4px;background:${d.color};vertical-align:middle`,
                }), ' ', d.color),
              ),
            )),
          ),
        ),
      ),
    ),
  ));
  renderSteps();
}

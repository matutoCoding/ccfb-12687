// 客户只读分享页：查看快照、圈选批注、修改清单逐条销项、确认定稿
import { fmtTime, h, mount, toast, type ElChild } from '../ui/dom';
import { get, put, queryByIndex } from '../data/idb';
import type { Annotation, DesignProject, ShareToken } from '../types';
import { uid } from '../util/math';

export async function renderSharePage(root: HTMLElement, token: string): Promise<void> {
  const share = await get<ShareToken>('shares', token);
  if (!share) {
    mount(root, h('div', { class: 'panel error-box' }, '分享链接无效或已失效（数据仅保存在本机浏览器）'));
    return;
  }
  const project = await get<DesignProject>('projects', share.projectId);
  let annotations = await queryByIndex<Annotation>('annotations', 'token', token);

  const imgWrap = h('div', {
    class: 'canvas-wrap',
    style: 'position:relative;max-width:680px',
  }, h('img', {
    src: share.snapshotDataUrl,
    style: 'width:100%;display:block',
    draggable: false,
  }));

  const listHost = h('div', {});

  function renderPins() {
    imgWrap.querySelectorAll('.annotation-pin').forEach((el) => el.remove());
    annotations.forEach((a, i) => {
      const pin = h('div', {
        class: 'annotation-pin',
        style: `left:${a.x * 100}%;top:${a.y * 100}%`,
        title: a.text,
      }, String(i + 1));
      imgWrap.append(pin);
    });
  }

  function renderList() {
    const items: ElChild[] = annotations.length === 0
      ? [h('p', { class: 'muted small-text' }, '还没有批注，在左侧图上点选位置后填写意见')]
      : annotations.map((a) =>
            h('div', { class: `checklist-item ${a.resolved ? 'done' : ''}` },
              h('input', {
                type: 'checkbox',
                checked: a.resolved,
                style: 'width:auto;margin-top:3px',
                onchange: async (e: Event) => {
                  a.resolved = (e.target as HTMLInputElement).checked;
                  await put('annotations', a);
                  renderList();
                  toast(a.resolved ? '该条修改已销项' : '已取消销项');
                },
              }),
              h('div', {},
                h('div', {}, `#${annotations.indexOf(a) + 1} ${a.text}`),
                h('div', { class: 'muted small-text' }, `${a.author} · ${fmtTime(a.createdAt)} · 位置 (${(a.x * 100).toFixed(0)}%, ${(a.y * 100).toFixed(0)}%)`),
              ),
            ),
          );
    listHost.replaceChildren(...(items.filter((x): x is Node => x instanceof Node)));
  }

  // 圈选：点击图片记录归一化坐标
  imgWrap.addEventListener('click', (e) => {
    const rect = imgWrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const text = window.prompt('批注内容（要改哪里、怎么改）：');
    if (!text) return;
    const author = window.prompt('您的称呼：', '客户') ?? '客户';
    const a: Annotation = {
      id: uid('ann'),
      token,
      x,
      y,
      text,
      resolved: false,
      createdAt: Date.now(),
      author,
    };
    void put('annotations', a).then(() => {
      annotations.push(a);
      renderPins();
      renderList();
      toast('批注已提交，设计方会汇总成修改清单', 'ok');
    });
  });

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, `客户批注 · ${project?.name ?? '花稿'}`),
      h('span', { class: 'badge info' }, '只读分享视图'),
    ),
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '成品快照（点击图面任意位置添加批注）'),
        imgWrap,
      ),
      h('div', { class: 'panel' },
        h('h3', {}, `修改清单（${annotations.filter((a) => !a.resolved).length} 待处理 / ${annotations.length} 总计）`),
        listHost,
        h('button', {
          class: 'primary small',
          style: 'margin-top:12px',
          onclick: async () => {
            if (!project) return;
            if (annotations.some((a) => !a.resolved)) {
              toast('还有未销项的批注，不能定稿', 'warn');
              return;
            }
            project.status = 'locked';
            await put('projects', project);
            toast('全部意见已销项，花稿确认定稿锁定', 'ok');
          },
        }, '确认定稿锁定'),
      ),
    ),
  ));
  renderPins();
  renderList();
}

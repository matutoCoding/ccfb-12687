// hash 路由：#/fabric | tie | wax | recipe | preview | schedule | share | reverse
import type { DesignProject } from '../types';
import { mount, h } from './dom';
import { store } from '../state/store';
import { renderFabricPage } from '../pages/fabric-page';
import { renderTiePage } from '../pages/tie-page';
import { renderWaxPage } from '../pages/wax-page';
import { renderRecipePage } from '../pages/recipe-page';
import { renderPreviewPage } from '../pages/preview-page';
import { renderSchedulePage } from '../pages/schedule-page';
import { renderSharePage } from '../pages/share-page';
import { renderReversePage } from '../pages/reverse-page';

const ROUTES: Record<string, (root: HTMLElement, params: URLSearchParams) => Promise<void> | void> = {
  '/fabric': (r) => renderFabricPage(r),
  '/tie': (r) => renderTiePage(r),
  '/wax': (r) => renderWaxPage(r),
  '/recipe': (r) => renderRecipePage(r),
  '/preview': (r) => renderPreviewPage(r),
  '/schedule': (r) => renderSchedulePage(r),
  '/reverse': (r) => renderReversePage(r),
  '/share': (r, p) => renderSharePage(r, p.get('token') ?? ''),
};

const NAV: [string, string][] = [
  ['/fabric', '坯布库'],
  ['/tie', '扎结设计'],
  ['/wax', '蜡防编辑'],
  ['/recipe', '染程配方'],
  ['/preview', '成品预览'],
  ['/reverse', '来样反推'],
  ['/schedule', '拼缸排产'],
];

export function startRouter(): void {
  window.addEventListener('hashchange', render);
  render();
}

async function render(): Promise<void> {
  const hash = location.hash.replace(/^#/, '') || '/fabric';
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  const root = document.getElementById('view')!;
  const isShare = path === '/share';

  renderChrome(isShare);
  try {
    const fn = ROUTES[path] ?? ROUTES['/fabric'];
    await fn(root, params);
  } catch (err) {
    console.error(err);
    mount(root, h('div', { class: 'error-box' }, `页面渲染失败：${(err as Error).message}`));
  }
}

function renderChrome(hideNav: boolean): void {
  const header = document.getElementById('app-header')!;
  if (hideNav) {
    header.classList.add('hidden');
    return;
  }
  header.classList.remove('hidden');
  const current = location.hash.replace(/^#/, '').split('?')[0];
  const project: DesignProject | undefined = store.currentProject();
  header.replaceChildren(
    h('div', { class: 'brand' }, '🫐 靛蓝工坊'),
    h(
      'nav',
      {},
      ...NAV.map(([p, t]) =>
        h(
          'a',
          { class: `nav-link ${current === p ? 'active' : ''}`, href: `#${p}` },
          t,
        ),
      ),
    ),
    h('div', { class: 'proj-chip' }, project ? `当前花稿：${project.name}（${project.status}）` : '未选择花稿'),
  );
}

export function go(path: string): void {
  location.hash = path;
}

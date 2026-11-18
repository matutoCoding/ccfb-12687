// 极简 DOM 构建辅助，避免引入框架
export type ElChild = Node | string | false | null | undefined | ElChild[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined | null> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    if (Array.isArray(c)) {
      for (const cc of c) {
        if (cc === false || cc === null || cc === undefined) continue;
        el.append(cc instanceof Node ? cc : document.createTextNode(String(cc)));
      }
      continue;
    }
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, node: Node): void {
  el.replaceChildren(node);
}

export function label(text: string, input: HTMLElement): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', {}, text), input);
}

export function numInput(value: number, step = 1, onInput: (v: number) => void): HTMLInputElement {
  const el = h('input', { type: 'number', step, value }) as HTMLInputElement;
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

export function rangeInput(value: number, min: number, max: number, step: number, onInput: (v: number) => void) {
  const el = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  el.addEventListener('input', () => onInput(Number(el.value)));
  return el;
}

export function selectInput(options: [string, string][], value: string, onChange: (v: string) => void) {
  const el = h('select', {}, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))) as HTMLSelectElement;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function toast(msg: string, kind: 'info' | 'warn' | 'ok' | 'bad' = 'info'): void {
  const box = document.getElementById('toast-box')!;
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  box.append(t);
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 400);
  }, 2600);
}

export function confirmDialog(msg: string): Promise<boolean> {
  return Promise.resolve(window.confirm(msg));
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

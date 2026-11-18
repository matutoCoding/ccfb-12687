// 拼缸排产页：订单维护、色系拼缸、染缸占用表、浓度衰减补料、换缸预警、急单插单重排
import { h, mount, toast, label, numInput, selectInput } from '../ui/dom';
import { store } from '../state/store';
import { getAll, put, get, remove } from '../data/idb';
import type { OrderItem, ProductionPlan, VatSlot } from '../types';
import { uid, nowDay, addDays } from '../util/math';
import { defaultVats, reschedule, insertRushOrder } from '../domain/scheduler';

const COLOR_TAGS = ['靛蓝', '藏青', '茶棕', '薯莨', '铁灰'];

export async function renderSchedulePage(root: HTMLElement): Promise<void> {
  let orders = await getAll<OrderItem>('orders');
  let plan = await get<ProductionPlan>('plan', 'current');
  if (!plan) {
    plan = { vats: defaultVats(), slots: [], updatedAt: Date.now() };
    await put('plan', { ...plan, id: 'current' });
  }

  const tableHost = h('div', {});
  const orderListHost = h('div', {});

  // 新建订单表单状态
  const formState = { customer: '', colorTag: '靛蓝', meters: 20, dueDate: addDays(nowDay(), 3), priority: 3 };

  function renderOrders() {
    orderListHost.replaceChildren(
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '客户/订单'), h('th', {}, '色系'), h('th', {}, '米数'),
          h('th', {}, '交期'), h('th', {}, '优先级'), h('th', {}, '状态'), h('th', {}, '操作'),
        )),
        h('tbody', {},
          ...orders.map((o) =>
            h('tr', {},
              h('td', {}, o.customer),
              h('td', {}, h('span', { class: 'badge info' }, o.colorTag)),
              h('td', {}, `${o.meters} m`),
              h('td', {}, o.dueDate),
              h('td', {}, String(o.priority)),
              h('td', {}, h('span', { class: `badge ${o.status === 'done' ? 'ok' : 'warn'}` }, o.status)),
              h('td', {},
                h('button', {
                  class: 'small danger',
                  onclick: () => void deleteOrder(o),
                }, '删除'),
                h('button', {
                  class: 'small',
                  style: 'margin-left:6px',
                  onclick: () => void rushInsert(o),
                }, '急单插单'),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function renderPlan() {
    if (!plan) return;
    const days = Array.from({ length: 5 }, (_, i) => addDays(nowDay(), i));
    tableHost.replaceChildren(
      h('div', { class: 'panel' },
        h('h3', {}, `未来 5 天染缸占用表（${new Date(plan.updatedAt).toLocaleString('zh-CN')} 更新）`),
        h('div', {
          class: 'schedule-grid',
          style: `grid-template-columns:120px repeat(${days.length},1fr)`,
        },
          h('div', { class: 'muted small-text', style: 'padding:8px' }, '染缸 / 日期'),
          ...days.map((d) => h('div', { class: 'muted small-text', style: 'padding:8px' }, d.slice(5))),
          ...plan.vats.flatMap((vat) => [
            h('div', { style: 'padding:8px;font-weight:600' },
              vat.name,
              h('div', { class: 'muted small-text' }, `${vat.concentration} g/L`),
            ),
            ...days.map((d) => {
              const slots = plan!.slots.filter((s: VatSlot) => s.vatId === vat.id && s.date === d);
              if (slots.length === 0) return h('div', { class: 'slot-cell free' }, '空闲');
              return h('div', {}, ...slots.map((s) => {
                const names = s.orderIds
                  .map((id) => orders.find((o) => o.id === id)?.customer ?? id)
                  .join('、');
                return h('div', { class: `slot-cell ${s.conflictRisk ? 'risk' : 'busy'}`, style: 'margin-bottom:6px' },
                  h('div', {}, `${s.startHour}:00 · ${names}`),
                  s.conflictRisk ? h('div', { style: 'color:var(--bad);margin-top:4px' }, `⚠ ${s.conflictReason}`) : null,
                  s.replenish ? h('div', { class: 'replenish' }, `🧪 ${s.replenish}`) : null,
                );
              }));
            }),
          ]),
        ),
      ),
    );
  }

  async function deleteOrder(o: OrderItem) {
    orders = orders.filter((x) => x.id !== o.id);
    await remove('orders', o.id);
    renderOrders();
    toast('订单已移除');
  }

  async function rerun() {
    plan = reschedule(orders, plan!.vats);
    await put('plan', { ...plan, id: 'current' });
    renderPlan();
  }

  async function rushInsert(rush: OrderItem) {
    const { plan: next, affected } = insertRushOrder(orders, { ...rush }, plan!.vats);
    plan = next;
    await put('plan', { ...plan, id: 'current' });
    renderPlan();
    toast(
      affected.length ? `急单已插入，${affected.length} 个订单受影响需顺延` : '急单已插入，无订单受影响',
      affected.length ? 'warn' : 'ok',
    );
  }

  const form = h('div', { class: 'panel' },
    h('h3', {}, '新建定制单'),
    label('客户', h('input', {
      placeholder: '民宿/品牌名',
      oninput: (e: Event) => { formState.customer = (e.target as HTMLInputElement).value; },
    })),
    label('色系', selectInput(
      COLOR_TAGS.map((t): [string, string] => [t, t]),
      formState.colorTag,
      (v) => { formState.colorTag = v; },
    )),
    h('div', { class: 'row' },
      label('米数', numInput(formState.meters, 1, (v) => { formState.meters = v; })),
      label('优先级 1-10', numInput(formState.priority, 1, (v) => { formState.priority = v; })),
    ),
    label('交期', h('input', {
      type: 'date',
      value: formState.dueDate,
      onchange: (e: Event) => { formState.dueDate = (e.target as HTMLInputElement).value; },
    })),
    h('button', {
      class: 'primary small',
      onclick: async () => {
        if (!formState.customer.trim()) {
          toast('请填写客户名', 'warn');
          return;
        }
        const order: OrderItem = {
          id: uid('ord'),
          projectId: store.currentProject()?.id ?? '',
          customer: formState.customer.trim(),
          colorTag: formState.colorTag,
          meters: formState.meters,
          dueDate: formState.dueDate,
          priority: formState.priority,
          status: 'planned',
        };
        await put('orders', order);
        orders.push(order);
        formState.customer = '';
        renderOrders();
        toast('订单已加入，点击重新排产拼缸', 'ok');
      },
    }, '加入订单'),
  );

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('h2', {}, '拼缸排产'),
      h('span', { class: 'muted small-text' }, '同色系拼缸；每批次浓度按 12% 衰减，低于 70% 自动提醒补料；相邻锅次色系冲突预警'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: () => void rerun() }, '重新排产'),
    ),
    tableHost,
    h('div', { class: 'layout-2' },
      h('div', { class: 'panel' },
        h('h3', {}, '定制单队列'),
        orderListHost,
      ),
      form,
    ),
  ));
  renderOrders();
  renderPlan();
}

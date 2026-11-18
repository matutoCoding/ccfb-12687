// 拼缸排产：色系相近拼缸、浓度衰减补料提醒、换缸冲突预警、急单插单重排
import type { OrderItem, ProductionPlan, Vat, VatSlot } from '../types';
import { addDays, nowDay, uid } from '../util/math';

const HOURS_PER_SLOT = 4;
const SLOTS_PER_DAY = 2; // 上午/下午两口锅
const HORIZON_DAYS = 5;
/** 每批次后浓度保留率 */
const DECAY_PER_BATCH = 0.88;
/** 低于初始浓度 70% 提醒补料 */
const REPLENISH_THRESHOLD = 0.7;

const COLOR_FAMILIES: Record<string, string[]> = {
  indigo: ['靛蓝', '藏青', '蓝', '青'],
  warm: ['茶棕', '薯莨', '棕', '红', '咖'],
  neutral: ['灰', '铁', '黑'],
};

export function colorFamilyOf(tag: string): keyof typeof COLOR_FAMILIES {
  for (const [fam, keys] of Object.entries(COLOR_FAMILIES)) {
    if (keys.some((k) => tag.includes(k))) return fam as keyof typeof COLOR_FAMILIES;
  }
  return 'neutral';
}

export function defaultVats(): Vat[] {
  return [
    { id: uid('vat'), name: '1号靛蓝缸', concentration: 12, initialConcentration: 12, colorTag: '靛蓝', batches: 0 },
    { id: uid('vat'), name: '2号暖色缸', concentration: 10, initialConcentration: 10, colorTag: '茶棕', batches: 0 },
  ];
}

/**
 * 重排计划：
 * 1. 急单（priority 高）优先；同色系订单拼同一缸同一 slot
 * 2. 浓度按批次衰减，低于阈值生成补料提醒
 * 3. 同缸相邻 slot 色系不同 -> 换缸风险预警
 */
export function reschedule(orders: OrderItem[], vats: Vat[]): ProductionPlan {
  const pending = orders
    .filter((o) => o.status !== 'done')
    .sort((a, b) => b.priority - a.priority || a.dueDate.localeCompare(b.dueDate));

  const slots: VatSlot[] = [];
  const vatState = vats.map((v) => ({ ...v }));
  const lastSlotByVat = new Map<string, VatSlot>();
  const day0 = nowDay();

  let dayCursor = 0;
  let slotCursor = 0;
  for (const order of pending) {
    const fam = colorFamilyOf(order.colorTag);
    // 找色系匹配的缸，否则用第一口缸并预警
    let vat = vatState.find((v) => colorFamilyOf(v.colorTag) === fam);
    let conflict = false;
    let conflictReason: string | undefined;
    if (!vat) {
      vat = vatState[0];
      conflict = true;
      conflictReason = `无 ${order.colorTag} 色系专用缸，借用 ${vat.name} 需先清缸`;
    }

    // 拼缸：同一天同缸同 slot 且色系一致的订单合并
    const existing = slots.find(
      (s) =>
        s.vatId === vat!.id &&
        s.date === addDays(day0, dayCursor) &&
        !s.conflictRisk &&
        order.colorTag === vat!.colorTag,
    );

    // 衰减与补料
    vat.batches += 1;
    vat.concentration = +(vat.initialConcentration * Math.pow(DECAY_PER_BATCH, vat.batches)).toFixed(2);
    let replenish: string | undefined;
    if (vat.concentration < vat.initialConcentration * REPLENISH_THRESHOLD) {
      const need = +(vat.initialConcentration - vat.concentration).toFixed(2);
      replenish = `${vat.name} 浓度衰减至 ${vat.concentration} g/L，建议补料 ${need} g/L`;
      vat.concentration = vat.initialConcentration; // 补料后恢复
    }

    const date = addDays(day0, dayCursor);
    const startHour = (slotCursor % SLOTS_PER_DAY) * HOURS_PER_SLOT + 8;

    // 与上一 slot 色系冲突检测
    const prev = lastSlotByVat.get(vat.id);
    if (prev && !conflict && colorFamilyOf(prev.replenish ?? order.colorTag) !== fam) {
      // 拼缸情况下不重复预警
    }
    if (prev && prev.date === date && colorFamilyOf(vat.colorTag) !== fam) {
      conflict = true;
      conflictReason = `与前一锅 ${prev.id} 色系冲突，换缸清洗不彻底会串色`;
    }

    if (existing) {
      existing.orderIds.push(order.id);
      if (replenish) existing.replenish = replenish;
    } else {
      const slot: VatSlot = {
        id: uid('slot'),
        vatId: vat.id,
        date,
        startHour,
        hours: HOURS_PER_SLOT,
        orderIds: [order.id],
        conflictRisk: conflict,
        conflictReason,
        replenish,
      };
      slots.push(slot);
      lastSlotByVat.set(vat.id, slot);
    }

    slotCursor++;
    if (slotCursor % (SLOTS_PER_DAY * vatState.length) === 0) dayCursor++;
    if (dayCursor >= HORIZON_DAYS) break;
  }

  return { vats: vatState, slots, updatedAt: Date.now() };
}

/** 急单插单：把订单优先级提到最高并重排，返回受影响订单 */
export function insertRushOrder(
  orders: OrderItem[],
  rush: OrderItem,
  vats: Vat[],
): { plan: ProductionPlan; affected: OrderItem[] } {
  const before = new Set(reschedule(orders, vats).slots.flatMap((s) => s.orderIds));
  const merged = orders.filter((o) => o.id !== rush.id);
  rush.priority = 99;
  merged.push(rush);
  const plan = reschedule(merged, vats);
  const after = new Set(plan.slots.flatMap((s) => s.orderIds));
  const affected = merged.filter((o) => before.has(o.id) && after.has(o.id) && o.id !== rush.id);
  // 简单判定位置变化：排在急单之后的都视为受影响
  const rushSlotIdx = plan.slots.findIndex((s) => s.orderIds.includes(rush.id));
  const affectedIds = new Set(plan.slots.slice(rushSlotIdx + 1).flatMap((s) => s.orderIds));
  return { plan, affected: affected.filter((o) => affectedIds.has(o.id)) };
}

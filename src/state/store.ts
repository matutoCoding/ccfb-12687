// 全局内存状态：当前项目/坯布/配方，统一从 IndexedDB 装载并持久化
import { getAll, get, put } from '../data/idb';
import { SEED_DYES, emptyTie, emptyWax, seedFabric, seedRecipe } from '../data/seed';
import type { Dye, Fabric, DesignProject, Recipe } from '../types';
import { uid } from '../util/math';

interface AppState {
  fabrics: Fabric[];
  recipes: Recipe[];
  dyes: Dye[];
  projects: DesignProject[];
  currentProjectId: string | null;
  currentFabricId: string | null;
}

class Store {
  state: AppState = {
    fabrics: [],
    recipes: [],
    dyes: [],
    projects: [],
    currentProjectId: null,
    currentFabricId: null,
  };
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async init(): Promise<void> {
    this.state.dyes = await getAll<Dye>('dyes');
    if (this.state.dyes.length === 0) {
      for (const d of SEED_DYES) await put('dyes', d);
      this.state.dyes = SEED_DYES;
    }
    this.state.fabrics = await getAll<Fabric>('fabrics');
    if (this.state.fabrics.length === 0) {
      const fab = seedFabric();
      await put('fabrics', fab);
      this.state.fabrics = [fab];
    }
    this.state.recipes = await getAll<Recipe>('recipes');
    if (this.state.recipes.length === 0) {
      const rec = seedRecipe();
      await put('recipes', rec);
      this.state.recipes = [rec];
    }
    this.state.projects = await getAll<DesignProject>('projects');
    if (this.state.projects.length === 0) {
      const project = this.createProjectDraft('示例花稿 · 三道靛蓝', this.state.fabrics[0].id, this.state.recipes[0].id);
      await put('projects', project);
      this.state.projects = [project];
      this.state.currentProjectId = project.id;
    }
    this.state.currentProjectId ??= this.state.projects[0]?.id ?? null;
    this.state.currentFabricId ??= this.state.fabrics[0]?.id ?? null;
  }

  createProjectDraft(name: string, fabricId: string, recipeId: string): DesignProject {
    return {
      id: uid('proj'),
      name,
      fabricId,
      tie: emptyTie(),
      wax: emptyWax(),
      recipeId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
      changeOrders: [],
    };
  }

  currentProject(): DesignProject | undefined {
    return this.state.projects.find((p) => p.id === this.state.currentProjectId);
  }

  currentFabric(): Fabric | undefined {
    return this.state.fabrics.find((f) => f.id === this.state.currentFabricId);
  }

  async saveProject(p: DesignProject): Promise<void> {
    p.updatedAt = Date.now();
    const idx = this.state.projects.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.state.projects[idx] = p;
    else this.state.projects.push(p);
    await put('projects', p);
    this.emit();
  }

  async saveFabric(f: Fabric): Promise<void> {
    const idx = this.state.fabrics.findIndex((x) => x.id === f.id);
    if (idx >= 0) this.state.fabrics[idx] = f;
    else this.state.fabrics.push(f);
    await put('fabrics', f);
    this.emit();
  }

  async saveRecipe(r: Recipe): Promise<void> {
    const idx = this.state.recipes.findIndex((x) => x.id === r.id);
    if (idx >= 0) this.state.recipes[idx] = r;
    else this.state.recipes.push(r);
    await put('recipes', r);
    this.emit();
  }

  dyeColor(dyeId: string | null): [number, number, number] {
    const dye = this.state.dyes.find((d) => d.id === dyeId) ?? this.state.dyes[0];
    return dye.rgb;
  }

  async refreshProjects(): Promise<void> {
    this.state.projects = await getAll<DesignProject>('projects');
    this.emit();
  }

  async getSim<T>(projectId: string): Promise<T | undefined> {
    return get<T>('sims', projectId);
  }
}

export const store = new Store();

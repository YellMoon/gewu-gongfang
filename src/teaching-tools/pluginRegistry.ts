// 插件注册中心 — 单例
import type { PluginManifest, PluginInstance, PluginStatus } from './plugin-api';

type StatusChangeListener = (id: string, status: PluginStatus, error?: string) => void;

class PluginRegistry {
  private static instance: PluginRegistry;
  private plugins: Map<string, PluginInstance> = new Map();
  private statusListeners: Set<StatusChangeListener> = new Set();

  private constructor() {}

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  /**
   * 注册一个插件
   * @param manifest 插件清单
   * @returns 注册成功返回 true，重复注册返回 false
   */
  registerPlugin(manifest: PluginManifest): boolean {
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginRegistry] 插件 "${manifest.id}" 已注册，跳过`);
      return false;
    }

    const instance: PluginInstance = {
      manifest,
      status: 'registered',
    };

    this.plugins.set(manifest.id, instance);
    console.log(`[PluginRegistry] 已注册插件: ${manifest.name} (${manifest.id}) v${manifest.version}`);
    this.notifyListeners(manifest.id, 'registered');
    return true;
  }

  /**
   * 批量注册多个插件
   * @param manifests 插件清单列表
   * @returns 成功注册的数量
   */
  registerPlugins(manifests: PluginManifest[]): number {
    let count = 0;
    for (const manifest of manifests) {
      if (this.registerPlugin(manifest)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取插件实例
   */
  getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  /**
   * 获取所有已注册的插件
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取所有已注册的插件清单
   */
  getAllManifests(): PluginManifest[] {
    return this.getAllPlugins().map(p => p.manifest);
  }

  /**
   * 获取特定类型的所有插件
   */
  getPluginsByType(type: PluginManifest['type']): PluginInstance[] {
    return this.getAllPlugins().filter(p => p.manifest.type === type);
  }

  /**
   * 更新插件状态
   */
  updateStatus(id: string, status: PluginStatus, error?: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    plugin.status = status;
    if (error) plugin.error = error;
    this.notifyListeners(id, status, error);
  }

  /**
   * 设置插件组件
   */
  setComponent(id: string, component: any): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    plugin.component = component;
  }

  /**
   * 卸载插件
   */
  unregisterPlugin(id: string): boolean {
    const removed = this.plugins.delete(id);
    if (removed) {
      console.log(`[PluginRegistry] 已卸载插件: ${id}`);
      this.notifyListeners(id, 'registered'); // deregister equivalent
    }
    return removed;
  }

  /**
   * 检查插件是否已注册
   */
  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * 获取插件数量
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * 监听插件状态变化
   */
  addStatusListener(listener: StatusChangeListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * 通知状态变化
   */
  private notifyListeners(id: string, status: PluginStatus, error?: string): void {
    this.statusListeners.forEach(listener => {
      try {
        listener(id, status, error);
      } catch (e) {
        console.error('[PluginRegistry] 状态监听器异常:', e);
      }
    });
  }

  /**
   * 清空所有插件
   */
  clear(): void {
    this.plugins.clear();
    console.log('[PluginRegistry] 已清空所有插件');
  }
}

export { PluginRegistry };
export default PluginRegistry.getInstance;

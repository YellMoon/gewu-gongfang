// 插件加载器 — 扫描、加载、管理教学工具插件
import type { PluginManifest, PluginInstance, PluginComponentProps } from './plugin-api';
import { PluginRegistry } from './pluginRegistry';

/**
 * 插件加载器
 *
 * 职责：
 * - 扫描 teaching-tools 目录下的插件
 * - 读取 manifest.json 并注册
 * - 按 manifest.entry 动态加载组件（react-component 类型）
 * - 提供加载成功/失败的回调
 */
class PluginLoader {
  private registry: PluginRegistry;
  private componentCache: Map<string, React.ComponentType<PluginComponentProps>> = new Map();

  constructor() {
    this.registry = PluginRegistry.getInstance();
  }

  /**
   * 扫描已知插件列表
   * 对每一个内置插件，解析其 manifest 并注册到注册中心
   *
   * @param knownPlugins 内置插件的 import 路径映射
   */
  async scanBuiltinPlugins(knownPlugins: Array<{
    id: string;
    manifest: () => Promise<PluginManifest>;
    component: () => Promise<any>;
  }>): Promise<{ registered: number; failed: number }> {
    let registered = 0;
    let failed = 0;

    for (const plugin of knownPlugins) {
      try {
        const manifest = await plugin.manifest();
        const ok = this.registry.registerPlugin(manifest);

        if (ok) {
          // 预加载 react-component 类型的组件
          if (manifest.type === 'react-component') {
            this.registry.updateStatus(manifest.id, 'loading');
            try {
              const mod = await plugin.component();
              const Component = mod.default || mod;
              this.registry.setComponent(manifest.id, Component);
              this.componentCache.set(manifest.id, Component);
              this.registry.updateStatus(manifest.id, 'loaded');
            } catch (err: any) {
              console.error(`[PluginLoader] 加载插件组件失败: ${manifest.id}`, err);
              this.registry.updateStatus(manifest.id, 'error', err.message || '组件加载失败');
              failed++;
              continue;
            }
          }
          registered++;
        }
      } catch (err: any) {
        console.error(`[PluginLoader] 扫描插件失败: ${plugin.id}`, err);
        failed++;
      }
    }

    return { registered, failed };
  }

  /**
   * 动态加载插件的 React 组件
   * @param id 插件 ID
   */
  async loadPluginComponent(id: string): Promise<React.ComponentType<PluginComponentProps> | null> {
    // 先检查缓存
    const cached = this.componentCache.get(id);
    if (cached) return cached;

    // 检查是否已注册但未加载组件
    const instance = this.registry.getPlugin(id);
    if (!instance) {
      console.warn(`[PluginLoader] 插件未注册: ${id}`);
      return null;
    }

    if (instance.status === 'error') {
      console.warn(`[PluginLoader] 插件异常: ${id}`, instance.error);
      return null;
    }

    return null;
  }

  /**
   * 获取插件组件的 React 组件
   * @param id 插件 ID
   */
  getComponent(id: string): React.ComponentType<PluginComponentProps> | undefined {
    return this.componentCache.get(id);
  }

  /**
   * 检查插件组件是否已加载
   */
  isComponentLoaded(id: string): boolean {
    return this.componentCache.has(id);
  }

  /**
   * 获取所有已加载组件的插件 ID 列表
   */
  getLoadedPluginIds(): string[] {
    return Array.from(this.componentCache.keys());
  }

  /**
   * 获取插件列表（已注册的）
   */
  getAllPlugins(): PluginInstance[] {
    return this.registry.getAllPlugins();
  }

  /**
   * 获取插件清单列表
   */
  getAllManifests(): PluginManifest[] {
    return this.registry.getAllManifests();
  }

  /**
   * 获取单个插件
   */
  getPlugin(id: string): PluginInstance | undefined {
    return this.registry.getPlugin(id);
  }

  /**
   * 获取插件清单
   */
  getManifest(id: string): PluginManifest | undefined {
    const instance = this.registry.getPlugin(id);
    return instance?.manifest;
  }

  /**
   * 注册单个插件（用于外部传入的 manifest）
   */
  registerPlugin(manifest: PluginManifest): boolean {
    return this.registry.registerPlugin(manifest);
  }

  /**
   * 清空缓存和注册信息
   */
  clear(): void {
    this.componentCache.clear();
    this.registry.clear();
  }
}

// 单例导出
const pluginLoader = new PluginLoader();
export { PluginLoader };
export default pluginLoader;

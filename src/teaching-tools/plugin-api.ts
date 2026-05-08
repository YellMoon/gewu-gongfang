// 插件 API 类型定义

/** 插件清单 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: 'react-component' | 'python' | 'wasm' | 'iframe';
  entry: string;
  icon?: string;
  description?: string;
  author?: string;
  parameters?: Record<string, any>;
  permissions?: string[];
  dataDependencies?: string[];
  platform?: {
    desktop?: boolean;
    miniprogram?: 'full' | 'readonly' | 'none';
    mobile?: boolean;
  };
  registryUrl?: string;
}

/** 插件参数配置项描述（用于动态渲染参数表单） */
export interface PluginParameterField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'slider';
  defaultValue?: any;
  options?: { label: string; value: any }[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

/** 插件状态 */
export type PluginStatus = 'registered' | 'loading' | 'loaded' | 'error';

/** 插件实例（运行时） */
export interface PluginInstance {
  manifest: PluginManifest;
  status: PluginStatus;
  component?: React.ComponentType<PluginComponentProps>;
  error?: string;
}

/** 插件组件接收的 props */
export interface PluginComponentProps {
  api: PluginAPI;
  params: Record<string, any>;
  onParamsChange: (params: Record<string, any>) => void;
}

// ============================================================
// PluginAPI — 宿主环境提供给插件的接口
// ============================================================

/** 数据查询结果 */
export interface QueryResult<T = any> {
  success: boolean;
  data: T[];
  total?: number;
  error?: string;
}

/** 数据变更结果 */
export interface MutateResult {
  success: boolean;
  affected?: number;
  error?: string;
}

/** 通知类型 */
export type NotificationType = 'success' | 'info' | 'warning' | 'error';

/** 文件过滤器 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** 文件接口 */
export interface FileInfo {
  name: string;
  path?: string;
  data?: ArrayBuffer;
  text?: string;
  size: number;
  type: string;
}

/** 导出表格列定义 */
export interface ExportColumn {
  title: string;
  dataIndex: string;
  width?: number;
}

/**
 * 插件 API — 宿主暴露给插件的功能接口
 *
 * 使用方式：
 * ```tsx
 * const MyPlugin: React.FC<{ api: PluginAPI }> = ({ api }) => {
 *   useEffect(() => {
 *     api.data.query('students', {}).then(result => { ... });
 *   }, []);
 *
 *   const handleExport = () => {
 *     api.platform.exportExcel(data, columns, '导出文件.xlsx');
 *   };
 * };
 * ```
 */
export interface PluginAPI {
  /** 数据访问层 */
  data: {
    /**
     * 查询数据集合
     * @param collection 集合名称（students/grades/courses/schedules/questions/knowledgeTree/payments/consumptions/institutions/teachers/rooms）
     * @param filter 查询过滤条件
     */
    query(collection: string, filter?: Record<string, any>): Promise<QueryResult>;

    /**
     * 修改数据
     * @param collection 集合名称
     * @param action 操作类型：add / update / delete
     * @param data 操作数据
     */
    mutate(collection: string, action: 'add' | 'update' | 'delete', data: any): Promise<MutateResult>;
  };

  /** 平台能力层 */
  platform: {
    /**
     * 打开文件选择对话框
     * @param filter 文件类型过滤器
     */
    openFile(filter?: FileFilter): Promise<FileInfo | null>;

    /**
     * 保存文件
     * @param data 文件数据
     * @param name 文件名
     */
    saveFile(data: ArrayBuffer | string, name: string): Promise<void>;

    /**
     * 显示通知
     * @param message 通知内容
     * @param type 通知类型
     */
    notify(message: string, type?: NotificationType): void;

    /**
     * 导出 Excel
     * @param data 数据行
     * @param columns 列定义
     * @param filename 导出文件名
     */
    exportExcel(data: Record<string, any>[], columns: ExportColumn[], filename: string): void;
  };

  /** 在线状态同步 */
  sync: {
    /** 当前是否在线 */
    isOnline(): boolean;

    /**
     * 监听在线状态变化
     * @param callback 回调函数
     * @returns 取消监听的函数
     */
    onOnlineChange(callback: (online: boolean) => void): () => void;
  };
}

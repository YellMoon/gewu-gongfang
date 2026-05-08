/**
 * 操作日志记录器 - 全局事件记录
 * 所有页面通过 window.operateLogger 访问
 */
import { v4 as uuid } from 'uuid';

export interface OperateLogEntry {
  id: string;
  timestamp: string;
  user: string;
  actionType: string;
  detail: string;
  source: string;
}

const STORAGE_KEY = 'operate_log_geworks';
const MAX_LOG_COUNT = 500;

class OperateLogger {
  private logs: OperateLogEntry[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch {
      this.logs = [];
    }
  }

  private saveToStorage(): void {
    try {
      // 只保留最新的 MAX_LOG_COUNT 条
      if (this.logs.length > MAX_LOG_COUNT) {
        this.logs = this.logs.slice(0, MAX_LOG_COUNT);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch {
      // localStorage 满时忽略
    }
  }

  getAll(): OperateLogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
    this.saveToStorage();
  }

  /**
   * 记录一条操作日志
   */
  log(actionType: string, detail: string, source?: string): OperateLogEntry {
    const entry: OperateLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      user: this.getCurrentUser(),
      actionType,
      detail,
      source: source || '127.0.0.1',
    };

    this.logs.unshift(entry);
    this.saveToStorage();
    return entry;
  }

  private getCurrentUser(): string {
    // 从 localStorage 获取当前用户，或者从 dbService 的登录状态获取
    try {
      const db = (window as any).dbService;
      if (db && db.getCurrentUser) {
        const user = db.getCurrentUser();
        if (user) return user.name || user.username || '管理员';
      }
    } catch {
      // ignore
    }
    // 尝试从 localStorage 读取
    try {
      const loginInfo = localStorage.getItem('geworks_login_info');
      if (loginInfo) {
        const info = JSON.parse(loginInfo);
        return info.username || info.name || '管理员';
      }
    } catch {
      // ignore
    }
    return '管理员';
  }
}

// 全局实例
const logger = new OperateLogger();

// 挂载到 window 供全局使用
if (typeof window !== 'undefined') {
  (window as any).operateLogger = logger;
}

export default logger;

import type { PageKey } from './appNavigation';

export type CourseCalendarContext = {
  date?: string;
  scheduleId?: string;
  highlightToday?: boolean;
};

export type RevenueStatisticsContext = {
  mode?: 'arrears' | 'closed-balance';
};

export type QuestionBankToolsContext = {
  mode?: 'problem-questions';
};

export type CloudSyncContext = {
  mode?: 'issues' | 'pending';
  section?: 'sync-settings';
};

export type NavigationContext =
  | CourseCalendarContext
  | RevenueStatisticsContext
  | QuestionBankToolsContext
  | CloudSyncContext
  | undefined;

export type NavigationTarget = {
  page: PageKey;
  context?: NavigationContext;
};

export type NavigationInput = PageKey | NavigationTarget;

export function normalizeNavigationTarget(input: NavigationInput): NavigationTarget {
  const target = typeof input === 'string' ? { page: input } : input;
  if (target.page === 'cloud-sync') {
    return {
      page: 'system-params',
      context: {
        ...(typeof target.context === 'object' ? target.context : {}),
        section: 'sync-settings',
      } as CloudSyncContext,
    };
  }
  return target;
}

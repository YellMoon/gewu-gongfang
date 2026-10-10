import type { PageKey } from './appNavigation';

export type CourseCalendarContext = {
  date?: string;
  scheduleId?: string;
  highlightToday?: boolean;
};

export type RevenueStatisticsContext = {
  mode?: 'arrears' | 'closed-balance';
};

export type QuestionBankPreviewContext = { questionId?: string; questionIds?: string[] };

export type QuestionBankToolsContext = {
  mode?: 'problem-questions';
};

export type CloudSyncContext = {
  mode?: 'issues' | 'pending';
  section?: 'sync-settings';
};

export type MyAccountContext = { section?: 'devices' | 'software-update' };

export type NavigationContext =
  | CourseCalendarContext
  | RevenueStatisticsContext
  | QuestionBankPreviewContext
  | QuestionBankToolsContext
  | CloudSyncContext
  | MyAccountContext
  | undefined;

export type NavigationTarget = {
  page: PageKey;
  context?: NavigationContext;
};

export type NavigationInput = PageKey | NavigationTarget;

export function normalizeNavigationTarget(input: NavigationInput): NavigationTarget {
  const target = typeof input === 'string' ? { page: input } : input;
  if (target.page === 'system-params' || target.page === 'identity-devices') {
    return {
      page: 'my-account',
      context: {
        ...(typeof target.context === 'object' ? target.context : {}),
        section: target.page === 'identity-devices' ? 'devices' : 'software-update',
      } as MyAccountContext,
    };
  }
  return target;
}

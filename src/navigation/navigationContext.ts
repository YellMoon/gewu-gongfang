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
  return typeof input === 'string' ? { page: input } : input;
}

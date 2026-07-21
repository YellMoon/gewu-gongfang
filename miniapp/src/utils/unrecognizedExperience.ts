import { api } from './api';

export interface UnrecognizedQuestion {
  id: string;
  number: number;
  type: string;
  stemRichContent: any;
  options: Array<{
    key: string;
    contentRichContent: any;
  }>;
  answer: string;
  explanationRichContent: any;
  sourceLabel: string;
}

export interface UnrecognizedTask {
  id: string;
  status: string;
  phase: string;
  progress: number;
  createdAt: string;
  expiresAt: string;
  request: any;
  result: any;
  error: string | null;
}

export interface UnrecognizedSession {
  token: string;
  userId: string;
  sessionId: string;
  accountState: string;
}

export const unrecognizedExperienceApi = {
  async getQuestions(): Promise<UnrecognizedQuestion[]> {
    const res = await api.get<any>('/api/experience/questions');
    if (!res.success) throw new Error(res.error || 'Failed to get questions');
    return res.data.questions;
  },

  async createTask(params: {
    taskType: string;
    title: string;
    questionIds: string[];
    answerPosition?: string;
    formulaMode?: string;
  }): Promise<UnrecognizedTask> {
    const res = await api.post<any>('/api/experience/tasks', params);
    if (!res.success) throw new Error(res.error || 'Failed to create task');
    return res.data.task;
  },

  async getTask(taskId: string): Promise<UnrecognizedTask> {
    const res = await api.get<any>(`/api/experience/tasks/${taskId}`);
    if (!res.success) throw new Error(res.error || 'Failed to get task');
    return res.data.task;
  },

  async downloadArtifact(taskId: string, artifactId: string): Promise<string> {
    const res = await api.get<any>(`/api/experience/tasks/${taskId}/artifacts/${artifactId}`);
    if (!res.success) throw new Error(res.error || 'Failed to download artifact');
    return res.data.downloadUrl;
  },

  async cancelTask(taskId: string): Promise<void> {
    const res = await api.post<any>(`/api/experience/tasks/${taskId}/cancel`);
    if (!res.success) throw new Error(res.error || 'Failed to cancel task');
  },

  async submitApplication(params: {
    type: 'student' | 'teacher';
    name: string;
    phone: string;
    school?: string;
    grade?: string;
    parentRole?: string;
    parentPhone?: string;
    subject?: string;
    notes?: string;
  }): Promise<{ applicationId: string; status: string }> {
    const res = await api.post<any>('/api/experience/apply', params);
    if (!res.success) throw new Error(res.error || 'Failed to submit application');
    return res.data;
  },

  async getApplicationStatus(): Promise<{
    hasApplication: boolean;
    status?: string;
    type?: string;
    createdAt?: string;
    reviewedAt?: string;
    reviewNote?: string;
  }> {
    const res = await api.get<any>('/api/experience/application/status');
    if (!res.success) throw new Error(res.error || 'Failed to get application status');
    return res.data;
  },
};

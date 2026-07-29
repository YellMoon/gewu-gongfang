import { applicationApi, experienceApi } from './api';

export interface UnrecognizedQuestion {
  id: string;
  number: number;
  type: string;
  stemRichContent: any;
  options: Array<{ key: string; contentRichContent: any }>;
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

function requireSuccess(response: any, fallback: string): any {
  if (!response?.success) throw new Error(response?.error || fallback);
  return response;
}

export const unrecognizedExperienceApi = {
  async getQuestions(): Promise<UnrecognizedQuestion[]> {
    const response: any = requireSuccess(await experienceApi.questions(), 'Failed to get questions');
    return response.questions || response.data?.questions || [];
  },

  async createTask(params: {
    taskType: string;
    title: string;
    questionIds: string[];
    answerPosition?: string;
    formulaMode?: string;
  }): Promise<UnrecognizedTask> {
    const { taskType, ...payload } = params;
    const response: any = requireSuccess(await experienceApi.createTask(taskType, payload), 'Failed to create task');
    return response.task || response.data?.task;
  },

  async getTask(taskId: string): Promise<UnrecognizedTask> {
    const response: any = requireSuccess(await experienceApi.getTaskResult(taskId), 'Failed to get task');
    return response.task || response.data?.task;
  },

  downloadArtifact(artifactId: string): Promise<any> {
    return experienceApi.downloadArtifact(artifactId);
  },

  async cancelTask(taskId: string): Promise<UnrecognizedTask> {
    const response: any = requireSuccess(await experienceApi.cancelTask(taskId), 'Failed to cancel task');
    return response.task || response.data?.task;
  },

  async submitApplication(applicationType: 'student' | 'teacher', payload: any, idempotencyKey: string): Promise<any> {
    const response: any = requireSuccess(
      await applicationApi.submit({
        requestedRole: applicationType,
        bindingHint: String(payload?.bindingHint || payload?.profileId || '').trim() || undefined,
      }, idempotencyKey),
      'Failed to submit application',
    );
    return response.data || response;
  },

  async getApplicationStatus(): Promise<any> {
    const response: any = requireSuccess(await applicationApi.mine(), 'Failed to get application status');
    return response.data || response;
  },

};

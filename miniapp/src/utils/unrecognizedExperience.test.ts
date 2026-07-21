import { unrecognizedExperienceApi } from './unrecognizedExperience';

// Mock api
jest.mock('./api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('unrecognizedExperienceApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getQuestions returns questions list', async () => {
    const mockQuestions = [
      {
        id: 'test-1',
        number: 1,
        type: 'single-choice',
        stemRichContent: {},
        options: [],
        answer: 'A',
        explanationRichContent: {},
        sourceLabel: '示例题',
      },
    ];

    (require('./api').api.get as jest.Mock).mockResolvedValue({
      success: true,
      data: { questions: mockQuestions },
    });

    const questions = await unrecognizedExperienceApi.getQuestions();
    expect(questions).toEqual(mockQuestions);
  });

  it('createTask returns task', async () => {
    const mockTask = {
      id: 'task-1',
      status: 'queued',
      phase: 'queued',
      progress: 0,
      createdAt: '2026-07-20T00:00:00.000Z',
      expiresAt: '2026-07-20T01:00:00.000Z',
      request: {},
      result: null,
      error: null,
    };

    (require('./api').api.post as jest.Mock).mockResolvedValue({
      success: true,
      data: { task: mockTask },
    });

    const task = await unrecognizedExperienceApi.createTask({
      taskType: 'question-paper',
      title: '测试试卷',
      questionIds: ['test-1'],
    });

    expect(task).toEqual(mockTask);
  });

  it('getApplicationStatus returns status', async () => {
    const mockStatus = {
      hasApplication: true,
      status: 'pending',
      type: 'student',
      createdAt: '2026-07-20T00:00:00.000Z',
    };

    (require('./api').api.get as jest.Mock).mockResolvedValue({
      success: true,
      data: mockStatus,
    });

    const status = await unrecognizedExperienceApi.getApplicationStatus();
    expect(status).toEqual(mockStatus);
  });

  it('submitApplication returns result', async () => {
    const mockResult = {
      applicationId: 'app-1',
      status: 'pending',
    };

    (require('./api').api.post as jest.Mock).mockResolvedValue({
      success: true,
      data: mockResult,
    });

    const result = await unrecognizedExperienceApi.submitApplication({
      type: 'student',
      name: '测试学生',
      phone: '13800138000',
      school: '测试学校',
      grade: '高一',
      parentRole: '爸爸',
      parentPhone: '13800138001',
    });

    expect(result).toEqual(mockResult);
  });

  it('throws error when API fails', async () => {
    (require('./api').api.get as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Network error',
    });

    await expect(unrecognizedExperienceApi.getQuestions()).rejects.toThrow('Network error');
  });
});

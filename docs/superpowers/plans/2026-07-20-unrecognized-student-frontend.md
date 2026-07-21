# 未认可学生前端UI实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现未认可学生的前端UI，包括登录流程、申请页面、示例题展示和会员标记

**Architecture:** 修改现有登录页面，添加未认可学生专属页面，集成后端未认可体验API，实现隔离的示例题浏览和组卷功能

**Tech Stack:** Taro (React语法)、TypeScript、微信小程序

---

## 文件结构

### 新建文件
- `miniapp/src/pages/unrecognized-apply/index.tsx` - 未认可学生申请页面
- `miniapp/src/pages/unrecognized-apply/index.scss` - 申请页面样式
- `miniapp/src/pages/unrecognized-status/index.tsx` - 申请状态页面
- `miniapp/src/pages/unrecognized-status/index.scss` - 状态页面样式
- `miniapp/src/pages/unrecognized-experience/index.tsx` - 示例题体验页面
- `miniapp/src/pages/unrecognized-experience/index.scss` - 体验页面样式
- `miniapp/src/utils/unrecognizedExperience.ts` - 未认可体验API封装

### 修改文件
- `miniapp/src/app.config.ts` - 注册新页面
- `miniapp/src/pages/login/index.tsx` - 修改登录流程
- `miniapp/src/pages/login/index.scss` - 更新登录样式
- `miniapp/src/pages/index/index.tsx` - 添加未认可学生首页入口
- `miniapp/src/pages/question-bank/index.tsx` - 添加示例题入口
- `miniapp/src/utils/api.ts` - 添加未认可体验API

---

### Task 1: 创建未认可体验API封装

**Files:**
- Create: `miniapp/src/utils/unrecognizedExperience.ts`
- Test: `miniapp/src/utils/unrecognizedExperience.test.ts`

- [ ] **Step 1: 创建API封装文件**

```typescript
// miniapp/src/utils/unrecognizedExperience.ts
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
  // 获取示例题列表
  async getQuestions(): Promise<UnrecognizedQuestion[]> {
    const res = await api.get<any>('/api/experience/questions');
    if (!res.success) throw new Error(res.error || 'Failed to get questions');
    return res.data.questions;
  },

  // 创建组卷任务
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

  // 获取任务状态
  async getTask(taskId: string): Promise<UnrecognizedTask> {
    const res = await api.get<any>(`/api/experience/tasks/${taskId}`);
    if (!res.success) throw new Error(res.error || 'Failed to get task');
    return res.data.task;
  },

  // 下载产物
  async downloadArtifact(taskId: string, artifactId: string): Promise<string> {
    const res = await api.get<any>(`/api/experience/tasks/${taskId}/artifacts/${artifactId}`);
    if (!res.success) throw new Error(res.error || 'Failed to download artifact');
    return res.data.downloadUrl;
  },

  // 取消任务
  async cancelTask(taskId: string): Promise<void> {
    const res = await api.post<any>(`/api/experience/tasks/${taskId}/cancel`);
    if (!res.success) throw new Error(res.error || 'Failed to cancel task');
  },

  // 提交申请
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

  // 获取申请状态
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
```

- [ ] **Step 2: 创建测试文件**

```typescript
// miniapp/src/utils/unrecognizedExperience.test.ts
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
});
```

- [ ] **Step 3: 运行测试验证**

Run: `cd miniapp && npm test -- --testPathPattern=unrecognizedExperience`
Expected: PASS

- [ ] **Step 4: 提交代码**

```bash
git add miniapp/src/utils/unrecognizedExperience.ts miniapp/src/utils/unrecognizedExperience.test.ts
git commit -m "feat(miniapp): add unrecognized experience API wrapper"
```

---

### Task 2: 修改登录页面支持未认可学生

**Files:**
- Modify: `miniapp/src/pages/login/index.tsx:63-100`
- Modify: `miniapp/src/pages/login/index.scss`

- [ ] **Step 1: 修改登录页面逻辑**

在`miniapp/src/pages/login/index.tsx`中，修改`requestWxLogin`函数，添加未认可学生处理：

```typescript
// 在requestWxLogin函数中添加未认可学生处理
} else if (res.code === 'UNRECOGNIZED_STUDENT') {
  // 未认可学生，跳转到体验页面
  Taro.setStorageSync('unrecognized_session', {
    token: res.data.token,
    userId: res.data.userId,
    sessionId: res.data.sessionId,
    accountState: 'unrecognized',
  });
  Taro.reLaunch({ url: '/pages/unrecognized-experience/index' });
}
```

- [ ] **Step 2: 添加未认可学生登录按钮**

在登录页面添加"体验账号"按钮：

```tsx
// 在登录页面添加体验入口
<View className="experience-entry">
  <Button
    className="experience-btn"
    onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-experience/index' })}
  >
    体验账号
  </Button>
  <Text className="experience-hint">无需注册，立即体验基础功能</Text>
</View>
```

- [ ] **Step 3: 更新登录页面样式**

```scss
// miniapp/src/pages/login/index.scss
.experience-entry {
  margin-top: 40rpx;
  text-align: center;
}

.experience-btn {
  background: #f5f5f5;
  color: #666;
  border: 1rpx solid #ddd;
  border-radius: 40rpx;
  font-size: 28rpx;
  padding: 16rpx 40rpx;
}

.experience-hint {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #999;
}
```

- [ ] **Step 4: 测试登录流程**

Run: `cd miniapp && npm run dev:weapp`
Expected: 登录页面显示体验入口，点击跳转到体验页面

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/login/index.tsx miniapp/src/pages/login/index.scss
git commit -m "feat(miniapp): add unrecognized student login entry"
```

---

### Task 3: 创建未认可学生体验页面

**Files:**
- Create: `miniapp/src/pages/unrecognized-experience/index.tsx`
- Create: `miniapp/src/pages/unrecognized-experience/index.scss`
- Modify: `miniapp/src/app.config.ts`

- [ ] **Step 1: 注册新页面**

在`miniapp/src/app.config.ts`的pages数组中添加：

```typescript
'pages/unrecognized-experience/index',
```

- [ ] **Step 2: 创建体验页面**

```tsx
// miniapp/src/pages/unrecognized-experience/index.tsx
import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button, Checkbox, CheckboxGroup } from '@tarojs/components';
import { unrecognizedExperienceApi, UnrecognizedQuestion } from '../../utils/unrecognizedExperience';
import './index.scss';

export default function UnrecognizedExperiencePage() {
  const [questions, setQuestions] = useState<UnrecognizedQuestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const data = await unrecognizedExperienceApi.getQuestions();
      setQuestions(data);
      // 默认全选
      setSelectedIds(data.map(q => q.id));
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const handleCreateTask = async () => {
    if (selectedIds.length === 0) {
      Taro.showToast({ title: '请至少选择一道题目', icon: 'none' });
      return;
    }

    try {
      setCreating(true);
      const task = await unrecognizedExperienceApi.createTask({
        taskType: 'question-paper',
        title: '体验试卷',
        questionIds: selectedIds,
        answerPosition: 'end',
        formulaMode: 'word-native',
      });

      Taro.showToast({ title: '任务创建成功', icon: 'success' });
      
      // 轮询任务状态
      pollTaskStatus(task.id);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '创建失败', icon: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const pollTaskStatus = async (taskId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const poll = async () => {
      try {
        const task = await unrecognizedExperienceApi.getTask(taskId);
        
        if (task.status === 'completed') {
          Taro.showToast({ title: '生成完成', icon: 'success' });
          // 这里可以添加下载逻辑
        } else if (task.status === 'failed') {
          Taro.showToast({ title: task.error || '生成失败', icon: 'error' });
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 2000);
        }
      } catch (err) {
        console.error('Poll task status error:', err);
      }
    };

    poll();
  };

  if (loading) {
    return (
      <View className="experience-page">
        <View className="loading">加载中...</View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="experience-page">
        <View className="error">
          <Text>{error}</Text>
          <Button onClick={loadQuestions}>重试</Button>
        </View>
      </View>
    );
  }

  return (
    <View className="experience-page">
      <View className="header">
        <Text className="title">体验题库</Text>
        <Text className="subtitle">以下为固定示例题，不属于正式题库</Text>
      </View>

      <View className="question-list">
        {questions.map(question => (
          <View 
            key={question.id} 
            className={`question-item ${selectedIds.includes(question.id) ? 'selected' : ''}`}
            onClick={() => handleSelect(question.id)}
          >
            <CheckboxGroup>
              <Checkbox 
                value={question.id} 
                checked={selectedIds.includes(question.id)}
              />
            </CheckboxGroup>
            <View className="question-content">
              <Text className="question-number">第{question.number}题</Text>
              <Text className="question-type">{question.type === 'single-choice' ? '单选题' : '多选题'}</Text>
            </View>
          </View>
        ))}
      </View>

      <View className="footer">
        <Text className="selected-count">已选择 {selectedIds.length} 道题目</Text>
        <Button 
          className="create-btn"
          disabled={selectedIds.length === 0 || creating}
          onClick={handleCreateTask}
        >
          {creating ? '创建中...' : '生成试卷'}
        </Button>
      </View>

      <View className="apply-entry">
        <Text className="apply-text">想要使用完整功能？</Text>
        <Button 
          className="apply-btn"
          onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-apply/index' })}
        >
          申请正式账号
        </Button>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: 创建页面样式**

```scss
// miniapp/src/pages/unrecognized-experience/index.scss
.experience-page {
  min-height: 100vh;
  background: #f7f4ee;
  padding: 32rpx;
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}

.loading, .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400rpx;
  color: #666;
}

.header {
  margin-bottom: 32rpx;
}

.title {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 8rpx;
}

.subtitle {
  display: block;
  font-size: 24rpx;
  color: #999;
}

.question-list {
  background: white;
  border-radius: 16rpx;
  overflow: hidden;
}

.question-item {
  display: flex;
  align-items: center;
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  
  &.selected {
    background: #f8f9fa;
  }
  
  &:last-child {
    border-bottom: none;
  }
}

.question-content {
  margin-left: 16rpx;
  flex: 1;
}

.question-number {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 4rpx;
}

.question-type {
  display: block;
  font-size: 24rpx;
  color: #999;
}

.footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  padding: 16rpx 32rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.selected-count {
  font-size: 26rpx;
  color: #666;
}

.create-btn {
  background: #1f6f68;
  color: white;
  border-radius: 40rpx;
  font-size: 28rpx;
  padding: 16rpx 40rpx;
  
  &[disabled] {
    background: #ccc;
  }
}

.apply-entry {
  margin-top: 32rpx;
  text-align: center;
  padding: 32rpx;
  background: white;
  border-radius: 16rpx;
}

.apply-text {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 16rpx;
}

.apply-btn {
  background: transparent;
  color: #1f6f68;
  border: 1rpx solid #1f6f68;
  border-radius: 40rpx;
  font-size: 28rpx;
}
```

- [ ] **Step 4: 测试页面功能**

Run: `cd miniapp && npm run dev:weapp`
Expected: 
1. 登录页面显示"体验账号"按钮
2. 点击跳转到体验页面
3. 显示示例题列表
4. 可以选择题目并生成试卷

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/unrecognized-experience/ miniapp/src/app.config.ts
git commit -m "feat(miniapp): add unrecognized experience page"
```

---

### Task 4: 创建申请页面

**Files:**
- Create: `miniapp/src/pages/unrecognized-apply/index.tsx`
- Create: `miniapp/src/pages/unrecognized-apply/index.scss`
- Modify: `miniapp/src/app.config.ts`

- [ ] **Step 1: 注册新页面**

在`miniapp/src/app.config.ts`的pages数组中添加：

```typescript
'pages/unrecognized-apply/index',
```

- [ ] **Step 2: 创建申请页面**

```tsx
// miniapp/src/pages/unrecognized-apply/index.tsx
import { useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, Picker, Button } from '@tarojs/components';
import { unrecognizedExperienceApi } from '../../utils/unrecognizedExperience';
import './index.scss';

const GRADE_OPTIONS = ['高一', '高二', '高三', '高复'];
const PARENT_ROLE_OPTIONS = ['爸爸', '妈妈'];

export default function UnrecognizedApplyPage() {
  const [type, setType] = useState<'student' | 'teacher'>('student');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [school, setSchool] = useState('');
  const [gradeIndex, setGradeIndex] = useState(0);
  const [parentRoleIndex, setParentRoleIndex] = useState(0);
  const [parentPhone, setParentPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    if (!phone.trim() || !/^1\d{10}$/.test(phone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    if (type === 'student') {
      if (!school.trim()) {
        Taro.showToast({ title: '请输入学校', icon: 'none' });
        return;
      }
      if (!parentPhone.trim() || !/^1\d{10}$/.test(parentPhone)) {
        Taro.showToast({ title: '请输入正确的家长手机号', icon: 'none' });
        return;
      }
      if (phone === parentPhone) {
        Taro.showToast({ title: '学生手机号和家长手机号不能相同', icon: 'none' });
        return;
      }
    }

    if (type === 'teacher' && !subject.trim()) {
      Taro.showToast({ title: '请输入科目', icon: 'none' });
      return;
    }

    try {
      setLoading(true);
      await unrecognizedExperienceApi.submitApplication({
        type,
        name: name.trim(),
        phone: phone.trim(),
        school: type === 'student' ? school.trim() : undefined,
        grade: type === 'student' ? GRADE_OPTIONS[gradeIndex] : undefined,
        parentRole: type === 'student' ? PARENT_ROLE_OPTIONS[parentRoleIndex] : undefined,
        parentPhone: type === 'student' ? parentPhone.trim() : undefined,
        subject: type === 'teacher' ? subject.trim() : undefined,
        notes: notes.trim() || undefined,
      });

      Taro.showToast({ title: '申请提交成功', icon: 'success' });
      setTimeout(() => {
        Taro.navigateTo({ url: '/pages/unrecognized-status/index' });
      }, 1500);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '提交失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="apply-page">
      <View className="header">
        <Text className="title">申请正式账号</Text>
        <Text className="subtitle">提交申请后等待管理员审核</Text>
      </View>

      <View className="type-switch">
        <Button 
          className={`type-btn ${type === 'student' ? 'active' : ''}`}
          onClick={() => setType('student')}
        >
          学生
        </Button>
        <Button 
          className={`type-btn ${type === 'teacher' ? 'active' : ''}`}
          onClick={() => setType('teacher')}
        >
          老师
        </Button>
      </View>

      <View className="form">
        <View className="form-item">
          <Text className="label">姓名 *</Text>
          <Input 
            className="input"
            placeholder="请输入姓名"
            value={name}
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <View className="form-item">
          <Text className="label">手机号 *</Text>
          <Input 
            className="input"
            type="number"
            placeholder="请输入手机号"
            value={phone}
            onInput={(e) => setPhone(e.detail.value)}
          />
        </View>

        {type === 'student' && (
          <>
            <View className="form-item">
              <Text className="label">学校 *</Text>
              <Input 
                className="input"
                placeholder="请输入学校名称"
                value={school}
                onInput={(e) => setSchool(e.detail.value)}
              />
            </View>

            <View className="form-item">
              <Text className="label">当前年级 *</Text>
              <Picker 
                mode="selector" 
                range={GRADE_OPTIONS}
                value={gradeIndex}
                onChange={(e) => setGradeIndex(Number(e.detail.value))}
              >
                <View className="picker">
                  <Text>{GRADE_OPTIONS[gradeIndex]}</Text>
                  <Text className="arrow">▼</Text>
                </View>
              </Picker>
            </View>

            <View className="form-item">
              <Text className="label">家长角色 *</Text>
              <Picker 
                mode="selector" 
                range={PARENT_ROLE_OPTIONS}
                value={parentRoleIndex}
                onChange={(e) => setParentRoleIndex(Number(e.detail.value))}
              >
                <View className="picker">
                  <Text>{PARENT_ROLE_OPTIONS[parentRoleIndex]}</Text>
                  <Text className="arrow">▼</Text>
                </View>
              </Picker>
            </View>

            <View className="form-item">
              <Text className="label">家长手机号 *</Text>
              <Input 
                className="input"
                type="number"
                placeholder="请输入家长手机号"
                value={parentPhone}
                onInput={(e) => setParentPhone(e.detail.value)}
              />
            </View>
          </>
        )}

        {type === 'teacher' && (
          <View className="form-item">
            <Text className="label">科目 *</Text>
            <Input 
              className="input"
              placeholder="请输入科目（如：物理）"
              value={subject}
              onInput={(e) => setSubject(e.detail.value)}
            />
          </View>
        )}

        <View className="form-item">
          <Text className="label">备注</Text>
          <Input 
            className="input"
            placeholder="选填"
            value={notes}
            onInput={(e) => setNotes(e.detail.value)}
          />
        </View>
      </View>

      <Button 
        className="submit-btn"
        disabled={loading}
        onClick={handleSubmit}
      >
        {loading ? '提交中...' : '提交申请'}
      </Button>
    </View>
  );
}
```

- [ ] **Step 3: 创建页面样式**

```scss
// miniapp/src/pages/unrecognized-apply/index.scss
.apply-page {
  min-height: 100vh;
  background: #f7f4ee;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.header {
  margin-bottom: 32rpx;
}

.title {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 8rpx;
}

.subtitle {
  display: block;
  font-size: 24rpx;
  color: #999;
}

.type-switch {
  display: flex;
  margin-bottom: 32rpx;
  background: white;
  border-radius: 12rpx;
  overflow: hidden;
}

.type-btn {
  flex: 1;
  background: white;
  color: #666;
  border-radius: 0;
  font-size: 28rpx;
  padding: 20rpx;
  
  &.active {
    background: #1f6f68;
    color: white;
  }
  
  &::after {
    border: none;
  }
}

.form {
  background: white;
  border-radius: 16rpx;
  overflow: hidden;
}

.form-item {
  display: flex;
  align-items: center;
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  
  &:last-child {
    border-bottom: none;
  }
}

.label {
  width: 160rpx;
  font-size: 28rpx;
  color: #333;
}

.input {
  flex: 1;
  font-size: 28rpx;
}

.picker {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 28rpx;
}

.arrow {
  font-size: 24rpx;
  color: #999;
}

.submit-btn {
  margin-top: 32rpx;
  background: #1f6f68;
  color: white;
  border-radius: 40rpx;
  font-size: 32rpx;
  padding: 24rpx;
  
  &[disabled] {
    background: #ccc;
  }
}
```

- [ ] **Step 4: 测试申请流程**

Run: `cd miniapp && npm run dev:weapp`
Expected:
1. 体验页面显示"申请正式账号"按钮
2. 点击跳转到申请页面
3. 可以切换学生/老师类型
4. 填写表单并提交
5. 提交成功后跳转到状态页面

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/unrecognized-apply/ miniapp/src/app.config.ts
git commit -m "feat(miniapp): add unrecognized student application page"
```

---

### Task 5: 创建申请状态页面

**Files:**
- Create: `miniapp/src/pages/unrecognized-status/index.tsx`
- Create: `miniapp/src/pages/unrecognized-status/index.scss`
- Modify: `miniapp/src/app.config.ts`

- [ ] **Step 1: 注册新页面**

在`miniapp/src/app.config.ts`的pages数组中添加：

```typescript
'pages/unrecognized-status/index',
```

- [ ] **Step 2: 创建状态页面**

```tsx
// miniapp/src/pages/unrecognized-status/index.tsx
import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { unrecognizedExperienceApi } from '../../utils/unrecognizedExperience';
import './index.scss';

export default function UnrecognizedStatusPage() {
  const [status, setStatus] = useState<{
    hasApplication: boolean;
    status?: string;
    type?: string;
    createdAt?: string;
    reviewedAt?: string;
    reviewNote?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await unrecognizedExperienceApi.getApplicationStatus();
      setStatus(data);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '加载失败', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View className="status-page">
        <View className="loading">加载中...</View>
      </View>
    );
  }

  if (!status?.hasApplication) {
    return (
      <View className="status-page">
        <View className="empty">
          <Text className="empty-text">暂无申请记录</Text>
          <Button 
            className="apply-btn"
            onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-apply/index' })}
          >
            立即申请
          </Button>
        </View>
      </View>
    );
  }

  const getStatusInfo = () => {
    switch (status.status) {
      case 'pending':
        return {
          text: '审核中',
          color: '#faad14',
          icon: '⏳',
          description: '您的申请正在审核中，请耐心等待',
        };
      case 'approved':
        return {
          text: '已通过',
          color: '#52c41a',
          icon: '✅',
          description: '恭喜！您的申请已通过，请重新登录使用正式账号',
        };
      case 'rejected':
        return {
          text: '已拒绝',
          color: '#ff4d4f',
          icon: '❌',
          description: status.reviewNote || '您的申请未通过审核',
        };
      default:
        return {
          text: '未知状态',
          color: '#999',
          icon: '❓',
          description: '请稍后重试',
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <View className="status-page">
      <View className="status-card">
        <View className="status-icon">{statusInfo.icon}</View>
        <View className="status-text" style={{ color: statusInfo.color }}>
          {statusInfo.text}
        </View>
        <View className="status-description">{statusInfo.description}</View>
      </View>

      <View className="info-card">
        <View className="info-item">
          <Text className="info-label">申请类型</Text>
          <Text className="info-value">{status.type === 'student' ? '学生' : '老师'}</Text>
        </View>
        <View className="info-item">
          <Text className="info-label">申请时间</Text>
          <Text className="info-value">
            {status.createdAt ? new Date(status.createdAt).toLocaleString() : '-'}
          </Text>
        </View>
        {status.reviewedAt && (
          <View className="info-item">
            <Text className="info-label">审核时间</Text>
            <Text className="info-value">
              {new Date(status.reviewedAt).toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {status.status === 'approved' && (
        <Button 
          className="relogin-btn"
          onClick={() => Taro.reLaunch({ url: '/pages/login/index' })}
        >
          重新登录
        </Button>
      )}

      <Button 
        className="back-btn"
        onClick={() => Taro.navigateBack()}
      >
        返回
      </Button>
    </View>
  );
}
```

- [ ] **Step 3: 创建页面样式**

```scss
// miniapp/src/pages/unrecognized-status/index.scss
.status-page {
  min-height: 100vh;
  background: #f7f4ee;
  padding: 32rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 400rpx;
  color: #666;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
  margin-bottom: 32rpx;
}

.apply-btn {
  background: #1f6f68;
  color: white;
  border-radius: 40rpx;
  font-size: 28rpx;
  padding: 16rpx 40rpx;
}

.status-card {
  background: white;
  border-radius: 16rpx;
  padding: 48rpx;
  text-align: center;
  margin-bottom: 32rpx;
}

.status-icon {
  font-size: 80rpx;
  margin-bottom: 24rpx;
}

.status-text {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 16rpx;
}

.status-description {
  font-size: 26rpx;
  color: #666;
}

.info-card {
  background: white;
  border-radius: 16rpx;
  overflow: hidden;
  margin-bottom: 32rpx;
}

.info-item {
  display: flex;
  justify-content: space-between;
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  
  &:last-child {
    border-bottom: none;
  }
}

.info-label {
  font-size: 26rpx;
  color: #999;
}

.info-value {
  font-size: 26rpx;
  color: #333;
}

.relogin-btn {
  background: #1f6f68;
  color: white;
  border-radius: 40rpx;
  font-size: 32rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}

.back-btn {
  background: white;
  color: #666;
  border-radius: 40rpx;
  font-size: 32rpx;
  padding: 24rpx;
}
```

- [ ] **Step 4: 测试状态页面**

Run: `cd miniapp && npm run dev:weapp`
Expected:
1. 体验页面点击"申请正式账号"跳转到申请页面
2. 提交申请后跳转到状态页面
3. 状态页面显示正确的申请状态
4. 已通过状态显示"重新登录"按钮

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/unrecognized-status/ miniapp/src/app.config.ts
git commit -m "feat(miniapp): add application status page"
```

---

### Task 6: 集成示例题到题库页面

**Files:**
- Modify: `miniapp/src/pages/question-bank/index.tsx`

- [ ] **Step 1: 在题库页面添加示例题入口**

在题库页面添加"体验题库"入口，只对未认可学生显示：

```tsx
// 在题库页面添加示例题入口
{isUnrecognized && (
  <View className="experience-section">
    <View className="section-header">
      <Text className="section-title">体验题库</Text>
      <Text className="section-subtitle">固定示例题，不属于正式题库</Text>
    </View>
    <Button 
      className="experience-btn"
      onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-experience/index' })}
    >
      进入体验
    </Button>
  </View>
)}
```

- [ ] **Step 2: 添加未认可学生状态检测**

```typescript
// 在题库页面添加未认可学生状态检测
const [isUnrecognized, setIsUnrecognized] = useState(false);

useEffect(() => {
  const session = Taro.getStorageSync('unrecognized_session');
  setIsUnrecognized(!!session?.token);
}, []);
```

- [ ] **Step 3: 添加样式**

```scss
// 在题库页面样式中添加
.experience-section {
  background: white;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
}

.section-header {
  margin-bottom: 16rpx;
}

.section-title {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 8rpx;
}

.section-subtitle {
  display: block;
  font-size: 24rpx;
  color: #999;
}

.experience-btn {
  background: #f5f5f5;
  color: #1f6f68;
  border: 1rpx solid #1f6f68;
  border-radius: 40rpx;
  font-size: 28rpx;
}
```

- [ ] **Step 4: 测试集成**

Run: `cd miniapp && npm run dev:weapp`
Expected:
1. 未认可学生登录后，题库页面显示"体验题库"入口
2. 点击跳转到体验页面
3. 已认可学生不显示该入口

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/question-bank/index.tsx
git commit -m "feat(miniapp): integrate experience section in question bank"
```

---

### Task 7: 添加会员标记

**Files:**
- Modify: `miniapp/src/pages/settings/index.tsx`
- Modify: `miniapp/src/pages/index/index.tsx`

- [ ] **Step 1: 在设置页面添加会员标记**

在用户信息区域添加会员标记：

```tsx
// 在用户信息区域添加会员标记
{user.isMember && (
  <View className="member-badge">
    <Text className="member-text">会员</Text>
  </View>
)}
```

- [ ] **Step 2: 在首页添加会员标记**

```tsx
// 在首页用户信息区域添加会员标记
{user.isMember && (
  <View className="member-badge">
    <Text className="member-text">会员</Text>
  </View>
)}
```

- [ ] **Step 3: 添加样式**

```scss
// 添加会员标记样式
.member-badge {
  display: inline-block;
  background: linear-gradient(135deg, #ffd700, #ffb800);
  color: white;
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 20rpx;
  margin-left: 12rpx;
}

.member-text {
  font-weight: bold;
}
```

- [ ] **Step 4: 测试会员标记**

Run: `cd miniapp && npm run dev:weapp`
Expected:
1. 已认可用户显示会员标记
2. 未认可用户不显示会员标记
3. 标记样式正确显示

- [ ] **Step 5: 提交代码**

```bash
git add miniapp/src/pages/settings/index.tsx miniapp/src/pages/index/index.tsx
git commit -m "feat(miniapp): add member badge for recognized users"
```

---

### Task 8: 更新隐私保护指引

**Files:**
- Create: `miniapp/src/pages/login/privacy.tsx`
- Modify: `miniapp/src/pages/login/index.tsx`

- [ ] **Step 1: 创建隐私保护指引页面**

```tsx
// miniapp/src/pages/login/privacy.tsx
import { View, Text, ScrollView } from '@tarojs/components';
import './privacy.scss';

export default function PrivacyPage() {
  return (
    <View className="privacy-page">
      <ScrollView scrollY className="content">
        <Text className="title">隐私保护指引</Text>
        
        <Text className="section-title">一、信息收集</Text>
        <Text className="section-content">
          为提供教育服务，我们需要收集以下信息：
        </Text>
        <Text className="section-content">
          1. 手机号：用于身份验证和登录
        </Text>
        <Text className="section-content">
          2. 学生信息：姓名、学校、年级，用于建立学生档案
        </Text>
        <Text className="section-content">
          3. 家长信息：家长手机号，用于家校沟通
        </Text>

        <Text className="section-title">二、信息使用</Text>
        <Text className="section-content">
          我们仅将收集的信息用于：
        </Text>
        <Text className="section-content">
          1. 身份验证和账号管理
        </Text>
        <Text className="section-content">
          2. 教育服务提供
        </Text>
        <Text className="section-content">
          3. 系统安全维护
        </Text>

        <Text className="section-title">三、信息保护</Text>
        <Text className="section-content">
          我们采取严格的安全措施保护您的信息：
        </Text>
        <Text className="section-content">
          1. 数据加密存储
        </Text>
        <Text className="section-content">
          2. 访问权限控制
        </Text>
        <Text className="section-content">
          3. 定期安全审计
        </Text>

        <Text className="section-title">四、信息共享</Text>
        <Text className="section-content">
          未经您明确同意，我们不会向第三方共享您的个人信息。
        </Text>

        <Text className="section-title">五、权利保障</Text>
        <Text className="section-content">
          您有权：
        </Text>
        <Text className="section-content">
          1. 查询您的个人信息
        </Text>
        <Text className="section-content">
          2. 更正您的个人信息
        </Text>
        <Text className="section-content">
          3. 删除您的个人信息
        </Text>

        <Text className="section-title">六、联系我们</Text>
        <Text className="section-content">
          如有疑问，请联系我们：support@gewu.com
        </Text>
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 2: 创建样式文件**

```scss
// miniapp/src/pages/login/privacy.scss
.privacy-page {
  min-height: 100vh;
  background: #f7f4ee;
  padding: 32rpx;
}

.content {
  height: calc(100vh - 64rpx);
}

.title {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  text-align: center;
  margin-bottom: 32rpx;
}

.section-title {
  display: block;
  font-size: 30rpx;
  font-weight: bold;
  color: #333;
  margin-top: 24rpx;
  margin-bottom: 12rpx;
}

.section-content {
  display: block;
  font-size: 26rpx;
  color: #666;
  line-height: 1.6;
  margin-bottom: 8rpx;
}
```

- [ ] **Step 3: 在登录页面添加隐私指引入口**

```tsx
// 在登录页面添加隐私指引入口
<View className="privacy-entry">
  <Text className="privacy-text">登录即表示同意</Text>
  <Text 
    className="privacy-link"
    onClick={() => Taro.navigateTo({ url: '/pages/login/privacy' })}
  >
    《隐私保护指引》
  </Text>
</View>
```

- [ ] **Step 4: 添加样式**

```scss
// 在登录页面样式中添加
.privacy-entry {
  text-align: center;
  margin-top: 32rpx;
}

.privacy-text {
  font-size: 24rpx;
  color: #999;
}

.privacy-link {
  font-size: 24rpx;
  color: #1f6f68;
}
```

- [ ] **Step 5: 测试隐私指引**

Run: `cd miniapp && npm run dev:weapp`
Expected:
1. 登录页面显示隐私保护指引链接
2. 点击跳转到隐私指引页面
3. 隐私指引内容完整显示

- [ ] **Step 6: 提交代码**

```bash
git add miniapp/src/pages/login/privacy.tsx miniapp/src/pages/login/privacy.scss miniapp/src/pages/login/index.tsx
git commit -m "feat(miniapp): add privacy protection guide"
```

---

## 验证计划

完成所有任务后，执行以下验证：

1. **功能验证**
   - 未认可学生登录流程
   - 示例题浏览和组卷
   - 申请提交和状态查看
   - 会员标记显示
   - 隐私指引访问

2. **测试验证**
   - 运行所有单元测试
   - 运行小程序构建
   - 检查TypeScript类型

3. **UI验证**
   - 未认可学生界面
   - 受认可学生界面
   - 老师界面
   - 管理员界面

4. **提交验证**
   - 提交所有更改
   - 创建PR
   - 推送到远程仓库

---

## 发布顺序

1. 兼容服务端（已完成）
2. 本地数据主机升级
3. 小程序上传
4. OSS桌面端更新

---

## 回滚说明

- 代码回滚：git revert
- 数据库回滚：保留旧字段，新字段可为空
- 功能开关：可通过配置禁用未认可学生功能
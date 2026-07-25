async (page) => {
  await page.addInitScript(() => {
    const runtime = {
      nodeRole: 'primary-host',
      deviceId: 'host-1',
      hostBaseUrl: 'http://localhost:3000',
      cloudBaseUrl: 'http://localhost:3000/api/cloud',
      desktopSyncToken: '',
      mainDbPath: '',
      questionBankPath: '',
      questionAssetPath: '',
      questionBankCandidatePaths: [],
      questionBankStoreId: '',
      localCachePath: '',
      nasBackupPath: '',
    };
    window.api = {
      invoke: async (channel) => channel === 'runtime-config:get' ? runtime : null,
      on: () => {},
      removeListener: () => {},
    };
    window.dbService = {
      getAllQuestions: () => [{
        id: 'q-clean-1', content: '2 + 2 = ?', type: 'single',
        options: ['3', '4'], answer: 'B', analysis: 'basic',
        knowledge_points: ['addition'], status: 'published',
      }],
    };
    localStorage.setItem('question_basket_ids', JSON.stringify(['q-clean-1']));
    localStorage.setItem('question_basket_selected', JSON.stringify(['q-clean-1']));
    sessionStorage.setItem('gewu_desktop_authorization_session', JSON.stringify({
      token: 'test-token', userId: 'user-1', deviceId: 'host-1',
    }));
  });
  await page.route('**/api/cloud-relay-host/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { online: true } }),
  }));
  await page.route('**/api/question-bank/questions**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [{
      id: 'q-clean-1', content: '2 + 2 = ?', type: 'single',
      options: ['3', '4'], answer: 'B', analysis: 'basic',
      knowledge_points: ['addition'], status: 'published',
    }] }),
  }));
  await page.route('**/api/question-bank/paper-export', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      fileName: 'direct-clean.docx',
      fileUrl: 'http://localhost:3000/api/question-bank/artifacts/direct-clean',
      accessUrl: 'http://localhost:3000/api/question-bank/artifacts/direct-clean/access',
      token: 'artifact-token',
    } }),
  }));
  await page.route('**/api/question-bank/artifacts/direct-clean/access', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      fileUrl: 'http://localhost:3000/api/question-bank/artifacts/direct-clean',
      token: 'artifact-token',
    } }),
  }));
  await page.route('**/api/question-bank/artifacts/direct-clean', route => route.fulfill({
    status: 200,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: 'mock-docx',
  }));
  await page.goto('http://localhost:3000');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('navigate-page', {
    detail: 'question-bank-paper',
  })));
  await page.waitForTimeout(1200);
}

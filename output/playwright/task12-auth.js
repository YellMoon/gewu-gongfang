async page => {
  await page.evaluate(() => sessionStorage.setItem('gewu_desktop_authorization_session', JSON.stringify({ token: 'jwt', userId: 'u1', deviceId: 'client-1' })));
}

async page => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.screenshot({ path: 'output/playwright/desktop-task12-720.png', fullPage: true });
  return await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth,
  }));
}

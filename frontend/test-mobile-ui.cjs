const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 428, height: 926, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  const screenshotPath = 'C:/Users/Cypher/.gemini/antigravity/brain/c5b26730-e70d-4dd5-8cf7-86d73ef4f142/mobile_mockup.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Mobile screenshot saved to ' + screenshotPath);
  await browser.close();
})();

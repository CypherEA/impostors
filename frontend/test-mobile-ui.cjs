const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Emulate an iPhone 13 Pro Max
  await page.setViewport({ width: 428, height: 926, isMobile: true, hasTouch: true });
  
  // Navigate to the local build
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle0' });
  
  // Wait a moment for animations to settle
  await new Promise(r => setTimeout(r, 2000));
  
  // Take screenshot
  const screenshotPath = 'C:/Users/Cypher/.gemini/antigravity/brain/c5b26730-e70d-4dd5-8cf7-86d73ef4f142/mobile_companion_snapshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Mobile screenshot saved to ' + screenshotPath);
  
  await browser.close();
})();

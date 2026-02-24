import puppeteer from 'puppeteer';
import admin from 'firebase-admin';

/**
 * Captures a screenshot of the given domain and uploads it to Firebase Storage.
 * @param {string} domain - The impostor domain to screenshot
 * @returns {string|null} - The public download URL of the screenshot, or null on failure.
 */
export async function takeScreenshot(domain) {
    let browser = null;
    try {
        const bucket = admin.storage().bucket();
        console.log(`[SCREENSHOT] Launching headless browser for ${domain}...`);

        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--window-size=1280,800' // Desktop view
            ]
        });

        const page = await browser.newPage();

        // Timeout after 15 seconds to not hang the worker
        await page.goto(`http://${domain}`, { waitUntil: 'networkidle2', timeout: 15000 });

        const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });

        const fileName = `screenshots/${domain}-${Date.now()}.png`;
        const file = bucket.file(fileName);

        await file.save(screenshotBuffer, {
            metadata: {
                contentType: 'image/png'
            }
        });

        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        console.log(`[SCREENSHOT] Successfully captured and uploaded: ${publicUrl}`);
        return publicUrl;

    } catch (err) {
        console.warn(`[SCREENSHOT FAILED] Could not capture ${domain}:`, err.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

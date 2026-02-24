import puppeteer from 'puppeteer';
import admin from 'firebase-admin';

/**
 * Captures a screenshot of the given domain and uploads it to Firebase Storage.
 * @param {string} domain - The impostor domain to screenshot
 * @returns {Promise<{url: string|null, is_malicious: boolean}>} - The public download URL and whether SafeBrowsing blocked it.
 */
export async function takeScreenshot(domain) {
    let browser = null;
    let isMalicious = false;

    // Helper to launch browser with or without safety features
    const launchBrowser = async (safe) => {
        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1280,800'
        ];

        if (!safe) {
            args.push(
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process,SafeBrowsing',
                '--safebrowsing-disable-auto-update',
                '--safebrowsing-disable-download-protection',
                '--disable-client-side-phishing-detection'
            );
        }

        return await puppeteer.launch({ headless: 'new', args });
    };

    try {
        const bucket = admin.storage().bucket();
        console.log(`[SCREENSHOT] Launching headless browser for ${domain}...`);

        // First attempt: With SafeBrowsing ENABLED to see if Google flags it
        browser = await launchBrowser(true);
        let page = await browser.newPage();

        try {
            await page.goto(`http://${domain}`, { waitUntil: 'networkidle2', timeout: 15000 });
        } catch (navErr) {
            if (navErr.message.includes('ERR_BLOCKED_BY_CLIENT')) {
                console.log(`[SCREENSHOT WARNING] Google SafeBrowsing blocked ${domain}! Flagging as malicious.`);
                isMalicious = true;

                // Close the safe browser and launch an unprotected one to get the actual screenshot
                await browser.close();
                console.log(`[SCREENSHOT] Re-launching unprotected browser for ${domain}...`);
                browser = await launchBrowser(false);
                page = await browser.newPage();
                await page.goto(`http://${domain}`, { waitUntil: 'networkidle2', timeout: 15000 });
            } else {
                throw navErr; // re-throw other timeouts/errors
            }
        }

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
        return { url: publicUrl, is_malicious: isMalicious };

    } catch (err) {
        console.warn(`[SCREENSHOT FAILED] Could not capture ${domain}:`, err.message);
        return { url: null, is_malicious: isMalicious };
    } finally {
        if (browser) await browser.close();
    }
}

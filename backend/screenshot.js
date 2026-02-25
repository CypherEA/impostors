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

/**
 * Extracts the Favicon and primary Logo (og:image) from an original domain to use as visual baselines.
 * @param {string} domain - The legitimate root domain to scrape.
 * @returns {Promise<{favicon_url: string|null, logo_url: string|null}>}
 */
export async function extractOriginalDomainFeatures(domain) {
    let browser = null;
    let fallbackFavicon = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

    // Helper to launch browser
    const launchBrowser = async () => {
        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1280,800'
        ];
        return await puppeteer.launch({ headless: 'new', args });
    };

    try {
        console.log(`[EXTRACTION] Launching headless browser for baseline features on ${domain}...`);
        browser = await launchBrowser();
        const page = await browser.newPage();

        // Wait until there are no more than 2 network connections for at least 500 ms.
        await page.goto(`https://${domain}`, { waitUntil: 'networkidle2', timeout: 15000 });

        // Execute script in browser context to find the image URLs
        const extracted = await page.evaluate(() => {
            let favicon = null;
            let logo = null;

            // 1. Try to find the Favicon
            const iconSelectors = [
                'link[rel="icon"]',
                'link[rel="shortcut icon"]',
                'link[rel="apple-touch-icon"]'
            ];
            for (const selector of iconSelectors) {
                const el = document.querySelector(selector);
                if (el && el.href) {
                    favicon = el.href;
                    break;
                }
            }

            // 2. Try to find the primary Logo (usually in OpenGraph tags or a navbar img)
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) {
                logo = ogImage.content;
            } else {
                // Fallback: look for an img tag with "logo" in class, id, or src
                const imgs = document.querySelectorAll('img');
                for (let img of imgs) {
                    const src = img.src || '';
                    const cls = img.className || '';
                    const id = img.id || '';
                    if (src.toLowerCase().includes('logo') || cls.toLowerCase().includes('logo') || id.toLowerCase().includes('logo')) {
                        // Ensure it's not a generic tiny tracker image
                        if (img.width > 20 || img.naturalWidth > 20) {
                            logo = img.src;
                            break;
                        }
                    }
                }
            }

            return { favicon, logo };
        });

        const bucket = admin.storage().bucket();
        const results = { favicon_url: null, logo_url: null };

        // Helper to download and re-upload buffer to Firebase Storage
        const uploadImageAsset = async (url, type) => {
            try {
                if (!url) return null;
                // If it's a relative URL from evaluation, it should have been resolved by the browser, but just in case
                if (url.startsWith('//')) url = `https:${url}`;
                if (url.startsWith('/')) url = `https://${domain}${url}`;

                const response = await fetch(url);
                if (!response.ok) return null;

                const buffer = await response.arrayBuffer();
                const fileName = `baselines/${domain}-${type}-${Date.now()}`;
                const file = bucket.file(fileName);

                const contentType = response.headers.get('content-type') || 'application/octet-stream';

                await file.save(Buffer.from(buffer), { metadata: { contentType } });
                await file.makePublic();

                return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            } catch (err) {
                console.warn(`[EXTRACTION WARNING] Failed to upload ${type} for ${domain}:`, err.message);
                return null;
            }
        };

        // Upload them
        if (extracted.favicon) results.favicon_url = await uploadImageAsset(extracted.favicon, 'favicon');
        if (extracted.logo) results.logo_url = await uploadImageAsset(extracted.logo, 'logo');

        // Fallback to Google's favicon service if the scrape completely failed to find one
        if (!results.favicon_url) results.favicon_url = fallbackFavicon;

        console.log(`[EXTRACTION] Completed for ${domain}. Favicon: ${!!results.favicon_url}, Logo: ${!!results.logo_url}`);
        return results;

    } catch (err) {
        console.warn(`[EXTRACTION FAILED] Could not extract features for ${domain}:`, err.message);
        return { favicon_url: fallbackFavicon, logo_url: null };
    } finally {
        if (browser) await browser.close();
    }
}

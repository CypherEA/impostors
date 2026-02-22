import http from 'http';
import cron from 'node-cron';
import admin from 'firebase-admin';
import { generateImpostors } from './generator.js';
import { scanDomain } from './scanner.js';

// ----------------------------------------------------
// 1. Firebase Admin Initialization
// User must provide service account credentials via env var 
// GOOGLE_APPLICATION_CREDENTIALS for local / Render / Heroku
// ----------------------------------------------------
try {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
} catch (e) {
    console.warn("WARNING: Firebase Admin initialization failed. Ensure GOOGLE_APPLICATION_CREDENTIALS is set.", e.message);
}

const db = admin.firestore?.() || null;

// ----------------------------------------------------
// 2. Healthcheck Web Server (Required for Render/Heroku)
// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Impostor Domain Scanner is running.\n');
});

server.listen(PORT, () => {
    console.log(`Healthcheck server listening on port ${PORT}`);
});

// ----------------------------------------------------
// 3. Core Scanning Logic
// ----------------------------------------------------
const delay = ms => new Promise(res => setTimeout(res, ms));

async function runScanCycle() {
    if (!db) {
        console.error("Firestore not connected. Skipping scan cycle.");
        return;
    }

    console.log(`[${new Date().toISOString()}] Starting new scan cycle...`);

    try {
        const domainsSnap = await db.collection('monitored_domains').get();
        if (domainsSnap.empty) {
            console.log("No domains to monitor.");
            return;
        }

        for (const doc of domainsSnap.docs) {
            const data = doc.data();
            const originalDomain = data.domain;

            console.log(`Processing variations for: ${originalDomain}`);

            // Generate impostors
            const impostors = generateImpostors(originalDomain);

            for (const item of impostors) {
                const impostorDomain = item.impostor;
                const confidence = item.confidence;

                // Scan the DNS
                const results = await scanDomain(impostorDomain);

                // If resolving, log and save to Firestore
                const isResolving = results.A || results.MX || results.TXT;
                if (isResolving) {
                    console.log(`[ALERT] Resolving Impostor Found: ${impostorDomain} | Records: ${JSON.stringify(results)}`);

                    const impostorRef = db.collection('generated_impostors').doc(impostorDomain);

                    const impostorDoc = await impostorRef.get();
                    if (!impostorDoc.exists) {
                        // Newly discovered
                        await impostorRef.set({
                            original_domain: originalDomain,
                            impostor_domain: impostorDomain,
                            confidence_level: confidence,
                            records: results,
                            first_detected_at: admin.firestore.FieldValue.serverTimestamp(),
                            last_scanned: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } else {
                        // Update existing entry
                        await impostorRef.update({
                            records: results,
                            last_scanned: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }

                // Sleep moderately to avoid flooding DNS servers
                await delay(500);
            }
        }

        console.log(`[${new Date().toISOString()}] Scan cycle completed.`);
    } catch (err) {
        console.error("Error during scan cycle:", err);
    }
}

// ----------------------------------------------------
// 4. CRON Schedule
// Schedule: Every Sunday at Midnight (0 0 * * 0)
// For testing purposes, you can change this to '* * * * *' to run every minute
// ----------------------------------------------------
cron.schedule('0 0 * * 0', () => {
    runScanCycle();
});

// You can uncomment below to run immediately on boot for testing natively:
// runScanCycle();

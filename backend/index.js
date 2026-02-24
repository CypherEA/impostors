import http from 'http';
import cron from 'node-cron';
import admin from 'firebase-admin';
import { generateImpostors } from './generator.js';
import { scanDomain, getRegistrationDate } from './scanner.js';

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
// 3. Core Scanning Logic - Initialization & Staggering
// ----------------------------------------------------
const delay = ms => new Promise(res => setTimeout(res, ms));

// Calculate a random date between now and X days in the future
function getRandomNextScanDate(daysFromNow = 7) {
    const nextScanDate = new Date();
    nextScanDate.setTime(nextScanDate.getTime() + (Math.random() * daysFromNow * 24 * 60 * 60 * 1000));
    return admin.firestore.Timestamp.fromDate(nextScanDate);
}

// ----------------------------------------------------
// 4. Real-time Listener for New Domains (Generate & First Scan)
// ----------------------------------------------------
if (db) {
    console.log("Starting Firestore listener for new domains...");
    db.collection('monitored_domains').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            // Only trigger on newly added domains
            if (change.type === 'added') {
                const data = change.doc.data();
                const domainStr = data.domain;

                // Check if this domain has already been processed by the worker
                if (data.processed_by_worker) return;

                console.log(`[NEW DOMAIN] Detected: ${domainStr}. Starting generation and initial scan.`);

                // Mark as processed immediately so concurrent/future restarts don't re-trigger
                await change.doc.ref.update({ processed_by_worker: true });

                const impostors = generateImpostors(domainStr);

                for (const item of impostors) {
                    const impostorDomain = item.impostor;
                    const confidence = item.confidence;

                    // 1. First-time resolve check
                    const results = await scanDomain(impostorDomain);
                    const isResolving = results.A || results.MX || results.TXT;

                    // 2. Schedule the next scan randomly within the next 7 days
                    const nextScanAt = getRandomNextScanDate(7);

                    const payload = {
                        original_domain: domainStr,
                        impostor_domain: impostorDomain,
                        confidence_level: confidence,
                        records: results,
                        next_scan_at: nextScanAt
                    };

                    // If it resolves, log it and add timestamps
                    if (isResolving) {
                        console.log(`[ALERT] Resolving Impostor Found during initial scan: ${impostorDomain}`);
                        payload.first_detected_at = admin.firestore.FieldValue.serverTimestamp();
                        payload.last_scanned = admin.firestore.FieldValue.serverTimestamp();

                        // Fetch the actual registry creation date via RDAP
                        const actualRegDate = await getRegistrationDate(impostorDomain);
                        payload.registry_created_at = actualRegDate || "Redacted/Unknown";
                    } else {
                        // Even if it doesn't resolve right now, we keep a record of the last time we checked it
                        payload.last_scanned = admin.firestore.FieldValue.serverTimestamp();
                    }

                    // Save the impostor to the database so the CRON can pick it up later
                    await db.collection('generated_impostors').doc(impostorDomain).set(payload, { merge: true });

                    // Sleep moderately to avoid flooding DNS servers
                    await delay(200);
                }
                console.log(`[NEW DOMAIN] Finished initial processing for: ${domainStr}`);
            }
        });
    }, err => {
        console.error("Firestore listener error:", err);
    });

    console.log("Starting Firestore listener for On-Demand manual scans...");
    db.collection('generated_impostors').where('force_scan', '==', true).onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                if (!data.force_scan) return;

                const impostorDomain = data.impostor_domain;
                console.log(`[ON-DEMAND] Manual scan triggered for ${impostorDomain}`);

                // Immediately remove the flag to prevent infinite loops
                await change.doc.ref.update({ force_scan: admin.firestore.FieldValue.delete() });

                // Execute the scan
                const results = await scanDomain(impostorDomain);
                const isResolving = results.A || results.MX || results.TXT;
                const nextScanAt = getRandomNextScanDate(7);

                const updatePayload = {
                    records: results,
                    next_scan_at: nextScanAt,
                    last_scanned: admin.firestore.FieldValue.serverTimestamp()
                };

                // If newly resolving
                if (isResolving && !data.first_detected_at) {
                    console.log(`[ALERT] Newly Resolving Impostor Found during ON-DEMAND scan: ${impostorDomain}`);
                    updatePayload.first_detected_at = admin.firestore.FieldValue.serverTimestamp();
                }

                if (isResolving && !data.registry_created_at) {
                    const actualRegDate = await getRegistrationDate(impostorDomain);
                    updatePayload.registry_created_at = actualRegDate || "Redacted/Unknown";
                }

                await change.doc.ref.update(updatePayload);
            }
        });
    }, err => {
        console.error("Firestore manual scan listener error:", err);
    });
}

// ----------------------------------------------------
// 5. CRON Schedule for Staggered Rescans
// ----------------------------------------------------
// Runs every hour. It looks for any impostor domain where `next_scan_at` is heavily past due or due right now.
cron.schedule('0 * * * *', async () => {
    if (!db) return;

    console.log(`[${new Date().toISOString()}] Running hourly CRON for scheduled impostor rescans...`);

    try {
        const now = admin.firestore.Timestamp.now();
        const dueImpostorsSnap = await db.collection('generated_impostors')
            .where('next_scan_at', '<=', now)
            .limit(500) // process in chunks so we don't timeout the worker
            .get();

        if (dueImpostorsSnap.empty) {
            console.log("No domains scheduled for rescanning at this hour.");
            return;
        }

        console.log(`Found ${dueImpostorsSnap.size} impostor domains due for rescan.`);

        for (const doc of dueImpostorsSnap.docs) {
            const data = doc.data();
            const impostorDomain = data.impostor_domain;

            // Perform the resolution scan
            const results = await scanDomain(impostorDomain);
            const isResolving = results.A || results.MX || results.TXT;

            // Schedule the NEXT scan (random within next 7 days from now)
            const nextScanAt = getRandomNextScanDate(7);

            const updatePayload = {
                records: results,
                next_scan_at: nextScanAt,
                last_scanned: admin.firestore.FieldValue.serverTimestamp()
            };

            // If it's resolving NOW but wasn't before, flag the first_detected_at
            if (isResolving && !data.first_detected_at) {
                console.log(`[ALERT] Newly Resolving Impostor Found during CRON: ${impostorDomain}`);
                updatePayload.first_detected_at = admin.firestore.FieldValue.serverTimestamp();
            }

            if (isResolving && !data.registry_created_at) {
                // Fetch the actual registry creation date since it is newly resolving or missed it previously
                const actualRegDate = await getRegistrationDate(impostorDomain);
                updatePayload.registry_created_at = actualRegDate || "Redacted/Unknown";
            }

            await doc.ref.update(updatePayload);
            await delay(500); // polite delay
        }

        console.log(`[${new Date().toISOString()}] Hourly CRON completed.`);
    } catch (err) {
        console.error("Error during hourly CRON:", err);
    }
});

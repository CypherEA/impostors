import admin from 'firebase-admin';
import { extractOriginalDomainFeatures } from './screenshot.js';
import dotenv from 'dotenv';
dotenv.config();

// Initialize Firebase Admin with credentials from the same path the backend uses
admin.initializeApp({
    credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
});

const db = admin.firestore();

async function backfillOriginalDomains() {
    console.log("=== Starting Retroactive Favicon/Logo Extraction ===");

    try {
        const snap = await db.collection('monitored_domains').get();
        let total = snap.size;
        let processed = 0;
        let skipped = 0;

        console.log(`Found ${total} monitored domains.`);

        for (const doc of snap.docs) {
            const data = doc.data();
            const domain = doc.id;

            if (data.original_favicon || data.original_logo) {
                console.log(`[SKIP] ${domain} already has visual features extracted.`);
                skipped++;
                continue;
            }

            console.log(`[PROCESS] Extracting features for ${domain}...`);
            const features = await extractOriginalDomainFeatures(domain);

            if (features.favicon_url || features.logo_url) {
                await doc.ref.update({
                    original_favicon: features.favicon_url,
                    original_logo: features.logo_url
                });
                console.log(`[SUCCESS] Saved features for ${domain}`);
            } else {
                console.log(`[WARNING] Failed to extract any features for ${domain}`);
            }
            processed++;
        }

        console.log("=== Backfill Complete ===");
        console.log(`Total: ${total} | Processed: ${processed} | Skipped: ${skipped}`);

    } catch (e) {
        console.error("Critical error during backfill:", e);
    } finally {
        process.exit(0);
    }
}

backfillOriginalDomains();

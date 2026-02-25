import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

// Initialize Firebase Admin with credentials from the same path the backend uses
admin.initializeApp({
    credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    storageBucket: 'boilermaker-impostors.firebasestorage.app'
});

const db = admin.firestore();

async function requeueFailedScreenshots() {
    console.log("=== Starting Screenshot Requeue Script ===");

    try {
        const snap = await db.collection('generated_impostors').get();
        let total = snap.size;
        let requeued = 0;

        console.log(`Scanning ${total} total impostor domains...`);

        for (const doc of snap.docs) {
            const data = doc.data();
            const domain = doc.id;

            // Only care about domains that actually resolve
            const isResolving = data.records && (data.records.A || data.records.MX || data.records.TXT);
            if (!isResolving) continue;

            const hasScreenshot = !!data.screenshot_url;
            const needsScreenshot = !!data.needs_screenshot;

            // If it resolves, it DOES NOT have a screenshot yet, and it's NOT currently in the queue
            // Force it back into the queue and reset the attempt lock
            if (!hasScreenshot && !needsScreenshot) {
                console.log(`[REQUEUE] ${domain} (Resolving but missing screenshot)`);

                await doc.ref.update({
                    needs_screenshot: true,
                    screenshot_attempted: false
                });

                requeued++;
            }
        }

        console.log("=== Requeue Complete ===");
        console.log(`Total Scanned: ${total} | Flagged for Re-attempt: ${requeued}`);

    } catch (e) {
        console.error("Critical error during requeuing:", e);
    } finally {
        process.exit(0);
    }
}

requeueFailedScreenshots();

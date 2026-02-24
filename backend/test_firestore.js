import admin from 'firebase-admin';

admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function check() {
    const snap = await db.collection('generated_impostors').limit(20).get();
    snap.forEach(doc => {
        const d = doc.data();
        if (d.records && (d.records.A || d.records.MX || d.records.TXT)) {
            console.log("Resolving Domain:", d.impostor_domain, "RDAP:", d.registry_created_at, "First Detect:", d.first_detected_at);
        } else {
            console.log("Non-resolving:", d.impostor_domain, "RDAP:", d.registry_created_at);
        }
    });
}
check().catch(console.error);

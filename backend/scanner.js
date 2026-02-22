import dns from 'dns/promises';

/**
 * Scans a given domain for A, MX, and TXT records.
 * Returns an object with the results.
 */
export async function scanDomain(domain) {
    const results = {
        A: false,
        MX: false,
        TXT: false
    };

    try {
        const aRecords = await dns.resolve4(domain);
        if (aRecords && aRecords.length > 0) results.A = true;
    } catch (e) {
        // Ignore ENOTFOUND
    }

    try {
        const mxRecords = await dns.resolveMx(domain);
        if (mxRecords && mxRecords.length > 0) results.MX = true;
    } catch (e) {
        // Ignore ENOTFOUND
    }

    try {
        const txtRecords = await dns.resolveTxt(domain);
        if (txtRecords && txtRecords.length > 0) {
            // Flatten the nested TXT arrays into a single string to check for SPF / DMARC
            const joinedTxt = txtRecords.map(arr => arr.join('')).join('|').toLowerCase();
            if (joinedTxt.includes('v=spf1') || joinedTxt.includes('v=dmarc1')) {
                results.TXT = true;
            } else if (txtRecords.length > 0) {
                // Technically just having TXT records means the domain resolves, 
                // but we specifically care if it looks actively configured for email/verification.
                // We'll mark true for ANY TXT record for now to be safe.
                results.TXT = true;
            }
        }
    } catch (e) {
        // Ignore ENOTFOUND
    }

    return results;
}

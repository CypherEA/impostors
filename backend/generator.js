import punycode from 'punycode';

const TLDs = ['com', 'org', 'net', 'co', 'info', 'biz', 'us', 'io'];
const ADJACENT_KEYS = {
    'q': ['w', 'a', 's'], 'w': ['q', 'e', 'a', 's', 'd'], 'e': ['w', 'r', 's', 'd', 'f'], 'r': ['e', 't', 'd', 'f', 'g'],
    't': ['r', 'y', 'f', 'g', 'h'], 'y': ['t', 'u', 'g', 'h', 'j'], 'u': ['y', 'i', 'h', 'j', 'k'], 'i': ['u', 'o', 'j', 'k', 'l'],
    'o': ['i', 'p', 'k', 'l'], 'p': ['o', 'l'], 'a': ['q', 'w', 's', 'z', 'x'], 's': ['q', 'w', 'e', 'a', 'd', 'z', 'x', 'c'],
    'd': ['w', 'e', 'r', 's', 'f', 'x', 'c', 'v'], 'f': ['e', 'r', 't', 'd', 'g', 'c', 'v', 'b'], 'g': ['r', 't', 'y', 'f', 'h', 'v', 'b', 'n'],
    'h': ['t', 'y', 'u', 'g', 'j', 'b', 'n', 'm'], 'j': ['y', 'u', 'i', 'h', 'k', 'n', 'm'], 'k': ['u', 'i', 'o', 'j', 'l', 'm'],
    'l': ['i', 'o', 'p', 'k'], 'z': ['a', 's', 'x'], 'x': ['a', 's', 'd', 'z', 'c'], 'c': ['s', 'd', 'f', 'x', 'v'],
    'v': ['d', 'f', 'g', 'c', 'b'], 'b': ['f', 'g', 'h', 'v', 'n'], 'n': ['g', 'h', 'j', 'b', 'm'], 'm': ['h', 'j', 'k', 'n']
};

export function generateImpostors(domain) {
    const parts = domain.split('.');
    if (parts.length < 2) return [];

    let basename = parts.slice(0, -1).join('.');
    const originalTld = parts[parts.length - 1];

    let results = [];
    const minLength = basename.length;

    // Helper to calculate confidence purely based on variation and length
    const addResult = (impostorStr, penaltyBase) => {
        if (impostorStr === domain) return;

        // Confidence Heuristic:
        // Shorter domains have much lower confidence for variations because short character shifts 
        // usually result in completely unrelated legitimate sites (e.g., abc.com vs abd.com).
        // A base penalty is provided by the typo type.

        let confidence = 100 - penaltyBase;

        // If domain is very short, heavily penalize confidence
        if (minLength <= 3) confidence -= 40;
        else if (minLength <= 5) confidence -= 20;
        else if (minLength <= 7) confidence -= 10;

        // Ensure bounds
        confidence = Math.max(1, Math.min(99, confidence));

        results.push({ impostor: impostorStr, confidence });
    };

    // 1. TLD Swap (High Confidence, common impersonation)
    TLDs.forEach(tld => {
        if (tld !== originalTld) addResult(`${basename}.${tld}`, 5); // 95% confidence on long domains
    });

    // 2. Homoglyphs / Punycode (Cyrillic a, e, o etc) (Highest confidence, intentional deceit)
    // Replace ASCII 'a' with Cyrillic 'а' (U+0430)
    if (basename.includes('a')) {
        let puny = punycode.toASCII(basename.replace(/a/g, 'а') + '.' + originalTld);
        addResult(puny, 1); // 99% confident
    }
    if (basename.includes('e')) {
        let puny = punycode.toASCII(basename.replace(/e/g, 'е') + '.' + originalTld);
        addResult(puny, 1);
    }
    if (basename.includes('o')) {
        let puny = punycode.toASCII(basename.replace(/o/g, 'о') + '.' + originalTld);
        addResult(puny, 1);
    }

    // 3. Bitsquatting / Adjacent Keys (Fat finger)
    for (let i = 0; i < basename.length; i++) {
        let char = basename[i];
        if (ADJACENT_KEYS[char]) {
            ADJACENT_KEYS[char].forEach(adj => {
                let modified = basename.substring(0, i) + adj + basename.substring(i + 1);
                addResult(`${modified}.${originalTld}`, 15); // 85% confident
            });
        }
    }

    // 4. Missing Character
    if (basename.length > 3) {
        for (let i = 0; i < basename.length; i++) {
            let modified = basename.substring(0, i) + basename.substring(i + 1);
            addResult(`${modified}.${originalTld}`, 25); // 75% confident
        }
    }

    // 5. Letter Duplication
    for (let i = 0; i < basename.length; i++) {
        let modified = basename.substring(0, i) + basename[i] + basename.substring(i);
        addResult(`${modified}.${originalTld}`, 20); // 80% confident
    }

    // 6. Character Swaps (Transposition)
    for (let i = 0; i < basename.length - 1; i++) {
        let modified = basename.substring(0, i) + basename[i + 1] + basename[i] + basename.substring(i + 2);
        addResult(`${modified}.${originalTld}`, 10); // 90% confident
    }

    // 7. Prepended / Appended generic keywords
    const keywords = ['login-', 'secure-', 'auth-', 'account-', '-support', '-help'];
    keywords.forEach(kw => {
        let modified = kw.endsWith('-') ? kw + basename : basename + kw;
        addResult(`${modified}.${originalTld}`, 2); // 98% confident intentional phishing
    });

    // Deduplicate array by impostor domain string (pick highest confidence)
    const uniqueMap = new Map();
    results.forEach(item => {
        if (!uniqueMap.has(item.impostor) || uniqueMap.get(item.impostor) < item.confidence) {
            uniqueMap.set(item.impostor, item.confidence);
        }
    });

    return Array.from(uniqueMap, ([impostor, confidence]) => ({ impostor, confidence }));
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc,
    arrayUnion, query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const views = {
    auth: document.getElementById('view-auth'),
    dashboard: document.getElementById('view-dashboard'),
    admin: document.getElementById('view-admin')
};
const nav = {
    menu: document.getElementById('nav-menu'),
    dashboardBtn: document.getElementById('nav-dashboard'),
    adminBtn: document.getElementById('nav-admin'),
    userDisplay: document.getElementById('user-display'),
    logoutBtn: document.getElementById('btn-logout')
};
const authParts = {
    form: document.getElementById('auth-form'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    loginBtn: document.getElementById('btn-login'),
    registerBtn: document.getElementById('btn-register'),
    error: document.getElementById('auth-error')
};

let currentUser = null;
let currentRole = 'user';
let unsubDomains = null;
let unsubImpostors = null;

// --- UI Navigation ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (viewName === 'dashboard') nav.dashboardBtn.classList.add('active');
    if (viewName === 'admin') nav.adminBtn.classList.add('active');
}

nav.dashboardBtn.addEventListener('click', () => switchView('dashboard'));
nav.adminBtn.addEventListener('click', () => {
    switchView('admin');
    loadAdminData();
});

// --- Auth Error Helper ---
function showAuthError(msg) {
    authParts.error.textContent = msg;
    authParts.error.classList.remove('hidden');
    setTimeout(() => authParts.error.classList.add('hidden'), 5000);
}

// --- Auth Listeners ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        nav.userDisplay.textContent = user.email;
        nav.menu.classList.remove('hidden');

        // Ensure user doc exists and check role
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            await setDoc(userRef, { email: user.email, role: 'user', createdAt: serverTimestamp() });
            currentRole = 'user';
        } else {
            currentRole = userSnap.data().role || 'user';
        }

        if (currentRole === 'admin') {
            nav.adminBtn.classList.remove('hidden');
        } else {
            nav.adminBtn.classList.add('hidden');
        }

        switchView('dashboard');
        loadUserDashboard(user.uid);
    } else {
        currentUser = null;
        currentRole = 'user';
        nav.menu.classList.add('hidden');
        switchView('auth');
        if (unsubDomains) unsubDomains();
        if (unsubImpostors) unsubImpostors();
    }
});

authParts.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!authParts.form.checkValidity()) return authParts.form.reportValidity();
    try {
        await signInWithEmailAndPassword(auth, authParts.email.value, authParts.password.value);
    } catch (err) {
        showAuthError(err.message);
    }
});

authParts.registerBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!authParts.form.checkValidity()) return authParts.form.reportValidity();
    try {
        await createUserWithEmailAndPassword(auth, authParts.email.value, authParts.password.value);
    } catch (err) {
        showAuthError(err.message);
    }
});

nav.logoutBtn.addEventListener('click', () => signOut(auth));

// --- Domain Management ---
const addDomainForm = document.getElementById('add-domain-form');
const newDomainInput = document.getElementById('new-domain');

addDomainForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    let domain = newDomainInput.value.trim().toLowerCase();
    if (!domain) return;

    try {
        const domainRef = doc(db, 'monitored_domains', domain);
        const docSnap = await getDoc(domainRef);

        if (docSnap.exists()) {
            // Deduplication: just add the user to the existing domain
            await updateDoc(domainRef, {
                users: arrayUnion(currentUser.uid)
            });
        } else {
            // New entry
            await setDoc(domainRef, {
                domain: domain,
                users: [currentUser.uid],
                createdAt: serverTimestamp()
            });
        }

        newDomainInput.value = '';
    } catch (err) {
        alert("Error adding domain: " + err.message);
    }
});

// --- Dashboard Loading ---
function loadUserDashboard(uid) {
    const domainsGrid = document.getElementById('domains-grid');
    const qDomains = query(collection(db, 'monitored_domains'), where('users', 'array-contains', uid));

    if (unsubDomains) unsubDomains();

    unsubDomains = onSnapshot(qDomains, (snapshot) => {
        domainsGrid.innerHTML = '';
        const userDomains = [];

        if (snapshot.empty) {
            domainsGrid.innerHTML = '<div class="empty-state">No domains monitored yet. Add one above!</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            userDomains.push(data.domain);

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-title">
                    <span>${data.domain}</span>
                    <span class="badge" style="background:var(--success-bg);color:var(--success)">Active</span>
                </div>
                <div class="subtitle mt-4" style="font-size: 0.8rem">Added: ${data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Just now'}</div>
            `;
            domainsGrid.appendChild(card);
        });

        // Load Impostors for these domains
        loadUserImpostors(userDomains);
    });
}

function loadUserImpostors(userDomains) {
    if (unsubImpostors) unsubImpostors();
    if (userDomains.length === 0) return;

    // chunk arrays into blocks of 10 for Firestore 'in' query limitation
    // For MVP frontend draft, we just do a simplified approach. In production, 
    // the backend would structure this better or we'd do multiple queries.
    // We'll just take the top 10 domains for now in the UI listener.
    const queryDomains = userDomains.slice(0, 10);

    const impTbody = document.getElementById('impostors-tbody');
    const qImpostors = query(collection(db, 'generated_impostors'), where('original_domain', 'in', queryDomains));

    unsubImpostors = onSnapshot(qImpostors, (snapshot) => {
        impTbody.innerHTML = '';
        let activeCount = 0;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Only show ones that actually resolved (have at least one true record)
            const hasResolutions = Object.values(data.records).some(v => v === true);
            if (!hasResolutions) return;

            activeCount++;
            const tr = document.createElement('tr');

            // Format records
            let recordsHtml = '';
            if (data.records.A) recordsHtml += `<span class="record-tag active">A/AAAA</span>`;
            if (data.records.MX) recordsHtml += `<span class="record-tag active">MX</span>`;
            if (data.records.TXT) recordsHtml += `<span class="record-tag active">TXT (SPF/DMARC)</span>`;

            const lastScan = data.last_scanned ? data.last_scanned.toDate().toLocaleString() : 'N/A';

            // Confidence color
            let confColor = data.confidence_level > 70 ? 'var(--danger)' : (data.confidence_level > 40 ? '#d29922' : 'var(--success)');

            tr.innerHTML = `
                <td style="font-weight: 600; color: #fff">${data.impostor_domain}</td>
                <td class="subtitle">${data.original_domain}</td>
                <td><span style="color: ${confColor}; font-weight: 600">${data.confidence_level}%</span></td>
                <td>${recordsHtml || '<span class="subtitle">None</span>'}</td>
                <td class="subtitle" style="font-size: 0.8rem">${lastScan}</td>
            `;
            impTbody.appendChild(tr);
        });

        document.getElementById('impostor-count').textContent = activeCount;

        if (activeCount === 0) {
            impTbody.innerHTML = '<tr><td colspan="5" style="text-align:center" class="subtitle">No resolving impostor domains detected yet.</td></tr>';
        }
    });
}

// --- Admin Data Loading ---
async function loadAdminData() {
    const adminTbody = document.getElementById('admin-tbody');
    adminTbody.innerHTML = '<tr><td colspan="3">Loading data...</td></tr>';

    try {
        // Fetch all users to map UIDs to Emails
        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap = {};
        usersSnap.forEach(u => userMap[u.id] = u.data().email);

        // Fetch all domains
        const domainSnap = await getDocs(collection(db, 'monitored_domains'));
        adminTbody.innerHTML = '';

        if (domainSnap.empty) {
            adminTbody.innerHTML = '<tr><td colspan="3" style="text-align:center" class="subtitle">No domains registered across the system.</td></tr>';
            return;
        }

        domainSnap.forEach(d => {
            const data = d.data();
            const emails = data.users.map(uid => userMap[uid] || uid).join(', ');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500">${data.domain}</td>
                <td class="subtitle">${emails}</td>
                <td class="subtitle">${data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Unknown'}</td>
            `;
            adminTbody.appendChild(tr);
        });

    } catch (err) {
        console.error("Admin Load Error", err);
        adminTbody.innerHTML = `<tr><td colspan="3" style="color:var(--danger)">Failed to load: ${err.message}</td></tr>`;
    }
}

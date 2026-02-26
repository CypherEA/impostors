import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, LogOut, LayoutDashboard, Settings, Eye, RefreshCw, Activity, X, Trash2, TriangleAlert } from 'lucide-react';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "firebase/auth";
import {
    collection, doc, setDoc, getDoc, getDocs, updateDoc,
    deleteDoc, query, onSnapshot, serverTimestamp
} from "firebase/firestore";
import { auth, googleProvider, db } from './firebase';
import { toUnicode } from 'idna-uts46-hx';
import './mobile.css';

// Same helper as DesktopApp
function punycodeToUnicode(domain) {
    if (!domain.includes('xn--')) return domain;
    try {
        return toUnicode(domain);
    } catch (e) {
        return domain;
    }
}

export default function MobileApp() {
    const [currentUser, setCurrentUser] = useState(null);
    const [currentRole, setCurrentRole] = useState('user');
    const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, admin, settings
    const [authError, setAuthError] = useState('');

    // Auth Form State
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Domain State
    const [newDomain, setNewDomain] = useState('');
    const [userDomains, setUserDomains] = useState([]);
    const [impostors, setImpostors] = useState([]);

    // Mobile specific: selected domain chip
    const [activeDomainFilter, setActiveDomainFilter] = useState(null);

    // Listen for Auth changes (duplicated from DesktopApp for now - could be lifted to context later if needed)
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (!userDoc.exists()) {
                    await setDoc(doc(db, 'users', user.uid), {
                        email: user.email,
                        role: 'user',
                        created_at: serverTimestamp(),
                        last_login: serverTimestamp()
                    });
                    setCurrentRole('user');
                } else {
                    setCurrentRole(userDoc.data().role || 'user');
                    await updateDoc(doc(db, 'users', user.uid), { last_login: serverTimestamp() });
                }
                if (activeTab === 'auth' || !activeTab) setActiveTab('dashboard');
            } else {
                setCurrentRole('user');
                setUserDomains([]);
                setImpostors([]);
            }
        });
        return () => unsubscribe();
    }, []);

    // Sync Data
    useEffect(() => {
        if (!currentUser) return;
        const unsubDomains = onSnapshot(collection(db, 'monitored_domains'), (snapshot) => {
            const allDomains = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            let userDoms = [];
            if (currentRole === 'admin') {
                userDoms = allDomains;
            } else {
                userDoms = allDomains.filter(d => d.users && d.users.includes(currentUser.uid));
            }
            setUserDomains(userDoms.sort((a, b) => a.domain.localeCompare(b.domain)));
        });

        const unsubImpostors = onSnapshot(collection(db, 'generated_impostors'), (snapshot) => {
            setImpostors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { unsubDomains(); unsubImpostors(); };
    }, [currentUser, currentRole]);

    const handleAuth = async (isLogin, e) => {
        e.preventDefault();
        setAuthError('');
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err) {
            setAuthError(err.message);
        }
    };

    const handleGoogleAuth = async () => {
        setAuthError('');
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err) {
            setAuthError(err.message);
        }
    };

    const addDomain = async (e) => {
        e.preventDefault();
        if (!newDomain) return;
        let cleanDomain = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

        try {
            const q = query(collection(db, 'monitored_domains'));
            const snapshot = await getDocs(q);
            const existing = snapshot.docs.find(doc => doc.data().domain === cleanDomain);

            if (existing) {
                let users = existing.data().users || [];
                if (!users.includes(currentUser.uid)) {
                    users.push(currentUser.uid);
                    await updateDoc(doc(db, 'monitored_domains', existing.id), { users });
                }
            } else {
                await setDoc(doc(collection(db, 'monitored_domains')), {
                    domain: cleanDomain,
                    users: [currentUser.uid],
                    added_at: serverTimestamp()
                });
            }
            setNewDomain('');
        } catch (err) {
            console.error("Error adding target:", err);
            alert("Failed to add domain.");
        }
    };

    const removeMonitoredDomain = async (e, domObj) => {
        e.stopPropagation();
        if (!window.confirm(`Stop monitoring ${domObj.domain}?`)) return;
        try {
            let users = domObj.users || [];
            const updatedUsers = users.filter(uid => uid !== currentUser.uid);

            if (updatedUsers.length === 0) {
                await deleteDoc(doc(db, 'monitored_domains', domObj.id));
            } else {
                await updateDoc(doc(db, 'monitored_domains', domObj.id), { users: updatedUsers });
            }

            if (activeDomainFilter === domObj.domain) {
                setActiveDomainFilter(null);
            }
        } catch (err) {
            console.error(err);
            alert("Failed to remove domain.");
        }
    };

    // Mobile Render Logic

    if (!currentUser) {
        return (
            <div className="mobile-app">
                <header className="mobile-header">
                    <div className="logo">
                        <img src="/favicon.png" alt="Logo" />
                        <span>Domain Monitor</span>
                    </div>
                </header>
                <main className="mobile-main centered">
                    <section className="auth-box">
                        <h2>Welcome Back</h2>
                        <form onSubmit={(e) => handleAuth(true, e)}>
                            {/* Simplified auth form for mobile mockup */}
                            <div className="input-group">
                                <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                            </div>
                            <div className="input-group">
                                <input type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
                            </div>
                            <button type="submit" className="btn btn-primary w-full">Sign In</button>
                            <button type="button" onClick={handleGoogleAuth} className="btn btn-secondary w-full mt-4">Continue with Google</button>
                            {authError && <div className="error-msg">{authError}</div>}
                        </form>
                    </section>
                </main>
            </div>
        );
    }

    // Active domain's impostors
    const displayedImpostors = activeDomainFilter
        ? impostors.filter(imp => imp.original_domain === activeDomainFilter)
        : impostors;

    // Sort high confidence first
    const sortedImpostors = [...displayedImpostors].sort((a, b) => (b.confidence_level || 0) - (a.confidence_level || 0));

    return (
        <div className="mobile-app">
            <header className="mobile-header">
                <div className="logo">
                    <img src="/favicon.png" alt="Logo" />
                    <span>Domain Monitor</span>
                </div>
                <div className="header-actions">
                    {/* Maybe a quick add button here later */}
                </div>
            </header>

            <main className="mobile-main">
                {activeTab === 'dashboard' && (
                    <>
                        <section className="mobile-section">
                            <div className="section-header">
                                <h3>Monitored Targets</h3>
                            </div>
                            <form className="mobile-add-form" onSubmit={addDomain}>
                                <input type="text" required placeholder="example.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
                                <button type="submit" className="btn btn-primary">+</button>
                            </form>

                            <div className="chips-container">
                                <div
                                    className={`chip ${activeDomainFilter === null ? 'active' : ''}`}
                                    onClick={() => setActiveDomainFilter(null)}
                                >
                                    Global View
                                </div>
                                {userDomains.map(d => (
                                    <div
                                        key={d.id}
                                        className={`chip ${activeDomainFilter === d.domain ? 'active' : ''}`}
                                        onClick={() => setActiveDomainFilter(d.domain)}
                                    >
                                        {d.original_favicon && <img src={d.original_favicon} alt="" className="chip-icon" />}
                                        {d.domain}
                                        <span className="chip-delete" onClick={(e) => removeMonitoredDomain(e, d)}><X size={12} /></span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="mobile-section flex-1">
                            <div className="section-header">
                                <h3>{activeDomainFilter ? `Resolving: ${activeDomainFilter}` : 'All Resolved Impostors'}</h3>
                                <span className="badge error">{sortedImpostors.length}</span>
                            </div>

                            <div className="cards-container">
                                {sortedImpostors.length === 0 ? (
                                    <div className="empty-state">No resolving impostors detected.</div>
                                ) : (
                                    sortedImpostors.map(imp => {
                                        const isRes = (imp.a_records && imp.a_records.length > 0) || (imp.aaaa_records && imp.aaaa_records.length > 0) || (imp.mx_records && imp.mx_records.length > 0);
                                        const decoded = punycodeToUnicode(imp.impostor_domain);
                                        const isPuny = decoded !== imp.impostor_domain;

                                        return (
                                            <div key={imp.id} className="impostor-card">
                                                <div className="card-top">
                                                    <div className="domain-info">
                                                        <h4>{decoded}</h4>
                                                        {isPuny && <span className="puny-sub">({imp.impostor_domain})</span>}
                                                        <div className="original-ref">Target: {imp.original_domain}</div>
                                                    </div>
                                                    <div className={`confidence-badge ${imp.confidence_level > 70 ? 'high' : imp.confidence_level > 40 ? 'med' : 'low'}`}>
                                                        {imp.confidence_level}%
                                                    </div>
                                                </div>

                                                <div className="card-records">
                                                    {(imp.a_records?.length > 0 || imp.aaaa_records?.length > 0) && <span className="record-tag active">A/AAAA</span>}
                                                    {imp.mx_records?.length > 0 && <span className="record-tag active">MX</span>}
                                                    {imp.txt_records?.some(r => r.includes('v=spf1') || r.includes('v=DMARC1')) && <span className="record-tag active">TXT (SPF/DMARC)</span>}
                                                </div>

                                                <div className="card-footer">
                                                    <span className="scanned-date">
                                                        Last scanned: {imp.last_scanned ? imp.last_scanned.toDate().toLocaleDateString() : 'N/A'}
                                                    </span>
                                                    {/* Add more actions here if necessary */}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </section>
                    </>
                )}

                {activeTab === 'settings' && (
                    <section className="mobile-section flex-1 centered-content">
                        <div className="user-profile">
                            <div className="avatar">{currentUser.email.charAt(0).toUpperCase()}</div>
                            <h3>{currentUser.email}</h3>
                            <span className="role-badge">{currentRole}</span>

                            <button onClick={() => signOut(auth)} className="btn btn-secondary mt-4 w-full">
                                <LogOut size={16} className="inline mr-2" /> Sign Out
                            </button>
                        </div>
                    </section>
                )}
            </main>

            <nav className="bottom-tab-bar">
                <button
                    className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                >
                    <LayoutDashboard size={20} />
                    <span>Monitor</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    <Settings size={20} />
                    <span>Settings</span>
                </button>
            </nav>
        </div>
    );
}

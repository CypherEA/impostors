import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, LogOut, LayoutDashboard, Settings, Eye, RefreshCw, Activity, X, Trash2, TriangleAlert, Download, Image as ImageIcon } from 'lucide-react';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "firebase/auth";
import {
    collection, doc, setDoc, getDoc, getDocs, updateDoc,
    deleteDoc, query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "firebase/firestore";
import { auth, googleProvider, db } from './firebase';
import { toUnicode } from 'idna-uts46-hx';
import './mobile.css';

function punycodeToUnicode(domain) {
    if (!domain.includes('xn--')) return domain;
    try {
        return toUnicode(domain);
    } catch (e) {
        return domain;
    }
}

function useSortableData(items, config = null) {
    const [sortConfig, setSortConfig] = useState(config);

    const sortedItems = useMemo(() => {
        let sortableItems = [...items];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                if (sortConfig.key === 'last_scanned' || sortConfig.key === 'first_detected_at') {
                    aValue = aValue ? aValue.toMillis() : 0;
                    bValue = bValue ? bValue.toMillis() : 0;
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [items, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return { items: sortedItems, requestSort, sortConfig };
}


export default function MobileApp() {
    const [currentUser, setCurrentUser] = useState(null);
    const [currentRole, setCurrentRole] = useState('user');
    const [activeTab, setActiveTab] = useState('dashboard');
    const [authError, setAuthError] = useState('');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [newDomain, setNewDomain] = useState('');
    const [userDomains, setUserDomains] = useState([]);
    const [impostors, setImpostors] = useState([]);
    const [activeDomainFilter, setActiveDomainFilter] = useState(null);

    // Popup State
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [popupDomain, setPopupDomain] = useState(null);
    const [popupData, setPopupData] = useState([]);
    const [isPopupLoading, setIsPopupLoading] = useState(false);
    const [selectedImpostors, setSelectedImpostors] = useState(new Set());
    const [activeScreenshot, setActiveScreenshot] = useState(null);

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
            const resolving = [];
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                const isResolving = data.records && Object.values(data.records).some(v => v === true);
                if (isResolving) resolving.push({ id: docSnap.id, ...data });
            });
            setImpostors(resolving);
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

    const openDomainPopup = async (domainStr) => {
        setPopupDomain(domainStr);
        setIsPopupOpen(true);
        setIsPopupLoading(true);
        setSelectedImpostors(new Set());

        try {
            const qImpostors = query(collection(db, 'generated_impostors'), where('original_domain', '==', domainStr));
            const snap = await getDocs(qImpostors);
            const data = [];
            snap.forEach(d => data.push(d.data()));
            data.sort((a, b) => b.confidence_level - a.confidence_level);
            setPopupData(data);
        } catch (err) {
            console.error(err);
            alert("Failed to load domain permutations.");
        } finally {
            setIsPopupLoading(false);
        }
    };

    const toggleSelection = (impostorDomain) => {
        const newSet = new Set(selectedImpostors);
        if (newSet.has(impostorDomain)) {
            newSet.delete(impostorDomain);
        } else {
            newSet.add(impostorDomain);
        }
        setSelectedImpostors(newSet);
    };

    const toggleAllSelected = () => {
        if (selectedImpostors.size === popupData.length) {
            setSelectedImpostors(new Set());
        } else {
            setSelectedImpostors(new Set(popupData.map(d => d.impostor_domain)));
        }
    };

    const exportPopupData = () => {
        const toExport = selectedImpostors.size > 0
            ? popupData.filter(d => selectedImpostors.has(d.impostor_domain))
            : popupData;
        if (toExport.length === 0) return;

        const headers = ['Impostor Domain', 'Original Domain', 'Confidence Score', 'Resolved A', 'Resolved MX', 'Resolved TXT', 'Last Scanned', 'Detected by App', 'Actual Reg Date'];
        const csvContent = [
            headers.join(','),
            ...toExport.map(row => {
                return [
                    row.impostor_domain, row.original_domain, row.confidence_level,
                    row.records?.A ? 'Yes' : 'No', row.records?.MX ? 'Yes' : 'No', row.records?.TXT ? 'Yes' : 'No',
                    row.last_scanned ? row.last_scanned.toDate().toISOString() : '',
                    row.first_detected_at ? row.first_detected_at.toDate().toISOString() : '',
                    row.registry_created_at ? row.registry_created_at : 'Unknown'
                ].join(',');
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `permutations_${popupDomain}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const pingRender = () => {
        fetch('https://impostors-5nty.onrender.com', { mode: 'no-cors' }).catch(() => { });
    };

    const triggerOnDemandScan = async () => {
        const targets = selectedImpostors.size > 0 ? Array.from(selectedImpostors) : popupData.map(d => d.impostor_domain);
        if (targets.length === 0) return;
        if (!window.confirm(`Queue manual scan for ${targets.length} domains?`)) return;
        pingRender();
        try {
            for (const t of targets) {
                await updateDoc(doc(db, 'generated_impostors', t), { force_scan: true });
            }
            alert(`Queued ${targets.length} domains for manual scanning!`);
        } catch (err) {
            alert("Error queuing scan: " + err.message);
        }
    };

    const triggerRegenerateList = async () => {
        if (!popupDomain) return;
        if (!window.confirm(`Regenerate all combinations for ${popupDomain}?`)) return;
        pingRender();
        try {
            await updateDoc(doc(db, 'monitored_domains', popupDomain), { processed_by_worker: false });
            alert(`Regeneration queued for ${popupDomain}!`);
        } catch (err) {
            alert("Error: " + err.message);
        }
    };

    const removeImpostor = async (impostorDomain) => {
        if (!window.confirm(`Permanently ignore ${impostorDomain}?`)) return;
        try {
            await deleteDoc(doc(db, 'generated_impostors', impostorDomain));
            const newSel = new Set(selectedImpostors);
            newSel.delete(impostorDomain);
            setSelectedImpostors(newSel);
            setPopupData(popupData.filter(d => d.impostor_domain !== impostorDomain));
        } catch (err) {
            alert("Error removing impostor: " + err.message);
        }
    };

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

    const displayedImpostors = activeDomainFilter
        ? impostors.filter(imp => imp.original_domain === activeDomainFilter)
        : impostors;
    const sortedImpostors = [...displayedImpostors].sort((a, b) => (b.confidence_level || 0) - (a.confidence_level || 0));

    return (
        <div className="mobile-app">

            {isPopupOpen && (
                <div className="modal-overlay" style={{ zIndex: 100, position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div className="mobile-modal-content" style={{ background: '#0d1117', width: '95%', height: '90%', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div className="modal-header" style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '1rem', margin: 0 }}>Permutations: <span className="text-primary">{popupDomain}</span></h3>
                            <button onClick={() => setIsPopupOpen(false)} style={{ background: 'none', border: 'none', color: '#fff' }}><X size={20} /></button>
                        </div>

                        <div className="modal-actions" style={{ padding: '1rem', display: 'flex', gap: '0.5rem', overflowX: 'auto', flexShrink: 0 }}>
                            <button onClick={exportPopupData} className="btn btn-secondary btn-sm" disabled={popupData.length === 0} style={{ whiteSpace: 'nowrap' }}>
                                <Download size={14} className="inline mr-1" /> Export {selectedImpostors.size > 0 ? `(${selectedImpostors.size})` : 'All'}
                            </button>
                            <button onClick={triggerRegenerateList} className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                                <RefreshCw size={14} className="inline mr-1" /> Regenerate
                            </button>
                            <button onClick={triggerOnDemandScan} className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                                <Activity size={14} className="inline mr-1" /> Scan Now
                            </button>
                        </div>

                        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                            {isPopupLoading ? (
                                <div style={{ textAlign: 'center', color: '#8b949e', marginTop: '2rem' }}>Loading data...</div>
                            ) : (
                                <div className="cards-container">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
                                        <input type="checkbox" onChange={toggleAllSelected} checked={popupData.length > 0 && selectedImpostors.size === popupData.length} />
                                        <span style={{ fontSize: '0.8rem', color: '#8b949e' }}>Select All ({popupData.length})</span>
                                    </div>
                                    {popupData.length === 0 ? (
                                        <div className="empty-state" style={{ textAlign: 'center', fontSize: '0.9rem', color: '#8b949e' }}>No permutations found.</div>
                                    ) : (
                                        popupData.map(imp => {
                                            const isRes = (imp.records?.A) || (imp.records?.MX) || (imp.records?.TXT);
                                            const decoded = punycodeToUnicode(imp.impostor_domain);
                                            const isPuny = decoded !== imp.impostor_domain;

                                            return (
                                                <div key={imp.impostor_domain} className="impostor-card" style={{ display: 'flex', flexDirection: 'row', gap: '1rem', alignItems: 'flex-start' }}>
                                                    <div style={{ paddingTop: '0.2rem' }}>
                                                        <input type="checkbox" checked={selectedImpostors.has(imp.impostor_domain)} onChange={() => toggleSelection(imp.impostor_domain)} />
                                                    </div>
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                        <div className="card-top">
                                                            <div className="domain-info">
                                                                <h4>{decoded}</h4>
                                                                {isPuny && <span className="puny-sub">({imp.impostor_domain})</span>}
                                                            </div>
                                                            <div className={`confidence-badge ${imp.confidence_level > 70 ? 'high' : imp.confidence_level > 40 ? 'med' : 'low'}`}>
                                                                {imp.confidence_level}%
                                                            </div>
                                                        </div>
                                                        <div className="card-records">
                                                            {isRes ? <span className="badge error">Resolving</span> : <span className="badge" style={{ background: 'rgba(255,255,255,0.1)' }}>Not Resolving</span>}
                                                            {(imp.records?.A) && <span className="record-tag active">A</span>}
                                                            {imp.records?.MX && <span className="record-tag active">MX</span>}
                                                            {imp.records?.TXT && <span className="record-tag active">TXT</span>}
                                                        </div>
                                                        <div className="card-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
                                                            <span className="scanned-date">
                                                                {imp.last_scanned ? new Date(imp.last_scanned.toMillis()).toLocaleDateString() : 'Unscanned'}
                                                            </span>
                                                            <button onClick={() => removeImpostor(imp.impostor_domain)} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: '0 5px' }}>
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}


            <header className="mobile-header">
                <div className="logo">
                    <img src="/favicon.png" alt="Logo" />
                    <span>Domain Monitor</span>
                </div>
                <div className="header-actions">
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {activeDomainFilter && (
                                        <button onClick={() => openDomainPopup(activeDomainFilter)} className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.6rem' }}>
                                            <Eye size={12} className="inline mr-1" /> Perms
                                        </button>
                                    )}
                                    <span className="badge error" style={{ fontSize: '0.85rem' }}>{sortedImpostors.length}</span>
                                </div>
                            </div>

                            <div className="cards-container">
                                {sortedImpostors.length === 0 ? (
                                    <div className="empty-state" style={{ textAlign: 'center', margin: '2rem 0' }}>No resolving impostors detected.</div>
                                ) : (
                                    sortedImpostors.map(imp => {
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
                                                    {(imp.records?.A) && <span className="record-tag active">A/AAAA</span>}
                                                    {imp.records?.MX && <span className="record-tag active">MX</span>}
                                                    {imp.records?.TXT && <span className="record-tag active">TXT (SPF/DMARC)</span>}
                                                    {imp.safebrowsing_flagged && <span className="record-tag active" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}><TriangleAlert size={10} className="inline" /> Flagged</span>}
                                                </div>

                                                <div className="card-footer">
                                                    <span className="scanned-date">
                                                        Last scanned: {imp.last_scanned ? new Date(imp.last_scanned.toMillis()).toLocaleDateString() : 'N/A'}
                                                    </span>
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

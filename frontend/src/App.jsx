import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, LogOut, LayoutDashboard, Settings, Eye, Download, RefreshCw, Activity, X, Trash2, Image as ImageIcon, TriangleAlert, ChevronUp, ChevronDown } from 'lucide-react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc,
  arrayUnion, arrayRemove, deleteDoc, query, where, onSnapshot, serverTimestamp
} from "firebase/firestore";
import { auth, googleProvider, db } from './firebase';
import punycode from 'punycode/';

// Real Punycode Decoder using NPM package
function punycodeToUnicode(domain) {
  if (!domain.includes('xn--')) return domain;

  try {
    return punycode.toUnicode(domain);
  } catch (e) {
    return domain;
  }
}

// Custom Hook for Table Sorting
function useSortableData(items, config = null) {
  const [sortConfig, setSortConfig] = useState(config);

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // Handle specific nested/complex fields if necessary
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
    if (
      sortConfig &&
      sortConfig.key === key &&
      sortConfig.direction === 'ascending'
    ) {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  return { items: sortedItems, requestSort, sortConfig };
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentRole, setCurrentRole] = useState('user');
  const [activeView, setActiveView] = useState('auth'); // auth, dashboard, admin
  const [authError, setAuthError] = useState('');

  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Domain State
  const [newDomain, setNewDomain] = useState('');
  const [userDomains, setUserDomains] = useState([]);
  const [impostors, setImpostors] = useState([]);
  const { items: sortedImpostors, requestSort, sortConfig } = useSortableData(impostors, { key: 'confidence_level', direction: 'descending' });
  const [activeDomainFilter, setActiveDomainFilter] = useState(null);

  // Popup / Generated Potentials State
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [popupDomain, setPopupDomain] = useState(null);
  const [popupData, setPopupData] = useState([]);
  const { items: sortedPopupData, requestSort: requestPopupSort, sortConfig: popupSortConfig } = useSortableData(popupData, { key: 'confidence_level', direction: 'descending' });
  const [isPopupLoading, setIsPopupLoading] = useState(false);
  const [selectedImpostors, setSelectedImpostors] = useState(new Set());
  const [activeScreenshot, setActiveScreenshot] = useState(null);

  // Admin State
  const [adminData, setAdminData] = useState([]);
  const { items: sortedAdminData, requestSort: requestAdminSort, sortConfig: adminSortConfig } = useSortableData(adminData, { key: 'added', direction: 'descending' });

  // Listen for Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);

        // Ensure user doc exists and fetch role
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        let role = 'user';
        if (!userSnap.exists()) {
          await setDoc(userRef, { email: user.email, role: 'user', createdAt: serverTimestamp() });
        } else {
          role = userSnap.data().role || 'user';
        }

        setCurrentRole(role);
        setActiveView('dashboard');
      } else {
        setCurrentUser(null);
        setCurrentRole('user');
        setActiveView('auth');
        setUserDomains([]);
        setImpostors([]);
        setAdminData([]);
        setActiveDomainFilter(null);
        setIsPopupOpen(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Listen for domains when user logs in and switch to dashboard
  useEffect(() => {
    if (!currentUser || activeView !== 'dashboard') return;

    const qDomains = query(collection(db, 'monitored_domains'), where('users', 'array-contains', currentUser.uid));

    const unsub = onSnapshot(qDomains, (snapshot) => {
      const domainsInfo = [];
      const domainsList = [];

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        domainsInfo.push({ id: docSnap.id, ...data });
        domainsList.push(data.domain);
      });

      setUserDomains(domainsInfo);

      // Load impostors if any domains exist
      if (domainsList.length > 0) {
        loadImpostors(domainsList);
      } else {
        setImpostors([]); // clear
      }
    });

    return () => unsub();
  }, [currentUser, activeView]);

  // Load Admin Data when switching to Admin View
  useEffect(() => {
    if (activeView !== 'admin') return;

    const fetchAdmin = async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const userMap = {};
        usersSnap.forEach(u => userMap[u.id] = u.data().email);

        const domainSnap = await getDocs(collection(db, 'monitored_domains'));
        const adminItems = [];

        domainSnap.forEach(d => {
          const data = d.data();
          const emails = data.users.map(uid => userMap[uid] || uid).join(', ');
          adminItems.push({
            domain: data.domain,
            emails,
            added: data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Unknown'
          });
        });
        setAdminData(adminItems);
      } catch (err) {
        console.error("Admin error:", err);
      }
    };
    fetchAdmin();
  }, [activeView]);

  const loadImpostors = (domainsList) => {
    const queryDomains = domainsList.slice(0, 10);
    const qImpostors = query(collection(db, 'generated_impostors'), where('original_domain', 'in', queryDomains));

    // Notice this listener doesn't return unsub right now to avoid complex cleanup tracking in React
    // for multiple dynamic chunks. In prod, careful unmounting is needed.
    onSnapshot(qImpostors, (snapshot) => {
      const imps = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const hasResolutions = Object.values(data.records).some(v => v === true);
        if (hasResolutions) imps.push(data);
      });
      setImpostors(imps);
    });
  };

  // --- Popup & Export Logic ---
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

      // Sort by confidence highest first
      data.sort((a, b) => b.confidence_level - a.confidence_level);
      setPopupData(data);
    } catch (err) {
      console.error(err);
      alert("Failed to load potential domains.");
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
      setSelectedImpostors(new Set()); // deselect all
    } else {
      setSelectedImpostors(new Set(popupData.map(d => d.impostor_domain))); // select all
    }
  };

  const exportPopupData = () => {
    // If some are selected, export only those. Otherwise export all in the popup.
    const toExport = selectedImpostors.size > 0
      ? popupData.filter(d => selectedImpostors.has(d.impostor_domain))
      : popupData;

    if (toExport.length === 0) return;

    // CSV Headers
    const headers = ['Impostor Domain', 'Original Domain', 'Confidence Score', 'Resolved A', 'Resolved MX', 'Resolved TXT', 'Last Scanned', 'Detected by App', 'Actual Reg Date'];

    const csvContent = [
      headers.join(','),
      ...toExport.map(row => {
        return [
          row.impostor_domain,
          row.original_domain,
          row.confidence_level,
          row.records.A ? 'Yes' : 'No',
          row.records.MX ? 'Yes' : 'No',
          row.records.TXT ? 'Yes' : 'No',
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
    link.setAttribute("download", `impostors_export_${popupDomain}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Silently wake up the free Render.com backend container
  const pingRender = () => {
    fetch('https://impostors-5nty.onrender.com', { mode: 'no-cors' }).catch(() => { });
  };

  const removeMonitoredDomain = async (e, domainObj) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to stop monitoring ${domainObj.domain}?`)) return;

    try {
      const domainRef = doc(db, 'monitored_domains', domainObj.domain);

      if (domainObj.users.length > 1) {
        await updateDoc(domainRef, { users: arrayRemove(currentUser.uid) });
      } else {
        await deleteDoc(domainRef);
        const qImpostors = query(collection(db, 'generated_impostors'), where('original_domain', '==', domainObj.domain));
        const snap = await getDocs(qImpostors);
        snap.forEach(d => deleteDoc(d.ref));
      }

      if (activeDomainFilter === domainObj.domain) setActiveDomainFilter(null);
    } catch (err) {
      alert("Error removing domain: " + err.message);
    }
  };

  const removeImpostor = async (impostorDomain) => {
    if (!window.confirm(`Are you sure you want to permanently ignore ${impostorDomain}?`)) return;
    try {
      await deleteDoc(doc(db, 'generated_impostors', impostorDomain));
      const newSel = new Set(selectedImpostors);
      newSel.delete(impostorDomain);
      setSelectedImpostors(newSel);
    } catch (err) {
      alert("Error removing impostor: " + err.message);
    }
  };

  const triggerOnDemandScan = async () => {
    const targets = selectedImpostors.size > 0
      ? Array.from(selectedImpostors)
      : popupData.map(d => d.impostor_domain);

    if (targets.length === 0) return;
    if (!window.confirm(`Queue manual scan for ${targets.length} domains?`)) return;

    pingRender();

    try {
      for (const t of targets) {
        await updateDoc(doc(db, 'generated_impostors', t), { force_scan: true });
      }
      alert(`Successfully queued ${targets.length} domains for immediate backend scanning!`);
    } catch (err) {
      alert("Error queuing scan: " + err.message);
    }
  };

  const triggerRegenerateList = async () => {
    if (!popupDomain) return;
    if (!window.confirm(`Are you sure you want to regenerate all impostor combinations for ${popupDomain}?`)) return;

    pingRender();

    try {
      await updateDoc(doc(db, 'monitored_domains', popupDomain), {
        processed_by_worker: false // setting this to false triggers the backend onSnapshot logic
      });
      alert(`Regeneration queued for ${popupDomain}! Check back in a few moments.`);
    } catch (err) {
      alert("Error submitting regeneration request: " + err.message);
    }
  };

  // --- Auth Handlers ---
  const handleAuth = async (isLogin, e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      setEmail('');
      setPassword('');
    } catch (err) {
      setAuthError(err.message);
      setTimeout(() => setAuthError(''), 5000);
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err.message);
      setTimeout(() => setAuthError(''), 5000);
    }
  };

  const addDomain = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    pingRender();

    try {
      const domainRef = doc(db, 'monitored_domains', domain);
      const docSnap = await getDoc(domainRef);

      if (docSnap.exists()) {
        await updateDoc(domainRef, { users: arrayUnion(currentUser.uid) });
      } else {
        await setDoc(domainRef, {
          domain,
          users: [currentUser.uid],
          createdAt: serverTimestamp()
        });
      }
      setNewDomain('');
    } catch (err) {
      alert("Error adding domain: " + err.message);
    }
  };

  return (
    <>
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>

      {/* Generated Potentials Modal */}
      {isPopupOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Generated Potentials for: <span className="text-primary">{popupDomain}</span></h3>
              <button onClick={() => setIsPopupOpen(false)} className="nav-btn"><X size={24} /></button>
            </div>

            <div className="modal-actions" style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button onClick={exportPopupData} className="btn btn-secondary btn-sm" disabled={popupData.length === 0}>
                <Download size={14} className="inline mr-1 -mt-1" />
                Export {selectedImpostors.size > 0 ? `Selected (${selectedImpostors.size})` : 'All'}
              </button>
              <button onClick={triggerRegenerateList} className="btn btn-secondary btn-sm">
                <RefreshCw size={14} className="inline mr-1 -mt-1" /> Regenerate List
              </button>
              <button onClick={triggerOnDemandScan} className="btn btn-primary btn-sm">
                <Activity size={14} className="inline mr-1 -mt-1" /> Run Manual Scan Now
              </button>
            </div>

            <div className="table-container" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {isPopupLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading data...</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}><input type="checkbox" onChange={toggleAllSelected} checked={sortedPopupData.length > 0 && selectedImpostors.size === sortedPopupData.length} /></th>
                      <th onClick={() => requestPopupSort('impostor_domain')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Impostor Domain {popupSortConfig?.key === 'impostor_domain' ? (popupSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                      <th onClick={() => requestPopupSort('confidence_level')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Confidence {popupSortConfig?.key === 'confidence_level' ? (popupSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                      <th>Is Resolving</th>
                      <th onClick={() => requestPopupSort('last_scanned')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Last Checked {popupSortConfig?.key === 'last_scanned' ? (popupSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPopupData.length === 0 ? (
                      <tr><td colSpan="6" className="empty-state">No generated potentials found yet.</td></tr>
                    ) : (
                      sortedPopupData.map(d => {
                        const confColor = d.confidence_level > 70 ? 'var(--danger)' : (d.confidence_level > 40 ? '#d29922' : 'var(--success)');
                        const isRes = d.records && (d.records.A || d.records.MX || d.records.TXT);
                        return (
                          <tr key={d.impostor_domain}>
                            <td><input type="checkbox" checked={selectedImpostors.has(d.impostor_domain)} onChange={() => toggleSelection(d.impostor_domain)} /></td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {punycodeToUnicode(d.impostor_domain) !== d.impostor_domain ? (
                                  <>
                                    <span style={{ fontWeight: 600 }}>{punycodeToUnicode(d.impostor_domain)}</span>
                                    <span className="subtitle" style={{ fontSize: '0.8rem' }}>({d.impostor_domain})</span>
                                  </>
                                ) : (
                                  <span style={{ fontWeight: 600 }}>{d.impostor_domain}</span>
                                )}
                                {d.screenshot_url && (
                                  <button onClick={() => setActiveScreenshot(d.screenshot_url)} className="btn btn-ghost btn-sm" style={{ padding: '0 5px' }} title="View Screenshot">
                                    <ImageIcon size={14} className="text-primary" />
                                  </button>
                                )}
                                {d.safebrowsing_flagged && (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--danger)', marginLeft: '4px' }} title="Flagged as Malicious/Phishing by Google SafeBrowsing">
                                    <TriangleAlert size={16} />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td><span style={{ color: confColor, fontWeight: 600 }}>{d.confidence_level}%</span></td>
                            <td>
                              {isRes ? <span className="badge error">Yes</span> : <span className="badge">No</span>}
                            </td>
                            <td className="subtitle" style={{ fontSize: '0.8rem' }}>
                              {d.last_scanned ? d.last_scanned.toDate().toLocaleDateString() : 'N/A'}
                            </td>
                            <td>
                              <button onClick={() => removeImpostor(d.impostor_domain)} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: '5px' }}>
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="app-container">
        <header className="navbar">
          <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/favicon.png" alt="Domain Monitor Logo" style={{ width: '48px', height: '48px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.1' }}>
              <span style={{ fontSize: '1.3rem' }}>Domain Monitor</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>by BoilermakerGRC</span>
            </div>
          </div>

          {currentUser && (
            <nav>
              <button
                className={`nav-btn ${activeView === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveView('dashboard')}
              >
                <LayoutDashboard size={18} className="inline mr-1 -mt-1" /> Dashboard
              </button>

              {currentRole === 'admin' && (
                <button
                  className={`nav-btn ${activeView === 'admin' ? 'active' : ''}`}
                  onClick={() => setActiveView('admin')}
                >
                  <Settings size={18} className="inline mr-1 -mt-1" /> Admin
                </button>
              )}

              <div className="user-block">
                <span>{currentUser.email}</span>
                <button onClick={() => signOut(auth)} className="btn btn-secondary btn-sm">
                  <LogOut size={14} className="inline mr-1 -mt-1" /> Sign Out
                </button>
              </div>
            </nav>
          )}
        </header>

        <main style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* Auth View */}
          {activeView === 'auth' && (
            <section className="view auth-box">
              <h2>Welcome Back</h2>
              <p className="subtitle">Sign in to monitor your digital assets.</p>
              <form onSubmit={(e) => handleAuth(true, e)}>
                <div className="input-group">
                  <label>Email Address</label>
                  <input type="email" required placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>Password</label>
                  <input type="password" required placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-primary w-full">Sign In</button>
                <button type="button" onClick={(e) => handleAuth(false, e)} className="btn btn-ghost w-full mt-4">Create Account</button>
                <div style={{ margin: '1rem 0', display: 'flex', alignItems: 'center', opacity: 0.5 }}>
                  <span style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></span>
                  <span style={{ padding: '0 10px', fontSize: '0.8rem' }}>OR</span>
                  <span style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></span>
                </div>
                <button type="button" onClick={handleGoogleAuth} className="btn btn-secondary w-full" style={{ display: 'flex', gap: '0.5rem' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12v4.57h5.92c-.26 1.5-1.14 2.76-2.43 3.63v3.01h3.94c2.31-2.12 3.13-5.26 3.13-8.96z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.94-3.01c-.98.66-2.23 1.05-3.34 1.05-2.57 0-4.74-1.74-5.52-4.08H2.39v3.1C4.21 21.01 7.82 23 12 23z" fill="#34A853" />
                    <path d="M6.48 14.3A6.71 6.71 0 016.14 12c0-.79.14-1.55.35-2.28v-3.1H2.39A10.99 10.99 0 001 12c0 1.77.43 3.44 1.19 4.93l4.29-2.63z" fill="#FBBC05" />
                    <path d="M12 4.93c1.62 0 3.07.56 4.22 1.66l3.17-3.17C17.46 1.66 14.97.7 12 .7 7.82.7 4.21 2.68 2.39 6.22l4.09 3.1C7.26 6.98 9.43 4.93 12 4.93z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
                {authError && <div className="error-msg">{authError}</div>}
              </form>
            </section>
          )}

          {/* Dashboard View (Master-Detail Sidebar Layout) */}
          {activeView === 'dashboard' && (
            <div className="dashboard-layout">
              {/* Sidebar (Master) */}
              <div className="sidebar">
                <div className="sidebar-header">
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Monitored Domains</h3>
                  <p className="subtitle" style={{ fontSize: '0.75rem', marginBottom: '1rem' }}>Add a root domain to monitor for impersonation.</p>

                  <form className="add-domain-form" onSubmit={addDomain} style={{ flexDirection: 'column', gap: '0.5rem' }}>
                    <input type="text" required placeholder="example.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} style={{ width: '100%' }} />
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Add Target</button>
                  </form>
                </div>

                {/* Mobile Dropdown (Visible only at <= 900px) */}
                <div className="mobile-domain-selector">
                  <select
                    value={activeDomainFilter || ""}
                    onChange={e => setActiveDomainFilter(e.target.value === "" ? null : e.target.value)}
                  >
                    <option value="">Select a Domain to View...</option>
                    {userDomains.map(d => (
                      <option key={d.id} value={d.domain}>{d.domain}</option>
                    ))}
                  </select>
                </div>

                {/* Desktop List (Hidden at <= 900px) */}
                <div className="sidebar-list">
                  {userDomains.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2rem 1rem', fontSize: '0.8rem' }}>No domains monitored yet.</div>
                  ) : (
                    userDomains.map(d => (
                      <div
                        key={d.id}
                        className={`sidebar-item ${activeDomainFilter === d.domain ? 'active' : ''}`}
                        onClick={() => setActiveDomainFilter(activeDomainFilter === d.domain ? null : d.domain)}
                      >
                        <div className="sidebar-item-content">
                          {d.original_favicon ? (
                            <img src={d.original_favicon} alt="" style={{ width: '16px', height: '16px', borderRadius: '2px' }} />
                          ) : (
                            <div style={{ width: '16px', height: '16px', background: 'var(--border-color)', borderRadius: '2px' }}></div>
                          )}
                          <span className="sidebar-item-domain">{d.domain}</span>
                        </div>
                        <button onClick={(e) => removeMonitoredDomain(e, d)} className="btn btn-ghost btn-sm" title="Remove Domain" style={{ padding: '0 5px', minWidth: '0' }}>
                          <Trash2 size={14} color="var(--danger)" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Main Content (Detail) */}
              <div className="main-content">
                <div className="detail-header" style={{ flexShrink: 0 }}>
                  <div>
                    <h2>{activeDomainFilter ? `Monitoring Detail: ${activeDomainFilter}` : 'Global Impostor View'}</h2>
                    {activeDomainFilter ? (
                      <span className="badge mt-2" style={{ background: 'var(--success-bg)', color: 'var(--success)', display: 'inline-block' }}>Active Tracking</span>
                    ) : (
                      <span className="badge mt-2" style={{ background: 'var(--primary-ghost)', color: 'var(--primary)', display: 'inline-block' }}>All Domains</span>
                    )}
                  </div>
                  {activeDomainFilter && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openDomainPopup(activeDomainFilter); }}
                      className="btn btn-secondary"
                    >
                      <Eye size={16} className="inline mr-2 -mt-1" /> View Generation Matrix
                    </button>
                  )}
                </div>

                <div className="impostors-section" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, paddingBottom: '10px' }}>
                    {activeDomainFilter ? `Resolved Impostors for ${activeDomainFilter}` : 'All Resolved Impostors (Global)'}
                    <span className="badge error">
                      {impostors.filter(imp => activeDomainFilter ? imp.original_domain === activeDomainFilter : true).length}
                    </span>
                  </h3>
                  <div className="table-container" style={{ flex: 1, overflowY: 'auto' }}>
                    <table style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--panel-bg)', zIndex: 10, backdropFilter: 'blur(10px)' }}>
                        <tr>
                          <th onClick={() => requestSort('impostor_domain')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Impostor Domain {sortConfig?.key === 'impostor_domain' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th onClick={() => requestSort('original_domain')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Original {sortConfig?.key === 'original_domain' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th onClick={() => requestSort('confidence_level')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Confidence {sortConfig?.key === 'confidence_level' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th>Detected Records</th>
                          <th onClick={() => requestSort('last_scanned')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Last Scanned {sortConfig?.key === 'last_scanned' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th onClick={() => requestSort('first_detected_at')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            App Detection {sortConfig?.key === 'first_detected_at' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th onClick={() => requestSort('registry_created_at')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Actual Registry Date {sortConfig?.key === 'registry_created_at' ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                          </th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedImpostors.filter(imp => activeDomainFilter ? imp.original_domain === activeDomainFilter : true).length === 0 ? (
                          <tr><td colSpan="8" style={{ textAlign: 'center' }} className="subtitle">
                            {activeDomainFilter ? `No resolving impostor domains detected for ${activeDomainFilter} yet.` : `No resolving impostor domains detected yet.`}
                          </td></tr>
                        ) : (
                          sortedImpostors
                            .filter(imp => activeDomainFilter ? imp.original_domain === activeDomainFilter : true)
                            .map(imp => {
                              const confColor = imp.confidence_level > 70 ? 'var(--danger)' : (imp.confidence_level > 40 ? '#d29922' : 'var(--success)');
                              const isRes = imp.records && (imp.records.A || imp.records.MX || imp.records.TXT);
                              return (
                                <tr key={imp.impostor_domain}>
                                  <td style={{ color: '#fff' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {punycodeToUnicode(imp.impostor_domain) !== imp.impostor_domain ? (
                                        <>
                                          <span style={{ fontWeight: 600 }}>{punycodeToUnicode(imp.impostor_domain)}</span>
                                          <span className="subtitle" style={{ fontSize: '0.8rem' }}>({imp.impostor_domain})</span>
                                        </>
                                      ) : (
                                        <span style={{ fontWeight: 600 }}>{imp.impostor_domain}</span>
                                      )}
                                      {imp.screenshot_url && (
                                        <button onClick={() => setActiveScreenshot(imp.screenshot_url)} className="btn btn-ghost btn-sm" style={{ padding: '0 5px' }} title="View Screenshot">
                                          <ImageIcon size={14} className="text-primary" />
                                        </button>
                                      )}
                                      {imp.safebrowsing_flagged && (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--danger)', marginLeft: '4px' }} title="Flagged as Malicious/Phishing by Google SafeBrowsing">
                                          <TriangleAlert size={16} />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="subtitle">{imp.original_domain}</td>
                                  <td><span style={{ color: confColor, fontWeight: 600 }}>{imp.confidence_level}%</span></td>
                                  <td>
                                    {imp.records.A && <span className="record-tag active">A/AAAA</span>}
                                    {imp.records.MX && <span className="record-tag active">MX</span>}
                                    {imp.records.TXT && <span className="record-tag active">TXT (SPF/DMARC)</span>}
                                  </td>
                                  <td className="subtitle" style={{ fontSize: '0.8rem' }}>
                                    {imp.last_scanned ? imp.last_scanned.toDate().toLocaleString() : 'N/A'}
                                  </td>
                                  <td className="subtitle" style={{ fontSize: '0.8rem' }}>
                                    {imp.first_detected_at ? imp.first_detected_at.toDate().toLocaleDateString() : 'N/A'}
                                  </td>
                                  <td className="subtitle" style={{ fontSize: '0.8rem', color: imp.registry_created_at && imp.registry_created_at !== 'Redacted/Unknown' ? 'var(--danger)' : 'var(--text-muted)' }}>
                                    {imp.registry_created_at ? (imp.registry_created_at === 'Redacted/Unknown' ? 'Redacted' : new Date(imp.registry_created_at).toLocaleDateString()) : 'N/A'}
                                  </td>
                                  <td>
                                    <button onClick={() => removeImpostor(imp.impostor_domain)} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: '5px' }} title="Remove Impostor">
                                      <Trash2 size={16} />
                                    </button>
                                  </td>
                                </tr>
                              )
                            })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Admin View */}
          {activeView === 'admin' && (
            <section className="view">
              <h2>Admin Control Center</h2>
              <p className="subtitle">Global overview of all monitored domains across all users.</p>

              <div className="table-container mt-4">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => requestAdminSort('domain')} style={{ cursor: 'pointer' }}>
                        Domain {adminSortConfig?.key === 'domain' ? (adminSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                      <th onClick={() => requestAdminSort('emails')} style={{ cursor: 'pointer' }}>
                        Tracking Users (Emails) {adminSortConfig?.key === 'emails' ? (adminSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                      <th onClick={() => requestAdminSort('added')} style={{ cursor: 'pointer' }}>
                        Added Date {adminSortConfig?.key === 'added' ? (adminSortConfig.direction === 'ascending' ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />) : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAdminData.length === 0 ? (
                      <tr><td colSpan="3" style={{ textAlign: 'center' }} className="subtitle">No domains registered across the system.</td></tr>
                    ) : (
                      sortedAdminData.map((ad, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 500 }}>{ad.domain}</td>
                          <td className="subtitle">{ad.emails}</td>
                          <td className="subtitle">{ad.added}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      {activeScreenshot && (
        <div className="modal-overlay" onClick={() => setActiveScreenshot(null)}>
          <div className="screenshot-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem' }}>
              <h3>Domain Screenshot</h3>
              <button onClick={() => setActiveScreenshot(null)} className="btn btn-ghost btn-sm" style={{ padding: '5px' }}>
                <X size={20} />
              </button>
            </div>
            <img src={activeScreenshot} alt="Domain Capture" className="screenshot-img" />
          </div>
        </div>
      )}
    </>
  );
}

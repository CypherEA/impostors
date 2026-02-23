import React, { useState, useEffect } from 'react';
import { ShieldCheck, LogOut, LayoutDashboard, Settings } from 'lucide-react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc,
  arrayUnion, query, where, onSnapshot, serverTimestamp
} from "firebase/firestore";
import { auth, googleProvider, db } from './firebase';

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

  // Admin State
  const [adminData, setAdminData] = useState([]);

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

      <div className="app-container">
        <header className="navbar">
          <div className="logo">
            <ShieldCheck className="text-primary" />
            <span>BoilermakerGRC <span className="badge">Monitor</span></span>
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

        <main>
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

          {/* Dashboard View */}
          {activeView === 'dashboard' && (
            <section className="view">
              <div className="dashboard-header">
                <div>
                  <h2>Your Monitored Domains</h2>
                  <p className="subtitle">Add domains to automatically generate and scan for impostors.</p>
                </div>
                <form className="add-domain-form" onSubmit={addDomain}>
                  <input type="text" required placeholder="example.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
                  <button type="submit" className="btn btn-primary">Add Domain</button>
                </form>
              </div>

              <div className="grid">
                {userDomains.length === 0 ? (
                  <div className="empty-state">No domains monitored yet. Add one above!</div>
                ) : (
                  userDomains.map(d => (
                    <div className="card" key={d.id}>
                      <div className="card-title">
                        <span>{d.domain}</span>
                        <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Active</span>
                      </div>
                      <div className="subtitle mt-4" style={{ fontSize: '0.8rem' }}>Added: {d.createdAt ? d.createdAt.toDate().toLocaleDateString() : 'Just now'}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="impostors-section mt-8">
                <h3>Resolved Impostors <span className="badge error">{impostors.length}</span></h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Impostor Domain</th>
                        <th>Original</th>
                        <th>Confidence</th>
                        <th>Detected Records</th>
                        <th>Last Scanned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impostors.length === 0 ? (
                        <tr><td colSpan="5" style={{ textAlign: 'center' }} className="subtitle">No resolving impostor domains detected yet.</td></tr>
                      ) : (
                        impostors.map(imp => {
                          const confColor = imp.confidence_level > 70 ? 'var(--danger)' : (imp.confidence_level > 40 ? '#d29922' : 'var(--success)');
                          return (
                            <tr key={imp.impostor_domain}>
                              <td style={{ fontWeight: 600, color: '#fff' }}>{imp.impostor_domain}</td>
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
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
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
                      <th>Domain</th>
                      <th>Tracking Users (Emails)</th>
                      <th>Added Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminData.length === 0 ? (
                      <tr><td colSpan="3" style={{ textAlign: 'center' }} className="subtitle">No domains registered across the system.</td></tr>
                    ) : (
                      adminData.map((ad, idx) => (
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
    </>
  );
}

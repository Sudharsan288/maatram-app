import { useEffect, useMemo, useState } from "react";
import "./App.css";

import { auth, db } from "./firebase";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

// ------------------------------------
// INITIAL DATA
// ------------------------------------

const initialQueries = [];

const categories = [
  "Scholarship",
  "Financial Assistance",
  "Education",
  "Career Guidance",
  "Personal Support",
  "Other",
];

// ------------------------------------
// ERROR MESSAGES
// ------------------------------------

function getErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use":
      "This email already has an account. Please sign in.",
    "auth/invalid-email":
      "Please enter a valid email address.",
    "auth/weak-password":
      "Please choose a stronger password.",
    "auth/invalid-credential":
      "Incorrect email or password.",
    "auth/user-not-found":
      "No account found with this email.",
    "auth/wrong-password":
      "Incorrect password. Please try again.",
    "auth/network-request-failed":
      "Network error. Check your internet connection.",
    "auth/too-many-requests":
      "Too many attempts. Please try again later.",
    "auth/operation-not-allowed":
      "Email/Password sign-in is not enabled in Firebase.",
    "auth/missing-email":
      "Please enter your email address.",
  };

  return (
    messages[error.code] ||
    `Something went wrong: ${error.code || error.message}`
  );
}

// ------------------------------------
// MAIN APP
// ------------------------------------

function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Authentication
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [userRole, setUserRole] = useState("student");
  const [roleReady, setRoleReady] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Navigation
  const [activePage, setActivePage] = useState("dashboard");
  const [selectedQueryId, setSelectedQueryId] = useState(null);

  // Login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Application
  const [queries, setQueries] = useState(initialQueries);
  const [queriesLoading, setQueriesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  // Query form
  const [form, setForm] = useState({
    title: "",
    category: "Scholarship",
    description: "",
  });

  // ------------------------------------
  // SPLASH SCREEN TIMER
  // ------------------------------------

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 1800);

    return () => clearTimeout(timer);
  }, []);

  // ------------------------------------
  // FIREBASE AUTH LISTENER
  // ------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Reset role loading whenever authentication changes.
      setRoleReady(false);
      setAuthUser(user);

      if (!user) {
        setUserRole("student");
        setRoleReady(true);
      }

      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  // ------------------------------------
  // LOAD SIGNED-IN USER ROLE
  // ------------------------------------

  useEffect(() => {
    if (!authReady || !authUser) return;

    let cancelled = false;

    async function loadRole() {
      try {
        const roleRef = doc(db, "roles", authUser.uid);
        const roleSnapshot = await getDoc(roleRef);

        const role = roleSnapshot.exists()
          ? roleSnapshot.data().role
          : "student";

        if (!cancelled) {
          setUserRole(
            role === "coordinator" ? "coordinator" : "student"
          );

          setRoleReady(true);
        }
      } catch (error) {
        console.error("Error loading user role:", error);

        if (!cancelled) {
          setUserRole("student");
          setRoleReady(true);

          setNotice(
            "Unable to verify your account role. Some features may be unavailable."
          );
        }
      }
    }

    loadRole();

    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  // ------------------------------------
  // LIVE QUERY LOADING
  // ------------------------------------

  useEffect(() => {
    if (!authReady || !authUser || !roleReady) return;

    const queriesRef =
      userRole === "coordinator"
        ? collectionGroup(db, "queries")
        : collection(
            db,
            "users",
            authUser.uid,
            "queries"
          );

    const queriesQuery = query(
      queriesRef,
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      queriesQuery,
      (snapshot) => {
        const loadedQueries = snapshot.docs.map((queryDoc) => {
          const data = queryDoc.data();

          const ownerUid =
            queryDoc.ref.parent.parent?.id || authUser.uid;

          return {
            id: queryDoc.id,
            ownerUid,
            title: data.title || "Untitled query",
            category: data.category || "Other",
            description: data.description || "",
            status: data.status || "Pending",

            date: data.createdAt?.toDate
              ? data.createdAt.toDate().toLocaleDateString("en-IN")
              : "Just now",

            student: data.studentEmail || "Student",
            statusUpdatedAt: data.statusUpdatedAt || null,
          };
        });

        setQueries(loadedQueries);
        setQueriesLoading(false);
      },
      (error) => {
        console.error("Error listening to queries:", error);

        setNotice(
          userRole === "coordinator"
            ? "Unable to load all student queries. Check Firestore rules and indexes."
            : "Unable to load your queries. Please refresh."
        );

        setQueriesLoading(false);
      }
    );

    return unsubscribe;
  }, [authReady, authUser, roleReady, userRole]);

  // ------------------------------------
  // DERIVED DATA
  // ------------------------------------

  const selectedQuery = useMemo(
    () =>
      queries.find(
        (queryItem) => queryItem.id === selectedQueryId
      ),
    [queries, selectedQueryId]
  );

  const pendingCount = queries.filter(
    (item) => item.status === "Pending"
  ).length;

  const progressCount = queries.filter(
    (item) => item.status === "In Progress"
  ).length;

  const resolvedCount = queries.filter(
    (item) => item.status === "Resolved"
  ).length;

  const filteredQueries = queries.filter((queryItem) => {
    const searchText = search.toLowerCase();

    return (
      queryItem.title.toLowerCase().includes(searchText) ||
      queryItem.category.toLowerCase().includes(searchText) ||
      queryItem.status.toLowerCase().includes(searchText) ||
      (
        userRole === "coordinator" &&
        queryItem.student.toLowerCase().includes(searchText)
      )
    );
  });

  // ------------------------------------
  // LOGIN / REGISTER
  // ------------------------------------

  async function handleLogin(event) {
    event.preventDefault();

    if (!email.trim() || !password) {
      setNotice("Please enter your email and password.");
      return;
    }

    setAuthLoading(true);
    setNotice("");

    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        setNotice("Account created successfully!");
      } else {
        await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password
        );

        setNotice("Signed in successfully!");
      }

      setPassword("");
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  // ------------------------------------
  // FORGOT PASSWORD
  // ------------------------------------

  async function handleForgotPassword() {
    if (!email.trim()) {
      setNotice("Please enter your email address first.");
      return;
    }

    setAuthLoading(true);
    setNotice("");

    try {
      await sendPasswordResetEmail(auth, email.trim());

      setNotice(
        "If an account exists for this email, a password reset link has been sent."
      );
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  // ------------------------------------
  // LOGOUT
  // ------------------------------------

  async function handleLogout() {
    try {
      await signOut(auth);

      setQueries([]);
      setPassword("");
      setSelectedQueryId(null);
      setActivePage("dashboard");
      setNotice("");
    } catch {
      setNotice("Unable to sign out. Please try again.");
    }
  }

  // ------------------------------------
  // NAVIGATION
  // ------------------------------------

  function openPage(page) {
    setActivePage(page);
    setSelectedQueryId(null);
    setSearch("");
    setNotice("");
  }

  function openQuery(id) {
    setSelectedQueryId(id);
    setActivePage("details");
    setNotice("");
  }

  // ------------------------------------
  // QUERY FORM
  // ------------------------------------

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  // ------------------------------------
  // SUBMIT QUERY TO FIRESTORE
  // ------------------------------------

  async function submitQuery(event) {
    event.preventDefault();

    if (!form.title.trim() || !form.description.trim()) {
      setNotice("Please complete all required fields.");
      return;
    }

    if (!authUser) {
      setNotice("Please sign in before submitting a query.");
      return;
    }

    setQueriesLoading(true);
    setNotice("");

    try {
      const queriesRef = collection(
        db,
        "users",
        authUser.uid,
        "queries"
      );

      await addDoc(queriesRef, {
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim(),
        status: "Pending",
        createdAt: serverTimestamp(),
        studentEmail: authUser.email,
      });

      setForm({
        title: "",
        category: "Scholarship",
        description: "",
      });

      setNotice("Your query has been submitted successfully!");
      setActivePage("queries");

      const snapshot = await getDocs(
        query(queriesRef, orderBy("createdAt", "desc"))
      );

      const loadedQueries = snapshot.docs.map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,
          ownerUid: authUser.uid,
          title: data.title,
          category: data.category,
          description: data.description,
          status: data.status,
          date: data.createdAt
            ? data.createdAt.toDate().toLocaleDateString("en-IN")
            : "Just now",
          student: data.studentEmail,
          statusUpdatedAt: data.statusUpdatedAt || null,
        };
      });

      setQueries(loadedQueries);
    } catch (error) {
      console.error("Error submitting query:", error);
      setNotice("Unable to submit your query. Please try again.");
    } finally {
      setQueriesLoading(false);
    }
  }

  // ------------------------------------
  // COORDINATOR STATUS UPDATE
  // ------------------------------------

  async function changeStatus(queryItem, status) {
    if (userRole !== "coordinator") {
      setNotice("Only coordinators can update query status.");
      return;
    }

    try {
      const queryRef = doc(
        db,
        "users",
        queryItem.ownerUid,
        "queries",
        queryItem.id
      );

      await updateDoc(queryRef, {
        status,
        statusUpdatedAt: serverTimestamp(),
      });

      setNotice(`Query status updated to ${status}.`);
    } catch (error) {
      console.error("Error updating query status:", error);

      setNotice(
        "Unable to update status. Check Firestore rules and try again."
      );
    }
  }

  // ------------------------------------
  // SPLASH / AUTH LOADING
  // ------------------------------------

  if (
    showSplash ||
    !authReady ||
    (authUser && !roleReady)
  ) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <img
            src="/maatram-logo.png"
            alt="Maatram Foundation"
            className="splash-logo"
          />

          <h1>MAATRAM</h1>
          <p>STUDENT SUPPORT SYSTEM</p>
          <div className="splash-loader"></div>
        </div>
      </div>
    );
  }

  // ------------------------------------
  // LOGIN / REGISTRATION PAGE
  // ------------------------------------

  if (!authUser) {
    return (
      <div className="login-page">
        <div className="login-card">

          <div className="login-logo">
            <img
              src="/maatram-logo.png"
              alt="Maatram Foundation"
            />
          </div>

          <div className="login-heading">
            <span className="eyebrow">
              STUDENT SUPPORT PORTAL
            </span>

            <h2>
              {isRegistering
                ? "Create your account"
                : "Welcome back"}
            </h2>

            <p>
              {isRegistering
                ? "Register to access student support."
                : "Sign in to continue to your student portal."}
            </p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <label htmlFor="email">Email address</label>

            <input
              id="email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label htmlFor="password">Password</label>

            <div className="password-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {!isRegistering && (
              <div className="forgot-password">
                <button
                  type="button"
                  className="text-button"
                  onClick={handleForgotPassword}
                  disabled={authLoading}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              className="primary-button sign-in-button"
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : isRegistering
                ? "Create account"
                : "Sign in"}
            </button>
          </form>

          <p className="auth-switch">
            {isRegistering
              ? "Already have an account?"
              : "Don't have an account?"}

            <button
              type="button"
              className="text-button"
              onClick={() => {
                setIsRegistering((current) => !current);
                setNotice("");
              }}
            >
              {isRegistering ? "Sign in" : "Create account"}
            </button>
          </p>

          {notice && (
            <div className="notice-message">
              {notice}
            </div>
          )}

          <div className="login-footer">
            © 2026 Maatram Foundation
          </div>

        </div>
      </div>
    );
  }
    // ------------------------------------
  // MAIN APPLICATION
  // ------------------------------------

  return (
    <div className="app-shell">

      <aside className="sidebar">

        <div className="sidebar-brand">
          <Brand />
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            {(authUser.email || "S").charAt(0).toUpperCase()}
          </div>

          <div className="user-info">
            <strong>
              {userRole === "coordinator" ? "Coordinator" : "Student"}
            </strong>
            <span>{authUser.email}</span>
          </div>
        </div>

        <nav className="sidebar-nav">

          <span className="nav-label">MENU</span>

          <button
            className={activePage === "dashboard" ? "active" : ""}
            onClick={() => openPage("dashboard")}
          >
            <span>▦</span>
            Dashboard
          </button>

          {/* Raise a Query removed from sidebar */}

          <button
            className={activePage === "queries" ? "active" : ""}
            onClick={() => openPage("queries")}
          >
            <span>☷</span>
            {userRole === "coordinator"
              ? "All Student Queries"
              : "My Queries"}
            <span className="nav-count">{queries.length}</span>
          </button>

          <button
            className={activePage === "notifications" ? "active" : ""}
            onClick={() => openPage("notifications")}
          >
            <span>♧</span>
            Notifications
          </button>

        </nav>

        <div className="sidebar-bottom">

          <div className="sidebar-help">
            <span>
              {userRole === "coordinator"
                ? "Coordinator workspace"
                : "Need assistance?"}
            </span>

            <p>
              {userRole === "coordinator"
                ? "Review student requests and update their progress."
                : "Raise a query and our team will help you."}
            </p>

            <button
              onClick={() =>
                openPage(
                  userRole === "coordinator"
                    ? "queries"
                    : "raise"
                )
              }
            >
              {userRole === "coordinator"
                ? "Review Queries →"
                : "Get Support →"}
            </button>
          </div>

          <button
            className="logout-button"
            onClick={handleLogout}
          >
            <span>↪</span>
            Sign out
          </button>

        </div>

      </aside>

      <main className="main-content">

        <header className="topbar">

          <div>
            <span className="topbar-label">
              MAATRAM FOUNDATION
            </span>

            <h2>
              {activePage === "dashboard" && "Dashboard"}
              {activePage === "raise" && "Raise a Query"}
              {activePage === "queries" &&
                (userRole === "coordinator"
                  ? "All Student Queries"
                  : "My Queries")}
              {activePage === "details" && "Query Details"}
              {activePage === "notifications" && "Notifications"}
            </h2>
          </div>

          <div className="topbar-user">

            <div className="topbar-user-info">
              <strong>Welcome back!</strong>
              <span>{authUser.email}</span>
            </div>

            <div className="user-avatar">
              {(authUser.email || "S").charAt(0).toUpperCase()}
            </div>

          </div>

        </header>

        {notice && (
          <div className="app-notice">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        {/* DASHBOARD */}

        {activePage === "dashboard" && (
          <section className="page-content">

            <div className="welcome-banner">
              <div>
                <span className="eyebrow">
                  {userRole === "coordinator"
                    ? "COORDINATOR PORTAL"
                    : "STUDENT PORTAL"}
                </span>

                <h1>
                  Hello,{" "}
                  <span>
                    {userRole === "coordinator"
                      ? "Coordinator!"
                      : "Student!"}
                  </span>
                </h1>

                <p>
                  {userRole === "coordinator"
                    ? "Review student requests and help them move forward."
                    : "Your journey matters. Let us know how we can support you."}
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    openPage(
                      userRole === "coordinator"
                        ? "queries"
                        : "raise"
                    )
                  }
                >
                  {userRole === "coordinator"
                    ? "View All Queries"
                    : "+ Raise a Query"}
                </button>
              </div>

              <div className="welcome-decoration">M</div>
            </div>

            <div className="section-heading">
              <div>
                <h3>Overview</h3>
                <p>
                  {userRole === "coordinator"
                    ? "Overview of all student support requests."
                    : "Here is a summary of your support requests."}
                </p>
              </div>
            </div>

            <div className="stats-grid">

              <StatCard
                title="Total Queries"
                value={queries.length}
                icon="☷"
                description="All submitted queries"
              />

              <StatCard
                title="Pending"
                value={pendingCount}
                icon="◷"
                description="Waiting for review"
              />

              <StatCard
                title="In Progress"
                value={progressCount}
                icon="↻"
                description="Currently being handled"
              />

              <StatCard
                title="Resolved"
                value={resolvedCount}
                icon="✓"
                description="Successfully completed"
              />

            </div>

            <div className="section-heading">
              <div>
                <h3>
                  {userRole === "coordinator"
                    ? "Recent Student Queries"
                    : "Recent Queries"}
                </h3>
                <p>
                  {userRole === "coordinator"
                    ? "Latest requests submitted by students."
                    : "Track your latest support requests."}
                </p>
              </div>

              <button
                className="text-button"
                onClick={() => openPage("queries")}
              >
                View all →
              </button>
            </div>

            {queriesLoading ? (
              <div className="empty-state">
                <p>Loading your queries...</p>
              </div>
            ) : (
              <QueryList
                queries={queries.slice(0, 4)}
                onOpen={openQuery}
                showStudent={userRole === "coordinator"}
              />
            )}

          </section>
        )}

        {/* RAISE QUERY */}

        {activePage === "raise" && userRole !== "coordinator" && (
          <section className="page-content">

            <div className="page-intro">
              <span className="eyebrow">WE ARE HERE TO HELP</span>
              <h1>Raise a Query</h1>
              <p>
                Tell us what you need help with. Our support team will review your request.
              </p>
            </div>

            <form className="query-form" onSubmit={submitQuery}>

              <div className="form-section-heading">
                <h3>Query Information</h3>
                <p>Fields marked with * are required.</p>
              </div>

              <label htmlFor="query-title">Query Title *</label>

              <input
                id="query-title"
                name="title"
                type="text"
                placeholder="Enter a short title for your query"
                value={form.title}
                onChange={updateForm}
                required
              />

              <label htmlFor="query-category">Category *</label>

              <select
                id="query-category"
                name="category"
                value={form.category}
                onChange={updateForm}
                required
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>

              <label htmlFor="query-description">
                Describe your concern *
              </label>

              <textarea
                id="query-description"
                name="description"
                placeholder="Explain your issue in detail..."
                value={form.description}
                onChange={updateForm}
                rows={6}
                required
              />

              <div className="upload-area">
                <p>Image attachments are temporarily unavailable.</p>
                <span>Text-based query submission is available.</span>
              </div>

              <div className="form-actions">

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openPage("dashboard")}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={queriesLoading}
                >
                  {queriesLoading
                    ? "Submitting..."
                    : "Submit Query →"}
                </button>

              </div>

            </form>

          </section>
        )}

        {/* MY QUERIES / ALL STUDENT QUERIES */}

        {activePage === "queries" && (
          <section className="page-content">

            <div className="page-intro">
              <span className="eyebrow">YOUR SUPPORT REQUESTS</span>

              <h1>
                {userRole === "coordinator"
                  ? "All Student Queries"
                  : "My Queries"}
              </h1>

              <p>
                {userRole === "coordinator"
                  ? "Review and manage queries submitted by students."
                  : "View and track the progress of your submitted queries."}
              </p>
            </div>

            <div className="query-toolbar">

              <input
                type="search"
                placeholder={
                  userRole === "coordinator"
                    ? "Search student queries..."
                    : "Search your queries..."
                }
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />

              <span>{filteredQueries.length} queries found</span>

            </div>

            {queriesLoading ? (
              <div className="empty-state">
                <p>Loading your queries...</p>
              </div>
            ) : (
              <QueryList
                queries={filteredQueries}
                onOpen={openQuery}
                showStudent={userRole === "coordinator"}
              />
            )}

          </section>
        )}

        {/* QUERY DETAILS */}

        {activePage === "details" && (
          <section className="page-content">

            {selectedQuery ? (
              <div className="details-card">

                {/* IMPROVED GOLD BACK BUTTON */}

                <button
                  className="secondary-button back-button"
                  onClick={() => openPage("queries")}
                >
                  ← Back to{" "}
                  {userRole === "coordinator"
                    ? "All Student Queries"
                    : "My Queries"}
                </button>

                <div className="details-header">
                  <div>
                    <span className="eyebrow">QUERY DETAILS</span>
                    <h1>{selectedQuery.title}</h1>
                    <p>Submitted on {selectedQuery.date}</p>
                  </div>

                  <StatusBadge status={selectedQuery.status} />
                </div>

                <div className="details-info-grid">

                  <div>
                    <span>Category</span>
                    <strong>{selectedQuery.category}</strong>
                  </div>

                  <div>
                    <span>Submitted by</span>
                    <strong>{selectedQuery.student}</strong>
                  </div>

                  <div>
                    <span>Query ID</span>
                    <strong>#{selectedQuery.id}</strong>
                  </div>

                </div>

                <div className="details-description">
                  <h3>Description</h3>
                  <p>{selectedQuery.description}</p>
                </div>

                <div className="details-status">
                  <h3>Current Status</h3>

                  <StatusBadge status={selectedQuery.status} />

                  <p>
                    You can check this page to follow the progress of your request.
                  </p>
                </div>

                {userRole === "coordinator" && (
                  <div className="demo-status-controls">

                    <h3>Update Query Status</h3>

                    <p>
                      Choose the latest status. The change will be saved to Firestore.
                    </p>

                    <div className="status-buttons">

                      {[
                        "Pending",
                        "In Progress",
                        "Resolved",
                      ].map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="secondary-button"
                          disabled={selectedQuery.status === status}
                          onClick={() =>
                            changeStatus(selectedQuery, status)
                          }
                        >
                          {selectedQuery.status === status
                            ? `✓ ${status}`
                            : status}
                        </button>
                      ))}

                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="empty-state">
                <h3>Query not found</h3>

                <button
                  className="primary-button"
                  onClick={() => openPage("queries")}
                >
                  Back to{" "}
                  {userRole === "coordinator"
                    ? "All Student Queries"
                    : "My Queries"}
                </button>
              </div>
            )}

          </section>
        )}
                {/* NOTIFICATIONS */}

        {activePage === "notifications" && (
          <section className="page-content">

            <div className="page-intro">
              <span className="eyebrow">STAY UPDATED</span>
              <h1>Notifications</h1>
              <p>
                Updates and information about your support requests.
              </p>
            </div>

            <div className="notification-list">

              <div className="notification-item">
                <div className="notification-icon">✓</div>

                <div>
                  <strong>
                    Welcome to Maatram Student Support!
                  </strong>

                  <p>
                    Your account is ready. You can now raise queries and access the student support portal.
                  </p>

                  <span>Welcome</span>
                </div>
              </div>

              {queries
                .filter((queryItem) => queryItem.statusUpdatedAt)
                .map((queryItem) => (
                  <button
                    key={`${queryItem.ownerUid}-${queryItem.id}`}
                    className="notification-item notification-button"
                    onClick={() => openQuery(queryItem.id)}
                  >
                    <div className="notification-icon">✓</div>

                    <div>
                      <strong>
                        Status updated: {queryItem.title}
                      </strong>

                      <p>
                        Your query is now {queryItem.status}.
                      </p>

                      <span>
                        {queryItem.statusUpdatedAt?.toDate
                          ? queryItem.statusUpdatedAt
                              .toDate()
                              .toLocaleString("en-IN")
                          : "Recently updated"}
                      </span>
                    </div>
                  </button>
                ))}

            </div>

          </section>
        )}

        <footer className="main-footer">
          <span>© 2026 Maatram Foundation</span>
          <span>Student Support System</span>
        </footer>

      </main>

      {/* MOBILE NAVIGATION */}

      <nav className="mobile-nav">

        <button
          className={activePage === "dashboard" ? "active" : ""}
          onClick={() => openPage("dashboard")}
        >
          <span>▦</span>
          Home
        </button>

        {/* Raise button removed from mobile navigation */}

        <button
          className={activePage === "queries" ? "active" : ""}
          onClick={() => openPage("queries")}
        >
          <span>☷</span>
          Queries
        </button>

        <button
          className={activePage === "notifications" ? "active" : ""}
          onClick={() => openPage("notifications")}
        >
          <span>♧</span>
          Alerts
        </button>

      </nav>

    </div>
  );
}

// ------------------------------------
// BRAND COMPONENT
// ------------------------------------

function Brand() {
  return (
    <div className="brand">
      <img src="/maatram-logo.png" alt="Maatram logo" />

      <div>
        <strong>MAATRAM</strong>
        <span>STUDENT SUPPORT</span>
      </div>
    </div>
  );
}

// ------------------------------------
// STAT CARD
// ------------------------------------

function StatCard({ title, value, icon, description }) {
  return (
    <div className="stat-card">

      <div className="stat-card-top">
        <span>{title}</span>

        <div className="stat-icon">
          {icon}
        </div>
      </div>

      <h2>{value}</h2>
      <p>{description}</p>

    </div>
  );
}

// ------------------------------------
// STATUS BADGE
// ------------------------------------

function StatusBadge({ status }) {
  const className = status
    .toLowerCase()
    .replaceAll(" ", "-");

  return (
    <span className={`status-badge ${className}`}>
      {status}
    </span>
  );
}

// ------------------------------------
// QUERY LIST
// ------------------------------------

function QueryList({
  queries,
  onOpen,
  showStudent = false,
}) {
  if (!queries.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">☷</div>

        <h3>No queries found</h3>

        <p>
          {showStudent
            ? "Student queries will appear here."
            : "Your submitted queries will appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="query-list">

      {queries.map((queryItem) => (
        <button
          key={`${queryItem.ownerUid || ""}-${queryItem.id}`}
          className="query-list-item"
          onClick={() => onOpen(queryItem.id)}
        >

          <div className="query-list-main">

            <div className="query-list-icon">☷</div>

            <div className="query-list-text">
              <strong>{queryItem.title}</strong>

              <span>
                {queryItem.category} · {queryItem.date}
                {showStudent
                  ? ` · ${queryItem.student}`
                  : ""}
              </span>
            </div>

          </div>

          <div className="query-list-right">
            <StatusBadge status={queryItem.status} />
            <span className="query-arrow">→</span>
          </div>

        </button>
      ))}

    </div>
  );
}

export default App;
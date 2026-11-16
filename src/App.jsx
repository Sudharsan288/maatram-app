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
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const DEFAULT_CATEGORIES = [
  "Scholarship",
  "Financial Assistance",
  "Education",
  "Career Guidance",
  "Personal Support",
  "Other",
];

const ROLE_LABELS = {
  student: "Student Representative",
  coordinator: "Coordinator",
  admin: "Admin",
};

const STATUSES = ["Pending", "In Progress", "Resolved"];

function getErrorMessage(error) {
  const errors = {
    "auth/email-already-in-use":
      "This email already has an account. Please sign in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password":
      "Password must contain at least 6 characters.",
    "auth/invalid-credential":
      "Incorrect email or password.",
    "auth/network-request-failed":
      "Check your internet connection.",
    "permission-denied":
      "Permission denied. Please check your Firestore security rules.",
    "failed-precondition":
      "A Firestore index may be required. Check the Firebase console.",
  };

  return (
    errors[error.code] ||
    error.message ||
    "Something went wrong."
  );
}

function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [role, setRole] = useState("student");
  const [roleReady, setRoleReady] = useState(false);

  const [registering, setRegistering] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("dashboard");

  const [queries, setQueries] = useState([]);
  const [queriesLoading, setQueriesLoading] = useState(false);

  const [selectedQuery, setSelectedQuery] = useState(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    title: "",
    category: DEFAULT_CATEGORIES[0],
    description: "",
  });

  // Categories are consistently stored as strings.
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  // Every user object has uid, email, displayName and role.
  const [users, setUsers] = useState([]);

  const [rulesText, setRulesText] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [assignmentUid, setAssignmentUid] = useState("");

  // --------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      setNotice("");

      if (!user) {
        setRole("student");
        setRoleReady(true);
        setQueries([]);
        setUsers([]);
        setCategories(DEFAULT_CATEGORIES);
        setRulesText("");
        setSelectedQuery(null);
        setPage("dashboard");
        setSearch("");
      } else {
        setRoleReady(false);
      }
    });

    return unsubscribe;
  }, []);

  // --------------------------------------------------
  // LOAD USER ROLE AND PROFILE
  // --------------------------------------------------

  useEffect(() => {
    if (!authUser) return;

    let active = true;

    async function loadRole() {
      try {
        const roleRef = doc(db, "roles", authUser.uid);
        const roleSnapshot = await getDoc(roleRef);

        if (!roleSnapshot.exists()) {
          throw new Error(
            "Role document not found. Contact the administrator."
          );
        }

        const userRole = roleSnapshot.data().role;

        if (!["student", "coordinator", "admin"].includes(userRole)) {
          throw new Error("Invalid account role.");
        }

        if (active) {
          setRole(userRole);
          setRoleReady(true);
        }

        // Update profile without overwriting the role.
        try {
          await setDoc(
            doc(db, "users", authUser.uid),
            {
              email: authUser.email || "",
              displayName:
                authUser.displayName ||
                (authUser.email || "").split("@")[0],
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (profileError) {
          console.error("Profile update error:", profileError);
        }
      } catch (error) {
        console.error("Role loading error:", error);

        if (active) {
          setNotice(getErrorMessage(error));
          setRoleReady(true);
        }
      }
    }

    loadRole();

    return () => {
      active = false;
    };
  }, [authUser]);

  // --------------------------------------------------
  // LOAD CATEGORIES
  // --------------------------------------------------

  useEffect(() => {
    if (!authUser || !roleReady) return;

    const unsubscribe = onSnapshot(
      collection(db, "categories"),
      (snapshot) => {
        if (snapshot.empty) {
          setCategories(DEFAULT_CATEGORIES);
          return;
        }

        const values = snapshot.docs
          .map((item) => item.data().name)
          .filter(
            (name) =>
              typeof name === "string" &&
              name.trim().length > 0
          );

        setCategories(
          values.length > 0 ? values : DEFAULT_CATEGORIES
        );
      },
      (error) => {
        console.error("Category loading error:", error);
        setNotice(getErrorMessage(error));
      }
    );

    return unsubscribe;
  }, [authUser, roleReady]);

  // --------------------------------------------------
  // LOAD QUERIES BASED ON ROLE
  // --------------------------------------------------

  useEffect(() => {
    if (!authUser || !roleReady) return;

    let active = true;

    const queryCollection =
      role === "student"
        ? collection(db, "users", authUser.uid, "queries")
        : collectionGroup(db, "queries");

    const queryConstraints = [];

    if (role === "coordinator") {
      queryConstraints.push(
        where("assignedTo", "==", authUser.uid)
      );
    } else {
      queryConstraints.push(orderBy("createdAt", "desc"));
    }

    const queriesRef = query(
      queryCollection,
      ...queryConstraints
    );

    const unsubscribe = onSnapshot(
      queriesRef,
      (snapshot) => {
        if (!active) return;

        const queryList = snapshot.docs.map((item) => {
          const data = item.data();

          return {
            id: item.id,
            ownerUid:
              item.ref.parent.parent?.id || authUser.uid,
            title: data.title || "Untitled Query",
            category: data.category || "Other",
            description: data.description || "",
            status: data.status || "Pending",
            studentEmail: data.studentEmail || "",
            assignedTo: data.assignedTo || "",
            assignedEmail: data.assignedEmail || "",
            createdAt: data.createdAt || null,
            date: data.createdAt?.toDate
              ? data.createdAt.toDate().toLocaleDateString("en-IN")
              : "Just now",
            createdAtMs: data.createdAt?.toMillis
              ? data.createdAt.toMillis()
              : 0,
          };
        });

        if (role === "coordinator") {
          queryList.sort(
            (a, b) => b.createdAtMs - a.createdAtMs
          );
        }

        setQueries(queryList);

        // Keep the open details view synchronized with Firestore.
        setSelectedQuery((current) => {
          if (!current) return null;

          return (
            queryList.find(
              (item) =>
                item.id === current.id &&
                item.ownerUid === current.ownerUid
            ) || current
          );
        });

        setQueriesLoading(false);
      },
      (error) => {
        console.error("Query loading error:", error);

        if (active) {
          setNotice(getErrorMessage(error));
          setQueriesLoading(false);
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authUser, role, roleReady]);

  // --------------------------------------------------
  // ADMIN DATA
  // --------------------------------------------------

  useEffect(() => {
    if (!authUser || !roleReady || role !== "admin") {
      return;
    }

    const stopUsers = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        setUsers(
          snapshot.docs.map((item) => ({
            uid: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => {
        console.error("User loading error:", error);
        setNotice(getErrorMessage(error));
      }
    );

    const stopRules = onSnapshot(
      doc(db, "settings", "rules"),
      (snapshot) => {
        setRulesText(
          snapshot.exists()
            ? snapshot.data().content || ""
            : ""
        );
      },
      (error) => {
        console.error("Rules loading error:", error);
        setNotice(getErrorMessage(error));
      }
    );

    return () => {
      stopUsers();
      stopRules();
    };
  }, [authUser, role, roleReady]);

  // --------------------------------------------------
  // SEARCH
  // --------------------------------------------------

  const visibleQueries = useMemo(() => {
    const searchText = search.toLowerCase().trim();

    if (!searchText) return queries;

    return queries.filter((item) =>
      [
        item.title,
        item.category,
        item.status,
        item.studentEmail,
        item.assignedEmail,
      ].some((value) =>
        (value || "").toLowerCase().includes(searchText)
      )
    );
  }, [queries, search]);

  // --------------------------------------------------
  // LOGIN AND REGISTRATION
  // --------------------------------------------------

  async function handleAuth(event) {
    event.preventDefault();

    setAuthLoading(true);
    setNotice("");

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (registering) {
        const result = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );

        await setDoc(doc(db, "users", result.user.uid), {
          email: result.user.email || cleanEmail,
          role: "student",
          displayName: cleanEmail.split("@")[0],
          createdAt: serverTimestamp(),
        });

        // New accounts are students by default.
        await setDoc(doc(db, "roles", result.user.uid), {
          role: "student",
          createdAt: serverTimestamp(),
        });

        setNotice(
          "Account created successfully as Student Representative."
        );
      } else {
        await signInWithEmailAndPassword(
          auth,
          cleanEmail,
          password
        );
      }
    } catch (error) {
      console.error("Authentication error:", error);
      setNotice(getErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function forgotPassword() {
    if (!email.trim()) {
      setNotice("Enter your email address first.");
      return;
    }

    try {
      await sendPasswordResetEmail(
        auth,
        email.trim().toLowerCase()
      );

      setNotice(
        "Password reset email sent if the account exists."
      );
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  }

  async function logout() {
    try {
      await signOut(auth);

      setNotice("");
      setPassword("");
      setSearch("");
      setSelectedQuery(null);
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  }

  // --------------------------------------------------
  // STUDENT: SUBMIT QUERY
  // --------------------------------------------------

  async function submitQuery(event) {
    event.preventDefault();

    if (role !== "student") {
      setNotice(
        "Only Student Representatives can log queries."
      );
      return;
    }

    if (!form.title.trim() || !form.description.trim()) {
      setNotice("Please complete all required fields.");
      return;
    }

    if (!categories.includes(form.category)) {
      setNotice("Please select a valid query category.");
      return;
    }

    try {
      setQueriesLoading(true);
      setNotice("");

      await addDoc(
        collection(db, "users", authUser.uid, "queries"),
        {
          title: form.title.trim(),
          category: form.category,
          description: form.description.trim(),
          status: "Pending",
          createdAt: serverTimestamp(),
          studentEmail: authUser.email || "",
          assignedTo: "",
          assignedEmail: "",
        }
      );

      setForm({
        title: "",
        category: categories[0] || "Other",
        description: "",
      });

      setPage("queries");
      setNotice("Your query has been submitted successfully.");
    } catch (error) {
      console.error("Query submission error:", error);
      setNotice(getErrorMessage(error));
    } finally {
      setQueriesLoading(false);
    }
  }

  // --------------------------------------------------
  // COORDINATOR / ADMIN: UPDATE QUERY STATUS
  // --------------------------------------------------

  async function updateStatus(item, status) {
    if (!["coordinator", "admin"].includes(role)) {
      return;
    }

    if (!STATUSES.includes(status)) {
      setNotice("Invalid query status.");
      return;
    }

    try {
      await updateDoc(
        doc(db, "users", item.ownerUid, "queries", item.id),
        {
          status,
          statusUpdatedAt: serverTimestamp(),
        }
      );

      setNotice(`Query status updated to ${status}.`);
    } catch (error) {
      console.error("Status update error:", error);
      setNotice(getErrorMessage(error));
    }
  }

  // --------------------------------------------------
  // ADMIN: ASSIGN QUERY
  // --------------------------------------------------

  async function assignQuery(item) {
    if (role !== "admin" || !assignmentUid) {
      setNotice("Select a Coordinator first.");
      return;
    }

    const coordinator = users.find(
      (user) => user.uid === assignmentUid
    );

    if (!coordinator || coordinator.role !== "coordinator") {
      setNotice("Please select a valid Coordinator account.");
      return;
    }

    try {
      await updateDoc(
        doc(db, "users", item.ownerUid, "queries", item.id),
        {
          assignedTo: coordinator.uid,
          assignedEmail: coordinator.email || "",
          assignedAt: serverTimestamp(),
        }
      );

      setAssignmentUid("");
      setNotice("Query assigned successfully.");
    } catch (error) {
      console.error("Query assignment error:", error);
      setNotice(getErrorMessage(error));
    }
  }

  // --------------------------------------------------
  // ADMIN: CHANGE USER ROLE
  // --------------------------------------------------

  async function changeUserRole(userUid, nextRole) {
    if (role !== "admin") return;

    if (!["student", "coordinator", "admin"].includes(nextRole)) {
      setNotice("Invalid role selected.");
      return;
    }

    if (userUid === authUser.uid) {
      setNotice("You cannot change your own Admin role.");
      return;
    }

    try {
      await setDoc(
        doc(db, "roles", userUid),
        {
          role: nextRole,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", userUid),
        { role: nextRole },
        { merge: true }
      );

      setNotice(`User role updated to ${ROLE_LABELS[nextRole]}.`);
    } catch (error) {
      console.error("Role update error:", error);
      setNotice(getErrorMessage(error));
    }
  }

  // --------------------------------------------------
  // ADMIN: CATEGORY MANAGEMENT
  // --------------------------------------------------

  async function addCategory(event) {
    event.preventDefault();

    const name = newCategory.trim();

    if (!name) {
      setNotice("Enter a category name.");
      return;
    }

    if (
      categories.some(
        (category) =>
          category.toLowerCase() === name.toLowerCase()
      )
    ) {
      setNotice("This category already exists.");
      return;
    }

    const categoryId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!categoryId) {
      setNotice("Please enter a valid category name.");
      return;
    }

    try {
      await setDoc(doc(db, "categories", categoryId), {
        name,
        createdAt: serverTimestamp(),
      });

      setNewCategory("");
      setNotice("Category added successfully.");
    } catch (error) {
      console.error("Category creation error:", error);
      setNotice(getErrorMessage(error));
    }
  }

  async function removeCategory(name) {
    if (role !== "admin") return;

    const categoryId = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    try {
      await deleteDoc(doc(db, "categories", categoryId));
      setNotice("Category removed successfully.");
    } catch (error) {
      console.error("Category removal error:", error);
      setNotice(getErrorMessage(error));
    }
  }

  // --------------------------------------------------
  // ADMIN: GUIDELINES
  // --------------------------------------------------

  async function saveRules(event) {
    event.preventDefault();

    if (role !== "admin") return;

    try {
      await setDoc(
        doc(db, "settings", "rules"),
        {
          content: rulesText,
          updatedAt: serverTimestamp(),
          updatedBy: authUser.uid,
        },
        { merge: true }
      );

      setNotice("Guidelines saved successfully.");
    } catch (error) {
      console.error("Guidelines save error:", error);
      setNotice(getErrorMessage(error));
    }
  }
    // --------------------------------------------------
  // LOADING SCREEN
  // --------------------------------------------------

  if (!authReady || (authUser && !roleReady)) {
    return (
      <div className="splash-screen">
        <div className="splash-content">
          <img
            src="/maatram-logo.png"
            alt="Maatram"
            className="splash-logo"
          />
          <h1>MAATRAM</h1>
          <p>STUDENT SUPPORT SYSTEM</p>
          <div className="splash-loader"></div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // LOGIN SCREEN
  // --------------------------------------------------

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
              {registering
                ? "Create your account"
                : "Welcome back"}
            </h2>

            <p>
              {registering
                ? "Register as a Student Representative."
                : "Sign in to continue to your portal."}
            </p>
          </div>

          <form onSubmit={handleAuth} className="login-form">
            <label htmlFor="email">Email address</label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              autoComplete="email"
              required
            />

            <label htmlFor="password">Password</label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete={
                registering ? "new-password" : "current-password"
              }
              minLength={6}
              required
            />

            {!registering && (
              <div className="forgot-password">
                <button
                  type="button"
                  className="text-button"
                  onClick={forgotPassword}
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
                : registering
                ? "Create account"
                : "Sign in"}
            </button>
          </form>

          <p className="auth-switch">
            {registering
              ? "Already have an account?"
              : "Don't have an account?"}

            <button
              className="text-button"
              type="button"
              onClick={() => {
                setRegistering(!registering);
                setNotice("");
              }}
            >
              {registering ? "Sign in" : "Create account"}
            </button>
          </p>

          {notice && (
            <div className="notice-message">{notice}</div>
          )}

          <div className="login-footer">
            © 2026 Maatram Foundation
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // ROLE-BASED DATA
  // --------------------------------------------------

  const isAdmin = role === "admin";
  const isCoordinator = role === "coordinator";

  const pending = queries.filter(
    (item) => item.status === "Pending"
  ).length;

  const inProgress = queries.filter(
    (item) => item.status === "In Progress"
  ).length;

  const resolved = queries.filter(
    (item) => item.status === "Resolved"
  ).length;

  const coordinators = users.filter(
    (user) => user.role === "coordinator"
  );

  const nav = [
    ["dashboard", "▦", "Dashboard"],
    [
      "queries",
      "☷",
      isAdmin
        ? "All Queries"
        : isCoordinator
        ? "Assigned Queries"
        : "My Queries",
    ],
    ...(role === "student"
      ? [["raise", "+", "Log a Query"]]
      : []),
    ...(isAdmin
      ? [
          ["users", "♙", "Users"],
          ["categories", "▤", "Categories"],
          ["rules", "⚙", "Rules"],
          ["reports", "▥", "Reports"],
        ]
      : []),
  ];

  // Mobile navigation uses the same items as desktop navigation.
  const navItems = nav.map(([id, icon, label]) => ({
    id,
    icon,
    label,
  }));

  function openPage(nextPage) {
    setPage(nextPage);
    setSelectedQuery(null);
    setSearch("");
    setNotice("");
  }

  // --------------------------------------------------
  // MAIN APPLICATION
  // --------------------------------------------------

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            {(authUser.email || "M")[0].toUpperCase()}
          </div>

          <div className="user-info">
            <strong>{ROLE_LABELS[role]}</strong>
            <span>{authUser.email}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-label">WORKSPACE</span>

          {nav.map(([key, icon, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => openPage(key)}
            >
              <span>{icon}</span>
              {label}

              {key === "queries" && (
                <span className="nav-count">
                  {queries.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span>
              {isAdmin
                ? "Administration"
                : isCoordinator
                ? "Coordinator workspace"
                : "Need assistance?"}
            </span>

            <p>
              {isAdmin
                ? "Manage users, categories, guidelines and reports."
                : isCoordinator
                ? "Work on queries assigned to you."
                : "Log a query and track its progress."}
            </p>
          </div>

          <button className="logout-button" onClick={logout}>
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
              {{
                dashboard: "Dashboard",
                queries: isAdmin
                  ? "All Queries"
                  : isCoordinator
                  ? "Assigned Queries"
                  : "My Queries",
                raise: "Log a Query",
                users: "User Management",
                categories: "Category Management",
                rules: "Guidelines & Rules",
                reports: "Reports",
                details: "Query Details",
              }[page] || "Dashboard"}
            </h2>
          </div>

          <div className="topbar-user">
            <div className="topbar-user-info">
              <strong>{ROLE_LABELS[role]}</strong>
              <span>{authUser.email}</span>
            </div>

            <div className="user-avatar">
              {(authUser.email || "M")[0].toUpperCase()}
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

        {page === "dashboard" && (
          <section className="page-content">
            <div className="welcome-banner">
              <div>
                <span className="eyebrow">
                  {ROLE_LABELS[role].toUpperCase()} PORTAL
                </span>

                <h1>
                  Hello, <span>{ROLE_LABELS[role]}!</span>
                </h1>

                <p>
                  {isAdmin
                    ? "Manage the student support system from one place."
                    : isCoordinator
                    ? "Review and resolve the queries assigned to you."
                    : "Log your support requests and follow their progress."}
                </p>

                {role === "student" && (
                  <button
                    className="primary-button"
                    onClick={() => openPage("raise")}
                  >
                    + Log a Query
                  </button>
                )}

                {isCoordinator && (
                  <button
                    className="primary-button"
                    onClick={() => openPage("queries")}
                  >
                    View Assigned Queries
                  </button>
                )}
              </div>

              <div className="welcome-decoration">M</div>
            </div>

            <div className="section-heading">
              <div>
                <h3>Overview</h3>
                <p>
                  {isAdmin
                    ? "System-wide query overview."
                    : isCoordinator
                    ? "Your assigned workload."
                    : "Your submitted support requests."}
                </p>
              </div>
            </div>

            <div className="stats-grid">
              <Stat
                title="Total Queries"
                value={queries.length}
                icon="☷"
              />

              <Stat
                title="Pending"
                value={pending}
                icon="◷"
              />

              <Stat
                title="In Progress"
                value={inProgress}
                icon="↻"
              />

              <Stat
                title="Resolved"
                value={resolved}
                icon="✓"
              />
            </div>

            {isAdmin && (
              <div className="admin-shortcuts">
                {[
                  ["users", "Manage Users"],
                  ["categories", "Manage Categories"],
                  ["rules", "Manage Rules"],
                  ["reports", "View Reports"],
                ].map(([target, label]) => (
                  <button
                    className="secondary-button"
                    key={target}
                    onClick={() => openPage(target)}
                  >
                    {label} →
                  </button>
                ))}
              </div>
            )}

            <div className="section-heading">
              <div>
                <h3>
                  {isAdmin
                    ? "Latest Queries"
                    : isCoordinator
                    ? "Assigned Queries"
                    : "Recent Queries"}
                </h3>

                <p>Latest query activity</p>
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
                Loading queries...
              </div>
            ) : (
              <QueryList
                queries={queries.slice(0, 5)}
                onSelect={(item) => {
                  setSelectedQuery(item);
                  setPage("details");
                }}
              />
            )}
          </section>
        )}

        {/* STUDENT: LOG QUERY */}

        {page === "raise" && role === "student" && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">
                WE ARE HERE TO HELP
              </span>
              <h1>Log a Query</h1>
              <p>
                Submit a support request for the Maatram team.
              </p>
            </div>

            <form
              className="query-form"
              onSubmit={submitQuery}
            >
              <div className="form-section-heading">
                <h3>Query Information</h3>
                <p>Fields marked * are required.</p>
              </div>

              <label>Query Title *</label>

              <input
                value={form.title}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    title: event.target.value,
                  }))
                }
                required
                placeholder="Enter a short title"
              />

              <label>Category *</label>

              <select
                value={form.category}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    category: event.target.value,
                  }))
                }
                required
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>

              <label>Description *</label>

              <textarea
                rows={6}
                value={form.description}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
                required
                placeholder="Explain your concern in detail..."
              />

              <div className="upload-area">
                <p>Image attachments are not enabled yet.</p>
                <span>
                  Text-based query submission is available.
                </span>
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
                {/* ALL QUERIES PAGE */}

        {page === "queries" && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">QUERY MANAGEMENT</span>
              <h1>
                {isAdmin
                  ? "All Queries"
                  : isCoordinator
                  ? "Assigned Queries"
                  : "My Queries"}
              </h1>
              <p>View and track student support requests.</p>
            </div>

            <div className="filter-bar">
              <input
                type="text"
                placeholder="Search queries..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {queriesLoading ? (
              <p className="empty-state">Loading queries...</p>
            ) : visibleQueries.length === 0 ? (
              <p className="empty-state">No queries found.</p>
            ) : (
              <QueryList
                queries={visibleQueries}
                onSelect={(item) => {
                  setSelectedQuery(item);
                  setPage("details");
                }}
              />
            )}
          </section>
        )}

        {/* QUERY DETAILS PAGE */}

        {page === "details" && selectedQuery && (
          <section className="page-content">
            <button
              className="back-button"
              onClick={() => setPage("queries")}
            >
              ← Back to Queries
            </button>

            <div className="page-heading">
              <div>
                <h2>Query Details</h2>
                <p>
                  Review the request and its current progress.
                </p>
              </div>

              <Status status={selectedQuery.status} />
            </div>

            <div className="details-card">
              <div className="detail-row">
                <span>Query Title</span>
                <strong>{selectedQuery.title}</strong>
              </div>

              <div className="detail-row">
                <span>Category</span>
                <strong>{selectedQuery.category}</strong>
              </div>

              <div className="detail-row">
                <span>Student Email</span>
                <strong>
                  {selectedQuery.studentEmail || "Not available"}
                </strong>
              </div>

              <div className="detail-row">
                <span>Submitted On</span>
                <strong>
                  {selectedQuery.createdAt?.toDate
                    ? selectedQuery.createdAt
                        .toDate()
                        .toLocaleString("en-IN")
                    : "Not available"}
                </strong>
              </div>

              <div className="detail-description">
                <span>Description</span>
                <p>{selectedQuery.description}</p>
              </div>

              <div className="detail-row">
                <span>Assigned Coordinator</span>
                <strong>
                  {selectedQuery.assignedEmail || "Not assigned"}
                </strong>
              </div>

              {isAdmin && (
                <div className="management-section">
                  <h3>Assign Coordinator</h3>

                  <select
                    value={assignmentUid}
                    onChange={(event) =>
                      setAssignmentUid(event.target.value)
                    }
                  >
                    <option value="">Select coordinator</option>

                    {coordinators.map((coordinator) => (
                      <option
                        key={coordinator.uid}
                        value={coordinator.uid}
                      >
                        {coordinator.displayName ||
                          coordinator.email}
                      </option>
                    ))}
                  </select>

                  <button
                    className="primary-button"
                    onClick={() => assignQuery(selectedQuery)}
                    disabled={!assignmentUid}
                  >
                    Assign Coordinator
                  </button>
                </div>
              )}

              {(isAdmin || isCoordinator) && (
                <div className="management-section">
                  <h3>Update Query Status</h3>

                  <div className="status-actions">
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        className={
                          selectedQuery.status === status
                            ? "status-button active"
                            : "status-button"
                        }
                        onClick={() =>
                          updateStatus(selectedQuery, status)
                        }
                        disabled={selectedQuery.status === status}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ADMIN USER MANAGEMENT */}

        {page === "users" && isAdmin && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">ADMINISTRATION</span>
              <h1>User Management</h1>
              <p>Manage student and coordinator accounts.</p>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Current Role</th>
                    <th>Change Role</th>
                  </tr>
                </thead>

                <tbody>
                  {users.map((user) => (
                    <tr key={user.uid}>
                      <td>{user.displayName || "User"}</td>
                      <td>{user.email}</td>
                      <td>
                        {ROLE_LABELS[user.role] || user.role}
                      </td>
                      <td>
                        <select
                          value={user.role || "student"}
                          onChange={(event) =>
                            changeUserRole(
                              user.uid,
                              event.target.value
                            )
                          }
                          disabled={user.uid === authUser.uid}
                        >
                          <option value="student">Student</option>
                          <option value="coordinator">
                            Coordinator
                          </option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}

                  {users.length === 0 && (
                    <tr>
                      <td colSpan="4">No users found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ADMIN CATEGORY MANAGEMENT */}

        {page === "categories" && isAdmin && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">ADMINISTRATION</span>
              <h1>Query Categories</h1>
              <p>
                Manage the categories students can select.
              </p>
            </div>

            <div className="management-card">
              <h3>Add New Category</h3>

              <form onSubmit={addCategory} className="inline-form">
                <input
                  type="text"
                  placeholder="Enter category name"
                  value={newCategory}
                  onChange={(event) =>
                    setNewCategory(event.target.value)
                  }
                  required
                />

                <button
                  type="submit"
                  className="primary-button"
                  disabled={!newCategory.trim()}
                >
                  Add Category
                </button>
              </form>
            </div>

            <div className="category-list">
              {categories.map((category) => (
                <div className="category-item" key={category}>
                  <span>{category}</span>

                  <button
                    className="danger-button"
                    onClick={() => removeCategory(category)}
                  >
                    Remove
                  </button>
                </div>
              ))}

              {categories.length === 0 && (
                <p className="empty-state">
                  No categories available.
                </p>
              )}
            </div>
          </section>
        )}

        {/* ADMIN GUIDELINES PAGE */}

        {page === "rules" && isAdmin && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">ADMINISTRATION</span>
              <h1>Guidelines</h1>
              <p>
                Manage the instructions displayed to students.
              </p>
            </div>

            <form
              className="management-card"
              onSubmit={saveRules}
            >
              <h3>Student Support Guidelines</h3>

              <textarea
                rows={8}
                placeholder="Enter student support guidelines..."
                value={rulesText}
                onChange={(event) =>
                  setRulesText(event.target.value)
                }
              />

              <button
                type="submit"
                className="primary-button"
              >
                Save Guidelines
              </button>
            </form>
          </section>
        )}
                {/* ADMIN REPORTS PAGE */}

        {page === "reports" && isAdmin && (
          <section className="page-content">
            <div className="page-intro">
              <span className="eyebrow">ADMINISTRATION</span>
              <h1>Reports & Analytics</h1>
              <p>
                Overview of student support requests.
              </p>
            </div>

            <div className="stats-grid">
              <Stat
                title="Total Queries"
                value={queries.length}
                icon="☷"
              />

              <Stat
                title="Pending"
                value={pending}
                icon="◷"
              />

              <Stat
                title="In Progress"
                value={inProgress}
                icon="↻"
              />

              <Stat
                title="Resolved"
                value={resolved}
                icon="✓"
              />
            </div>

            <div className="management-card">
              <h3>Query Category Summary</h3>

              {categories.map((category) => {
                const count = queries.filter(
                  (item) => item.category === category
                ).length;

                return (
                  <div className="report-row" key={category}>
                    <span>{category}</span>
                    <strong>{count}</strong>
                  </div>
                );
              })}

              {categories.length === 0 && (
                <p className="empty-state">
                  No category data available.
                </p>
              )}
            </div>
          </section>
        )}
      </main>

      {/* MOBILE NAVIGATION */}

      <nav className="mobile-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={
              page === item.id
                ? "mobile-nav-item active"
                : "mobile-nav-item"
            }
            onClick={() => openPage(item.id)}
          >
            <span>{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ==================================================
// REUSABLE COMPONENTS
// ==================================================

function Brand() {
  return (
    <div className="brand">
      <div className="brand-logo">M</div>

      <div className="brand-text">
        <strong>MAATRAM</strong>
        <span>FOUNDATION</span>
      </div>
    </div>
  );
}

function Stat({ title, label, value, icon }) {
  return (
    <div className="stat-card">
      {icon && <span className="stat-icon">{icon}</span>}
      <span>{title || label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Status({ status }) {
  const statusClass = (status || "Pending")
    .toLowerCase()
    .replace(/\s+/g, "-");

  return (
    <span className={`status-badge ${statusClass}`}>
      {status || "Pending"}
    </span>
  );
}

function QueryList({ queries, onSelect }) {
  if (!queries || queries.length === 0) {
    return (
      <p className="empty-state">
        No queries available.
      </p>
    );
  }

  return (
    <div className="query-list">
      {queries.map((item) => (
        <button
          type="button"
          className="query-card"
          key={`${item.ownerUid}-${item.id}`}
          onClick={() => onSelect(item)}
        >
          <div className="query-card-content">
            <div className="query-card-heading">
              <h3>{item.title}</h3>
              <Status status={item.status} />
            </div>

            <p>{item.description}</p>

            <div className="query-card-meta">
              <span>{item.category}</span>

              {item.studentEmail && (
                <span>{item.studentEmail}</span>
              )}

              <span>
                {item.createdAt?.toDate
                  ? item.createdAt
                      .toDate()
                      .toLocaleDateString("en-IN")
                  : "Recently submitted"}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export default App;
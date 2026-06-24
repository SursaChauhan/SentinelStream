// frontend/src/App.tsx
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CamerasPage from "./pages/CamerasPage";

function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">🛡️</span>
          <span className="brand-name">SentinelStream</span>
        </div>

        <nav>
          <ul className="nav-links">
            <li>
              <Link
                to="/"
                className={`nav-link ${location.pathname === "/" ? "active" : ""}`}
              >
                📊 Dashboard
              </Link>
            </li>
            <li>
              <Link
                to="/cameras"
                className={`nav-link ${location.pathname === "/cameras" ? "active" : ""}`}
              >
                🎥 Camera Manager
              </Link>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="btn btn-secondary btn-full">
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="navbar">
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600 }}>Active Session</h2>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Monitoring for suspicious activity
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500 }}>
              👤 {user?.username}
            </span>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "var(--accent-emerald)",
                boxShadow: "0 0 8px var(--accent-emerald)",
              }}
            />
          </div>
        </header>

        <div className="page-container">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/cameras" element={<CamerasPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

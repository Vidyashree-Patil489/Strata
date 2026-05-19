import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ui/ProtectedRoute";
import DashboardLayout from "./components/ui/DashboardLayout";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import Login from "./pages/Login";
import OAuthCallback from "./pages/OAuthCallback";
import Repos from "./pages/Repos";
import Settings from "./pages/Settings";
import RepoHealth from "./pages/RepoHealth";
import KnowledgeGraph from "./pages/KnowledgeGraph";
import Forensics from "./pages/Forensics";
import Insights from "./pages/Insights";
import CommitDiff from "./pages/CommitDiff";

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<OAuthCallback />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <RepoHealth />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/repos"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <Repos />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/graph"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <KnowledgeGraph />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/forensics"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <Forensics />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/insights"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <Insights />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <Settings />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/commit-diff/:repoId/:commitSha"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <CommitDiff />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;

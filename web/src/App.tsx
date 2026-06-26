import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { RequireAuth } from "./auth/RequireAuth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import WaitlistPage from "./pages/WaitlistPage";
import FirstAidPage from "./pages/FirstAidPage";
import MapPage from "./pages/MapPage";
import ForumListPage from "./pages/ForumListPage";
import NewThreadPage from "./pages/NewThreadPage";
import ForumThreadPage from "./pages/ForumThreadPage";
import CheckinSetupPage from "./pages/CheckinSetupPage";
import ProfilePage from "./pages/ProfilePage";

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify" element={<VerifyEmailPage />} />
      <Route path="/waitlist" element={<WaitlistPage />} />
      {/* First-aid info stays public — life-safety content must be reachable. */}
      <Route path="/first-aid" element={<FirstAidPage />} />

      {/* Authenticated app */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<MapPage />} />
        <Route path="/forum" element={<ForumListPage />} />
        <Route path="/forum/new" element={<NewThreadPage />} />
        <Route path="/forum/:id" element={<ForumThreadPage />} />
        <Route path="/checkins" element={<CheckinSetupPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";

// Every route is its own chunk, so a logged-out visitor on /login doesn't
// download the map (Leaflet), sockets, or the forum. AppShell carries
// Socket.io + presence and is only fetched once signed in.
const AppShell = lazy(() => import("./components/AppShell"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const WaitlistPage = lazy(() => import("./pages/WaitlistPage"));
const FirstAidPage = lazy(() => import("./pages/FirstAidPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const ForumListPage = lazy(() => import("./pages/ForumListPage"));
const NewThreadPage = lazy(() => import("./pages/NewThreadPage"));
const ForumThreadPage = lazy(() => import("./pages/ForumThreadPage"));
const CheckinSetupPage = lazy(() => import("./pages/CheckinSetupPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));

function RouteFallback() {
  return (
    <div className="boot-screen" role="status">
      <p>Loading SafeSips…</p>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyEmailPage />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        {/* Public copy of the first-aid info for logged-out emergency access. */}
        <Route path="/help" element={<FirstAidPage />} />

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
          <Route path="/first-aid" element={<FirstAidPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/alerts" element={<AlertsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

import { ClerkProvider } from "@clerk/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { fitStandaloneScreen } from "./fitScreen";
// Self-hosted brand font (no Google Fonts request: works offline and doesn't
// send visitors' IPs to a third party). Includes Latin Extended for Romanian.
import "@fontsource-variable/nunito";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// Offline support (first-aid info must open with no connection). Production
// only: in dev it would cache Vite's hot-reloading modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  });
}

fitStandaloneScreen();

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in DOM");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/login"
      signInUrl="/login"
      signUpUrl="/register"
      appearance={{
        variables: {
          colorPrimary: "#d6117e",
          colorForeground: "#1b2440",
          colorBackground: "#ffffff",
          borderRadius: "14px",
          fontFamily: '"Nunito Variable", Nunito, system-ui, sans-serif',
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ClerkProvider>
  </React.StrictMode>
);

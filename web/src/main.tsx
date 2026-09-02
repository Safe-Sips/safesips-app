import { ClerkProvider } from "@clerk/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "leaflet/dist/leaflet.css";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

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
          fontFamily: "Nunito, system-ui, sans-serif",
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

import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import App from "../App";
import { SignedOutScreen } from "./SignedOutScreen";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

function AuthedApp() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    let active = true;
    void getToken().then((value) => {
      if (active) setToken(value ?? null);
    });
    return () => {
      active = false;
    };
  }, [isSignedIn, getToken]);

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0f", justifyContent: "center" }}>
        <ActivityIndicator color="#ffd400" size="large" />
      </View>
    );
  }
  if (!isSignedIn || !token) {
    if (!isSignedIn) return <SignedOutScreen />;
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0f", justifyContent: "center" }}>
        <ActivityIndicator color="#ffd400" size="large" />
      </View>
    );
  }
  return <App sessionToken={token} />;
}

export function AuthRoot() {
  if (!publishableKey) {
    throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <AuthedApp />
    </ClerkProvider>
  );
}

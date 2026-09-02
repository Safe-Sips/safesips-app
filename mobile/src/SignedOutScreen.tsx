import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as AuthSession from "expo-auth-session";
import { useHostedAuth } from "@clerk/expo/hosted-auth";

/** Hosted Clerk sign-in / sign-up. Works in Expo Go and a dev client. */
export function SignedOutScreen() {
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: "sign-in" | "sign-up") => {
    setError(null);
    setBusy(true);
    try {
      await startHostedAuth({
        mode,
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: "safesips",
          path: "clerk",
        }),
      });
    } catch {
      setError("Could not open Clerk sign-in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>SafeSips</Text>
      <Text style={styles.tagline}>
        Sign in to share an approximate 200 m area — never your exact position.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        disabled={busy}
        onPress={() => void run("sign-in")}
      >
        <Text style={styles.primaryBtnText}>Sign in</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        disabled={busy}
        onPress={() => void run("sign-up")}
      >
        <Text style={styles.secondaryBtnText}>Create account</Text>
      </Pressable>
      {busy && <ActivityIndicator color="#ffd400" style={{ marginTop: 16 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.note}>
        Not an emergency service — call 112 in an emergency.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0a0f",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  brand: {
    color: "#f4f4f7",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
  },
  tagline: {
    color: "#9aa0ad",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#ffd400",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#1a1700", fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: { color: "#f4f4f7", fontWeight: "700", fontSize: 15 },
  error: { color: "#ff4d5e", fontSize: 13, marginTop: 8 },
  note: { color: "#9aa0ad", fontSize: 12, lineHeight: 18, marginTop: 16 },
  pressed: { opacity: 0.7 },
});

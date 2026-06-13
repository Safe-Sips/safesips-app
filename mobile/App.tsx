import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import MapLibreGL from "@maplibre/maplibre-react-native";
import { LatLng, PUBLIC_RADIUS_METERS } from "@safesips/shared";
import { OSM_RASTER_STYLE_JSON } from "./src/mapStyle";
import { circlePolygon, toFeatureCollection } from "./src/geo";
import { geocodeAddress } from "./src/geocode";
import { usePresence } from "./src/usePresence";

// Raster OSM tiles need no token.
MapLibreGL.setAccessToken(null);

const DEFAULT_CENTER: [number, number] = [26.1025, 44.4268]; // [lng, lat] Bucharest

type Source = { kind: "gps" } | { kind: "address"; address: string } | null;

export default function App() {
  const {
    connection,
    others,
    selfPublic,
    lastUpdateAt,
    notice,
    publish,
    stop,
  } = usePresence();

  // Exact location is kept ONLY in local state; it is never emitted.
  const [exact, setExact] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const lastSource = useRef<Source>(null);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (exact) {
      cameraRef.current?.setCamera({
        centerCoordinate: [exact.lng, exact.lat],
        zoomLevel: 15,
        animationDuration: 600,
      });
    }
  }, [exact]);

  // Pulse the circle outline (radar-like blink).
  const [pulseOn, setPulseOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setPulseOn((p) => !p), 700);
    return () => clearInterval(id);
  }, []);

  const setAndPublish = useCallback(
    (loc: LatLng) => {
      setExact(loc);
      publish(loc);
    },
    [publish]
  );

  const runGps = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission denied. Try entering an address.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      lastSource.current = { kind: "gps" };
      setAndPublish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setError("Could not get your location. Try entering an address.");
    } finally {
      setBusy(false);
    }
  }, [setAndPublish]);

  const runAddress = useCallback(
    async (value: string) => {
      const query = value.trim();
      if (!query) return;
      setError(null);
      setBusy(true);
      try {
        const result = await geocodeAddress(query);
        if (!result) {
          setError("No match found for that address.");
          return;
        }
        lastSource.current = { kind: "address", address: query };
        setAndPublish({ lat: result.lat, lng: result.lng });
      } catch {
        setError("Address lookup failed. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [setAndPublish]
  );

  const guard = useCallback(
    (action: () => void) => {
      if (acked) {
        action();
        return;
      }
      Alert.alert(
        "Before you share",
        "Others will see an approximate 200 m area, not your exact position. " +
          "Think twice before sharing from a sensitive place such as home, " +
          "school, work, a shelter, or a medical facility. " +
          "SafeSips is not an emergency service — call 911 in an emergency.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "I understand",
            onPress: () => {
              setAcked(true);
              action();
            },
          },
        ]
      );
    },
    [acked]
  );

  const onUpdate = useCallback(() => {
    const source = lastSource.current;
    if (source?.kind === "gps") runGps();
    else if (source?.kind === "address") runAddress(source.address);
  }, [runGps, runAddress]);

  const onStop = useCallback(() => {
    stop();
    setExact(null);
    lastSource.current = null;
  }, [stop]);

  const sharing = selfPublic !== null;

  const circles = useMemo(() => {
    const features = others.map((r) =>
      circlePolygon({ lat: r.lat, lng: r.lng }, PUBLIC_RADIUS_METERS, r.publicId)
    );
    if (selfPublic) {
      features.push(
        circlePolygon(selfPublic, PUBLIC_RADIUS_METERS, "self")
      );
    }
    return toFeatureCollection(features);
  }, [others, selfPublic]);

  const selfDot = useMemo(() => {
    if (!exact) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [exact.lng, exact.lat] },
    };
  }, [exact]);

  const lastUpdateText = useLastUpdateText(lastUpdateAt);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <MapLibreGL.MapView style={styles.map} mapStyle={OSM_RASTER_STYLE_JSON}>
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 12 }}
        />

        {/* All public privacy circles (self + others). */}
        <MapLibreGL.ShapeSource id="privacy" shape={circles as any}>
          <MapLibreGL.FillLayer
            id="privacy-fill"
            style={{ fillColor: "#ffd400", fillOpacity: 0.12 }}
          />
          <MapLibreGL.LineLayer
            id="privacy-line"
            style={{
              lineColor: "#ffd400",
              lineWidth: pulseOn ? 3.5 : 2,
              lineOpacity: pulseOn ? 0.95 : 0.4,
            }}
          />
        </MapLibreGL.ShapeSource>

        {/* This user's exact location: blue dot, only on this device. */}
        {selfDot && (
          <MapLibreGL.ShapeSource id="selfdot" shape={selfDot as any}>
            <MapLibreGL.CircleLayer
              id="self-dot"
              style={{
                circleColor: "#2f7bff",
                circleRadius: 7,
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 2,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapLibreGL.MapView>

      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>SafeSips</Text>
          <View style={[styles.pill, pillStyle(connection)]}>
            <Text style={styles.pillText}>
              {connection === "connected"
                ? "Online"
                : connection === "connecting"
                  ? "Connecting"
                  : "Offline"}
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.pressed,
            connection !== "connected" && styles.disabled,
          ]}
          disabled={connection !== "connected" || busy}
          onPress={() => guard(runGps)}
        >
          <Text style={styles.primaryBtnText}>Share My Location</Text>
        </Pressable>

        <View style={styles.addressRow}>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="Enter your address"
            placeholderTextColor="#9aa0ad"
            autoCapitalize="none"
            maxLength={500}
            returnKeyType="go"
            onSubmitEditing={() => guard(() => runAddress(address))}
          />
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            disabled={connection !== "connected" || !address.trim() || busy}
            onPress={() => guard(() => runAddress(address))}
          >
            <Text style={styles.secondaryBtnText}>Go</Text>
          </Pressable>
        </View>

        {busy && <ActivityIndicator color="#ffd400" style={{ marginTop: 10 }} />}
        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.error}>{notice}</Text>}

        <View style={styles.statusBox}>
          <Row label="Sharing status" value={sharing ? "Sharing" : "Not sharing"} />
          <Row label="Last update" value={lastUpdateText} />
          <Row label="Others nearby" value={String(others.length)} />
          {sharing && (
            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
                onPress={onUpdate}
              >
                <Text style={styles.ghostBtnText}>Update</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
                onPress={onStop}
              >
                <Text style={styles.dangerBtnText}>Stop sharing</Text>
              </Pressable>
            </View>
          )}
        </View>

        <Text style={styles.note}>
          Your precise location stays private. Others see only an approximate
          200 m area. Not an emergency service — call 911 in an emergency.
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function useLastUpdateText(timestamp: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  if (timestamp == null) return "—";
  const s = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

function pillStyle(connection: string) {
  if (connection === "connected") return { backgroundColor: "rgba(46,213,115,0.16)" };
  if (connection === "connecting") return { backgroundColor: "rgba(255,212,0,0.16)" };
  return { backgroundColor: "rgba(255,77,94,0.16)" };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0f" },
  map: { flex: 1 },
  panel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: "rgba(18,18,26,0.95)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  brand: { color: "#f4f4f7", fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { color: "#f4f4f7", fontSize: 11, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: "#ffd400",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#1a1700", fontWeight: "800", fontSize: 15 },
  addressRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    color: "#f4f4f7",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  secondaryBtnText: { color: "#f4f4f7", fontWeight: "700" },
  statusBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  rowLabel: { color: "#9aa0ad", fontSize: 13 },
  rowValue: { color: "#f4f4f7", fontSize: 13, fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  ghostBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  ghostBtnText: { color: "#f4f4f7", fontWeight: "700" },
  dangerBtn: {
    flex: 1,
    backgroundColor: "rgba(255,77,94,0.16)",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  dangerBtnText: { color: "#ff4d5e", fontWeight: "700" },
  note: { color: "#9aa0ad", fontSize: 12, lineHeight: 18, marginTop: 12 },
  error: { color: "#ff4d5e", fontSize: 13, marginTop: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

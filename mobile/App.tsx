import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import MapLibreGL from "@maplibre/maplibre-react-native";
import { LatLng, PUBLIC_RADIUS_METERS } from "@safesips/shared";
import { OSM_RASTER_STYLE_JSON } from "./src/mapStyle";
import { circlePolygon, toFeatureCollection } from "./src/geo";
import { geocodeAddress } from "./src/geocode";
import { usePresence } from "./src/usePresence";

MapLibreGL.setAccessToken(null);

const DEFAULT_CENTER: [number, number] = [26.1025, 44.4268];

type Source = { kind: "gps" } | { kind: "address"; address: string } | null;

/**
 * Mobile map + share controls.
 *
 * Layout rules:
 * - Map is always the dominant surface (full screen).
 * - Bottom sheet sizes to its content and caps at ~38% of the screen.
 * - Idle: brand, share CTA, address. Sharing: compact status + stop/update.
 * - Safe-area + keyboard aware so controls stay usable on real phones.
 */
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
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = Math.round(windowHeight * 0.38);

  const [exact, setExact] = useState<LatLng | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const lastSource = useRef<Source>(null);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (!exact) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [exact.lng, exact.lat],
      zoomLevel: 15,
      animationDuration: 600,
    });
  }, [exact]);

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
        setError("Location permission denied. Try an address instead.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      lastSource.current = { kind: "gps" };
      setAndPublish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setError("Could not get GPS. Try entering an address.");
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
          setError("No match for that address.");
          return;
        }
        lastSource.current = { kind: "address", address: query };
        setAndPublish({ lat: result.lat, lng: result.lng });
      } catch {
        setError("Address lookup failed. Try again.");
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
        "Others see an approximate 200 m area — not your exact spot. " +
          "Avoid sharing from home, school, work, shelters, or medical sites. " +
          "SafeSips is not an emergency service — call 112 / 911 if needed.",
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
    if (source?.kind === "gps") void runGps();
    else if (source?.kind === "address") void runAddress(source.address);
  }, [runGps, runAddress]);

  const onStop = useCallback(() => {
    stop();
    setExact(null);
    lastSource.current = null;
  }, [stop]);

  const sharing = selfPublic !== null;
  const online = connection === "connected";
  const lastUpdateText = useLastUpdateText(lastUpdateAt);

  const circles = useMemo(() => {
    const features = others.map((r) =>
      circlePolygon({ lat: r.lat, lng: r.lng }, PUBLIC_RADIUS_METERS, r.publicId)
    );
    if (selfPublic) {
      features.push(circlePolygon(selfPublic, PUBLIC_RADIUS_METERS, "self"));
    }
    return toFeatureCollection(features);
  }, [others, selfPublic]);

  const othersDots = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: others.map((r) => ({
        type: "Feature" as const,
        properties: { id: r.publicId },
        geometry: {
          type: "Point" as const,
          coordinates: [r.lng, r.lat],
        },
      })),
    }),
    [others]
  );

  const selfDot = useMemo(() => {
    if (!exact) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Point" as const,
        coordinates: [exact.lng, exact.lat],
      },
    };
  }, [exact]);

  const connectionLabel =
    connection === "connected"
      ? "Online"
      : connection === "connecting"
        ? "Connecting…"
        : "Offline";

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <MapLibreGL.MapView
        style={styles.map}
        mapStyle={OSM_RASTER_STYLE_JSON}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        compassViewPosition={1}
        compassViewMargins={{ x: 12, y: Math.max(insets.top + 8, 48) }}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 12 }}
        />

        <MapLibreGL.ShapeSource id="privacy" shape={circles as any}>
          <MapLibreGL.FillLayer
            id="privacy-fill"
            style={{ fillColor: "#f2bd00", fillOpacity: 0.14 }}
          />
          <MapLibreGL.LineLayer
            id="privacy-line"
            style={{
              lineColor: "#f2bd00",
              lineWidth: pulseOn ? 3 : 2,
              lineOpacity: pulseOn ? 0.95 : 0.45,
            }}
          />
        </MapLibreGL.ShapeSource>

        <MapLibreGL.ShapeSource id="othersdots" shape={othersDots as any}>
          <MapLibreGL.CircleLayer
            id="other-dots"
            style={{
              circleColor: "#c5c9d4",
              circleRadius: 6,
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 2,
            }}
          />
        </MapLibreGL.ShapeSource>

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

      <KeyboardAvoidingView
        style={styles.sheetWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : undefined}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              paddingBottom: Math.max(insets.bottom, 12),
              marginBottom: 10,
            },
          ]}
        >
          <View style={styles.handle} accessibilityElementsHidden />

          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.headerRow}>
              <Text style={styles.brand} accessibilityRole="header">
                SafeSips
              </Text>
              <View
                style={[styles.pill, connectionPill(connection)]}
                accessibilityLabel={`Connection ${connectionLabel}`}
              >
                <View style={[styles.pillDot, connectionDot(connection)]} />
                <Text style={styles.pillText}>{connectionLabel}</Text>
              </View>
            </View>

            {!sharing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share my location"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.pressed,
                  (!online || busy) && styles.disabled,
                ]}
                disabled={!online || busy}
                onPress={() => guard(() => void runGps())}
              >
                {busy ? (
                  <ActivityIndicator color="#1a1700" />
                ) : (
                  <Text style={styles.primaryBtnText}>Share my location</Text>
                )}
              </Pressable>
            ) : (
              <View style={styles.sharingRow}>
                <View style={styles.sharingMeta}>
                  <Text style={styles.sharingTitle}>Sharing nearby area</Text>
                  <Text style={styles.sharingSub}>
                    Updated {lastUpdateText} · {others.length} nearby
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop sharing"
                  style={({ pressed }) => [
                    styles.stopBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={onStop}
                >
                  <Text style={styles.stopBtnText}>Stop</Text>
                </Pressable>
              </View>
            )}

            {!sharing ? (
              <View style={styles.addressRow}>
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Or enter an address"
                  placeholderTextColor="#8b90a5"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={500}
                  returnKeyType="go"
                  editable={online && !busy}
                  onSubmitEditing={() =>
                    guard(() => void runAddress(address))
                  }
                  accessibilityLabel="Address"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Share from address"
                  style={({ pressed }) => [
                    styles.goBtn,
                    pressed && styles.pressed,
                    (!online || !address.trim() || busy) && styles.disabled,
                  ]}
                  disabled={!online || !address.trim() || busy}
                  onPress={() => guard(() => void runAddress(address))}
                >
                  <Text style={styles.goBtnText}>Go</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Update location"
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.pressed,
                  (!online || busy) && styles.disabled,
                ]}
                disabled={!online || busy}
                onPress={onUpdate}
              >
                {busy ? (
                  <ActivityIndicator color="#1b2440" />
                ) : (
                  <Text style={styles.secondaryBtnText}>Update location</Text>
                )}
              </Pressable>
            )}

            {(error || notice) && (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error || notice}
              </Text>
            )}

            <Text style={styles.note}>
              Exact GPS stays on this phone. Others only see a ~200 m area.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
  return `${Math.floor(s / 60)}m ago`;
}

function connectionPill(connection: string) {
  if (connection === "connected") {
    return { backgroundColor: "rgba(31, 157, 84, 0.14)" };
  }
  if (connection === "connecting") {
    return { backgroundColor: "rgba(242, 189, 0, 0.18)" };
  }
  return { backgroundColor: "rgba(224, 38, 60, 0.14)" };
}

function connectionDot(connection: string) {
  if (connection === "connected") return { backgroundColor: "#1f9d54" };
  if (connection === "connecting") return { backgroundColor: "#f2bd00" };
  return { backgroundColor: "#e0263c" };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#e6eaf6",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  sheet: {
    marginHorizontal: 12,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(24, 33, 60, 0.1)",
    shadowColor: "#0e1330",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(24, 33, 60, 0.18)",
    marginTop: 10,
    marginBottom: 4,
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  brand: {
    color: "#0e1330",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pillText: {
    color: "#1b2440",
    fontSize: 12,
    fontWeight: "700",
  },
  primaryBtn: {
    backgroundColor: "#f2bd00",
    borderRadius: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    color: "#1a1700",
    fontWeight: "800",
    fontSize: 16,
  },
  sharingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(47, 123, 255, 0.08)",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  sharingMeta: {
    flex: 1,
  },
  sharingTitle: {
    color: "#1b2440",
    fontWeight: "800",
    fontSize: 15,
  },
  sharingSub: {
    color: "#5d6580",
    fontSize: 12,
    marginTop: 2,
  },
  stopBtn: {
    backgroundColor: "rgba(224, 38, 60, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: "center",
  },
  stopBtnText: {
    color: "#e0263c",
    fontWeight: "800",
    fontSize: 14,
  },
  addressRow: {
    flexDirection: "row",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    backgroundColor: "rgba(24, 33, 60, 0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(24, 33, 60, 0.1)",
    color: "#1b2440",
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
  },
  goBtn: {
    backgroundColor: "#0e1330",
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  goBtnText: {
    color: "#f4f4f7",
    fontWeight: "800",
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: "rgba(24, 33, 60, 0.06)",
    borderRadius: 12,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    color: "#1b2440",
    fontWeight: "700",
    fontSize: 14,
  },
  note: {
    color: "#5d6580",
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: "#e0263c",
    fontSize: 13,
    fontWeight: "600",
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});

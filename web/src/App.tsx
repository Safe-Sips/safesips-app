import { useCallback, useRef, useState } from "react";
import type { LatLng } from "@safesips/shared";
import type { AddressSuggestion } from "./geocode";
import Controls from "./components/Controls";
import LegalFooter from "./components/LegalFooter";
import LegalModal from "./components/LegalModal";
import MapView from "./components/MapView";
import SensitiveWarning from "./components/SensitiveWarning";
import { geocodeAddress } from "./geocode";
import { usePresence } from "./hooks/usePresence";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legal/content";

const ACK_KEY = "safesips.sensitiveAck";

type PendingAction =
  | { kind: "gps" }
  | { kind: "address"; address: string; lat?: number; lng?: number };
type LegalDoc = "privacy" | "terms" | null;

export default function App() {
  const { state, publish, stop, clearNotice } = usePresence();

  // Exact location lives ONLY in local component state; it is never emitted.
  const [exact, setExact] = useState<LatLng | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [acked, setAcked] = useState<boolean>(
    () => localStorage.getItem(ACK_KEY) === "1"
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null);
  const lastSource = useRef<PendingAction | null>(null);

  const setExactAndPublish = useCallback(
    (location: LatLng) => {
      setExact(location);
      publish(location);
    },
    [publish]
  );

  const runGps = useCallback(() => {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Geolocation is not supported on this device.");
      return;
    }
    setGeoStatus("Requesting location permission…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus(null);
        lastSource.current = { kind: "gps" };
        setExactAndPublish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setGeoStatus(null);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Try entering an address instead."
            : "Could not get your location. Try entering an address instead."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }, [setExactAndPublish]);

  const runAddress = useCallback(
    async (address: string) => {
      setGeoError(null);
      setGeoStatus("Looking up address…");
      try {
        const result = await geocodeAddress(address);
        setGeoStatus(null);
        if (!result) {
          setGeoError("No match found for that address.");
          return;
        }
        lastSource.current = { kind: "address", address: result.displayName };
        setExactAndPublish({ lat: result.lat, lng: result.lng });
      } catch {
        setGeoStatus(null);
        setGeoError("Address lookup failed. Please try again.");
      }
    },
    [setExactAndPublish]
  );

  const runPickedAddress = useCallback(
    (suggestion: AddressSuggestion) => {
      clearNotice();
      if (!acked) {
        setPending({
          kind: "address",
          address: suggestion.displayName,
          lat: suggestion.lat,
          lng: suggestion.lng,
        });
        return;
      }
      setGeoError(null);
      setGeoStatus(null);
      lastSource.current = { kind: "address", address: suggestion.displayName };
      setExactAndPublish({ lat: suggestion.lat, lng: suggestion.lng });
    },
    [acked, clearNotice, setExactAndPublish]
  );

  // Gate the first share behind the sensitive-location warning.
  const guarded = useCallback(
    (action: PendingAction) => {
      clearNotice();
      if (acked) {
        if (action.kind === "gps") runGps();
        else runAddress(action.address);
      } else {
        setPending(action);
      }
    },
    [acked, clearNotice, runGps, runAddress]
  );

  const confirmWarning = useCallback(() => {
    localStorage.setItem(ACK_KEY, "1");
    setAcked(true);
    const action = pending;
    setPending(null);
    if (action?.kind === "gps") runGps();
    else if (action?.kind === "address") {
      if (action.lat != null && action.lng != null) {
        lastSource.current = { kind: "address", address: action.address };
        setExactAndPublish({ lat: action.lat, lng: action.lng });
      } else {
        runAddress(action.address);
      }
    }
  }, [pending, runGps, runAddress, setExactAndPublish]);

  const onUpdate = useCallback(() => {
    const source = lastSource.current;
    if (source?.kind === "gps") runGps();
    else if (source?.kind === "address") runAddress(source.address);
  }, [runGps, runAddress]);

  const onStop = useCallback(() => {
    stop();
    setExact(null);
    lastSource.current = null;
    setGeoStatus(null);
    setGeoError(null);
  }, [stop]);

  return (
    <div className="app-shell">
      <MapView
        exact={exact}
        selfPublic={state.selfPublic}
        others={state.others}
      />
      <Controls
        connection={state.connection}
        sharing={state.selfPublic !== null}
        geoStatus={geoStatus}
        geoError={geoError}
        notice={state.notice}
        lastUpdateAt={state.lastUpdateAt}
        othersCount={state.others.length}
        onShareGps={() => guarded({ kind: "gps" })}
        onSubmitAddress={(address) => guarded({ kind: "address", address })}
        onPickAddress={runPickedAddress}
        onUpdate={onUpdate}
        onStop={onStop}
      />
      <SensitiveWarning
        open={pending !== null}
        onConfirm={confirmWarning}
        onCancel={() => setPending(null)}
      />
      <LegalFooter
        onOpenPrivacy={() => setLegalDoc("privacy")}
        onOpenTerms={() => setLegalDoc("terms")}
      />
      <LegalModal
        title="Privacy Policy"
        body={PRIVACY_POLICY}
        open={legalDoc === "privacy"}
        onClose={() => setLegalDoc(null)}
      />
      <LegalModal
        title="Terms of Service"
        body={TERMS_OF_SERVICE}
        open={legalDoc === "terms"}
        onClose={() => setLegalDoc(null)}
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLngBounds } from "leaflet";
import type { LatLng, ReportDTO, ReportSafety, SafeHavenDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useSocket } from "../socket/SocketProvider";
import { usePresence } from "../hooks/usePresence";
import Controls from "../components/Controls";
import MapView, { type FocusPoint } from "../components/MapView";
import SensitiveWarning from "../components/SensitiveWarning";
import MarkUnsafeDialog from "../components/MarkUnsafeDialog";
import ReportPanel from "../components/ReportPanel";
import SafeHavenPanel from "../components/SafeHavenPanel";
import LegalFooter from "../components/LegalFooter";
import LegalModal from "../components/LegalModal";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "../legal/content";

const ACK_KEY = "safesips.sensitiveAck";

type PendingAction = { kind: "gps" };
type LegalDoc = "privacy" | "terms" | null;

export default function MapPage() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { state, publish, stop, clearNotice } = usePresence();

  // Exact location lives ONLY in local state; it is never emitted.
  const [exact, setExact] = useState<LatLng | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Where the map should recenter (initial entry, "use my location", reporting).
  // This only pans the view — it never shares the location.
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);

  // On entry, center the map on the user's current location instead of the
  // default. View-only: this does NOT share/publish anything.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setFocusPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          zoom: 15,
        }),
      () => {
        /* permission denied / unavailable: keep the default view */
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 }
    );
  }, []);

  const [acked, setAcked] = useState<boolean>(
    () => localStorage.getItem(ACK_KEY) === "1"
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const lastSource = useRef<PendingAction | null>(null);

  // Reports + safe havens.
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [selected, setSelected] = useState<ReportDTO | null>(null);
  const [reportMode, setReportMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<LatLng | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [havenPoint, setHavenPoint] = useState<LatLng | null>(null);
  const [havens, setHavens] = useState<SafeHavenDTO[]>([]);
  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null);

  const boundsRef = useRef<LatLngBounds | null>(null);
  const fetchTimer = useRef<number | undefined>(undefined);

  /* --------------------------- presence sharing --------------------------- */

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
        setExactAndPublish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setGeoStatus(null);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable location access to share."
            : "Could not get your location. Check permissions and try again."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }, [setExactAndPublish]);

  const guarded = useCallback(
    (action: PendingAction) => {
      clearNotice();
      if (acked) {
        runGps();
      } else {
        setPending(action);
      }
    },
    [acked, clearNotice, runGps]
  );

  const confirmWarning = useCallback(() => {
    localStorage.setItem(ACK_KEY, "1");
    setAcked(true);
    const action = pending;
    setPending(null);
    if (action?.kind === "gps") runGps();
  }, [pending, runGps]);

  const onUpdate = useCallback(() => {
    if (lastSource.current?.kind === "gps") runGps();
  }, [runGps]);

  const onStop = useCallback(() => {
    stop();
    setExact(null);
    lastSource.current = null;
    setGeoStatus(null);
    setGeoError(null);
  }, [stop]);

  // Sync local exact coords when sharing auto-stops (24 h limit / server expiry).
  useEffect(() => {
    if (state.selfPublic === null && exact !== null) {
      setExact(null);
      lastSource.current = null;
      setGeoStatus(null);
    }
  }, [state.selfPublic, exact]);

  /* ------------------------------- reports -------------------------------- */

  const loadReports = useCallback(async (bounds: LatLngBounds) => {
    const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
    try {
      const list = await api.listReports(bbox);
      setReports(list);
    } catch {
      // ignore transient errors
    }
  }, []);

  const onBoundsChange = useCallback(
    (bounds: LatLngBounds) => {
      boundsRef.current = bounds;
      window.clearTimeout(fetchTimer.current);
      fetchTimer.current = window.setTimeout(() => loadReports(bounds), 400);
    },
    [loadReports]
  );

  // Live report broadcasts.
  useEffect(() => {
    if (!socket) return;
    const onNew = (report: ReportDTO) => {
      setReports((prev) =>
        prev.some((r) => r.id === report.id) ? prev : [report, ...prev]
      );
    };
    const onRemoved = ({ id }: { id: string }) => {
      setReports((prev) => prev.filter((r) => r.id !== id));
      setSelected((s) => (s?.id === id ? null : s));
    };
    socket.on("report:new", onNew);
    socket.on("report:removed", onRemoved);
    return () => {
      socket.off("report:new", onNew);
      socket.off("report:removed", onRemoved);
    };
  }, [socket]);

  const updateReportInState = useCallback((updated: ReportDTO) => {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelected((s) => (s?.id === updated.id ? updated : s));
  }, []);

  const submitReport = useCallback(
    async (input: {
      safety: ReportSafety;
      category: string | null;
      note: string | null;
    }) => {
      if (!pendingPoint) return;
      setReportBusy(true);
      setReportError(null);
      try {
        const dto = await api.createReport({
          lat: pendingPoint.lat,
          lng: pendingPoint.lng,
          safety: input.safety,
          category: input.category,
          note: input.note,
          placeLabel: null,
        });
        setReports((prev) => [dto, ...prev.filter((r) => r.id !== dto.id)]);
        const point = pendingPoint;
        setPendingPoint(null);
        setReportMode(false);
        // Move the map to the place that was just reported.
        setFocusPoint({ lat: point.lat, lng: point.lng });
        // If they marked it unsafe, immediately surface nearby help.
        if (input.safety === "unsafe") setHavenPoint(point);
      } catch (e) {
        setReportError(
          e instanceof ApiError ? e.message : "Could not publish the report."
        );
      } finally {
        setReportBusy(false);
      }
    },
    [pendingPoint]
  );

  const useMyLocationForReport = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPendingPoint(point);
        // Move the map so the pending pin is visible.
        setFocusPoint({ ...point });
      },
      () => setReportError("Couldn't get your location. Tap the map instead."),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  }, []);

  // Show nearby help (pharmacies, police, hospital, fuel, 24/7) anytime —
  // independent of reporting a place unsafe. Falls back to the map center if
  // location permission is unavailable (never no-ops).
  const findHelpNearMe = useCallback(() => {
    const fallbackPoint = (): LatLng => {
      const center = boundsRef.current?.getCenter();
      if (center) return { lat: center.lat, lng: center.lng };
      // Map default (Bucharest) — same as MapView — so the panel always opens.
      return { lat: 44.4268, lng: 26.1025 };
    };
    if (!("geolocation" in navigator)) {
      setHavenPoint(fallbackPoint());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setHavenPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setHavenPoint(fallbackPoint()),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 }
    );
  }, []);

  return (
    <div className="map-page">
      <MapView
        exact={exact}
        selfPublic={state.selfPublic}
        others={state.others}
        reports={reports}
        havens={havens}
        pickMode={reportMode && pendingPoint === null}
        pendingPoint={pendingPoint}
        focusPoint={focusPoint}
        onPickPoint={(p) => setPendingPoint(p)}
        onSelectReport={(r) => setSelected(r)}
        onBoundsChange={onBoundsChange}
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
        onUpdate={onUpdate}
        onStop={onStop}
        onOpenPrivacy={() => setLegalDoc("privacy")}
        onOpenTerms={() => setLegalDoc("terms")}
      />

      {/* Report-a-place + find-help controls, or the report-mode banner. */}
      {!reportMode ? (
        <div className="map-fabs">
          <button
            className="report-fab"
            onClick={() => {
              setReportError(null);
              setReportMode(true);
            }}
          >
            ＋ Report a place
          </button>
          <button className="help-fab" onClick={findHelpNearMe}>
            🆘 Help near me
          </button>
        </div>
      ) : (
        <div className="report-banner">
          <span>Tap the spot on the map, or</span>
          <button className="btn btn-secondary btn-sm" onClick={useMyLocationForReport}>
            Use my location
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setReportMode(false);
              setPendingPoint(null);
              setReportError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {pendingPoint && (
        <MarkUnsafeDialog
          point={pendingPoint}
          placeLabel={null}
          busy={reportBusy}
          error={reportError}
          onSubmit={submitReport}
          onCancel={() => {
            setPendingPoint(null);
            setReportError(null);
          }}
        />
      )}

      {selected && (
        <ReportPanel
          report={selected}
          isOwn={selected.authorId === user?.id}
          onClose={() => setSelected(null)}
          onChange={updateReportInState}
          onDelete={(id) => {
            setReports((prev) => prev.filter((r) => r.id !== id));
            setSelected(null);
          }}
          onFindHavens={(r) => setHavenPoint({ lat: r.lat, lng: r.lng })}
        />
      )}

      {havenPoint && (
        <SafeHavenPanel
          point={havenPoint}
          onLoaded={setHavens}
          onClose={() => {
            setHavenPoint(null);
            setHavens([]);
          }}
        />
      )}

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

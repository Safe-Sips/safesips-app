import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { LatLngBounds } from "leaflet";
import {
  isReportExpired,
  type LatLng,
  type ReportDTO,
  type ReportSafety,
  type SafeHavenDTO,
} from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeAgo } from "../format";
import { useAuth } from "../auth/AuthContext";
import { useSocket } from "../socket/SocketProvider";
import { usePresence } from "../hooks/usePresence";
import Controls from "../components/Controls";
import MapView, { type AlertArea, type FocusPoint } from "../components/MapView";
import SensitiveWarning from "../components/SensitiveWarning";
import MarkUnsafeDialog from "../components/MarkUnsafeDialog";
import ReportPanel from "../components/ReportPanel";
import SafeHavenPanel from "../components/SafeHavenPanel";
import LegalFooter from "../components/LegalFooter";
import LegalModal from "../components/LegalModal";
import MapIntro, { hasSeenMapIntro, markMapIntroSeen } from "../components/MapIntro";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "../legal/content";

const ACK_KEY = "safesips.sensitiveAck";

type PendingAction = { kind: "gps" };
type LegalDoc = "privacy" | "terms" | null;

/** Turn a GeolocationPositionError into something the user can act on. */
function geolocationErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return (
      "Location is blocked for SafeSips. To share, allow it: tap the lock or " +
      "info icon next to the address bar → Site settings → Location → Allow, " +
      "then try again. On iPhone also check Settings → Privacy & Security → " +
      "Location Services → Safari Websites."
    );
  }
  if (err.code === err.TIMEOUT) {
    return "Getting your location took too long. Move near a window or outdoors and try again.";
  }
  return "Your device couldn't find your location. Turn on Location / GPS and try again.";
}

/** Router state from the Alerts page's "See where they were last sharing". */
function readAlertArea(state: unknown): AlertArea | null {
  const a = (state as { alertArea?: Partial<AlertArea> } | null)?.alertArea;
  if (!a || typeof a.lat !== "number" || typeof a.lng !== "number") return null;
  return { lat: a.lat, lng: a.lng, name: String(a.name ?? "Your contact"), at: Number(a.at) || Date.now() };
}

export default function MapPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [alertArea, setAlertArea] = useState<AlertArea | null>(() => readAlertArea(location.state));
  // Opened again from another alert while already on the map.
  useEffect(() => {
    const next = readAlertArea(location.state);
    if (next) {
      setAlertArea(next);
      setFocusPoint({ lat: next.lat, lng: next.lng, zoom: 15 });
    }
  }, [location.state]);
  const closeAlertArea = () => {
    setAlertArea(null);
    // Drop it from history so a refresh/back doesn't bring it back.
    navigate(".", { replace: true, state: null });
  };
  const { socket } = useSocket();
  const { state, publish, stop, clearNotice, setDurationMs } = usePresence();

  // Exact location lives ONLY on this device and is never emitted. It's owned
  // by PresenceProvider (above the routes) so the live circle keeps following
  // you while you're on another tab.
  const exact = state.exact;
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Where the map should recenter (initial entry, "use my location", reporting).
  // This only pans the view — it never shares the location.
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(() =>
    alertArea ? { lat: alertArea.lat, lng: alertArea.lng, zoom: 15 } : null
  );

  // On entry, center the map on the user's current location instead of the
  // default (unless we came to look at a contact's alert area). View-only:
  // this does NOT share/publish anything.
  useEffect(() => {
    if (alertArea || !("geolocation" in navigator)) return;
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

  // Reports + safe havens.
  const [reports, setReports] = useState<ReportDTO[]>([]);
  // Reports fade over 48 h and then vanish. Opacity moves ~0.07%/min, so a
  // 5-minute tick is plenty (and costs nothing between ticks).
  const [reportNow, setReportNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setReportNow(Date.now()), 5 * 60_000);
    return () => window.clearInterval(id);
  }, []);
  const visibleReports = useMemo(
    () => reports.filter((r) => !isReportExpired(r.createdAt, reportNow)),
    [reports, reportNow]
  );
  const [selected, setSelected] = useState<ReportDTO | null>(null);
  const [reportMode, setReportMode] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<LatLng | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [havenPoint, setHavenPoint] = useState<LatLng | null>(null);
  const [havens, setHavens] = useState<SafeHavenDTO[]>([]);
  const [legalDoc, setLegalDoc] = useState<LegalDoc>(null);
  // First visit: explain what the map shows before anyone shares.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenMapIntro());
  const closeIntro = useCallback(() => {
    markMapIntroSeen();
    setIntroOpen(false);
  }, []);

  const boundsRef = useRef<LatLngBounds | null>(null);
  const fetchTimer = useRef<number | undefined>(undefined);

  /* --------------------------- presence sharing --------------------------- */

  const setExactAndPublish = useCallback(
    (location: LatLng) => publish(location),
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
        setExactAndPublish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setGeoStatus(null);
        setGeoError(geolocationErrorMessage(err));
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

  // Update forces a precise GPS fix right now (the live circle otherwise moves
  // on its own using low-power positioning). Also works after a resumed share.
  const onUpdate = useCallback(() => {
    runGps();
  }, [runGps]);

  const onStop = useCallback(() => {
    stop();
    setGeoStatus(null);
    setGeoError(null);
  }, [stop]);

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
        reports={visibleReports}
        reportNow={reportNow}
        havens={havens}
        pickMode={reportMode && pendingPoint === null}
        pendingPoint={pendingPoint}
        focusPoint={focusPoint}
        alertArea={alertArea}
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
        sharedUntil={state.sharedUntil}
        durationMs={state.durationMs}
        onDurationChange={setDurationMs}
        othersCount={state.others.length}
        onShareGps={() => guarded({ kind: "gps" })}
        onUpdate={onUpdate}
        onStop={onStop}
        onOpenPrivacy={() => setLegalDoc("privacy")}
        onOpenTerms={() => setLegalDoc("terms")}
        onOpenHowItWorks={() => setIntroOpen(true)}
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
            <span aria-hidden="true">＋ </span>Report a place
          </button>
          <button className="help-fab" onClick={findHelpNearMe}>
            <span aria-hidden="true">🆘 </span>Help near me
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

      {alertArea && !reportMode && (
        <div className="report-banner alert-area-banner" role="status">
          <span>
            <strong>{alertArea.name}</strong>'s last shared area ({timeAgo(alertArea.at)}) —
            approximate, not their exact position.
          </span>
          <button className="btn btn-ghost btn-sm" onClick={closeAlertArea}>
            Close
          </button>
        </div>
      )}

      {/* Empty map: say so instead of showing a silent, empty map. */}
      {!reportMode && !alertArea && state.connection === "connected" && state.others.length === 0 && (
        <p className="map-empty" role="status">
          {state.selfPublic
            ? "You're sharing. No one else is sharing right now."
            : "No one else is sharing right now. Share your circle so friends can find you."}
        </p>
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
        onOpenHowItWorks={() => setIntroOpen(true)}
      />
      <MapIntro open={introOpen} onClose={closeIntro} />
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

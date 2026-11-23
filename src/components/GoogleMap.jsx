import { useCallback, useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { getStops } from "../services/stops.js";
import { getFavorites } from "../services/favorites.js";
import StationModal from "./StationModal.jsx";
import ShareModal from "./ShareModal.jsx";
import LoadingBus from "./LoadingBus.jsx";
import styles from "./GoogleMap.module.css";
import busIcon from "../assets/busvektor.svg";
import { getMapStyles } from "../themes/mapStyles.js";
import { useLocation } from "react-router";
import { getStopById } from "../services/stops.js";
import { getTripSchedule } from "../services/tripSchedule.js";

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

if (apiKey) {
  setOptions({ key: apiKey, v: "weekly" });
}

// Dynamisk gruppering af stoppesteder baseret på zoomniveau og kortprojektion.
function groupStops(stops, projection, zoom) {
  if (zoom >= 15) {
    return stops.map((stop) => [stop]);
  }

  const cellSize = 150;
  const scale = 2 ** zoom;
  const groups = new Map();

  stops.forEach((stop) => {
    const position = new google.maps.LatLng(stop.stop_lat, stop.stop_lon);
    const point = projection.fromLatLngToPoint(position);
    if (!point) return;

    const x = Math.floor((point.x * scale) / cellSize);
    const y = Math.floor((point.y * scale) / cellSize);
    const key = `${x}:${y}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(stop);
  });

  return [...groups.values()];
}

// GoogleMap-komponenten håndterer kortvisning, markører for stoppesteder og brugerens lokation.
export default function GoogleMap({ userLocation }) {
  const mapRef = useRef(null);
  const googleMapRef = useRef(null);
  const locationMarkerRef = useRef(null);
  const latestLocationRef = useRef(userLocation);
  latestLocationRef.current = userLocation;

  const refreshStopsRef = useRef(null);
  const renderStopsRef = useRef(null);
  const fitFavoritesRef = useRef(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeRefreshesRef = useRef(0);

  // Saml parallelle opdateringer, så animationen først stopper, når alle er færdige.
  const beginRefresh = useCallback(() => {
    activeRefreshesRef.current += 1;
    setIsRefreshing(true);
    let finished = false;

    return () => {
      if (finished) return;
      finished = true;
      activeRefreshesRef.current = Math.max(0, activeRefreshesRef.current - 1);
      if (activeRefreshesRef.current === 0) setIsRefreshing(false);
    };
  }, []);
  const [error, setError] = useState("");
  const [shareError, setShareError] = useState("");
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [favorites, setFavorites] = useState(getFavorites);
  const favoritesRef = useRef(favorites);
  const [showAllStops, setShowAllStops] = useState(false);
  const showAllStopsRef = useRef(false);

  // Brug useLocation til at få adgang til den valgte stoppested fra SearchPage
  const location = useLocation();
  const requestedStop = location.state?.selectedStop;
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapReady) return;

    const params = new URLSearchParams(location.search);

    const tripId = params.get("trip");
    const stopId = params.get("stop");
    const departureAt = params.get("departure");

    const hasShareParams =
      params.has("trip") || params.has("stop") || params.has("departure");

    if (!hasShareParams) return;

    if (!tripId || !stopId || !departureAt) {
      setShareError("Linket mangler oplysninger om busafgangen.");
      return;
    }

    let cancelled = false;

    async function openSharedTrip() {
      try {
        if (!Number.isFinite(Date.parse(departureAt))) {
          throw new Error("Ugyldigt afgangstidspunkt");
        }

        const [stop, schedule] = await Promise.all([
          getStopById(stopId),
          getTripSchedule(tripId, stopId, departureAt),
        ]);

        if (cancelled) return;

        if (!stop || schedule.length === 0) {
          throw new Error("Busafgangen kunne ikke findes");
        }

        setSelectedStop(stop);
        setSelectedTrip({
          trip_id: tripId,
          departure_at: departureAt,
          route_short_name: params.get("route") || "?",
          destination: params.get("destination") || "Ukendt destination",
        });
        setShareOpen(false);
        setError("");

        const map = googleMapRef.current;

        if (map) {
          map.set("hasCenteredOnUser", true);
          map.panTo({
            lat: Number(stop.stop_lat),
            lng: Number(stop.stop_lon),
          });
          map.setZoom(17);
        }
      } catch (error) {
        if (cancelled) return;

        console.error("Kunne ikke åbne delt busafgang:", error);
        setShareError(
          "Busafgangen kunne ikke findes. Linket kan være ugyldigt eller udløbet.",
        );
      }
    }

    openSharedTrip();

    return () => {
      cancelled = true;
    };
  }, [mapReady, location.search]);

  // Lyt til ændringer i favoritstoppesteder og opdater kortet derefter.
  useEffect(() => {
    function updateFavorites() {
      setFavorites(getFavorites());
    }

    window.addEventListener("favorites-changed", updateFavorites);
    window.addEventListener("storage", updateFavorites);

    return () => {
      window.removeEventListener("favorites-changed", updateFavorites);
      window.removeEventListener("storage", updateFavorites);
    };
  }, []);

  // Opdater kortet, når favoritstoppesteder ændres
  useEffect(() => {
    favoritesRef.current = favorites;

    // Opdater markører på det eksisterende kort
    renderStopsRef.current?.();

    // Sørg for, at favoritstoppesteder er synlige
    if (favorites.length > 0 && !showAllStopsRef.current) {
      fitFavoritesRef.current?.();
    }

    if (favorites.length === 0) {
      showAllStopsRef.current = false;
      setShowAllStops(false);
      refreshStopsRef.current?.();
    }
  }, [favorites]);

  useEffect(() => {
    if (!apiKey) {
      setError("Google Maps API-nøglen mangler.");
      return;
    }

    let cancelled = false;
    let idleListener = null;
    let zoomListener = null;
    let updateTimer = null;
    let requestId = 0;
    let stopMarkers = [];
    let cachedStops = [];
    let themeObserver = null;

    // Indlæser Google Maps API og initialiserer kortet
    async function loadMap() {
      try {
        const { Map, OverlayView } = await importLibrary("maps");

        if (cancelled || !mapRef.current) return;

        const map = new Map(mapRef.current, {
          center: { lat: 56.1629, lng: 10.2039 },
          zoom: 15,
          disableDefaultUI: true,
          clickableIcons: false,
          styles: getMapStyles(),
        });

        class MapMarker extends OverlayView {
          constructor(position, className, title = "") {
            super();
            this.position = position;
            this.element = document.createElement("div");
            this.element.className = className;
            this.element.title = title;
          }

          onAdd() {
            this.getPanes().overlayMouseTarget.appendChild(this.element);
          }

          draw() {
            const projection = this.getProjection();
            if (!projection) return;
            const point = projection.fromLatLngToDivPixel(this.position);
            if (!point) return;
            this.element.style.left = `${point.x}px`;
            this.element.style.top = `${point.y}px`;
          }

          onRemove() {
            this.element.remove();
          }

          setPosition(position) {
            this.position = position;
            this.draw();
          }
        }

        googleMapRef.current = map;
        setMapReady(true); // Indikerer, at kortet er klar til brug

        // Opdater kun kortets farver ved temaskift – behold zoom, position og markører.
        themeObserver = new MutationObserver(() => {
          map.setOptions({ styles: getMapStyles() });
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme", "data-mode"],
        });

        const locationMarker = new MapMarker(
          new google.maps.LatLng(56.1629, 10.2039),
          styles.locationDot,
        );

        locationMarkerRef.current = locationMarker;

        const currentLocation = latestLocationRef.current;

        if (currentLocation) {
          const position = new google.maps.LatLng(
            currentLocation.latitude,
            currentLocation.longitude,
          );

          locationMarker.setPosition(position);
          locationMarker.setMap(map);
          map.setCenter(position);
          map.set("hasCenteredOnUser", true);
        }

        // Render stoppesteder på kortet baseret på synlige stoppesteder og favoritstoppesteder
        function renderStops() {
          if (cancelled) return;

          const projection = map.getProjection();
          const zoom = map.getZoom();

          if (!projection || zoom == null) return;

          const savedFavorites = favoritesRef.current;

          // Brug favoritternes gemte koordinater.
          // De behøver derfor ikke ligge i cachedStops.
          const visibleStops =
            savedFavorites.length > 0 && !showAllStopsRef.current
              ? savedFavorites
                  .map((stop) => ({
                    ...stop,
                    stop_lat: Number(stop.stop_lat),
                    stop_lon: Number(stop.stop_lon),
                  }))
                  .filter(
                    (stop) =>
                      Number.isFinite(stop.stop_lat) &&
                      Number.isFinite(stop.stop_lon),
                  )
              : cachedStops;

          const groups = groupStops(visibleStops, projection, zoom);

          const newMarkers = groups.map((group) => {
            if (group.length === 1) {
              const stop = group[0];
              const marker = new MapMarker(
                new google.maps.LatLng(stop.stop_lat, stop.stop_lon),
                styles.stopMarker,
                stop.stop_name,
              );

              const selectStop = () => {
                setSelectedTrip(null);
                setShareOpen(false);
                setSelectedStop(stop);
              };
              marker.element.addEventListener("click", selectStop);
              marker.element.setAttribute("role", "button");
              marker.element.setAttribute("tabindex", "0");
              marker.element.setAttribute(
                "aria-label",
                `Vælg stoppested ${stop.stop_name}`,
              );
              marker.element.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectStop();
                }
              });
              return marker;
            }

            const latitude =
              group.reduce((sum, stop) => sum + stop.stop_lat, 0) /
              group.length;
            const longitude =
              group.reduce((sum, stop) => sum + stop.stop_lon, 0) /
              group.length;
            const position = new google.maps.LatLng(latitude, longitude);
            const marker = new MapMarker(
              position,
              styles.stopGroup,
              `${group.length} stoppesteder`,
            );

            const icon = document.createElement("span");
            icon.className = styles.groupIcon;
            const count = document.createElement("span");
            count.className = styles.groupCount;
            count.textContent = String(group.length);
            const name = document.createElement("span");
            name.className = styles.groupName;
            name.textContent = group[0].stop_name
              .split("/")[0]
              .replace(/\s*\(.*$/, "")
              .trim();
            marker.element.append(icon, count, name);

            const zoomToGroup = () => {
              map.panTo(position);
              map.setZoom(Math.min((map.getZoom() ?? 15) + 2, 19));
            };
            marker.element.addEventListener("click", zoomToGroup);
            marker.element.setAttribute("role", "button");
            marker.element.setAttribute("tabindex", "0");
            marker.element.setAttribute(
              "aria-label",
              `Zoom ind på ${group.length} stoppesteder`,
            );
            marker.element.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                zoomToGroup();
              }
            });
            return marker;
          });

          newMarkers.forEach((marker) => marker.setMap(map));
          stopMarkers.forEach((marker) => marker.setMap(null));
          stopMarkers = newMarkers;
        }

        // Hent stoppesteder inden for det aktuelle kortområde og opdater markørerne
        async function updateStops() {
          const bounds = map.getBounds();
          if (!bounds || cancelled) return;
          const currentRequest = ++requestId;
          const area = {
            north: bounds.getNorthEast().lat(),
            east: bounds.getNorthEast().lng(),
            south: bounds.getSouthWest().lat(),
            west: bounds.getSouthWest().lng(),
          };

          const finishRefresh = beginRefresh();
          try {
            // Vis mindst én fuld rotation ved hver kortopdatering.
            const [stops] = await Promise.all([
              getStops(area),
              new Promise((resolve) => setTimeout(resolve, 600)),
            ]);
            if (cancelled || currentRequest !== requestId) return;
            cachedStops = stops.filter(
              (stop) =>
                Number.isFinite(stop.stop_lat) &&
                Number.isFinite(stop.stop_lon),
            );
            renderStops();
          } catch (fetchError) {
            if (!cancelled && currentRequest === requestId) {
              console.error("Kunne ikke hente stoppesteder:", fetchError);
            }
          } finally {
            finishRefresh();
          }
        }

        refreshStopsRef.current = updateStops;

        // tilpasser kortet automatisk, så alle favoritstoppesteder kan ses, selvom de ligger forskellige steder i Aarhus

        renderStopsRef.current = renderStops;

        fitFavoritesRef.current = () => {
          const favoriteStops = favoritesRef.current
            .map((stop) => ({
              lat: Number(stop.stop_lat),
              lng: Number(stop.stop_lon),
            }))
            .filter(
              (position) =>
                Number.isFinite(position.lat) && Number.isFinite(position.lng),
            );

          if (favoriteStops.length === 0) return;

          if (favoriteStops.length === 1) {
            map.setCenter(favoriteStops[0]);
            map.setZoom(15);
            return;
          }

          const bounds = new google.maps.LatLngBounds();

          favoriteStops.forEach((position) => {
            bounds.extend(position);
          });

          map.fitBounds(bounds, 48);
        };

        // Brug favoritternes placering ved første indlæsning
        if (favoritesRef.current.length > 0) {
          fitFavoritesRef.current();
        }

        zoomListener = map.addListener("zoom_changed", () => {
          renderStops();
        });
        idleListener = map.addListener("idle", () => {
          clearTimeout(updateTimer);
          requestId++;
          updateTimer = setTimeout(updateStops, 150);
        });
      } catch (mapError) {
        if (!cancelled) {
          console.error("Google Maps fejl:", mapError);
          setError("Kortet kunne ikke indlæses.");
        }
      }
    }

    loadMap();

    return () => {
      cancelled = true;
      refreshStopsRef.current = null;
      renderStopsRef.current = null;
      fitFavoritesRef.current = null;
      requestId++;
      clearTimeout(updateTimer);
      themeObserver?.disconnect();
      idleListener?.remove();
      zoomListener?.remove();
      stopMarkers.forEach((marker) => marker.setMap(null));

      locationMarkerRef.current?.setMap(null); // Fjern markøren fra kortet når det ikke er i brug
      locationMarkerRef.current = null;
      googleMapRef.current = null;
    };
  }, []);

  // Åbn et stoppested, som er valgt på søgesiden
  useEffect(() => {
    if (!mapReady || !requestedStop) return;

    const map = googleMapRef.current;
    if (!map) return;

    const latitude = Number(requestedStop.stop_lat);
    const longitude = Number(requestedStop.stop_lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    // Undgå at GPS-centering overskriver det valgte stoppested
    map.set("hasCenteredOnUser", true);

    map.panTo({
      lat: latitude,
      lng: longitude,
    });

    map.setZoom(17);
    setSelectedStop(requestedStop);
  }, [mapReady, requestedStop]);

  // Opdaterer brugerens lokation på kortet, når den ændres
  useEffect(() => {
    const map = googleMapRef.current;
    const marker = locationMarkerRef.current;

    if (!map || !marker || !userLocation) return;

    const position = new google.maps.LatLng(
      userLocation.latitude,
      userLocation.longitude,
    );

    marker.setPosition(position);
    marker.setMap(map);

    if (!map.get("hasCenteredOnUser")) {
      map.setCenter(position);
      map.set("hasCenteredOnUser", true);
    }
  }, [userLocation]);
  function handleToggleStops(showAll) {
    showAllStopsRef.current = showAll;
    setShowAllStops(showAll);

    renderStopsRef.current?.();

    if (showAll) {
      // Hent stoppesteder i det aktuelle kortområde
      refreshStopsRef.current?.();
    } else {
      // Zoom tilbage, så alle favoritter kan ses
      fitFavoritesRef.current?.();
    }
  }

  return (
    <div className={styles.mapContainer}>
      <div ref={mapRef} className={styles.map} />

      {favorites.length > 0 && (
        <div
          className={styles.favoriteToggle}
          role="group"
          aria-label="Visning af stoppesteder"
        >
          <span
            className={`${styles.busSlider} ${
              showAllStops ? styles.busSliderRight : ""
            }`}
            aria-hidden="true"
          >
            <img src={busIcon} alt="" />
          </span>

          <button
            type="button"
            className={!showAllStops ? styles.toggleActive : ""}
            onClick={() => handleToggleStops(false)}
            aria-pressed={!showAllStops}
          >
            {showAllStops ? "Mine" : ""}
          </button>

          <button
            type="button"
            className={showAllStops ? styles.toggleActive : ""}
            onClick={() => handleToggleStops(true)}
            aria-pressed={showAllStops}
          >
            {!showAllStops ? "Alle" : ""}
          </button>
        </div>
      )}

      <button
        type="button"
        className={styles.refreshButton}
        onClick={() => refreshStopsRef.current?.()}
        disabled={isRefreshing}
        aria-label="Opdater stoppesteder"
        aria-busy={isRefreshing}
        title="Opdater stoppesteder"
      >
        <span className={isRefreshing ? styles.rotating : ""}>
          <LoadingBus />
        </span>
      </button>

      {selectedStop && !shareOpen && (
        <StationModal
          key={selectedStop.stop_id}
          selectedStop={selectedStop}
          selectedTrip={selectedTrip}
          setSelectedTrip={setSelectedTrip}
          onShare={() => setShareOpen(true)}
          onRefresh={beginRefresh}
          onClose={() => {
            setSelectedTrip(null);
            setSelectedStop(null);
          }}
        />
      )}

      {selectedStop && selectedTrip && shareOpen && (
        <ShareModal
          selectedTrip={selectedTrip}
          selectedStop={selectedStop}
          onBack={() => setShareOpen(false)}
        />
      )}

      {shareError && (
        <div className={styles.shareError} role="alert">
          <h2>Kunne ikke åbne busafgangen</h2>
          <p>{shareError}</p>
          <button
            type="button"
            onClick={() => {
              setShareError("");
              window.history.replaceState(
                window.history.state,
                "",
                window.location.pathname,
              );
            }}
          >
            Tilbage til kortet
          </button>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

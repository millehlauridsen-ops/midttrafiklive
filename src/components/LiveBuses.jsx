import { useEffect, useRef } from "react";
import { getSimulatedBuses } from "../services/liveBuses.js";
import styles from "./LiveBuses.module.css";

// Markører lever uden for Reacts DOM, fordi Google Maps styrer overlay-laget.
export default function LiveBuses({ map, onSelectBus, refreshVersion }) {
  const refreshRef = useRef(null);
  const previousVersionRef = useRef(refreshVersion);
  const onSelectRef = useRef(onSelectBus);
  onSelectRef.current = onSelectBus;

  useEffect(() => {
    if (!map) return;

    let disposed = false;
    let loading = false;
    let pendingRefresh = false;
    const markers = new Map();
    const OverlayView = google.maps.OverlayView;

    class BusMarker extends OverlayView {
      constructor(bus) {
        super();
        this.bus = bus;
        this.element = document.createElement("button");
        this.element.type = "button";
        this.element.className = styles.busMarker;
        this.label = document.createElement("span");
        this.element.append(this.label);
        this.element.addEventListener("click", () => onSelectRef.current(this.bus));
        this.update(bus);
      }

      onAdd() {
        this.getPanes().overlayMouseTarget.appendChild(this.element);
      }

      draw() {
        const projection = this.getProjection();
        if (!projection) return;
        const position = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(this.bus.latitude, this.bus.longitude),
        );
        if (!position) return;
        this.element.style.left = `${position.x}px`;
        this.element.style.top = `${position.y}px`;
      }

      onRemove() {
        this.element.remove();
      }

      update(bus) {
        this.bus = bus;
        this.label.textContent = bus.route_short_name || "?";
        this.element.classList.toggle(styles.blue, /^\d{3}$/.test(bus.route_short_name ?? ""));
        this.element.title = `Simuleret bus ${bus.route_short_name} mod ${bus.destination}`;
        this.element.setAttribute("aria-label", this.element.title);
        this.draw();
      }
    }

    async function refresh() {
      if (disposed) return;
      if (loading) {
        pendingRefresh = true;
        return;
      }
      const bounds = map.getBounds();
      if (!bounds) return;

      loading = true;
      try {
        const buses = await getSimulatedBuses({
          south: bounds.getSouthWest().lat(),
          west: bounds.getSouthWest().lng(),
          north: bounds.getNorthEast().lat(),
          east: bounds.getNorthEast().lng(),
        });
        if (disposed) return;

        const visible = new Set();
        for (const bus of buses) {
          const key = `${bus.trip_id}-${bus.departure_at}`;
          visible.add(key);
          let marker = markers.get(key);
          if (!marker) {
            marker = new BusMarker(bus);
            markers.set(key, marker);
            marker.setMap(map);
          } else {
            marker.update(bus);
          }
        }

        for (const [key, marker] of markers) {
          if (!visible.has(key)) {
            marker.setMap(null);
            markers.delete(key);
          }
        }
      } catch (error) {
        if (!disposed) console.error("Kunne ikke hente simulerede busser:", error);
      } finally {
        loading = false;
        if (pendingRefresh && !disposed) {
          pendingRefresh = false;
          refresh();
        }
      }
    }

    refreshRef.current = refresh;
    // Kun første indlæsning og et manuelt tryk på kortets refresh-knap.
    refresh();

    return () => {
      disposed = true;
      refreshRef.current = null;
      markers.forEach((marker) => marker.setMap(null));
      markers.clear();
    };
  }, [map]);

  useEffect(() => {
    if (previousVersionRef.current === refreshVersion) return;
    previousVersionRef.current = refreshVersion;
    refreshRef.current?.();
  }, [refreshVersion]);

  return null;
}

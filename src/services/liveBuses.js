import { supabase } from "../lib/supabase.js";

// Positionerne er beregnede ud fra GTFS-køreplaner, ikke faktiske GPS-data.
export async function getSimulatedBuses(bounds) {
  const { data, error } = await supabase.rpc("get_simulated_buses", {
    p_south: bounds.south,
    p_west: bounds.west,
    p_north: bounds.north,
    p_east: bounds.east,
  });

  if (error) throw error;
  return (data ?? []).filter(
    (bus) =>
      Number.isFinite(bus.latitude) &&
      Number.isFinite(bus.longitude) &&
      bus.trip_id &&
      bus.stop_id &&
      bus.departure_at,
  );
}

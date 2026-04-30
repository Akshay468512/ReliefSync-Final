export type TravelMode = "car" | "bike" | "walking";

export interface RouteOption {
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  summary: string;
  blockedSignals: string[];
}

export interface RoutePlan {
  fastest: RouteOption | null;
  alternate: RouteOption | null;
}

const MODE_TO_OSRM_PROFILE: Record<TravelMode, string> = {
  car: "driving",
  bike: "cycling",
  walking: "foot",
};

const FLOOD_BLOCKED_HINTS = [
  { name: "KR Puram underpass", lat: 12.9982, lng: 77.6966, radiusKm: 0.8 },
  { name: "Hebbal flyover loop", lat: 13.0358, lng: 77.597, radiusKm: 0.6 },
];

function kmToMeters(km: number) {
  return km * 1000;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function decodePolyline(encoded: string, precision = 5): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: [number, number][] = [];
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;

    coordinates.push([lat / factor, lng / factor]);
  }

  return coordinates;
}

function blockedSignalsForPath(path: [number, number][]) {
  const hits: string[] = [];
  for (const point of path) {
    for (const floodHint of FLOOD_BLOCKED_HINTS) {
      const d = haversineMeters(point[0], point[1], floodHint.lat, floodHint.lng);
      if (d <= kmToMeters(floodHint.radiusKm)) {
        if (!hits.includes(floodHint.name)) hits.push(floodHint.name);
      }
    }
  }
  return hits;
}

export async function getRoutePlan(
  from: [number, number],
  to: [number, number],
  mode: TravelMode,
): Promise<RoutePlan> {
  const profile = MODE_TO_OSRM_PROFILE[mode];
  const coordinates = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordinates}?alternatives=true&overview=full&geometries=polyline&steps=true`;

  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to fetch route");
  const data = await response.json();
  const routes = Array.isArray(data.routes) ? data.routes : [];

  const mapRoute = (route: any): RouteOption => {
    const geometry = decodePolyline(route.geometry);
    return {
      geometry,
      distanceKm: Number(route.distance || 0) / 1000,
      durationMin: Number(route.duration || 0) / 60,
      summary: route.legs?.[0]?.summary || "Optimized route",
      blockedSignals: blockedSignalsForPath(geometry),
    };
  };

  return {
    fastest: routes[0] ? mapRoute(routes[0]) : null,
    alternate: routes[1] ? mapRoute(routes[1]) : null,
  };
}

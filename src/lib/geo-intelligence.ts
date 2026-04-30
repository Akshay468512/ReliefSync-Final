const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/reverse";

export interface ResolvedLocation {
  displayName: string;
  street?: string;
  locality?: string;
  landmark?: string;
  city?: string;
  district?: string;
  state?: string;
}

function pickFirst(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim().length > 0);
}

export async function resolvePlaceFromCoords(lat: number, lon: number): Promise<ResolvedLocation> {
  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lon.toString());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status ${response.status}`);
  }

  const data = await response.json();
  const address = data.address || {};
  const street = pickFirst(address.road, address.pedestrian, address.footway);
  const locality = pickFirst(address.suburb, address.neighbourhood, address.quarter, address.hamlet);
  const landmark = pickFirst(address.amenity, address.building, address.shop, address.tourism);
  const city = pickFirst(address.city, address.town, address.village, address.municipality);
  const district = pickFirst(address.city_district, address.county, address.state_district);
  const state = address.state;

  const displayName = [street || landmark, locality, city, state].filter(Boolean).join(", ")
    || data.display_name
    || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  return { displayName, street, locality, landmark, city, district, state };
}

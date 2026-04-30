import { useEffect, useRef, useState } from "react";
import type { Urgency } from "@/lib/ai-scoring";
import { URGENCY_COLORS } from "@/lib/ai-scoring";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  urgency: Urgency;
  title: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string | null;
}

interface Props {
  markers: MapMarker[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  onSelect?: (id: string) => void;
  pickable?: boolean;
  picked?: [number, number] | null;
  onPick?: (lat: number, lng: number) => void;
  routePath?: [number, number][] | null;
  alternateRoutePath?: [number, number][] | null;
  volunteerPosition?: [number, number] | null;
  destinationPosition?: [number, number] | null;
}

const BENGALURU: [number, number] = [12.9716, 77.5946];

function makeIcon(leaflet: any, urgency: Urgency) {
  const color = URGENCY_COLORS[urgency];
  const html = `
    <div style="position:relative;">
      <div style="position:absolute;inset:-8px;border-radius:9999px;background:${color};opacity:0.3;animation:pulse-ring 2s infinite;"></div>
      <div style="width:22px;height:22px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>
    </div>`;
  return leaflet.divIcon({
    html,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

export function DisasterMap({
  markers,
  center = BENGALURU,
  zoom = 12,
  height = "100%",
  onSelect,
  pickable = false,
  picked = null,
  onPick,
  routePath = null,
  alternateRoutePath = null,
  volunteerPosition = null,
  destinationPosition = null,
}: Props) {
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any | null>(null);
  const mapRef = useRef<any | null>(null);
  const layerRef = useRef<any | null>(null);
  const pickMarkerRef = useRef<any | null>(null);
  const routeLineRef = useRef<any | null>(null);
  const alternateRouteLineRef = useRef<any | null>(null);
  const volunteerMarkerRef = useRef<any | null>(null);
  const destinationMarkerRef = useRef<any | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let mounted = true;
    let map: any | null = null;

    void import("leaflet").then((leaflet) => {
      if (!mounted || !containerRef.current) return;
      leafletRef.current = leaflet;
      map = leaflet.map(containerRef.current, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      });
      leaflet.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      if (pickable && onPick) {
        map.on("click", (e: any) => onPick(e.latlng.lat, e.latlng.lng));
      }
    });

    return () => {
      mounted = false;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers
  useEffect(() => {
    const leaflet = leafletRef.current;
    const layer = layerRef.current;
    if (!leaflet || !layer) return;
    layer.clearLayers();
    markers.forEach((m) => {
      const marker = leaflet.marker([m.lat, m.lng], { icon: makeIcon(leaflet, m.urgency) });
      const popup = `
        <div style="min-width:200px;padding:4px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${m.title}</div>
          ${m.subtitle ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${URGENCY_COLORS[m.urgency]};font-weight:600;margin-bottom:6px;">${m.subtitle}</div>` : ""}
          ${m.imageUrl ? `<img src="${m.imageUrl}" alt="incident" style="width:100%;height:90px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.15);margin-bottom:6px;" />` : ""}
          ${m.body ? `<div style="font-size:12px;color:#aaa;line-height:1.4;">${m.body}</div>` : ""}
        </div>`;
      marker.bindPopup(popup);
      if (onSelect) marker.on("click", () => onSelect(m.id));
      marker.addTo(layer);
    });
  }, [markers, onSelect, mapReady]);

  // Pick marker
  useEffect(() => {
    const leaflet = leafletRef.current;
    if (!leaflet || !mapRef.current) return;
    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
    if (picked) {
      const pickIcon = leaflet.divIcon({
        html: `<div style="width:30px;height:30px;border-radius:9999px;background:oklch(0.7 0.22 25);border:4px solid white;box-shadow:0 4px 16px rgba(0,0,0,0.5);"></div>`,
        className: "",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      pickMarkerRef.current = leaflet.marker(picked, { icon: pickIcon }).addTo(mapRef.current);
    }
  }, [picked, mapReady]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    if (!leaflet || !mapRef.current) return;
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    if (alternateRouteLineRef.current) {
      alternateRouteLineRef.current.remove();
      alternateRouteLineRef.current = null;
    }

    if (alternateRoutePath?.length) {
      alternateRouteLineRef.current = leaflet.polyline(alternateRoutePath, {
        color: "oklch(0.75 0.12 240)",
        weight: 4,
        opacity: 0.55,
        dashArray: "8 8",
      }).addTo(mapRef.current);
    }

    if (routePath?.length) {
      routeLineRef.current = leaflet.polyline(routePath, {
        color: "oklch(0.74 0.23 165)",
        weight: 5,
        opacity: 0.95,
      }).addTo(mapRef.current);
      mapRef.current.fitBounds(routeLineRef.current.getBounds(), { padding: [40, 40] });
    }
  }, [routePath, alternateRoutePath, mapReady]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    if (!leaflet || !mapRef.current) return;
    if (volunteerMarkerRef.current) {
      volunteerMarkerRef.current.remove();
      volunteerMarkerRef.current = null;
    }
    if (volunteerPosition) {
      volunteerMarkerRef.current = leaflet.circleMarker(volunteerPosition, {
        radius: 8,
        color: "oklch(0.75 0.15 200)",
        weight: 2,
        fillOpacity: 0.85,
      }).addTo(mapRef.current);
      volunteerMarkerRef.current.bindTooltip("Volunteer", { direction: "top" });
    }
  }, [volunteerPosition, mapReady]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    if (!leaflet || !mapRef.current) return;
    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.remove();
      destinationMarkerRef.current = null;
    }
    if (destinationPosition) {
      destinationMarkerRef.current = leaflet.circleMarker(destinationPosition, {
        radius: 9,
        color: "oklch(0.65 0.25 20)",
        weight: 2,
        fillOpacity: 0.9,
      }).addTo(mapRef.current);
      destinationMarkerRef.current.bindTooltip("Destination", { direction: "top" });
    }
  }, [destinationPosition, mapReady]);

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-2xl overflow-hidden" />;
}

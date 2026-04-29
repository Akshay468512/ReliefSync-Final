import { useEffect, useRef } from "react";
import L from "leaflet";
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
}

const BENGALURU: [number, number] = [12.9716, 77.5946];

function makeIcon(urgency: Urgency) {
  const color = URGENCY_COLORS[urgency];
  const html = `
    <div style="position:relative;">
      <div style="position:absolute;inset:-8px;border-radius:9999px;background:${color};opacity:0.3;animation:pulse-ring 2s infinite;"></div>
      <div style="width:22px;height:22px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>
    </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

const PICK_ICON = L.divIcon({
  html: `<div style="width:30px;height:30px;border-radius:9999px;background:oklch(0.7 0.22 25);border:4px solid white;box-shadow:0 4px 16px rgba(0,0,0,0.5);"></div>`,
  className: "",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export function DisasterMap({
  markers,
  center = BENGALURU,
  zoom = 12,
  height = "100%",
  onSelect,
  pickable = false,
  picked = null,
  onPick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (pickable && onPick) {
      map.on("click", (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markers.forEach((m) => {
      const marker = L.marker([m.lat, m.lng], { icon: makeIcon(m.urgency) });
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
  }, [markers, onSelect]);

  // Pick marker
  useEffect(() => {
    if (!mapRef.current) return;
    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
    if (picked) {
      pickMarkerRef.current = L.marker(picked, { icon: PICK_ICON }).addTo(mapRef.current);
    }
  }, [picked]);

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-2xl overflow-hidden" />;
}

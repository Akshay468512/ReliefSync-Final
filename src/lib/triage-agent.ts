import type { NeedType, Urgency } from "@/lib/ai-scoring";
import { distanceKm } from "@/lib/ai-scoring";

export interface TriageInput {
  imageUrl?: string;
  description?: string;
  latitude: number;
  longitude: number;
  peopleAffected: number;
  timestamp?: Date;
  weatherSeverity?: number; // 0-100
  duplicateCount?: number;
  needType: NeedType;
}

export interface TriageOutput {
  criticalityScore: number;
  priorityLabel: Urgency;
  reasoning: string[];
  recommendedResourceType: NeedType;
  etaUrgencyLevel: "immediate" | "urgent" | "priority" | "routine";
  imageSignals: string[];
  textSignals: string[];
}

const CRITICAL_TEXT = [
  "trapped",
  "roof",
  "child injured",
  "unconscious",
  "ambulance urgently",
  "fire spreading",
  "people stranded",
  "bleeding",
  "collapsed",
  "drowning",
  "elderly",
  "pregnant",
];
const HIGH_TEXT = [
  "no food",
  "2 days",
  "road blocked",
  "need medicine",
  "injured",
  "no shelter",
  "water rising",
  "smoke",
  "fever",
  "urgent",
];

const ZONE_RISK_HOTSPOTS: Array<{ lat: number; lng: number; risk: number }> = [
  { lat: 13.0003, lng: 77.6954, risk: 24 }, // KR Puram
  { lat: 12.9698, lng: 77.7499, risk: 20 }, // Whitefield
  { lat: 13.0352, lng: 77.5970, risk: 16 }, // Hebbal
  { lat: 12.8456, lng: 77.6603, risk: 15 }, // Electronic City
  { lat: 12.9591, lng: 77.6974, risk: 13 }, // Marathahalli
];

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function toUrgency(score: number): Urgency {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function toEtaUrgency(score: number): TriageOutput["etaUrgencyLevel"] {
  if (score >= 85) return "immediate";
  if (score >= 65) return "urgent";
  if (score >= 40) return "priority";
  return "routine";
}

function zoneRiskScore(lat: number, lng: number): number {
  const nearest = ZONE_RISK_HOTSPOTS.reduce((best, z) => {
    const d = distanceKm(lat, lng, z.lat, z.lng);
    return d < best.d ? { d, risk: z.risk } : best;
  }, { d: Infinity, risk: 8 });
  if (nearest.d < 2.5) return nearest.risk;
  if (nearest.d < 7) return Math.round(nearest.risk * 0.6);
  return 6;
}

function inferWeatherSeverity(input: TriageInput): number {
  if (typeof input.weatherSeverity === "number") return clamp(input.weatherSeverity);
  const text = (input.description || "").toLowerCase();
  const now = input.timestamp ?? new Date();
  const isNight = now.getHours() >= 19 || now.getHours() <= 5;
  let severity = 25;
  if (text.includes("heavy rain") || text.includes("flood")) severity += 25;
  if (text.includes("storm") || text.includes("cyclone")) severity += 20;
  if (text.includes("fire")) severity += 15;
  if (isNight) severity += 12;
  return clamp(severity);
}

function analyzeText(description?: string) {
  const text = (description || "").toLowerCase().trim();
  if (!text) return { score: 0, signals: [] as string[] };
  const signals: string[] = [];
  let score = 0;
  for (const key of CRITICAL_TEXT) {
    if (text.includes(key)) {
      score += 11;
      signals.push(key);
    }
  }
  for (const key of HIGH_TEXT) {
    if (text.includes(key)) {
      score += 6;
      signals.push(key);
    }
  }
  const numericMatch = text.match(/(\d+)\s*(people|person|children|kids|elderly)?/);
  if (numericMatch?.[1]) {
    const victims = Number(numericMatch[1]);
    if (!Number.isNaN(victims) && victims > 0) {
      score += clamp(Math.log2(victims + 1) * 6, 0, 18);
      signals.push(`${victims} victims mentioned`);
    }
  }
  return { score: clamp(score, 0, 45), signals };
}

async function analyzeImage(imageUrl?: string) {
  if (!imageUrl) return { score: 0, signals: [] as string[] };
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { score: 0, signals: [] as string[] };
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let blueHeavy = 0;
    let redHeavy = 0;
    let dark = 0;
    let graySmoke = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > r + 20 && b > g + 12) blueHeavy++;
      if (r > g + 25 && r > b + 25) redHeavy++;
      if (r + g + b < 120) dark++;
      if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 55 && r < 170) graySmoke++;
    }

    const px = canvas.width * canvas.height;
    const blueRatio = blueHeavy / px;
    const redRatio = redHeavy / px;
    const darkRatio = dark / px;
    const smokeRatio = graySmoke / px;

    const signals: string[] = [];
    let score = 0;
    if (blueRatio > 0.28) {
      score += 18;
      signals.push("severe flooding indicators");
    } else if (blueRatio > 0.17) {
      score += 10;
      signals.push("water spread visible");
    }
    if (redRatio > 0.18) {
      score += 18;
      signals.push("fire intensity high");
    } else if (redRatio > 0.1) {
      score += 9;
      signals.push("possible fire/sparks visible");
    }
    if (smokeRatio > 0.22) {
      score += 11;
      signals.push("smoke or collapsed dust likely");
    }
    if (darkRatio > 0.52) {
      score += 8;
      signals.push("darkness/night risk");
    }
    return { score: clamp(score, 0, 45), signals };
  } catch {
    return { score: 0, signals: [] as string[] };
  }
}

function inferResourceType(input: TriageInput, textSignals: string[], imageSignals: string[]): NeedType {
  const joined = `${input.description || ""} ${textSignals.join(" ")} ${imageSignals.join(" ")}`.toLowerCase();
  if (joined.includes("fire") || joined.includes("smoke")) return "rescue";
  if (joined.includes("injured") || joined.includes("unconscious") || joined.includes("bleeding")) return "medicine";
  if (joined.includes("food")) return "food";
  if (joined.includes("shelter") || joined.includes("roof")) return "shelter";
  return input.needType;
}

export async function runTriageAgent(input: TriageInput): Promise<TriageOutput> {
  const text = analyzeText(input.description);
  const image = await analyzeImage(input.imageUrl);
  const weather = inferWeatherSeverity(input);
  const geo = zoneRiskScore(input.latitude, input.longitude);
  const peopleScore = clamp(Math.log2(Math.max(1, input.peopleAffected) + 1) * 9, 0, 20);
  const duplicatePenalty = clamp((input.duplicateCount || 0) * 2, 0, 10);

  const score = clamp(
    10 +
      text.score +
      image.score +
      peopleScore +
      Math.round(weather * 0.14) +
      geo +
      duplicatePenalty
  );

  const reasoning = [
    image.signals[0] ? `Image: ${image.signals[0]}` : "",
    text.signals[0] ? `Text: ${text.signals[0]}` : "",
    `${Math.max(1, input.peopleAffected)} people affected`,
    `Weather severity ${weather}/100`,
    `Geo-risk factor ${geo}`,
    duplicatePenalty > 0 ? `${input.duplicateCount} nearby similar requests` : "",
  ].filter(Boolean);

  return {
    criticalityScore: score,
    priorityLabel: toUrgency(score),
    reasoning,
    recommendedResourceType: inferResourceType(input, text.signals, image.signals),
    etaUrgencyLevel: toEtaUrgency(score),
    imageSignals: image.signals,
    textSignals: text.signals,
  };
}

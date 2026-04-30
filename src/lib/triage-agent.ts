import type { NeedType, Urgency } from "@/lib/ai-scoring";
import { distanceKm } from "@/lib/ai-scoring";

type DisasterType = "flood" | "fire" | "injury" | "crowd" | "other";
type EtaPriority = "immediate" | "urgent" | "priority" | "routine";
type ResponderType = "volunteer" | "ambulance" | "ngo_team" | "fire_unit" | "food_supply_team" | "rescue_boat";

export interface TriageInput {
  imageUrl?: string;
  description?: string;
  latitude: number;
  longitude: number;
  peopleAffected: number;
  timestamp?: Date;
  weatherSeverity?: number;
  duplicateCount?: number;
  needType: NeedType;
}

export interface TriageOutput {
  criticalityScore: number;
  priorityLabel: Urgency;
  detectedDisasterType: DisasterType;
  recommendedResourceType: NeedType;
  peopleRiskEstimate: number;
  confidenceScore: number;
  duplicateProbability: number;
  etaUrgencyLevel: EtaPriority;
  suggestedResponseEtaMinutes: number;
  recommendedResponder: ResponderType;
  reasoning: string[];
  imageSignals: string[];
  textSignals: string[];
  summary: string;
  json: {
    criticality_score: number;
    priority: Urgency;
    disaster_type: DisasterType;
    confidence: number;
    people_risk: number;
    duplicate_probability: number;
    resource_needed: ResponderType;
    eta_priority: EtaPriority;
    summary: string;
  };
}

const TEXT_SIGNAL_WEIGHTS: Record<string, number> = {
  "child injured": 18,
  "pregnant woman": 16,
  pregnant: 14,
  unconscious: 20,
  trapped: 18,
  "trapped inside": 20,
  bleeding: 16,
  drowning: 20,
  "fire spreading": 18,
  fire: 14,
  smoke: 10,
  "water rising": 12,
  flood: 12,
  "road blocked": 9,
  collapsed: 15,
  "no food": 8,
  "2 days": 7,
  elderly: 10,
  children: 10,
  infant: 12,
};

const ZONE_RISK_HOTSPOTS: Array<{ lat: number; lng: number; risk: number }> = [
  { lat: 13.0003, lng: 77.6954, risk: 24 },
  { lat: 12.9698, lng: 77.7499, risk: 20 },
  { lat: 13.0352, lng: 77.5970, risk: 16 },
  { lat: 12.8456, lng: 77.6603, risk: 15 },
  { lat: 12.9591, lng: 77.6974, risk: 13 },
];

const imageCache = new Map<string, Promise<ImageAnalysis>>();
const requestCache = new Map<string, TriageOutput>();

interface TextAnalysis {
  score: number;
  signals: string[];
  disasterHint: DisasterType;
  vulnerableBonus: number;
}
interface ImageAnalysis {
  score: number;
  signals: string[];
  disasterType: DisasterType;
  summary: string;
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function toUrgency(score: number): Urgency {
  if (score >= 86) return "critical";
  if (score >= 66) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function toEtaUrgency(score: number): EtaPriority {
  if (score >= 86) return "immediate";
  if (score >= 66) return "urgent";
  if (score >= 40) return "priority";
  return "routine";
}

function estimateEta(score: number) {
  if (score >= 86) return 10;
  if (score >= 66) return 20;
  if (score >= 40) return 35;
  return 60;
}

function zoneRiskScore(lat: number, lng: number): number {
  const nearest = ZONE_RISK_HOTSPOTS.reduce((best, z) => {
    const d = distanceKm(lat, lng, z.lat, z.lng);
    return d < best.d ? { d, risk: z.risk } : best;
  }, { d: Number.POSITIVE_INFINITY, risk: 8 });
  if (nearest.d < 2.5) return nearest.risk;
  if (nearest.d < 7) return Math.round(nearest.risk * 0.6);
  return 6;
}

function inferWeatherSeverity(input: TriageInput): number {
  if (typeof input.weatherSeverity === "number") return clamp(input.weatherSeverity);
  const text = (input.description || "").toLowerCase();
  const now = input.timestamp ?? new Date();
  const isNight = now.getHours() >= 19 || now.getHours() <= 5;
  let severity = 22;
  if (text.includes("heavy rain") || text.includes("flood")) severity += 24;
  if (text.includes("storm") || text.includes("cyclone")) severity += 18;
  if (text.includes("fire")) severity += 14;
  if (isNight) severity += 12;
  return clamp(severity);
}

function detectDisasterFromText(text: string): DisasterType {
  if (text.includes("flood") || text.includes("water")) return "flood";
  if (text.includes("fire") || text.includes("smoke")) return "fire";
  if (text.includes("injur") || text.includes("bleed") || text.includes("unconscious")) return "injury";
  if (text.includes("crowd") || text.includes("stampede")) return "crowd";
  return "other";
}

function analyzeText(description?: string): TextAnalysis {
  const text = (description || "").toLowerCase().trim();
  if (!text) return { score: 0, signals: [], disasterHint: "other", vulnerableBonus: 0 };
  const signals: string[] = [];
  let score = 0;
  let vulnerableBonus = 0;
  for (const [phrase, weight] of Object.entries(TEXT_SIGNAL_WEIGHTS)) {
    if (text.includes(phrase)) {
      score += weight;
      signals.push(phrase);
      if (["child injured", "pregnant woman", "pregnant", "elderly", "infant", "children"].includes(phrase)) {
        vulnerableBonus += 6;
      }
    }
  }
  const numericMatch = text.match(/(\d+)\s*(people|person|children|kids|elderly)?/);
  if (numericMatch?.[1]) {
    const victims = Number(numericMatch[1]);
    if (!Number.isNaN(victims) && victims > 0) {
      score += clamp(Math.log2(victims + 1) * 5, 0, 16);
      signals.push(`${victims} victims mentioned`);
    }
  }
  return {
    score: clamp(score, 0, 48),
    signals: signals.slice(0, 8),
    disasterHint: detectDisasterFromText(text),
    vulnerableBonus: clamp(vulnerableBonus, 0, 18),
  };
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function compressDataUrl(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let err: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

function parseGeminiJson(raw: string) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

async function analyzeImageWithGemini(imageUrl: string, apiKey: string): Promise<ImageAnalysis> {
  const compressed = await compressDataUrl(imageUrl);
  const parts = compressed.split(",");
  if (parts.length < 2) throw new Error("Invalid image data");
  const base64Data = parts[1];
  const mimeType = compressed.match(/^data:(.*?);base64,/)?.[1] || "image/jpeg";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const prompt = `Analyze this disaster image for: flood depth, smoke/fire, trapped people, visible injuries, collapsed buildings, crowd density, blocked roads, children/elderly risk, darkness/night danger.
Return STRICT JSON:
{"disasterType":"flood|fire|injury|crowd|other","detections":["..."],"urgencyScore":0-100,"summary":"<=24 words"}`;

  const data = await withRetry(async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });
    if (!response.ok) throw new Error(`Gemini failed ${response.status}`);
    return response.json();
  }, 1);

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini output");
  const parsed = parseGeminiJson(raw);
  const disasterType: DisasterType = ["flood", "fire", "injury", "crowd", "other"].includes(parsed.disasterType) ? parsed.disasterType : "other";
  const urgencyScore = clamp(Math.round(Number(parsed.urgencyScore) || 0), 0, 100);
  return {
    score: clamp(Math.round(urgencyScore * 0.45), 0, 45),
    signals: Array.isArray(parsed.detections) ? parsed.detections.slice(0, 8).map(String) : [],
    disasterType,
    summary: String(parsed.summary || "").slice(0, 240),
  };
}

async function analyzeImageHeuristic(imageUrl?: string): Promise<ImageAnalysis> {
  if (!imageUrl) return { score: 0, signals: [], disasterType: "other", summary: "" };
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imageUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { score: 0, signals: [], disasterType: "other", summary: "" };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0;
    let red = 0;
    let dark = 0;
    let gray = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (b > r + 20 && b > g + 12) blue++;
      if (r > g + 25 && r > b + 25) red++;
      if (r + g + b < 120) dark++;
      if (Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r > 50 && r < 170) gray++;
    }
    const total = canvas.width * canvas.height;
    const signals: string[] = [];
    let score = 0;
    let disasterType: DisasterType = "other";
    if (blue / total > 0.2) {
      score += 16;
      disasterType = "flood";
      signals.push("water spread visible");
    }
    if (red / total > 0.12) {
      score += 16;
      disasterType = "fire";
      signals.push("fire/smoke intensity");
    }
    if (gray / total > 0.2) {
      score += 10;
      signals.push("smoke or debris");
    }
    if (dark / total > 0.52) {
      score += 7;
      signals.push("darkness/night danger");
    }
    return { score: clamp(score, 0, 45), signals, disasterType, summary: "" };
  } catch {
    return { score: 0, signals: [], disasterType: "other", summary: "" };
  }
}

async function analyzeImage(imageUrl?: string): Promise<ImageAnalysis> {
  if (!imageUrl) return { score: 0, signals: [], disasterType: "other", summary: "" };
  const hash = await sha256(imageUrl.slice(0, 2000));
  const cached = imageCache.get(hash);
  if (cached) return cached;
  const promise = (async () => {
    const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (geminiApiKey) {
      try {
        return await analyzeImageWithGemini(imageUrl, geminiApiKey);
      } catch {
        return analyzeImageHeuristic(imageUrl);
      }
    }
    return analyzeImageHeuristic(imageUrl);
  })();
  imageCache.set(hash, promise);
  return promise;
}

function inferResourceType(needType: NeedType, disasterType: DisasterType, textSignals: string[], imageSignals: string[]): NeedType {
  const joined = `${textSignals.join(" ")} ${imageSignals.join(" ")}`.toLowerCase();
  if (disasterType === "fire") return "rescue";
  if (disasterType === "injury" || joined.includes("bleed") || joined.includes("unconscious")) return "medicine";
  if (disasterType === "flood" && !["rescue", "shelter", "transport"].includes(needType)) return "rescue";
  if (joined.includes("no food")) return "food";
  if (joined.includes("shelter") || joined.includes("roof")) return "shelter";
  return needType;
}

function inferResponder(resource: NeedType, disasterType: DisasterType): ResponderType {
  if (disasterType === "fire") return "fire_unit";
  if (disasterType === "flood" && (resource === "rescue" || resource === "transport")) return "rescue_boat";
  if (resource === "medicine" || disasterType === "injury") return "ambulance";
  if (resource === "food") return "food_supply_team";
  if (resource === "shelter") return "ngo_team";
  return "volunteer";
}

export async function runTriageAgent(input: TriageInput): Promise<TriageOutput> {
  const requestFingerprint = JSON.stringify({
    d: (input.description || "").slice(0, 120),
    i: (input.imageUrl || "").slice(0, 80),
    lat: Math.round(input.latitude * 1000),
    lng: Math.round(input.longitude * 1000),
    p: input.peopleAffected,
    n: input.needType,
    dup: input.duplicateCount || 0,
  });
  const cached = requestCache.get(requestFingerprint);
  if (cached) return cached;

  const startedAt = performance.now();
  const weather = inferWeatherSeverity(input);
  const geo = zoneRiskScore(input.latitude, input.longitude);
  const textPromise = Promise.resolve(analyzeText(input.description));
  const imagePromise = analyzeImage(input.imageUrl);
  const [text, image] = await Promise.all([textPromise, imagePromise]);

  const peopleScore = clamp(Math.log2(Math.max(1, input.peopleAffected) + 1) * 11, 0, 24);
  const duplicateProbability = clamp(12 + (input.duplicateCount || 0) * 22 + (text.signals.length > 0 ? 8 : 0), 0, 98);
  const duplicatePenalty = clamp(Math.round(duplicateProbability * 0.16), 0, 12);
  const waitingMinutes = input.timestamp ? Math.max(0, Math.floor((Date.now() - input.timestamp.getTime()) / 60000)) : 0;
  const waitingBonus = clamp(Math.floor(waitingMinutes / 10), 0, 8);
  const distanceToHelp = clamp(Math.round((10 - Math.min(10, geo / 2)) * 1.2), 0, 12);

  const rawScore =
    8 +
    Math.round(image.score * 1.1) +
    text.score +
    peopleScore +
    text.vulnerableBonus +
    Math.round(weather * 0.14) +
    geo +
    waitingBonus +
    distanceToHelp -
    duplicatePenalty;
  const criticalityScore = Math.round(clamp(rawScore, 1, 100));
  const priorityLabel = toUrgency(criticalityScore);
  const etaUrgencyLevel = toEtaUrgency(criticalityScore);
  const suggestedResponseEtaMinutes = estimateEta(criticalityScore);

  const detectedDisasterType: DisasterType =
    image.disasterType !== "other" ? image.disasterType : text.disasterHint;
  const recommendedResourceType = inferResourceType(input.needType, detectedDisasterType, text.signals, image.signals);
  const recommendedResponder = inferResponder(recommendedResourceType, detectedDisasterType);

  const peopleRiskEstimate = Math.round(clamp(peopleScore + text.vulnerableBonus + (criticalityScore * 0.25), 1, 100));
  const modalityConfidenceBase = (input.imageUrl ? 38 : 20) + (input.description ? 32 : 18);
  const confidenceScore = Math.round(clamp(modalityConfidenceBase + text.signals.length * 3 + image.signals.length * 2 - (duplicateProbability * 0.08), 35, 99));

  const reasoning = [
    image.signals[0] ? `Image: ${image.signals[0]}` : "Image: no decisive visual cue",
    text.signals[0] ? `Text: ${text.signals[0]}` : "Text: no explicit critical keywords",
    `${Math.max(1, input.peopleAffected)} people affected`,
    `Weather severity ${weather}/100`,
    `Geo-risk factor ${geo}`,
    `Duplicate probability ${duplicateProbability}%`,
  ];

  const latencyMs = Math.round(performance.now() - startedAt);
  const summary =
    image.summary ||
    `${priorityLabel.toUpperCase()} ${detectedDisasterType} case. ${recommendedResponder.replace("_", " ")} advised, ETA ${suggestedResponseEtaMinutes} min. (triage ${latencyMs}ms)`;

  const output: TriageOutput = {
    criticalityScore,
    priorityLabel,
    detectedDisasterType,
    recommendedResourceType,
    peopleRiskEstimate,
    confidenceScore,
    duplicateProbability,
    etaUrgencyLevel,
    suggestedResponseEtaMinutes,
    recommendedResponder,
    reasoning,
    imageSignals: image.signals,
    textSignals: text.signals,
    summary,
    json: {
      criticality_score: criticalityScore,
      priority: priorityLabel,
      disaster_type: detectedDisasterType,
      confidence: confidenceScore,
      people_risk: peopleRiskEstimate,
      duplicate_probability: duplicateProbability,
      resource_needed: recommendedResponder,
      eta_priority: etaUrgencyLevel,
      summary,
    },
  };

  requestCache.set(requestFingerprint, output);
  return output;
}

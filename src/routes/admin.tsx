import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { SosButton } from "@/components/SosButton";
import { DisasterMap, type MapMarker } from "@/components/DisasterMap";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { LeaderBoard } from "@/components/LeaderBoard";
import { SkeletonStat } from "@/components/SkeletonLoader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Urgency } from "@/lib/ai-scoring";
import { distanceKm } from "@/lib/ai-scoring";
import { runTriageAgent } from "@/lib/triage-agent";
import { useCountUp } from "@/lib/use-count-up";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Users, Truck, FileWarning,
  Trophy, ShieldAlert, BarChart3, Lock,
} from "lucide-react";
import { formatDistanceToNow, subDays, format } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin Console · ReliefLink AI" }] }),
});

interface Req {
  id: string;
  need_type: string;
  disaster_type: string;
  people_affected: number;
  description: string;
  latitude: number;
  longitude: number;
  resolved_place_name: string | null;
  urgency: Urgency;
  ai_score: number;
  ai_summary: string | null;
  triage_summary: string | null;
  status: string;
  created_at: string;
}

interface Mission {
  id: string;
  request_id: string;
  volunteer_name: string;
  status: string;
  created_at: string;
  eta_minutes: number | null;
  route_distance_km: number | null;
  latest_volunteer_lat: number | null;
  latest_volunteer_lng: number | null;
  route_mode: string | null;
}

const URGENCY_CHART_COLORS: Record<string, string> = {
  critical: "oklch(0.62 0.27 18)",
  high: "oklch(0.7 0.22 25)",
  medium: "oklch(0.8 0.18 80)",
  low: "oklch(0.72 0.18 155)",
};

const NEED_COLORS = [
  "oklch(0.7 0.22 25)",
  "oklch(0.75 0.15 200)",
  "oklch(0.72 0.18 155)",
  "oklch(0.8 0.18 80)",
  "oklch(0.65 0.2 300)",
  "oklch(0.68 0.2 240)",
];

const RESOURCE_KEYS = ["food", "water", "medicine", "ambulances", "boats", "volunteers", "shelterBeds"] as const;
type ResourceKey = typeof RESOURCE_KEYS[number];
type ZoneResource = Record<ResourceKey, number>;

const ZONES = [
  { name: "KR Puram", lat: 13.0003, lng: 77.6954 },
  { name: "Whitefield", lat: 12.9698, lng: 77.7499 },
  { name: "Hebbal", lat: 13.0352, lng: 77.597 },
  { name: "Electronic City", lat: 12.8456, lng: 77.6603 },
  { name: "Marathahalli", lat: 12.9591, lng: 77.6974 },
] as const;

const BASE_SUPPLY: Record<string, ZoneResource> = {
  "KR Puram": { food: 520, water: 890, medicine: 330, ambulances: 6, boats: 5, volunteers: 85, shelterBeds: 160 },
  Whitefield: { food: 740, water: 1050, medicine: 420, ambulances: 7, boats: 2, volunteers: 130, shelterBeds: 190 },
  Hebbal: { food: 690, water: 980, medicine: 380, ambulances: 5, boats: 1, volunteers: 110, shelterBeds: 240 },
  "Electronic City": { food: 600, water: 880, medicine: 350, ambulances: 8, boats: 1, volunteers: 98, shelterBeds: 180 },
  Marathahalli: { food: 570, water: 870, medicine: 300, ambulances: 5, boats: 2, volunteers: 92, shelterBeds: 150 },
};

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center px-4 gradient-mesh">
      <div className="glass-strong rounded-3xl p-10 max-w-sm text-center">
        <div className="h-16 w-16 rounded-2xl gradient-emergency flex items-center justify-center mx-auto mb-6 shadow-glow">
          <Lock className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-display font-bold">Admin Access Required</h1>
        <p className="text-sm text-muted-foreground mt-2 mb-6">
          This command center is restricted to Admin and NGO coordinators.
        </p>
        <button
          onClick={() => navigate({ to: "/auth" })}
          className="inline-flex h-11 items-center justify-center rounded-xl gradient-hero px-6 text-sm font-semibold text-white border-0"
        >
          Sign in as Admin
        </button>
      </div>
    </div>
  );
}

function AdminPage() {
  const { user, role, loading: authLoading } = useAuth();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [volunteerCount, setVolunteerCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [triageTestsRunning, setTriageTestsRunning] = useState(false);
  const [triageCaseResults, setTriageCaseResults] = useState<Array<{ name: string; score: number; priority: string; passed: boolean }>>([]);

  const load = async () => {
    const [{ data: r }, { data: m }, { data: v }] = await Promise.all([
      supabase.from("emergency_requests").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("missions").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("user_roles").select("user_id").eq("role", "volunteer"),
    ]);
    setReqs((r || []) as Req[]);
    setMissions((m || []) as Mission[]);
    setVolunteerCount((v || []).length);
    setDataLoading(false);
  };

  useEffect(() => {
    if (!user || (role !== "admin" && !authLoading)) return;
    load();
    const ch = supabase
      .channel("admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_requests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "missions" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, role, authLoading]); // eslint-disable-line

  const stats = useMemo(() => ({
    total: reqs.length,
    pending: reqs.filter((r) => r.status === "open").length,
    inProgress: reqs.filter((r) => r.status === "in_progress" || r.status === "assigned").length,
    completed: reqs.filter((r) => r.status === "completed").length,
    critical: reqs.filter((r) => r.urgency === "critical").length,
    activeMissions: missions.filter((m) => m.status === "accepted" || m.status === "on_the_way").length,
  }), [reqs, missions]);

  // Chart: daily request volume (last 7 days)
  const dailyData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), 6 - i);
      const label = format(d, "MMM d");
      const dayStr = format(d, "yyyy-MM-dd");
      const count = reqs.filter((r) => r.created_at.startsWith(dayStr)).length;
      const critical = reqs.filter((r) => r.created_at.startsWith(dayStr) && r.urgency === "critical").length;
      return { label, count, critical };
    });
    return days;
  }, [reqs]);

  // Chart: urgency breakdown
  const urgencyData = useMemo(() => {
    const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };
    reqs.forEach((r) => { breakdown[r.urgency as keyof typeof breakdown]++; });
    return Object.entries(breakdown).map(([name, value]) => ({ name, value }));
  }, [reqs]);

  // Chart: need-type breakdown
  const needData = useMemo(() => {
    const breakdown: Record<string, number> = {};
    reqs.forEach((r) => { breakdown[r.need_type] = (breakdown[r.need_type] || 0) + 1; });
    return Object.entries(breakdown).map(([name, value]) => ({ name, value }));
  }, [reqs]);

  const markers: MapMarker[] = reqs.map((r) => ({
    id: r.id,
    lat: r.latitude,
    lng: r.longitude,
    urgency: r.urgency,
    title: `${r.need_type} · ${r.people_affected}`,
    subtitle: `${r.urgency} · ${r.resolved_place_name || "location pinned"}`,
  }));

  const feed = useMemo(() => {
    const items = [
      ...reqs.slice(0, 20).map((r) => ({
        id: "r-" + r.id,
        text: `New ${r.urgency} request: ${r.need_type} (${r.people_affected} people)`,
        color: r.urgency === "critical" ? "oklch(0.62 0.27 18)" : r.urgency === "high" ? "oklch(0.7 0.22 25)" : undefined,
      })),
      ...missions.slice(0, 10).map((m) => ({
        id: "m-" + m.id,
        text: `${m.volunteer_name} → ${m.status.replace("_", " ")}`,
        color: m.status === "completed" ? "oklch(0.72 0.18 155)" : undefined,
      })),
    ];
    return items;
  }, [reqs, missions]);

  const feedItems = useMemo(() => {
    return [
      ...reqs.slice(0, 20).map((r) => ({
        id: "r-" + r.id,
        kind: "request" as const,
        time: r.created_at,
        text: `New ${r.urgency} request: ${r.need_type} (${r.people_affected})`,
        urgency: r.urgency,
      })),
      ...missions.slice(0, 20).map((m) => ({
        id: "m-" + m.id,
        kind: "mission" as const,
        time: m.created_at,
        text: `${m.volunteer_name} → ${m.status.replace("_", " ")}`,
        urgency: "low" as Urgency,
      })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 25);
  }, [reqs, missions]);

  const assignZone = (lat: number, lng: number) => {
    let best: string = ZONES[0].name;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const zone of ZONES) {
      const d = Math.hypot(lat - zone.lat, lng - zone.lng);
      if (d < bestDist) {
        bestDist = d;
        best = zone.name;
      }
    }
    return best;
  };

  const zoneInsights = useMemo(() => {
    const demandByZone: Record<string, ZoneResource> = {};
    for (const zone of ZONES) {
      demandByZone[zone.name] = { food: 0, water: 0, medicine: 0, ambulances: 0, boats: 0, volunteers: 0, shelterBeds: 0 };
    }
    for (const r of reqs.filter((x) => x.status !== "completed" && x.status !== "cancelled")) {
      const zone = assignZone(r.latitude, r.longitude);
      const d = demandByZone[zone];
      const severityMult = r.urgency === "critical" ? 1.6 : r.urgency === "high" ? 1.25 : r.urgency === "medium" ? 1 : 0.75;
      d.volunteers += Math.ceil((r.people_affected / 4) * severityMult);
      d.water += Math.ceil(r.people_affected * 2 * severityMult);
      d.food += Math.ceil(r.people_affected * 1.4 * severityMult);
      d.shelterBeds += Math.ceil((r.people_affected / 2) * severityMult);
      if (r.need_type === "medicine" || r.need_type === "blood") d.medicine += Math.ceil(r.people_affected * 1.1 * severityMult);
      if (r.need_type === "rescue") {
        d.ambulances += Math.ceil(1 * severityMult);
        d.boats += r.disaster_type === "flood" ? Math.ceil(1 * severityMult) : 0;
      }
      if (r.disaster_type === "flood") d.boats += Math.ceil(0.6 * severityMult);
    }
    const rows = ZONES.map((z) => {
      const demand = demandByZone[z.name];
      const supply = BASE_SUPPLY[z.name];
      const gaps: ZoneResource = {
        food: demand.food - supply.food,
        water: demand.water - supply.water,
        medicine: demand.medicine - supply.medicine,
        ambulances: demand.ambulances - supply.ambulances,
        boats: demand.boats - supply.boats,
        volunteers: demand.volunteers - supply.volunteers,
        shelterBeds: demand.shelterBeds - supply.shelterBeds,
      };
      return { zone: z.name, demand, supply, gaps };
    });
    return rows;
  }, [reqs]);

  const recommendations = useMemo(() => {
    const tips: string[] = [];
    const byNeed = (need: ResourceKey) => {
      const shortage = zoneInsights.filter((z) => z.gaps[need] > 0).sort((a, b) => b.gaps[need] - a.gaps[need])[0];
      const surplus = zoneInsights.filter((z) => z.gaps[need] < 0).sort((a, b) => a.gaps[need] - b.gaps[need])[0];
      if (shortage && surplus) {
        const qty = Math.max(1, Math.min(shortage.gaps[need], Math.abs(surplus.gaps[need])));
        tips.push(`Move ${qty} ${need} from ${surplus.zone} to ${shortage.zone}.`);
      }
    };
    byNeed("food");
    byNeed("water");
    byNeed("medicine");
    byNeed("volunteers");
    byNeed("ambulances");
    const criticalZone = zoneInsights
      .map((z) => ({ zone: z.zone, shortage: z.gaps.volunteers + z.gaps.ambulances + z.gaps.medicine }))
      .sort((a, b) => b.shortage - a.shortage)[0];
    if (criticalZone && criticalZone.shortage > 0) {
      tips.push(`Dispatch rescue team to urgent cluster in ${criticalZone.zone}.`);
    }
    return tips.slice(0, 5);
  }, [zoneInsights]);

  const triageQueue = useMemo(() => {
    return reqs
      .filter((r) => r.status !== "completed" && r.status !== "cancelled")
      .map((r) => {
        const waitingMin = Math.max(1, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000));
        const score = Math.min(
          100,
          Math.round(
            r.ai_score +
            Math.log2(r.people_affected + 1) * 5 +
            Math.min(15, waitingMin / 12)
          )
        );
        return { ...r, triageScore: score };
      })
      .sort((a, b) => b.triageScore - a.triageScore)
      .slice(0, 8);
  }, [reqs]);

  const dispatchRows = useMemo(() => {
    const active = missions.filter((m) => m.status === "accepted" || m.status === "on_the_way");
    return active.map((mission) => {
      const req = reqs.find((r) => r.id === mission.request_id);
      if (!req) return null;
      const remainingKm = (mission.latest_volunteer_lat != null && mission.latest_volunteer_lng != null)
        ? distanceKm(mission.latest_volunteer_lat, mission.latest_volunteer_lng, req.latitude, req.longitude)
        : null;
      const progress = mission.route_distance_km && remainingKm != null
        ? Math.max(0, Math.min(100, ((mission.route_distance_km - remainingKm) / mission.route_distance_km) * 100))
        : 0;
      const delay = mission.eta_minutes != null && new Date(req.created_at).getTime() + mission.eta_minutes * 60_000 < Date.now();
      const nearestBackup = missions
        .filter((m) => m.id !== mission.id && (m.status === "accepted" || m.status === "on_the_way") && m.latest_volunteer_lat != null && m.latest_volunteer_lng != null)
        .map((m) => ({
          volunteerName: m.volunteer_name,
          km: distanceKm(m.latest_volunteer_lat!, m.latest_volunteer_lng!, req.latitude, req.longitude),
        }))
        .sort((a, b) => a.km - b.km)[0];
      return {
        mission,
        req,
        remainingKm,
        progress,
        delay,
        nearestBackup,
      };
    }).filter(Boolean) as Array<{
      mission: Mission;
      req: Req;
      remainingKm: number | null;
      progress: number;
      delay: boolean;
      nearestBackup?: { volunteerName: string; km: number };
    }>;
  }, [missions, reqs]);

  const seedDemoScenarios = async () => {
    setSeedingDemo(true);
    const now = Date.now();
    const demo = [
      { disaster_type: "flood", need_type: "rescue", people_affected: 18, description: "Flood in KR Puram, families trapped on first floor, water rising fast.", latitude: 13.0003, longitude: 77.6954, urgency: "critical", ai_score: 94 },
      { disaster_type: "fire", need_type: "rescue", people_affected: 10, description: "Fire in Whitefield warehouse, smoke intense, road blocked.", latitude: 12.9698, longitude: 77.7499, urgency: "high", ai_score: 83 },
      { disaster_type: "other", need_type: "food", people_affected: 65, description: "Food shortage in Hebbal camp, no supplies for 2 days.", latitude: 13.0352, longitude: 77.597, urgency: "high", ai_score: 79 },
      { disaster_type: "medical", need_type: "medicine", people_affected: 7, description: "Medical emergency in Electronic City, child unconscious needs ambulance urgently.", latitude: 12.8456, longitude: 77.6603, urgency: "critical", ai_score: 92 },
      { disaster_type: "flood", need_type: "transport", people_affected: 24, description: "Blocked road in Marathahalli, stranded residents and elderly.", latitude: 12.9591, longitude: 77.6974, urgency: "medium", ai_score: 61 },
    ] as const;
    const { error } = await supabase.from("emergency_requests").insert(
      demo.map((d, i) => ({
        reporter_id: user?.id || null,
        reporter_name: "Demo Control",
        reporter_phone: "9999999999",
        disaster_type: d.disaster_type,
        need_type: d.need_type,
        people_affected: d.people_affected,
        description: d.description,
        latitude: d.latitude,
        longitude: d.longitude,
        urgency: d.urgency,
        ai_score: d.ai_score,
        created_at: new Date(now - i * 8 * 60_000).toISOString(),
      }))
    );
    setSeedingDemo(false);
    if (error) toast.error(error.message);
    else toast.success("Bengaluru demo scenarios generated.");
  };

  const runTriageDemoCases = async () => {
    setTriageTestsRunning(true);
    try {
      const cases = [
        {
          name: "Case 1: Flood + child injured",
          input: {
            description: "Severe flood water rising fast, child injured and trapped on rooftop, people stranded.",
            latitude: 13.0003,
            longitude: 77.6954,
            peopleAffected: 6,
            needType: "rescue" as const,
            duplicateCount: 0,
            weatherSeverity: 88,
            timestamp: new Date(Date.now() - 20 * 60_000),
          },
          pass: (score: number, priority: string) => score > 90 && priority === "critical",
        },
        {
          name: "Case 2: Food needed for 2 adults",
          input: {
            description: "Need food for 2 adults in safe shelter area.",
            latitude: 12.9591,
            longitude: 77.6974,
            peopleAffected: 2,
            needType: "food" as const,
            duplicateCount: 0,
            weatherSeverity: 20,
            timestamp: new Date(),
          },
          pass: (_score: number, priority: string) => priority === "medium",
        },
        {
          name: "Case 3: Apartment fire trapped residents",
          input: {
            description: "Apartment fire spreading quickly, multiple residents trapped inside and smoke everywhere.",
            latitude: 12.9698,
            longitude: 77.7499,
            peopleAffected: 14,
            needType: "rescue" as const,
            duplicateCount: 0,
            weatherSeverity: 72,
            timestamp: new Date(Date.now() - 10 * 60_000),
          },
          pass: (_score: number, priority: string) => priority === "critical",
        },
        {
          name: "Case 4: Duplicate nearby report",
          input: {
            description: "Flood rescue needed near KR Puram underpass. Families trapped and requesting help.",
            latitude: 13.00035,
            longitude: 77.69542,
            peopleAffected: 5,
            needType: "rescue" as const,
            duplicateCount: 2,
            weatherSeverity: 84,
            timestamp: new Date(),
          },
          pass: (_score: number, _priority: string, duplicateProbability: number) => duplicateProbability >= 45,
        },
      ];

      const outputs = await Promise.all(cases.map((c) => runTriageAgent(c.input)));
      const results = outputs.map((out, idx) => ({
        name: cases[idx].name,
        score: out.criticalityScore,
        priority: out.priorityLabel,
        passed: cases[idx].pass(out.criticalityScore, out.priorityLabel, out.duplicateProbability),
      }));
      setTriageCaseResults(results);
      const failCount = results.filter((r) => !r.passed).length;
      if (failCount === 0) toast.success("All TRIAGE AGENT test cases passed.");
      else toast.warning(`${failCount} triage test case(s) failed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to run triage test cases.");
    } finally {
      setTriageTestsRunning(false);
    }
  };

  // Auth guard
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full gradient-hero animate-spin" style={{ borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!user || role !== "admin") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <AccessDenied />
      </div>
    );
  }

  const STAT_CARDS = [
    { label: "Total requests", value: stats.total, icon: FileWarning, color: "text-foreground" },
    { label: "Pending", value: stats.pending, icon: AlertTriangle, color: "text-warning" },
    { label: "In progress", value: stats.inProgress, icon: Activity, color: "text-accent" },
    { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-success" },
    { label: "Volunteers", value: volunteerCount, icon: Users, color: "text-primary" },
    { label: "Active missions", value: stats.activeMissions, icon: Truck, color: "text-accent" },
  ];

  return (
    <div className="min-h-screen">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <span className="text-xs font-bold tracking-widest text-accent uppercase">Command Center</span>
            <h1 className="text-3xl font-display font-bold mt-1">Operations Overview</h1>
            <p className="text-muted-foreground text-sm mt-1">Live view across all requests, volunteers and missions.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-success pulse-ring" />
            <span className="text-xs text-muted-foreground">Live data · auto-updating</span>
            <button
              onClick={seedDemoScenarios}
              disabled={seedingDemo}
              className="ml-2 text-xs px-2.5 py-1 rounded-lg border border-border hover:border-primary/50 transition-colors"
            >
              {seedingDemo ? "Generating..." : "Generate Bengaluru Demo Data"}
            </button>
            <button
              onClick={runTriageDemoCases}
              disabled={triageTestsRunning}
              className="text-xs px-2.5 py-1 rounded-lg border border-border hover:border-primary/50 transition-colors"
            >
              {triageTestsRunning ? "Running TRIAGE tests..." : "Run TRIAGE Test Cases"}
            </button>
          </div>
        </div>

        {triageCaseResults.length > 0 && (
          <div className="glass-strong rounded-2xl p-4 mb-6">
            <h3 className="font-display font-semibold mb-2">TRIAGE AGENT Test Harness</h3>
            <div className="space-y-1.5 text-xs">
              {triageCaseResults.map((r) => (
                <div key={r.name} className="flex items-center justify-between glass rounded-lg px-3 py-2">
                  <span>{r.name}</span>
                  <span className={`${r.passed ? "text-success" : "text-warning"} font-semibold`}>
                    {r.passed ? "PASS" : "FAIL"} · {r.priority.toUpperCase()} · score {r.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stat Cards */}
        {dataLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[...Array(6)].map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {STAT_CARDS.map((s, i) => {
              const Icon = s.icon;
              const AnimatedValue = () => {
                const v = useCountUp(s.value);
                return <span>{v}</span>;
              };
              return (
                <div key={s.label} className="glass-strong rounded-2xl p-4 animate-float-up card-3d" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</span>
                    <Icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div className={`font-display text-3xl font-bold mt-2 ${s.color}`}>
                    <AnimatedValue />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_1fr] gap-4 mb-6">
          <div className="glass-strong rounded-2xl p-5 tilt-soft">
            <h3 className="font-display font-semibold mb-3">AI Triage Queue</h3>
            <div className="space-y-2">
              {triageQueue.map((item) => (
                <div key={item.id} className="glass rounded-xl p-3 text-xs card-3d">
                  <div className="flex items-center justify-between">
                    <span className="capitalize">{item.need_type} · {item.disaster_type}</span>
                    <span className="font-bold text-primary">Score {item.triageScore}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground line-clamp-1">{item.description}</div>
                  {(item.triage_summary || item.ai_summary) && <div className="mt-1 text-[11px] text-accent line-clamp-1">{item.triage_summary || item.ai_summary}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="glass-strong rounded-2xl p-5 tilt-soft">
            <h3 className="font-display font-semibold mb-3">Reallocation Recommendations</h3>
            <div className="space-y-2 text-sm">
              {recommendations.length === 0 ? (
                <p className="text-muted-foreground">No urgent reallocations required right now.</p>
              ) : recommendations.map((tip, i) => (
                <div key={i} className="glass rounded-lg p-3">{tip}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-5 mb-6 tilt-soft">
          <h3 className="font-display font-semibold mb-3">Zone-wise Resource Demand vs Supply</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Zone</th>
                  <th className="text-left p-2">Food</th>
                  <th className="text-left p-2">Medicine</th>
                  <th className="text-left p-2">Ambulances</th>
                  <th className="text-left p-2">Volunteers</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {zoneInsights.map((z) => {
                  const stress = z.gaps.food + z.gaps.medicine + z.gaps.ambulances * 25 + z.gaps.volunteers;
                  return (
                    <tr key={z.zone} className="border-t border-border/60">
                      <td className="p-2 font-medium">{z.zone}</td>
                      <td className="p-2">{z.demand.food}/{z.supply.food}</td>
                      <td className="p-2">{z.demand.medicine}/{z.supply.medicine}</td>
                      <td className="p-2">{z.demand.ambulances}/{z.supply.ambulances}</td>
                      <td className="p-2">{z.demand.volunteers}/{z.supply.volunteers}</td>
                      <td className={`p-2 font-semibold ${stress > 0 ? "text-warning" : "text-success"}`}>{stress > 0 ? "Shortage risk" : "Balanced"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-5 mb-6 tilt-soft">
          <h3 className="font-display font-semibold mb-3">Admin Dispatch View</h3>
          {dispatchRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active dispatches.</p>
          ) : (
            <div className="space-y-2">
              {dispatchRows.slice(0, 8).map(({ mission, req, progress, remainingKm, delay, nearestBackup }) => (
                <div key={mission.id} className="glass rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{mission.volunteer_name} → {req.need_type} ({req.resolved_place_name || "location pinned"})</div>
                    <div className={`${delay ? "text-warning" : "text-success"} font-semibold`}>{delay ? "Delay risk" : "On track"}</div>
                  </div>
                  <div className="text-muted-foreground mt-1">
                    ETA {mission.eta_minutes ?? "-"} min · remaining {remainingKm?.toFixed(1) ?? "-"} km · mode {mission.route_mode || "car"}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progress.toFixed(0)}%` }} />
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Backup volunteer: {nearestBackup ? `${nearestBackup.volunteerName} (${nearestBackup.km.toFixed(1)} km)` : "Not available"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map + Feed */}
        <div className="grid lg:grid-cols-[1fr_360px] gap-4 h-[500px] mb-6">
          <div className="glass-strong rounded-2xl p-3 relative tilt-soft">
            <div className="absolute top-6 left-6 z-[400] glass-strong rounded-xl px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Live Heatmap</div>
              <div className="text-sm font-bold">{stats.critical} critical · {stats.pending} pending</div>
            </div>
            <DisasterMap markers={markers} height="100%" />
          </div>

          <div className="glass-strong rounded-2xl p-4 overflow-y-auto tilt-soft">
            <h3 className="font-display font-bold mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary pulse-ring" /> Activity feed
            </h3>
            <div className="space-y-2">
              {feedItems.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
              {feedItems.map((f) => (
                <div key={f.id} className="glass rounded-lg p-3 text-xs animate-float-up card-3d">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`uppercase tracking-widest text-[10px] font-bold ${f.kind === "request" ? "text-primary" : "text-accent"}`}>
                      {f.kind}
                    </span>
                    <span className="text-muted-foreground">{formatDistanceToNow(new Date(f.time), { addSuffix: true })}</span>
                  </div>
                  <div>{f.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          {/* Daily Volume */}
          <div className="lg:col-span-2 glass-strong rounded-2xl p-5 tilt-soft">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-accent" />
              <h3 className="font-display font-semibold">Request volume (7 days)</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.7 0.22 25)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="oklch(0.7 0.22 25)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-critical" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.62 0.27 18)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="oklch(0.62 0.27 18)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 250)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "oklch(0.7 0.02 250)" }} />
                <YAxis tick={{ fontSize: 10, fill: "oklch(0.7 0.02 250)" }} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.22 0.025 250)", border: "1px solid oklch(0.3 0.02 250)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "oklch(0.98 0.005 250)" }}
                />
                <Area type="monotone" dataKey="count" stroke="oklch(0.7 0.22 25)" fill="url(#grad-total)" strokeWidth={2} name="Total" />
                <Area type="monotone" dataKey="critical" stroke="oklch(0.62 0.27 18)" fill="url(#grad-critical)" strokeWidth={2} name="Critical" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Urgency breakdown */}
          <div className="glass-strong rounded-2xl p-5 tilt-soft">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <h3 className="font-display font-semibold">Urgency split</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={urgencyData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} strokeWidth={0}>
                  {urgencyData.map((entry) => (
                    <Cell key={entry.name} fill={URGENCY_CHART_COLORS[entry.name] || "oklch(0.5 0.1 250)"} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "oklch(0.22 0.025 250)", border: "1px solid oklch(0.3 0.02 250)", borderRadius: 8, fontSize: 12 }}
                  itemStyle={{ color: "oklch(0.98 0.005 250)" }}
                />
                <Legend
                  formatter={(v) => <span style={{ fontSize: 11, color: "oklch(0.7 0.02 250)" }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Need-type bar + Leaderboard */}
        <div className="grid lg:grid-cols-[1fr_360px] gap-4 mb-6">
          <div className="glass-strong rounded-2xl p-5 tilt-soft">
            <h3 className="font-display font-semibold mb-4">Need types requested</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={needData} layout="vertical" margin={{ top: 0, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 250)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.7 0.02 250)" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "oklch(0.7 0.02 250)" }} width={65} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.22 0.025 250)", border: "1px solid oklch(0.3 0.02 250)", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {needData.map((_, i) => (
                    <Cell key={i} fill={NEED_COLORS[i % NEED_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-strong rounded-2xl p-5 tilt-soft">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-400" /> Top Volunteers
            </h3>
            <LeaderBoard limit={6} />
          </div>
        </div>

        {/* Recent Requests Table */}
        <div className="glass-strong rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-display font-bold">Recent requests</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left p-3">Urgency</th>
                  <th className="text-left p-3">Need</th>
                  <th className="text-left p-3">People</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Location</th>
                  <th className="text-left p-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {reqs.slice(0, 20).map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="p-3"><UrgencyBadge urgency={r.urgency} score={r.ai_score} /></td>
                    <td className="p-3 capitalize">{r.need_type}</td>
                    <td className="p-3">{r.people_affected}</td>
                    <td className="p-3 capitalize text-xs">{r.status.replace("_", " ")}</td>
                    <td className="p-3 text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[220px] truncate">{r.resolved_place_name || `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[300px] truncate">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SosButton />
    </div>
  );
}

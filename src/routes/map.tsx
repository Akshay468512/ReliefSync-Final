import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { SosButton } from "@/components/SosButton";
import { DisasterMap, type MapMarker } from "@/components/DisasterMap";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Urgency } from "@/lib/ai-scoring";
import { playAlert, setSoundMuted, isSoundMuted } from "@/lib/sounds";
import { Phone, Users, Clock, MapPin, AlertCircle, Volume2, VolumeX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/map")({
  component: MapPage,
  head: () => ({ meta: [{ title: "Live Disaster Map · ReliefLink AI" }] }),
});

interface Req {
  id: string;
  reporter_name: string;
  reporter_phone: string;
  disaster_type: string;
  need_type: string;
  people_affected: number;
  description: string;
  latitude: number;
  longitude: number;
  resolved_place_name: string | null;
  urgency: Urgency;
  ai_score: number;
  status: string;
  created_at: string;
  photo_url: string | null;
}

function MapPage() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [filter, setFilter] = useState<"all" | Urgency>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "completed">("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(!isSoundMuted());
  const [newCount, setNewCount] = useState(0);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundMuted(!next);
    toast.info(next ? "Sound alerts enabled" : "Sound alerts muted");
  };

  const load = async () => {
    const { data, error } = await supabase
      .from("emergency_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { toast.error(error.message); return; }
    setRequests((data || []) as Req[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_requests" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const r = payload.new as Req;
          setRequests((prev) => [r, ...prev]);
          setNewCount((c) => c + 1);
          const alertType = r.urgency === "critical" ? "critical" : "new";
          playAlert(alertType);
          toast.warning(`New ${r.urgency} request: ${r.need_type}`, {
            description: r.description.slice(0, 80),
            duration: r.urgency === "critical" ? 8000 : 4000,
          });
        } else if (payload.eventType === "UPDATE") {
          setRequests((prev) => prev.map((x) => (x.id === (payload.new as Req).id ? (payload.new as Req) : x)));
        } else if (payload.eventType === "DELETE") {
          setRequests((prev) => prev.filter((x) => x.id !== (payload.old as Req).id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (filter !== "all" && r.urgency !== filter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [requests, filter, statusFilter]);

  const markers: MapMarker[] = filtered.map((r) => ({
    id: r.id,
    lat: r.latitude,
    lng: r.longitude,
    urgency: r.urgency,
    title: `${r.need_type.toUpperCase()} · ${r.people_affected} people`,
    subtitle: `${r.urgency} · score ${r.ai_score} · ${r.status}`,
    body: `${r.resolved_place_name || `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`} • ${r.description.slice(0, 120)}`,
    imageUrl: r.photo_url,
  }));

  const stats = {
    total: requests.length,
    critical: requests.filter((r) => r.urgency === "critical").length,
    open: requests.filter((r) => r.status === "open").length,
  };

  const sel = selected ? requests.find((r) => r.id === selected) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Live Disaster Map</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {stats.total} total · {stats.open} open · <span className="text-critical font-semibold">{stats.critical} critical</span>
              {newCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-bold animate-float-up">
                  +{newCount} new
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={toggleSound}
              className="h-9 w-9 rounded-lg border border-border hover:border-primary/40 flex items-center justify-center transition-all"
              title={soundOn ? "Mute alerts" : "Enable alerts"}
              aria-label={soundOn ? "Mute sound alerts" : "Enable sound alerts"}
            >
              {soundOn ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            </button>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All urgency</SelectItem>
                <SelectItem value="critical">Critical only</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Link to="/submit"><Button className="gradient-emergency border-0">Report</Button></Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-4 h-[calc(100vh-240px)] min-h-[600px]">
          <div className="glass-strong rounded-2xl p-3 relative">
            <DisasterMap markers={markers} onSelect={setSelected} height="100%" />
            <div className="pointer-events-none absolute inset-3 rounded-2xl overflow-hidden">
              {filtered
                .filter((r) => r.urgency === "critical" || r.urgency === "high")
                .slice(0, 14)
                .map((r, i) => (
                  <div
                    key={`heat-${r.id}`}
                    className={`absolute rounded-full blur-2xl ${r.urgency === "critical" ? "bg-critical/30" : "bg-warning/20"}`}
                    style={{
                      width: r.urgency === "critical" ? 110 : 86,
                      height: r.urgency === "critical" ? 110 : 86,
                      left: `${15 + ((i * 13) % 70)}%`,
                      top: `${18 + ((i * 9) % 62)}%`,
                    }}
                  />
                ))}
            </div>
          </div>

          <div className="glass-strong rounded-2xl p-4 overflow-y-auto">
            {sel ? (
              <RequestDetail req={sel} onBack={() => setSelected(null)} />
            ) : (
              <RequestList requests={filtered} onSelect={setSelected} />
            )}
          </div>
        </div>
      </div>
      <SosButton />
    </div>
  );
}

function RequestList({ requests, onSelect }: { requests: Req[]; onSelect: (id: string) => void }) {
  if (requests.length === 0) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No requests match your filters.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="font-display font-semibold text-sm tracking-wide text-muted-foreground uppercase mb-3">Requests ({requests.length})</h3>
      {requests.map((r, i) => (
        <button
          key={r.id}
          onClick={() => onSelect(r.id)}
          className="w-full text-left glass rounded-xl p-3 hover:border-primary/40 transition group animate-float-up"
          style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <UrgencyBadge urgency={r.urgency} score={r.ai_score} />
            <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
          </div>
          <div className="font-semibold text-sm capitalize">{r.need_type} · {r.disaster_type}</div>
          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.description}</div>
          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-1">{r.resolved_place_name || `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}</div>
          {r.photo_url && (
            <img src={r.photo_url} alt="incident" className="mt-2 h-20 w-full rounded-lg object-cover border border-border/60" />
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{r.people_affected}</span>
            <span className="capitalize px-1.5 py-0.5 rounded bg-muted text-[10px]">{r.status}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function RequestDetail({ req, onBack }: { req: Req; onBack: () => void }) {
  return (
    <div className="animate-float-up">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1 transition-colors">← Back to list</button>
      <UrgencyBadge urgency={req.urgency} score={req.ai_score} />
      <h3 className="font-display font-bold text-xl mt-2 capitalize">{req.need_type} needed</h3>
      <p className="text-xs text-muted-foreground capitalize">Disaster: {req.disaster_type} · status: {req.status}</p>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-start gap-2"><Users className="h-4 w-4 text-accent mt-0.5" /><div><div className="font-medium">{req.people_affected} people affected</div></div></div>
        <div className="flex items-start gap-2"><Clock className="h-4 w-4 text-accent mt-0.5" /><div>{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</div></div>
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-accent mt-0.5" /><div><div className="text-sm">{req.resolved_place_name || "Location resolving..."}</div><div className="font-mono text-xs text-muted-foreground">{req.latitude.toFixed(4)}, {req.longitude.toFixed(4)}</div></div></div>
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Description</div>
          <p>{req.description}</p>
        </div>
        {req.photo_url && (
          <div className="glass rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Image Evidence</div>
            <img src={req.photo_url} alt="Uploaded incident evidence" className="h-40 w-full rounded-lg object-cover border border-border/60" />
          </div>
        )}
        <div className="glass rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reporter</div>
          <div className="font-medium">{req.reporter_name}</div>
          <a href={`tel:${req.reporter_phone}`} className="flex items-center gap-1.5 text-primary text-sm mt-0.5">
            <Phone className="h-3.5 w-3.5" /> {req.reporter_phone}
          </a>
        </div>
        <Link to="/volunteer">
          <Button className="w-full gradient-hero border-0">Accept as volunteer</Button>
        </Link>
      </div>
    </div>
  );
}

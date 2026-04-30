import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SosButton } from "@/components/SosButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DisasterMap } from "@/components/DisasterMap";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { VoiceSOS } from "@/components/VoiceSOS";
import { PhotoUploadField } from "@/components/PhotoUploadField";
import { scoreRequest, findDuplicates, type NeedType } from "@/lib/ai-scoring";
import { runTriageAgent, type TriageOutput } from "@/lib/triage-agent";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { resolvePlaceFromCoords } from "@/lib/geo-intelligence";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  MapPin, Sparkles, AlertTriangle, Loader2,
  CheckCircle2, Circle, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/submit")({
  component: SubmitPage,
  head: () => ({ meta: [{ title: "Report Emergency · ReliefLink AI" }] }),
});

const BENGALURU: [number, number] = [12.9716, 77.5946];
const DISASTERS = ["flood", "earthquake", "cyclone", "fire", "medical", "other"] as const;
const NEEDS: NeedType[] = ["rescue", "medicine", "food", "blood", "shelter", "transport"];

const STEPS = ["Location", "Details", "Review & Submit"];

function SubmitPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [cachedReporterName, setCachedReporterName] = useState("");
  const [cachedReporterPhone, setCachedReporterPhone] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [disasterType, setDisasterType] = useState<typeof DISASTERS[number]>("flood");
  const [needType, setNeedType] = useState<NeedType>("rescue");
  const [people, setPeople] = useState(1);
  const [description, setDescription] = useState("");
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [resolvedPlace, setResolvedPlace] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [triageLoading, setTriageLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; description: string }[]>([]);
  const [confirmDup, setConfirmDup] = useState(false);
  const [triagePreview, setTriagePreview] = useState<TriageOutput | null>(null);

  const reporterName = (profile?.full_name || cachedReporterName).trim();
  const reporterPhone = (profile?.phone || cachedReporterPhone).trim();
  const effectiveReporterName = (reporterName || nameInput).trim();
  const effectiveReporterPhone = (reporterPhone || phoneInput).trim();

  useEffect(() => {
    if (reporterName && !nameInput) setNameInput(reporterName);
    if (reporterPhone && !phoneInput) setPhoneInput(reporterPhone);
  }, [reporterName, reporterPhone, nameInput, phoneInput]);

  useEffect(() => {
    if (!user) return;

    const localName = localStorage.getItem("rl_reporter_name") || "";
    const localPhone = localStorage.getItem("rl_reporter_phone") || "";
    if (localName) setCachedReporterName((prev) => prev || localName);
    if (localPhone) setCachedReporterPhone((prev) => prev || localPhone);

    if (profile?.full_name && profile?.phone) return;
    supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const dbName = (data.full_name || "").trim();
        const dbPhone = (data.phone || "").trim();
        if (dbName) {
          setCachedReporterName(dbName);
          localStorage.setItem("rl_reporter_name", dbName);
        }
        if (dbPhone) {
          setCachedReporterPhone(dbPhone);
          localStorage.setItem("rl_reporter_phone", dbPhone);
        }
      });
  }, [user, profile?.full_name, profile?.phone]);

  useEffect(() => {
    let mounted = true;
    if (!coords) return;
    setTriageLoading(true);
    runTriageAgent({
      imageUrl: photoUrl || undefined,
      description,
      latitude: coords[0],
      longitude: coords[1],
      peopleAffected: people,
      needType,
      duplicateCount: duplicates.length,
      timestamp: new Date(),
    }).then((result) => {
      if (mounted) {
        setTriagePreview(result);
        setTriageLoading(false);
      }
    }).catch(() => {
      if (mounted) {
        setTriagePreview(null);
        setTriageLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [coords, photoUrl, description, people, needType, duplicates.length]);

  const detectGps = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    toast("Detecting your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextCoords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setCoords(nextCoords);
        resolvePlaceFromCoords(nextCoords[0], nextCoords[1])
          .then((resolved) => setResolvedPlace(resolved.displayName))
          .catch(() => setResolvedPlace(""));
        toast.success("Location locked");
      },
      () => toast.error("Couldn't get GPS — pick on map"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleVoiceTranscript = (text: string) => {
    setDescription((prev) => prev ? prev + " " + text : text);
  };

  const checkDuplicates = async (lat: number, lng: number) => {
    const { data } = await supabase
      .from("emergency_requests")
      .select("id, need_type, latitude, longitude, description, created_at")
      .in("status", ["open", "assigned", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (!data) return [];
    return findDuplicates(
      { needType, latitude: lat, longitude: lng, description },
      data.map((d) => ({
        id: d.id,
        needType: d.need_type as NeedType,
        latitude: d.latitude,
        longitude: d.longitude,
        description: d.description,
        created_at: d.created_at,
      }))
    );
  };

  const submit = async () => {
    if (!user) {
      toast.error("Please sign in to submit");
      navigate({ to: "/auth", search: { redirect: "/submit" } });
      return;
    }
    if (!coords) {
      toast.error("Set your location (GPS or pick on map)");
      setStep(0);
      return;
    }
    if (!effectiveReporterName || !effectiveReporterPhone) {
      toast.error("Please add your name and phone to continue.");
      return;
    }
    if (!description.trim() && !photoUrl) {
      toast.error("Add either a description, image, or voice note.");
      return;
    }

    if (!confirmDup) {
      const dups = await checkDuplicates(coords[0], coords[1]);
      if (dups.length > 0) {
        setDuplicates(dups.map((d) => ({ id: d.id, description: d.description })));
        toast.warning("Possible duplicate detected nearby");
        return;
      }
    }

    const triage = await runTriageAgent({
      imageUrl: photoUrl || undefined,
      description,
      latitude: coords[0],
      longitude: coords[1],
      peopleAffected: people,
      needType,
      duplicateCount: duplicates.length,
      timestamp: new Date(),
    });
    const fallback = scoreRequest({ needType, peopleAffected: people, description, createdAt: new Date() });
    let placeName = resolvedPlace;
    if (!placeName) {
      try {
        const resolved = await resolvePlaceFromCoords(coords[0], coords[1]);
        placeName = resolved.displayName;
        setResolvedPlace(resolved.displayName);
      } catch {
        placeName = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
      }
    }

    setSubmitting(true);
    if (user && (!reporterName || !reporterPhone)) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: effectiveReporterName.slice(0, 100),
          phone: effectiveReporterPhone.slice(0, 20),
        })
        .eq("id", user.id);
      if (profileError) {
        setSubmitting(false);
        toast.error(`Unable to save profile details: ${profileError.message}`);
        return;
      }
      setCachedReporterName(effectiveReporterName);
      setCachedReporterPhone(effectiveReporterPhone);
      localStorage.setItem("rl_reporter_name", effectiveReporterName);
      localStorage.setItem("rl_reporter_phone", effectiveReporterPhone);
    }
    const { error } = await supabase.from("emergency_requests").insert({
      reporter_id: user.id,
      reporter_name: effectiveReporterName.slice(0, 100),
      reporter_phone: effectiveReporterPhone.slice(0, 20),
      disaster_type: disasterType,
      need_type: needType,
      people_affected: people,
      description: description.slice(0, 1000) || "Image/voice-only request submitted",
      latitude: coords[0],
      longitude: coords[1],
      address: placeName,
      resolved_place_name: placeName,
      photo_url: photoUrl || null,
      urgency: triage.priorityLabel || fallback.urgency,
      ai_score: triage.criticalityScore || fallback.score,
      ai_summary: triage.summary || null,
      triage_summary: triage.summary || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `Request received. TRIAGE AGENT assigned score ${triage.criticalityScore} (${triage.priorityLabel.toUpperCase()}). Nearest NGO resources are being coordinated.`,
      { duration: 7000 }
    );
    navigate({ to: "/map" });
  };

  const canProceedStep0 = !!coords;
  const canProceedStep1 = (!!effectiveReporterName && !!effectiveReporterPhone) && (!!description.trim() || !!photoUrl);
  const fallbackPreview = scoreRequest({ needType, peopleAffected: people, description, createdAt: new Date() });

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-display font-bold">Report Emergency</h1>
          <p className="text-sm text-muted-foreground mt-1">Every detail helps responders act faster.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <button
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-sm font-medium transition-all ${
                  i === step ? "text-primary" : i < step ? "text-success cursor-pointer" : "text-muted-foreground"
                }`}
              >
                {i < step ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : i === step ? (
                  <div className="h-4 w-4 rounded-full gradient-hero flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{s}</span>
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          {/* MAP */}
          <div className="glass-strong rounded-2xl p-3 h-[500px] lg:h-auto lg:min-h-[600px] relative">
            <DisasterMap
              markers={[]}
              center={coords || BENGALURU}
              pickable
              picked={coords}
              onPick={(lat, lng) => {
                setCoords([lat, lng]);
                resolvePlaceFromCoords(lat, lng)
                  .then((resolved) => setResolvedPlace(resolved.displayName))
                  .catch(() => setResolvedPlace(""));
              }}
              height="100%"
            />
            <div className="absolute top-6 left-6 right-6 flex justify-between items-start pointer-events-none">
              <div className="glass-strong rounded-xl px-3 py-2 text-xs pointer-events-auto">
                <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" /> Tap map to pin location</div>
                {coords && <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{coords[0].toFixed(5)}, {coords[1].toFixed(5)}</div>}
                {resolvedPlace && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{resolvedPlace}</div>}
              </div>
              <Button size="sm" onClick={detectGps} className="pointer-events-auto gradient-cool border-0">
                <MapPin className="h-3.5 w-3.5 mr-1" /> Use GPS
              </Button>
            </div>
          </div>

          {/* FORM */}
          <div className="space-y-4">
            {/* Step 0: Location confirmation */}
            {step === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-strong rounded-2xl p-5 space-y-4"
              >
                <h2 className="font-display font-bold">Step 1: Pin your location</h2>
                {!coords ? (
                  <div className="glass rounded-xl p-4 text-center">
                    <MapPin className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Tap on the map or use GPS to set your location</p>
                    <Button size="sm" onClick={detectGps} className="mt-3 gradient-cool border-0">
                      Auto-detect GPS
                    </Button>
                  </div>
                ) : (
                  <div className="glass rounded-xl p-4">
                    <div className="flex items-center gap-2 text-success mb-1">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-medium">Location pinned</span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{coords[0].toFixed(5)}, {coords[1].toFixed(5)}</p>
                    {resolvedPlace && <p className="text-xs text-muted-foreground mt-1">{resolvedPlace}</p>}
                    <button onClick={() => { setCoords(null); setResolvedPlace(""); }} className="text-xs text-muted-foreground hover:text-primary mt-1 transition-colors">
                      Reset location
                    </button>
                  </div>
                )}
                <Button
                  onClick={() => setStep(1)}
                  disabled={!canProceedStep0}
                  className="w-full gradient-hero border-0"
                >
                  Continue to Details <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* Step 1: Details */}
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-strong rounded-2xl p-5 space-y-4"
              >
                <h2 className="font-display font-bold">Step 2: Emergency details</h2>
                {(!reporterName || !reporterPhone) && (
                  <div className="glass rounded-xl p-4 space-y-3">
                    <p className="text-xs text-muted-foreground">Complete profile once. This will be saved for future reports.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Your name</Label>
                        <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="mt-1.5" maxLength={100} />
                      </div>
                      <div>
                        <Label>Phone</Label>
                        <Input value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} className="mt-1.5" maxLength={20} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Disaster type</Label>
                    <Select value={disasterType} onValueChange={(v) => setDisasterType(v as typeof DISASTERS[number])}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DISASTERS.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>What's needed</Label>
                    <Select value={needType} onValueChange={(v) => setNeedType(v as NeedType)}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NEEDS.map((n) => <SelectItem key={n} value={n} className="capitalize">{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>People affected</Label>
                  <Input type="number" min={1} max={10000} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} className="mt-1.5" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label>Describe the situation</Label>
                    <VoiceSOS onTranscript={handleVoiceTranscript} />
                  </div>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[90px]"
                    placeholder='e.g. Family of 4 trapped on rooftop, water rising fast, child injured…'
                    maxLength={1000}
                  />
                  <p className={`text-[10px] mt-1 transition-colors ${description.length > 800 ? "text-warning" : "text-muted-foreground"}`}>
                    {description.length}/1000 — text, image, or voice all work. You do not need both.
                  </p>
                </div>

                <PhotoUploadField value={photoUrl} onChange={setPhotoUrl} />

                <div className="flex gap-2">
                  <Button onClick={() => setStep(0)} variant="outline" className="flex-1">Back</Button>
                  <Button onClick={() => setStep(2)} disabled={!canProceedStep1} className="flex-1 gradient-hero border-0">
                    Review <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 2: Review */}
            {step === 2 && (
              <>
                <div className="glass-strong rounded-2xl p-5 space-y-3">
                  <h2 className="font-display font-bold">Step 3: Review & Submit</h2>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="glass rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reporter</div>
                      <div className="font-medium">{effectiveReporterName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{effectiveReporterPhone || "—"}</div>
                    </div>
                    <div className="glass rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Disaster</div>
                      <div className="font-medium capitalize">{disasterType}</div>
                      <div className="text-xs text-muted-foreground capitalize">{needType} needed</div>
                    </div>
                    <div className="glass rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">People</div>
                      <div className="font-medium">{people} affected</div>
                    </div>
                    <div className="glass rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Location</div>
                      <div className="font-mono text-xs">{coords?.[0].toFixed(4)}, {coords?.[1].toFixed(4)}</div>
                      {resolvedPlace && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{resolvedPlace}</div>}
                    </div>
                  </div>
                  <div className="glass rounded-lg p-3 text-sm">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Description</div>
                    <p className="line-clamp-3">{description || "No text description provided (image/voice-based request)."}</p>
                  </div>
                  <Button onClick={() => setStep(1)} variant="outline" size="sm">Edit details</Button>
                </div>

                {/* AI Score */}
                <div className="glass-strong rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-accent" />
                      <span className="text-xs font-bold tracking-widest uppercase text-accent">TRIAGE AGENT</span>
                    </div>
                    <UrgencyBadge
                      urgency={triagePreview?.priorityLabel || fallbackPreview.urgency}
                      score={triagePreview?.criticalityScore || fallbackPreview.score}
                    />
                  </div>
                  {triageLoading && <div className="text-xs text-accent mb-2">Analyzing image + text + geo context...</div>}
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {(triagePreview?.reasoning || fallbackPreview.reasons).map((r, i) => <div key={i}>· {r}</div>)}
                    {triagePreview?.recommendedResourceType && <div>· Recommended resource: {triagePreview.recommendedResourceType}</div>}
                    {triagePreview?.recommendedResponder && <div>· Suggested responder: {triagePreview.recommendedResponder.replace("_", " ")}</div>}
                    {triagePreview?.etaUrgencyLevel && <div>· ETA urgency: {triagePreview.etaUrgencyLevel}</div>}
                    {typeof triagePreview?.duplicateProbability === "number" && <div>· Duplicate probability: {triagePreview.duplicateProbability}%</div>}
                    {typeof triagePreview?.confidenceScore === "number" && <div>· Confidence: {triagePreview.confidenceScore}%</div>}
                    {triagePreview?.summary && <div>· Summary: {triagePreview.summary}</div>}
                  </div>
                </div>

                {/* Duplicate warning */}
                {duplicates.length > 0 && !confirmDup && (
                  <div className="rounded-2xl p-5 border-2 border-warning/40 bg-warning/10">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <span className="font-bold text-warning">Possible duplicate nearby</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">This may already be reported. Check the live map first.</p>
                    {duplicates.slice(0, 2).map((d) => (
                      <div key={d.id} className="text-xs glass rounded-lg p-2 mb-1">{d.description.slice(0, 100)}…</div>
                    ))}
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" onClick={() => setConfirmDup(true)} className="flex-1">Submit anyway</Button>
                      <Link to="/map" className="flex-1"><Button size="sm" variant="default" className="w-full">View map</Button></Link>
                    </div>
                  </div>
                )}

                <Button onClick={submit} disabled={submitting} className="w-full h-12 text-base gradient-emergency border-0 shadow-glow">
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</> : "Send Emergency Request"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <SosButton />
    </div>
  );
}

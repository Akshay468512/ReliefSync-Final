import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SosButton } from "@/components/SosButton";
import { Button } from "@/components/ui/button";
import { useCountUp } from "@/lib/use-count-up";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { motion } from "framer-motion";
import {
  ArrowRight, MapPin, Sparkles, Users, Zap, Shield, Activity, Phone, Globe, Siren,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "ReliefLink AI — Hyperlocal Disaster Volunteer Coordination" },
      {
        name: "description",
        content:
          "Coordinate rescue, food, medicine and shelter in real-time during floods, earthquakes and emergencies. AI-powered priority engine.",
      },
    ],
  }),
});

const FEATURES = [
  {
    icon: MapPin,
    title: "Live Disaster Map",
    desc: "Every emergency, every volunteer — visualized on one real-time map.",
    grad: "gradient-emergency",
  },
  {
    icon: Sparkles,
    title: "AI Priority Engine",
    desc: "Rescue requests are auto-scored — critical, high, medium, low — so help reaches the most vulnerable first.",
    grad: "gradient-hero",
  },
  {
    icon: Users,
    title: "Volunteer Dispatch",
    desc: "Volunteers accept missions in one tap. Smart duplicate detection prevents over-assignment.",
    grad: "gradient-cool",
  },
  {
    icon: Zap,
    title: "Real-time Sync",
    desc: "New requests and status changes are pushed live to every connected screen in milliseconds.",
    grad: "gradient-emergency",
  },
  {
    icon: Shield,
    title: "Duplicate Detection",
    desc: "AI flags likely duplicate reports from the same location — cutting through noise in fast-moving situations.",
    grad: "gradient-hero",
  },
  {
    icon: Activity,
    title: "Admin Command Center",
    desc: "NGOs and coordinators get a real-time overview: zone charts, request volume, and volunteer rankings.",
    grad: "gradient-cool",
  },
];

const HELPLINES = [
  { name: "Emergency", num: "112" },
  { name: "Ambulance", num: "108" },
  { name: "Fire", num: "101" },
  { name: "Police", num: "100" },
];

interface LiveStats {
  total: number;
  completed: number;
  volunteers: number;
}

function AnimatedStat({ value, suffix = "" }: { value: number; suffix?: string }) {
  const display = useCountUp(value, 1500);
  return (
    <span>
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

function Landing() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<LiveStats>({ total: 0, completed: 0, volunteers: 0 });
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    setHeroVisible(true);

    async function loadStats() {
      const [{ count: total }, { count: completed }, { count: volunteers }] = await Promise.all([
        supabase.from("emergency_requests").select("*", { count: "exact", head: true }),
        supabase
          .from("emergency_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed"),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "volunteer"),
      ]);
      setStats({ total: total ?? 0, completed: completed ?? 0, volunteers: volunteers ?? 0 });
    }

    loadStats();

    const channel = supabase
      .channel("home-stats")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "emergency_requests" },
        () => {
          setStats((prev) => ({ ...prev, total: prev.total + 1 }));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "emergency_requests" },
        (payload) => {
          const updated = payload.new as { status: string };
          if (updated.status === "completed") {
            setStats((prev) => ({ ...prev, completed: prev.completed + 1 }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{ backgroundImage: "url('/landing-storm.png')" }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/55 to-background/85" aria-hidden="true" />
        <div className="absolute inset-0 gradient-mesh animate-mesh-drift" />
        <motion.div
          className="absolute top-20 right-[12%] h-16 w-16 rounded-2xl glass flex items-center justify-center"
          animate={{ y: [0, -10, 0], rotate: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
        >
          <Siren className="h-7 w-7 text-critical" />
        </motion.div>
        <motion.div
          className="absolute bottom-24 left-[10%] h-14 w-14 rounded-xl glass flex items-center justify-center"
          animate={{ y: [0, -12, 0], rotate: [0, -8, 0] }}
          transition={{ repeat: Infinity, duration: 7, ease: "easeInOut", delay: 0.4 }}
        >
          <Globe className="h-6 w-6 text-accent" />
        </motion.div>
        <div
          className="absolute top-20 left-1/4 h-64 w-64 rounded-full opacity-10 gradient-emergency blur-3xl animate-orb-float"
        />
        <div
          className="absolute bottom-10 right-1/4 h-48 w-48 rounded-full opacity-10 gradient-cool blur-3xl animate-orb-float"
          style={{ animationDelay: "1.5s" }}
        />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-20 pb-32">
          <div
            className="text-center max-w-4xl mx-auto"
            style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? "translateY(0)" : "translateY(30px)",
              transition: "opacity 0.8s ease-out, transform 0.8s ease-out",
            }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-primary/30 text-xs font-medium mb-8">
              <span className="h-2 w-2 rounded-full bg-success pulse-ring" />
              <span className="text-muted-foreground">{t("hero.badge")}</span>
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl font-display font-bold tracking-tight leading-[0.95]">
              {t("hero.h1a")}
              <br />
              <span className="text-gradient">{t("hero.h1b")}</span>
            </h1>

            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
              {t("hero.sub")}
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/submit">
                <Button
                  size="lg"
                  className="gradient-emergency border-0 text-base h-12 px-7 shadow-glow group"
                >
                  {t("hero.cta.report")}
                  <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/map">
                <Button size="lg" variant="outline" className="text-base h-12 px-7 glass">
                  <MapPin className="mr-2 h-4 w-4" /> {t("hero.cta.map")}
                </Button>
              </Link>
            </div>

            {/* Live stats from DB */}
            <div className="mt-16 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
              {[
                { v: stats.total, label: t("stats.total"), suffix: "+" },
                { v: stats.completed, label: t("stats.completed"), suffix: "" },
                { v: stats.volunteers, label: t("stats.volunteers"), suffix: "+" },
              ].map((s) => (
                <div key={s.label} className="glass rounded-2xl p-4 card-3d">
                  <div className="font-display text-3xl font-bold text-gradient">
                    <AnimatedStat value={s.v} suffix={s.suffix} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative py-24 px-4 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <span className="text-xs font-bold tracking-widest text-accent uppercase">
              {t("features.tag")}
            </span>
            <h2 className="mt-3 text-4xl sm:text-5xl font-display font-bold">
              {t("features.heading")}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="glass rounded-2xl p-6 hover:border-primary/40 transition-all group animate-float-up"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div
                    className={`h-12 w-12 rounded-xl ${f.grad} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-glow`}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="font-display font-bold text-lg">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 px-4 sm:px-6 relative overflow-hidden">
        <div className="absolute inset-0 gradient-mesh opacity-30" />
        <div className="mx-auto max-w-5xl relative">
          <div className="text-center mb-12">
            <span className="text-xs font-bold tracking-widest text-accent uppercase">
              {t("howItWorks.tag")}
            </span>
            <h2 className="mt-3 text-3xl font-display font-bold">{t("howItWorks.heading")}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              {t("howItWorks.sub")}
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { n: "01", t: t("howItWorks.step1.title"), d: t("howItWorks.step1.desc") },
              { n: "02", t: t("howItWorks.step2.title"), d: t("howItWorks.step2.desc") },
              { n: "03", t: t("howItWorks.step3.title"), d: t("howItWorks.step3.desc") },
            ].map((s) => (
              <div key={s.n} className="glass-strong rounded-2xl p-6 text-center">
                <div className="font-display text-4xl font-bold text-gradient mb-3">{s.n}</div>
                <h3 className="font-display font-bold text-lg mb-2">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link to="/map">
              <Button size="lg" className="gradient-hero border-0 shadow-glow">
                {t("hero.cta.map")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* EMERGENCY HELPLINES */}
      <section className="py-16 px-4 sm:px-6">
        <div className="mx-auto max-w-7xl glass-strong rounded-3xl p-8 md:p-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
            <div>
              <span className="text-xs font-bold tracking-widest text-critical uppercase">
                {t("helpline.title")}
              </span>
              <h3 className="mt-2 text-3xl font-display font-bold">{t("helpline.subtitle")}</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {HELPLINES.map((h) => (
                <a
                  key={h.num}
                  href={`tel:${h.num}`}
                  className="glass rounded-xl px-4 py-3 hover:border-primary/40 transition group"
                >
                  <div className="text-xs text-muted-foreground">{h.name}</div>
                  <div className="font-display font-bold text-2xl flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    {h.num}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* VOLUNTEER CTA */}
      <section className="py-24 px-4 sm:px-6">
        <div className="mx-auto max-w-4xl text-center glass-strong rounded-3xl p-12 relative overflow-hidden">
          <div className="absolute inset-0 gradient-mesh opacity-50" />
          <div className="relative">
            <h2 className="text-4xl font-display font-bold">{t("cta.heading")}</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">{t("cta.sub")}</p>
            <Link to="/auth" className="inline-block mt-8">
              <Button size="lg" className="gradient-hero border-0 h-12 px-8 shadow-glow">
                {t("cta.button")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="py-10 text-center text-sm text-muted-foreground border-t border-border">
        <div className="flex items-center justify-center gap-6 flex-wrap">
          <span>ReliefLink AI &copy; {new Date().getFullYear()}</span>
          <Link to="/map" className="hover:text-primary transition-colors">
            {t("nav.map")}
          </Link>
          <Link to="/submit" className="hover:text-primary transition-colors">
            {t("nav.report")}
          </Link>
          <Link to="/volunteer" className="hover:text-primary transition-colors">
            {t("nav.volunteer")}
          </Link>
          <Link to="/admin" className="hover:text-primary transition-colors">
            {t("nav.admin")}
          </Link>
          <Link to="/about" className="hover:text-primary transition-colors">
            {t("nav.about")}
          </Link>
        </div>
      </footer>

      <SosButton />
    </div>
  );
}

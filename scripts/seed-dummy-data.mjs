import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  const raw = readFileSync(path, "utf8");
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    const v = rest.join("=").trim().replace(/^"/, "").replace(/"$/, "");
    map[k.trim()] = v;
  }
  return map;
}

const env = readEnv(".env");
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase URL or publishable key in .env");
}

const suffix = `demo${Date.now().toString().slice(-6)}`;
const password = "Relief@123";

const users = [
  { role: "admin", fullName: "Aisha Coordinator", phone: "9000000001", email: `admin.${suffix}@relieflink.demo` },
  { role: "volunteer", fullName: "Rahul Volunteer", phone: "9000000002", email: `volunteer.${suffix}@relieflink.demo` },
  { role: "citizen", fullName: "Priya Citizen", phone: "9000000003", email: `citizen.${suffix}@relieflink.demo` },
];

const requests = [
  { disaster_type: "flood", need_type: "rescue", people_affected: 12, description: "Families trapped near KR Puram bridge, water rising rapidly.", latitude: 12.9986, longitude: 77.6958, urgency: "critical", ai_score: 93, resolved_place_name: "KR Puram Bridge Area, Bengaluru", address: "KR Puram Bridge Area, Bengaluru" },
  { disaster_type: "medical", need_type: "medicine", people_affected: 4, description: "Urgent insulin and first-aid required near Whitefield railway gate.", latitude: 12.9694, longitude: 77.7504, urgency: "high", ai_score: 81, resolved_place_name: "Whitefield Railway Gate, Bengaluru", address: "Whitefield Railway Gate, Bengaluru" },
  { disaster_type: "other", need_type: "food", people_affected: 25, description: "Shelter camp running out of cooked food near Hebbal flyover service road.", latitude: 13.0356, longitude: 77.5972, urgency: "high", ai_score: 76, resolved_place_name: "Hebbal Flyover Area, Bengaluru", address: "Hebbal Flyover Area, Bengaluru" },
];

const anonClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureUser(user) {
  const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
    email: user.email,
    password,
    options: { data: { full_name: user.fullName, phone: user.phone, role: user.role } },
  });

  if (signUpError && !signUpError.message.toLowerCase().includes("already registered")) {
    throw new Error(`Sign up failed for ${user.email}: ${signUpError.message}`);
  }

  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (signInError || !signInData.user) {
    return {
      ...user,
      password,
      userId: signUpData.user?.id || null,
      canLogin: false,
      error: signInError?.message || "Unable to sign in",
    };
  }

  return {
    ...user,
    password,
    userId: signInData.user.id,
    canLogin: true,
    accessToken: signInData.session?.access_token || null,
    error: null,
  };
}

async function seed() {
  const accounts = [];
  for (const user of users) {
    accounts.push(await ensureUser(user));
  }

  const citizen = accounts.find((a) => a.role === "citizen");
  if (citizen?.canLogin && citizen.accessToken && citizen.userId) {
    const citizenClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${citizen.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload = requests.map((r) => ({
      ...r,
      reporter_id: citizen.userId,
      reporter_name: citizen.fullName,
      reporter_phone: citizen.phone,
      status: "open",
    }));
    const { error } = await citizenClient.from("emergency_requests").insert(payload);
    if (error) {
      throw new Error(`Request seed failed: ${error.message}`);
    }
  }

  const output = accounts.map(({ accessToken, ...safe }) => safe);
  console.log(JSON.stringify({ seededAt: new Date().toISOString(), accounts: output }, null, 2));
}

seed().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

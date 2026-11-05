import OpenAI from "openai";
import type { Candidate } from "../lib/places";

export type Stop = {
  name: string;
  story: string;
  minutes: number;
  tip?: string;
  category: string;
  lat: number;
  lon: number;
  walkFromPrevMin?: number;
};

export type Itinerary = {
  title: string;
  intro: string;
  stops: Stop[];
  closing: string;
  source: "ai" | "local";
};

export type AiResult =
  | { itinerary: Itinerary; usedAi: true }
  | { itinerary: Itinerary; usedAi: false; reason: string };

const VIBE_LABELS: Record<string, string> = {
  surprise: "surprise me — a mix of all kinds of hidden gems",
  history: "history and heritage",
  art: "art, culture and museums",
  nature: "parks, gardens and nature",
  food: "markets and local food",
};

const CATEGORY_STORIES: Record<string, string> = {
  "Historic site": "A piece of local history hiding in plain sight — most people walk right past it without a glance.",
  Viewpoint: "The kind of view locals keep to themselves; the whole area opens up from here.",
  "Local market": "A working neighbourhood market — real food, real people, none of the souvenir-stand prices.",
  "Park & garden": "A green pocket the guidebooks forgot: sit down and watch the neighbourhood breathe.",
  "Arts centre": "A community arts hub where the local creative scene actually lives.",
  "Art & museum": "A small cultural stop with outsized charm — exactly the kind of place big lists leave out.",
  "Temple · Church · Mosque": "A living heritage site, usually quiet, always welcoming, often older than the city map itself.",
  "Nature reserve": "Wilderness minutes from the city — bring a camera more than an itinerary.",
  "Local attraction": "A beloved local oddity that never made the tourist brochures.",
  "Family fun": "Easy, cheerful and fun for everyone — a low-effort, high-smile stop.",
};

function getClient(): OpenAI | null {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.ZAI_API_BASE || "https://api.z.ai/api/paas/v4",
  });
}

// Some OpenAI-compatible backends ignore response_format and wrap JSON in prose
// or code fences — recover the outermost {…} object before parsing.
function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("could not parse model output as JSON");
  }
}

export function buildFallbackItinerary(
  originName: string,
  vibe: string,
  hours: number,
  candidates: Candidate[]
): Itinerary {
  const maxStops = hours >= 3 ? 6 : hours === 2 ? 5 : 4;
  const count = Math.min(maxStops, Math.max(3, candidates.length));
  const each = Math.max(10, Math.round((hours * 60) / count));
  const stops: Stop[] = candidates.slice(0, count).map((c) => ({
    name: c.name,
    category: c.category,
    lat: c.lat,
    lon: c.lon,
    minutes: each,
    story: CATEGORY_STORIES[c.category] || "A quiet local corner most visitors walk right past.",
    tip: "Walk between stops — the streets are part of the story.",
  }));
  return {
    title: `${hours}-hour local ramble${originName ? " in " + originName : ""}`,
    intro: `A self-guided ${hours}-hour route for ${
      VIBE_LABELS[vibe] ?? "local exploring"
    }, assembled from real mapped places around your area. Timings are a guide — wander freely.`,
    stops,
    closing: "This offline guide works even without the AI narrator — every place here is real, from OpenStreetMap.",
    source: "local",
  };
}

export async function buildAiItinerary(opts: {
  originName: string;
  vibe: string;
  hours: number;
  candidates: Candidate[];
}): Promise<AiResult> {
  const client = getClient();
  if (!client) {
    return {
      itinerary: buildFallbackItinerary(opts.originName, opts.vibe, opts.hours, opts.candidates),
      usedAi: false,
      reason: "AI narrator not configured (no API key)",
    };
  }

  const system = [
    "You are Wander1K, a friendly local guide who builds walking itineraries to hidden gems.",
    "You will receive JSON: the visitor's vibe, available hours, and real nearby mapped places (name, category, distanceKm from start, vibes).",
    "Return ONLY valid JSON, exactly:",
    '{"title": string, "intro": string, "stops": [{"name": string, "story": string, "minutes": number, "tip": string}], "closing": string}',
    "Rules:",
    "1. Pick 3-6 places. Copy each place name EXACTLY as given, character for character.",
    `2. Fit the plan into ${opts.hours} hour(s); "minutes" is roughly the time to spend AT that stop (walking time is computed separately).`,
    "3. Order stops into a sensible walking route (roughly nearest-first, small detours allowed).",
    `4. Curate for the visitor's vibe: ${VIBE_LABELS[opts.vibe] ?? "a mix"}. Skip places that clash with it.`,
    "5. story: 1-2 warm, specific sentences on why this stop is worth their time. Ground it in the category and vibes given — do NOT invent historical claims, prices, hours or businesses.",
    "6. tip: one short practical note (best time to go, what to look out for, etc.).",
    "7. intro: 2 sentences in the voice of a proud local. closing: 1 sentence send-off. title: short and evocative.",
    "8. No markdown, no text outside the JSON.",
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: process.env.ZAI_MODEL || "glm-4-flash",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            area: opts.originName,
            hours: opts.hours,
            places: opts.candidates.map((c) => ({
              name: c.name,
              category: c.category,
              distanceKm: Math.round(c.distanceKm * 10) / 10,
              vibes: c.vibes,
            })),
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 1600,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw) as {
      title?: string;
      intro?: string;
      closing?: string;
      stops?: { name?: string; story?: string; minutes?: number; tip?: string }[];
    };
    if (!Array.isArray(parsed.stops)) throw new Error("no stops in model output");

    const byName = new Map(opts.candidates.map((c) => [c.name.toLowerCase(), c]));
    const stops: Stop[] = [];
    const seen = new Set<string>();
    for (const s of parsed.stops) {
      if (!s || typeof s.name !== "string" || typeof s.story !== "string") continue;
      const cand = byName.get(s.name.toLowerCase());
      if (!cand || seen.has(cand.name.toLowerCase())) continue;
      seen.add(cand.name.toLowerCase());
      stops.push({
        name: cand.name,
        category: cand.category,
        lat: cand.lat,
        lon: cand.lon,
        minutes: Math.min(120, Math.max(10, Math.round(s.minutes ?? 30))),
        story: s.story,
        tip: typeof s.tip === "string" ? s.tip : undefined,
      });
    }
    if (stops.length < 3) throw new Error("model output had too few matchable stops");

    return {
      itinerary: {
        title: parsed.title || `Your ${opts.hours}-hour local route`,
        intro: parsed.intro || `Here's your local route for the next ${opts.hours} hour(s).`,
        stops,
        closing: parsed.closing || "Have a great wander!",
        source: "ai",
      },
      usedAi: true,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      itinerary: buildFallbackItinerary(opts.originName, opts.vibe, opts.hours, opts.candidates),
      usedAi: false,
      reason,
    };
  }
}

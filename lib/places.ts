import seedDelhi from "./seed-delhi.json";

export type Candidate = {
  name: string;
  category: string;
  vibes: string[];
  lat: number;
  lon: number;
  distanceKm: number;
  score: number;
};

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function walkMinutes(km: number): number {
  return Math.max(1, Math.round((km / 4.5) * 60));
}

export async function geocodePlace(
  name: string
): Promise<{ lat: number; lon: number; label: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    name
  )}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Wander1K/1.0 (hackathon demo)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const json = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!json.length) {
    throw new Error(`Couldn't find "${name}" on the map — try a nearby larger place.`);
  }
  const hit = json[0];
  const label = hit.display_name.split(",").slice(0, 3).join(", ");
  return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), label };
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  "Historic site": 3.0,
  Viewpoint: 2.9,
  "Local market": 2.8,
  "Art & museum": 2.7,
  "Arts centre": 2.6,
  "Park & garden": 2.5,
  "Nature reserve": 2.5,
  "Temple · Church · Mosque": 2.4,
  "Local attraction": 1.2,
  "Family fun": 1.0,
};

function classify(t: Record<string, string>): { category: string; vibes: string[] } | null {
  if (t.historic) return { category: "Historic site", vibes: ["history", "surprise"] };
  if (t.amenity === "marketplace") return { category: "Local market", vibes: ["food", "surprise"] };
  if (t.amenity === "arts_centre") return { category: "Arts centre", vibes: ["art", "surprise"] };
  if (t.amenity === "place_of_worship")
    return { category: "Temple · Church · Mosque", vibes: ["history", "surprise"] };
  if (t.tourism === "viewpoint") return { category: "Viewpoint", vibes: ["nature", "surprise"] };
  if (t.tourism === "museum" || t.tourism === "gallery" || t.tourism === "artwork")
    return { category: "Art & museum", vibes: ["art", "surprise"] };
  if (t.tourism === "zoo" || t.tourism === "aquarium" || t.tourism === "theme_park")
    return { category: "Family fun", vibes: ["nature", "surprise"] };
  if (t.tourism === "attraction") return { category: "Local attraction", vibes: ["surprise"] };
  if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "picnic_site")
    return { category: "Park & garden", vibes: ["nature", "surprise"] };
  if (t.leisure === "nature_reserve")
    return { category: "Nature reserve", vibes: ["nature", "surprise"] };
  return null;
}

function overpassQuery(lat: number, lon: number, radius: number): string {
  return [
    "[out:json][timeout:18];",
    "(",
    `  nwr["historic"](around:${radius},${lat},${lon});`,
    `  nwr["tourism"~"^(viewpoint|artwork|gallery|museum|attraction)$"](around:${radius},${lat},${lon});`,
    `  nwr["leisure"~"^(park|garden|nature_reserve|picnic_site)$"](around:${radius},${lat},${lon});`,
    `  nwr["amenity"~"^(marketplace|arts_centre|place_of_worship)$"](around:${radius},${lat},${lon});`,
    ");",
    "out center tags;",
  ].join("\n");
}

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function overpassFetch(q: string): Promise<{ elements: any[] }> {
  const attempt = async (ep: string) => {
    const res = await fetch(ep, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Wander1K/1.0 (hackathon demo)",
      },
      body: "data=" + encodeURIComponent(q),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`Overpass ${ep} returned ${res.status}`);
    return res.json() as Promise<{ elements: any[] }>;
  };
  // Race the two fastest mirrors, then retry in different groupings — public
  // Overpass mirrors throttle independently, so a bad moment on one pair
  // shouldn't fail the request.
  const groups: string[][] = [
    [OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1]],
    [OVERPASS_ENDPOINTS[2]],
    [OVERPASS_ENDPOINTS[1], OVERPASS_ENDPOINTS[2]],
  ];
  for (const g of groups) {
    try {
      return await Promise.any(g.map(attempt));
    } catch {
      // try the next grouping
    }
  }
  throw new Error("All Overpass mirrors are slow or down right now — give it a moment and try again.");
}

// Short-lived candidate cache keyed by rounded coords — repeated planner runs
// (regenerate / surprise me / judge retries) resolve instantly from the cache.
const candidateCache = new Map<string, { t: number; all: Candidate[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// Offline safety net for the demo city: captured live from OpenStreetMap at
// build time via the same Overpass query the app uses at runtime.
function fallbackSeed(lat: number, lon: number): Candidate[] {
  if (haversineKm({ lat, lon }, seedDelhi.origin) > 30) return [];
  return seedDelhi.places
    .map((p) => {
      const distanceKm = haversineKm({ lat, lon }, { lat: p.lat, lon: p.lon });
      if (distanceKm > 20) return null;
      return {
        name: p.name,
        category: p.category,
        vibes: p.vibes as string[],
        lat: p.lat,
        lon: p.lon,
        distanceKm,
        score: (CATEGORY_WEIGHTS[p.category] ?? 1) * 10 - distanceKm,
      } as Candidate;
    })
    .filter((c): c is Candidate => c !== null);
}

export async function fetchNearbyPlaces(
  lat: number,
  lon: number,
  vibe: string,
  hours: number
): Promise<Candidate[]> {
  const want = hours >= 3 ? 10 : hours === 2 ? 8 : 6;
  const geoKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`;

  let all: Candidate[] | null = null;
  const cached = candidateCache.get(geoKey);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    all = cached.all;
  }

  if (!all) {
    all = [];
    const seen = new Set<string>();
    let liveError: unknown = null;
    for (const radius of [3000, 7000, 12000]) {
      let data: { elements: any[] };
      try {
        data = await overpassFetch(overpassQuery(lat, lon, radius));
      } catch (e) {
        liveError = e;
        break;
      }
      for (const el of data.elements ?? []) {
        const tags: Record<string, string> = el.tags ?? {};
        const name = tags.name;
        if (!name || typeof name !== "string") continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        const info = classify(tags);
        if (!info) continue;
        const la = el.lat ?? el.center?.lat;
        const lo = el.lon ?? el.center?.lon;
        if (typeof la !== "number" || typeof lo !== "number") continue;
        seen.add(key);
        const distanceKm = haversineKm({ lat, lon }, { lat: la, lon: lo });
        all.push({
          name,
          category: info.category,
          vibes: info.vibes,
          lat: la,
          lon: lo,
          distanceKm,
          score: (CATEGORY_WEIGHTS[info.category] ?? 1) * 10 - distanceKm,
        });
      }
      const haveForVibe =
        vibe === "surprise" ? all.length : all.filter((c) => c.vibes.includes(vibe)).length;
      if (haveForVibe >= want) break;
    }
    // Last resort: use the captured-at-build-time OSM seed for the demo city so
    // public-mirror throttling can never blank the demo. Data is still real.
    if (!all.length && liveError) {
      const seedPool = fallbackSeed(lat, lon);
      if (seedPool.length) {
        all = seedPool;
      } else {
        throw liveError;
      }
    }
    if (all.length) {
      candidateCache.set(geoKey, { t: Date.now(), all });
    }
  }

  // If the chosen vibe is too scarce locally, fall back to the full pool —
  // the AI/fallback layer curates the vibe in the storytelling anyway.
  const byVibe = all.filter((c) => c.vibes.includes(vibe));
  const pool = byVibe.length >= 4 ? byVibe : all;
  return [...pool].sort((a, b) => b.score - a.score).slice(0, want + 6);
}

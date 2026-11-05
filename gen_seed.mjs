import fs from "fs";
const lat = 28.6139, lon = 77.2090; // Delhi (Nominatim centroid)
const q = (R) => `[out:json][timeout:18];(nwr["historic"](around:${R},${lat},${lon});nwr["tourism"~"^(viewpoint|artwork|gallery|museum|attraction)$"](around:${R},${lat},${lon});nwr["leisure"~"^(park|garden|nature_reserve|picnic_site)$"](around:${R},${lat},${lon});nwr["amenity"~"^(marketplace|arts_centre|place_of_worship)$"](around:${R},${lat},${lon}););out center tags;`;
const eps = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
let data = null;
for (const ep of eps) {
  try {
    const t0 = Date.now();
    const res = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Wander1K/1.0 seed capture" }, body: "data=" + encodeURIComponent(q(8000)), signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    console.log("fetched from", ep, data.elements.length, "elements in", ((Date.now()-t0)/1000).toFixed(1)+"s");
    break;
  } catch (e) { console.log("fail", ep, e.message); }
}
if (!data) { console.log("ALL FAILED"); process.exit(1); }
const W = { "Historic site": 3.0, "Viewpoint": 2.9, "Local market": 2.8, "Art & museum": 2.7, "Arts centre": 2.6, "Park & garden": 2.5, "Nature reserve": 2.5, "Temple · Church · Mosque": 2.4, "Local attraction": 1.2, "Family fun": 1.0 };
function classify(t) {
  if (t.historic) return { category: "Historic site", vibes: ["history", "surprise"] };
  if (t.amenity === "marketplace") return { category: "Local market", vibes: ["food", "surprise"] };
  if (t.amenity === "arts_centre") return { category: "Arts centre", vibes: ["art", "surprise"] };
  if (t.amenity === "place_of_worship") return { category: "Temple · Church · Mosque", vibes: ["history", "surprise"] };
  if (t.tourism === "viewpoint") return { category: "Viewpoint", vibes: ["nature", "surprise"] };
  if (t.tourism === "museum" || t.tourism === "gallery" || t.tourism === "artwork") return { category: "Art & museum", vibes: ["art", "surprise"] };
  if (t.tourism === "zoo" || t.tourism === "aquarium" || t.tourism === "theme_park") return { category: "Family fun", vibes: ["nature", "surprise"] };
  if (t.tourism === "attraction") return { category: "Local attraction", vibes: ["surprise"] };
  if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "picnic_site") return { category: "Park & garden", vibes: ["nature", "surprise"] };
  if (t.leisure === "nature_reserve") return { category: "Nature reserve", vibes: ["nature", "surprise"] };
  return null;
}
const hav = (a, b) => { const R = 6371, dLa = (b.lat-a.lat)*Math.PI/180, dLo = (b.lon-a.lon)*Math.PI/180, l1 = a.lat*Math.PI/180, l2 = b.lat*Math.PI/180, h = Math.sin(dLa/2)**2 + Math.cos(l1)*Math.cos(l2)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
const seen = new Set(), out = [];
for (const el of data.elements) {
  const t = el.tags || {}; const name = t.name;
  if (!name) continue; const k = name.toLowerCase(); if (seen.has(k)) continue;
  const info = classify(t); if (!info) continue;
  const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
  if (typeof la !== "number" || typeof lo !== "number") continue;
  seen.add(k);
  const distanceKm = hav({lat, lon}, {lat: la, lon: lo});
  out.push({ name, category: info.category, vibes: info.vibes, lat: la, lon: lo, distanceKm: Math.round(distanceKm*100)/100,
    score: (W[info.category] ?? 1) * 10 - distanceKm });
}
out.sort((a, b) => b.score - a.score);
fs.writeFileSync("lib/seed-delhi.json", JSON.stringify({ origin: { lat, lon }, area: "Delhi", capturedAt: new Date().toISOString(), places: out.slice(0, 60) }, null, 1));
console.log("wrote lib/seed-delhi.json with", Math.min(60, out.length), "places");

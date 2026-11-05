import { NextResponse } from "next/server";
import {
  geocodePlace,
  fetchNearbyPlaces,
  haversineKm,
  walkMinutes,
} from "../../../lib/places";
import { buildAiItinerary, buildFallbackItinerary, type Itinerary } from "../../../lib/itinerary";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_VIBES = new Set(["surprise", "history", "art", "nature", "food"]);

export async function POST(req: Request) {
  let body: { lat?: number; lon?: number; name?: string; hours?: number; vibe?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const vibe = ALLOWED_VIBES.has(body.vibe ?? "") ? (body.vibe as string) : "surprise";
  const hours = Math.min(4, Math.max(1, Math.round(body.hours ?? 2)));

  try {
    let loc: { lat: number; lon: number; label: string };
    if (typeof body.lat === "number" && typeof body.lon === "number") {
      loc = { lat: body.lat, lon: body.lon, label: "your current location" };
    } else if (typeof body.name === "string" && body.name.trim()) {
      loc = await geocodePlace(body.name.trim());
    } else {
      return NextResponse.json(
        { error: "Share a location first — use my location or type a place." },
        { status: 400 }
      );
    }

    const candidates = await fetchNearbyPlaces(loc.lat, loc.lon, vibe, hours);
    if (!candidates.length) {
      return NextResponse.json(
        {
          error:
            "No mapped hidden gems found around there yet — try a bigger nearby area or another vibe.",
        },
        { status: 404 }
      );
    }

    const ai = await buildAiItinerary({
      originName: loc.label,
      vibe,
      hours,
      candidates,
    });
    const itinerary: Itinerary = ai.usedAi
      ? ai.itinerary
      : buildFallbackItinerary(loc.label, vibe, hours, candidates);

    // Attach real walking time between consecutive stops.
    let prev: { lat: number; lon: number } = loc;
    for (const stop of itinerary.stops) {
      stop.walkFromPrevMin = walkMinutes(haversineKm(prev, stop));
      prev = stop;
    }

    return NextResponse.json({
      origin: loc,
      usedAi: itinerary.source === "ai",
      notice: ai.usedAi ? undefined : ai.reason,
      itinerary,
      candidatesFound: candidates.length,
    });
  } catch (e) {
    console.error("guide route error", e);
    const message = e instanceof Error ? e.message : "Something went wrong planning your route.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

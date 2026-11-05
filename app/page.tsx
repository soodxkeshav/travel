"use client";

import { useState, useEffect } from "react";

type Stop = {
  name: string;
  story: string;
  minutes: number;
  tip?: string;
  category: string;
  lat: number;
  lon: number;
  walkFromPrevMin?: number;
};

type Itinerary = {
  title: string;
  intro: string;
  stops: Stop[];
  closing: string;
  source: "ai" | "local";
};

type Result = {
  origin: { label: string; lat: number; lon: number };
  usedAi: boolean;
  notice?: string;
  itinerary: Itinerary;
  candidatesFound: number;
};

const VIBES = [
  { key: "surprise", label: "🎲 Surprise me" },
  { key: "history", label: "🏛 Heritage" },
  { key: "art", label: "🎨 Art & culture" },
  { key: "nature", label: "🌳 Green & views" },
  { key: "food", label: "🍜 Markets & food" },
];

const LOADING_LINES = [
  "Asking the map where locals sneak off to…",
  "Reading the neighbourhood's fine print…",
  "Weighing corners, gates and garden gates…",
  "Whispering with the market vendors…",
  "Chalking out your walking route…",
];

export default function Home() {
  const [vibe, setVibe] = useState("surprise");
  const [hours, setHours] = useState(2);
  const [place, setPlace] = useState("Delhi");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (status !== "loading") return;
    const t = setInterval(() => setLine((l) => (l + 1) % LOADING_LINES.length), 1600);
    return () => clearInterval(t);
  }, [status]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Your browser has no location support — type a place instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPlace("My location ✓");
        setError("");
      },
      () => setError("Location permission denied — type a place instead.")
    );
  }

  async function go() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          coords ? { lat: coords.lat, lon: coords.lon, hours, vibe } : { name: place, hours, vibe }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong — try again.");
        setStatus("error");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch {
      setError("Network hiccup — try again.");
      setStatus("error");
    }
  }

  const totalWalk = result
    ? result.itinerary.stops.reduce((a, s) => a + (s.walkFromPrevMin ?? 0), 0)
    : 0;
  const totalAtStop = result ? result.itinerary.stops.reduce((a, s) => a + s.minutes, 0) : 0;

  return (
    <div className="wrap">
      <div className="hero">
        <h1>
          Wander<span>1K</span>
        </h1>
        <p className="tag">
          Turn your next 1–4 free hours into a real walk through lesser-known places near you.
          The stories come from AI — the places come from the real map. Nothing is invented.
        </p>
      </div>

      <form
        className="card planner"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label>Vibe</label>
        <div className="chips">
          {VIBES.map((v) => (
            <button
              key={v.key}
              className={"chip" + (vibe === v.key ? " on" : "")}
              onClick={() => setVibe(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <label>How much time do you have?</label>
        <div className="hours">
          {[1, 2, 3, 4].map((h) => (
            <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>
              {h} hr{h > 1 ? "s" : ""}
            </button>
          ))}
        </div>

        <label>Where do we start?</label>
        <div className="row">
          <input
            type="text"
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setCoords(null);
            }}
            placeholder="City, area or landmark…"
          />
          <button type="button" className="gps" onClick={useMyLocation}>
            Use my location
          </button>
        </div>

        <button className="go" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Planning your wander…" : "Show me my next hour →"}
        </button>

        {status === "loading" && (
          <p className="loading">
            {LOADING_LINES[line]}
            <span className="dots" />
          </p>
        )}
      </form>

      {status === "error" && <div className="error">{error}</div>}

      {status === "done" && result && (
        <>
          <div className="result-head">
            <h2 style={{ margin: 0 }}>{result.itinerary.title}</h2>
            <span className={"badge " + (result.usedAi ? "ai" : "local")}>
              {result.usedAi ? "✨ AI-crafted · places verified" : "📜 Offline guide · places verified"}
            </span>
          </div>
          <p className="notice">
            Starting from {result.origin.label} · {result.candidatesFound} real mapped places
            scanned · ~{totalWalk} min walking + ~{totalAtStop} min exploring
          </p>
          <p className="intro">{result.itinerary.intro}</p>

          {result.itinerary.stops.map((s, i) => (
            <div key={s.name}>
              <div className="stop">
                <div className="stopidx">{i + 1}</div>
                <div className="stopbody">
                  <h3>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.name} ↗
                    </a>
                  </h3>
                  <div className="metarow">
                    <span className="cat">{s.category}</span>
                    <span>~{s.minutes} min here</span>
                    {typeof s.walkFromPrevMin === "number" && (
                      <span>🚶 {s.walkFromPrevMin} min from last stop</span>
                    )}
                  </div>
                  <p className="story">{s.story}</p>
                  {s.tip && <p className="tip">💡 {s.tip}</p>}
                </div>
              </div>
            </div>
          ))}

          <p className="closing">{result.itinerary.closing}</p>

          <div className="again">
            <button onClick={go}>↻ Regenerate</button>
            <button
              onClick={() => {
                setVibe("surprise");
                setTimeout(go, 50);
              }}
            >
              🎲 Surprise me instead
            </button>
          </div>
        </>
      )}

      <footer>
        Places from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        contributors. Stories by AI, grounded in mapped reality — verify opening times before you
        go.
      </footer>
    </div>
  );
}

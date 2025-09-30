import React, { useEffect, useMemo, useState } from "react";

// ---------- Types ----------
type TeamPick = "T1" | "T2" | "Sit";

type Settings = {
  wager: number;
  carryOver: boolean;
  soloDouble: boolean;   // NEW
  birdieDouble: boolean;
  eagleTriple: boolean;
};

type HoleState = {
  par: number | "";                 // allow empty while editing on mobile
  teamPicks: TeamPick[];
  scores: (number | "")[];
};

// ---------- UI Primitives ----------
function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700">{children}</label>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 items-center rounded-full transition " +
        (checked ? "bg-green-600" : "bg-gray-300")
      }
      aria-pressed={checked}
    >
      <span
        className={
          "inline-block h-5 w-5 transform rounded-full bg-white transition " +
          (checked ? "translate-x-5" : "translate-x-1")
        }
      />
    </button>
  );
}

// Mobile-friendly numeric input that can be cleared (crucial for iOS)
function NumberField({
  value,
  step = 1,
  min,
  onChange,
  className = "",
}: {
  value: number | "";
  step?: number;
  min?: number;
  onChange: (v: number | "") => void;
  className?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      onChange={(e) => {
        const val = e.target.value;
        if (val === "") {
          onChange("");
          return;
        }
        const num = Number(val);
        if (!Number.isNaN(num)) {
          if (min !== undefined && num < min) onChange(min);
          else onChange(num);
        }
      }}
      className={
        "w-full rounded-md border border-gray-300 px-2 py-2 text-lg outline-none focus:ring-2 focus:ring-indigo-500 " +
        className
      }
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-gray-300 px-2 py-2 text-lg outline-none focus:ring-2 focus:ring-indigo-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Core Computation (payouts) ----------
function computeDeltas(holes: HoleState[], settings: Settings, playersAll: string[]) {
  const activeIdx: number[] = [];
  playersAll.forEach((p, i) => {
    if (p.trim() !== "") activeIdx.push(i);
  });
  const nPlayers = activeIdx.length;

  const deltas = holes.map(() => Array(nPlayers).fill(0));
  let carry = 0;

  for (let hi = 0; hi < holes.length; hi++) {
    const hole = holes[hi];

    const pRaw = hole.par;
    let par = 4;
    if (typeof pRaw === "number" && Number.isFinite(pRaw) && pRaw >= 3) par = pRaw;
    else if (typeof pRaw === "string" && pRaw.trim() !== "" && !Number.isNaN(Number(pRaw))) par = Math.max(3, Number(pRaw));

    const t1: number[] = [];
    const t2: number[] = [];
    for (let aj = 0; aj < nPlayers; aj++) {
      const oi = activeIdx[aj];
      const pick = hole.teamPicks[oi];
      if (pick === "T1") t1.push(aj);
      else if (pick === "T2") t2.push(aj);
    }

    const stakeForScore = (winningBest: number) => {
      const baseUnits = 1 + (settings.carryOver ? carry : 0);
      let mult = 1;
      const rel = winningBest - par;
      if (settings.eagleTriple && rel <= -2) mult = 3;
      else if (settings.birdieDouble && rel === -1) mult = 2;
      return settings.wager * baseUnits * mult;
    };

    const teamBest = (team: number[]) => {
      let best = Infinity;
      for (const aj of team) {
        const oi = activeIdx[aj];
        const s = hole.scores[oi];
        if (s !== "") {
          const v = Number(s);
          if (v < best) best = v;
        }
      }
      return best;
    };

    const onlyOneTeam = (t1.length > 0 && t2.length === 0) || (t2.length > 0 && t1.length === 0);
    if (onlyOneTeam) {
      const participants = t1.length ? t1 : t2;
      let best = Infinity;
      for (const aj of participants) {
        const oi = activeIdx[aj];
        const s = hole.scores[oi];
        if (s !== "") best = Math.min(best, Number(s));
      }
      if (!Number.isFinite(best)) continue;

      const bestList: number[] = [];
      for (const aj of participants) {
        const oi = activeIdx[aj];
        const s = hole.scores[oi];
        if (s !== "" && Number(s) === best) bestList.push(aj);
      }

      if (bestList.length !== 1) {
        if (settings.carryOver) carry += 1;
        continue;
      }

      const stake = stakeForScore(best);
      const winner = bestList[0];
      for (const aj of participants) {
        if (aj === winner) continue;
        deltas[hi][aj] -= stake;
        deltas[hi][winner] += stake;
      }
      carry = 0;
      continue;
    }

    if (t1.length === 0 || t2.length === 0) continue;

    const best1 = teamBest(t1);
    const best2 = teamBest(t2);
    if (!Number.isFinite(best1) || !Number.isFinite(best2)) continue;

    if (best1 === best2) {
      if (settings.carryOver) carry += 1;
      continue;
    }

    const winners = best1 < best2 ? t1 : t2;
    const losers  = best1 < best2 ? t2 : t1;
    const winningBest = Math.min(best1, best2);
    const stake = stakeForScore(winningBest);

    const W = winners.length;
    const L = losers.length;

    let perWinnerGain = W >= L ? stake : stake * (L / W);
    let perLoserLoss  = W >  L ? stake * (W / L) : stake;

    // --- NEW: Solo = Double ---
    if (settings.soloDouble && (W === 1 && L >= 2)) {
      perWinnerGain *= 2;
      perLoserLoss  *= 2;
    }

    for (const aj of winners) deltas[hi][aj] += perWinnerGain;
    for (const aj of losers)  deltas[hi][aj] -= perLoserLoss;

    carry = 0;
  }

  const totals = Array(nPlayers).fill(0);
  deltas.forEach((row) => row.forEach((v, i) => (totals[i] += v)));

  return { deltas, totals, activeIdx };
}

// ---------- App ----------
export default function SideBetsTracker() {
  const [players, setPlayers] = useState(["A", "B", "C", "D", ""]);
  const [settings, setSettings] = useState<Settings>({
    wager: 1,
    carryOver: true,
    soloDouble: false,   // NEW
    birdieDouble: true,
    eagleTriple: true,
  });
  const [holes, setHoles] = useState<HoleState[]>(
    Array.from({ length: 18 }, () => ({
      par: 4,
      teamPicks: ["Sit", "Sit", "Sit", "Sit", "Sit"],
      scores: ["", "", "", "", ""],
    }))
  );

  const [screen, setScreen] = useState<"setup" | "play" | "ledger">("setup");
  const [activeHole, setActiveHole] = useState(0);

  const { deltas, totals, activeIdx } = useMemo(
    () => computeDeltas(holes, settings, players),
    [holes, settings, players]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <h1 className="font-semibold">Side Bets Tracker</h1>
          {screen !== "setup" && (
            <button onClick={() => setScreen("setup")} className="text-sm">⚙️ Settings</button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl p-4">
        {screen === "setup" && (
          <SetupScreen
            players={players}
            setPlayers={setPlayers}
            settings={settings}
            setSettings={setSettings}
            holes={holes}
            setHoles={setHoles}
            onStart={() => setScreen("play")}
          />
        )}

        {screen === "play" && (
          <HoleEntry
            holeIndex={activeHole}
            players={players}
            hole={holes[activeHole]}
            onUpdate={(next) => setHoles((h) => h.map((x, i) => (i === activeHole ? next : x)))}
            onNext={() => setActiveHole((i) => Math.min(i + 1, 17))}
            onPrev={() => setActiveHole((i) => Math.max(i - 1, 0))}
            onLedger={() => setScreen("ledger")}
          />
        )}

        {screen === "ledger" && (
          <Ledger
            players={players}
            deltas={deltas}
            totals={totals}
            activeIdx={activeIdx}
            onBack={() => setScreen("play")}
          />
        )}
      </main>
    </div>
  );
}

// ---------- Setup Screen ----------
function SetupScreen({
  players,
  setPlayers,
  settings,
  setSettings,
  holes,
  setHoles,
  onStart,
}: {
  players: string[];
  setPlayers: React.Dispatch<React.SetStateAction<string[]>>;
  settings: Settings;
  setSettings: (s: Settings) => void;
  holes: HoleState[];
  setHoles: React.Dispatch<React.SetStateAction<HoleState[]>>;
  onStart: () => void;
}) {
  const [courseName, setCourseName] = useState("");
  const [savedCourses, setSavedCourses] = useState<{ name: string; pars: number[] }[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem("savedCourses");
    if (raw) {
      try {
        setSavedCourses(JSON.parse(raw));
      } catch {
        setSavedCourses([]);
      }
    }
  }, []);

  const saveCourse = () => {
    const name = courseName.trim();
    if (!name) return;
    const pars = holes.map((h) => (typeof h.par === "number" ? h.par : 4));
    const updated = [...savedCourses, { name, pars }];
    setSavedCourses(updated);
    localStorage.setItem("savedCourses", JSON.stringify(updated));
    setCourseName("");
  };

  const loadCourse = (pars: number[]) => {
    setHoles((h) =>
      h.map((x, i): HoleState => ({
        ...x,
        par: typeof pars[i] === "number" ? Math.max(3, pars[i]!) : 4,
      }))
    );
  };

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Match Setup</h2>

      <div>
        <Label>Wager / Hole ($)</Label>
        <NumberField
          value={settings.wager}
          step={0.5}
          min={0}
          onChange={(v) => setSettings({ ...settings, wager: v === "" ? 0 : Number(v) })}
        />
      </div>

      <div className="flex justify-between"><span>Carry Over</span><Toggle checked={settings.carryOver} onChange={(v) => setSettings({ ...settings, carryOver: v })} /></div>

      {/* NEW Solo = Double */}
      <div className="flex justify-between"><span>Solo = Double</span><Toggle checked={settings.soloDouble} onChange={(v) => setSettings({ ...settings, soloDouble: v })} /></div>

      <div className="flex justify-between"><span>Birdie = Double</span><Toggle checked={settings.birdieDouble} onChange={(v) => setSettings({ ...settings, birdieDouble: v })} /></div>
      <div className="flex justify-between"><span>Eagle = Triple</span><Toggle checked={settings.eagleTriple} onChange={(v) => setSettings({ ...settings, eagleTriple: v })} /></div>

      <h3 className="font-medium mt-4">Players (max 5)</h3>
      {players.map((p, i) => (
        <input
          key={i}
          type="text"
          value={p}
          onChange={(e) => {
            const next = [...players];
            next[i] = e.target.value;
            setPlayers(next);
          }}
          placeholder={`Player ${i + 1}`}
          className="w-full rounded-md border px-3 py-2 mb-2"
        />
      ))}

      <h3 className="font-medium mt-4">Course Setup (Par per Hole)</h3>
      {holes.map((h, i) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="w-16">Hole {i + 1}</span>
          <NumberField
            value={h.par}
            min={3}
            step={1}
            onChange={(v) =>
              setHoles((arr) => arr.map((x, hi) => (hi === i ? { ...x, par: v } : x)))
            }
          />
        </div>
      ))}

      <div className="mt-4">
        <Label>Save Course</Label>
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="Course Name"
            className="flex-1 rounded-md border px-3 py-2"
          />
          <button onClick={saveCourse} className="rounded-lg bg-indigo-600 text-white px-3 py-2">
            Save
          </button>
        </div>

        {savedCourses.length > 0 && (
          <div className="mt-3">
            <Label>Load Course</Label>
            <div className="space-y-1">
              {savedCourses.map((c, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <button
                    onClick={() => loadCourse(c.pars)}
                    className="flex-1 rounded border px-3 py-1 text-left hover:bg-gray-100"
                  >
                    {c.name}
                  </button>
                  <button
                    onClick={() => {
                      const updated = savedCourses.filter((_, i) => i !== idx);
                      setSavedCourses(updated);
                      localStorage.setItem("savedCourses", JSON.stringify(updated));
                    }}
                    className="text-xs text-red-600 underline"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button onClick={onStart} className="w-full rounded-lg bg-indigo-600 text-white py-2">
        Start Match
      </button>
    </div>
  );
}

// ---------- Hole Entry ----------
function HoleEntry({
  holeIndex,
  players,
  hole,
  onUpdate,
  onNext,
  onPrev,
  onLedger,
}: {
  holeIndex: number;
  players: string[];
  hole: HoleState;
  onUpdate: (h: HoleState) => void;
  onNext: () => void;
  onPrev: () => void;
  onLedger: () => void;
}) {
  // Random team generator
  const randomizeTeams = () => {
    const newTeams: TeamPick[] = players.map((p) => {
      if (!p.trim()) return "Sit";
      return Math.random() < 0.5 ? "T1" : "T2";
    });
    onUpdate({ ...hole, teamPicks: newTeams });
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow relative">
      {/* Header with hole number + randomize button */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">Hole {holeIndex + 1}</h2>
        <button
          onClick={randomizeTeams}
          className="rounded-lg bg-green-600 text-white px-3 py-1 text-sm hover:bg-green-700"
        >
          🎲 Randomize
        </button>
      </div>

      <div className="mb-4">
        <Label>Par</Label>
        <NumberField
          value={hole.par}
          min={3}
          step={1}
          onChange={(v) => onUpdate({ ...hole, par: v })}
        />
      </div>

      {players
        .filter((p) => p.trim())
        .map((p, i) => (
          <div key={i} className="mb-3">
            <span className="font-medium">{p}</span>
            <div className="flex gap-2 mt-1">
              <Select
                value={hole.teamPicks[i]}
                onChange={(val) => {
                  const tp = [...hole.teamPicks];
                  tp[i] = val as TeamPick;
                  onUpdate({ ...hole, teamPicks: tp });
                }}
                options={[
                  { label: "T1", value: "T1" },
                  { label: "T2", value: "T2" },
                  { label: "Sit", value: "Sit" },
                ]}
              />
              <NumberField
                value={hole.scores[i]}
                min={1}
                step={1}
                onChange={(v) => {
                  const sc = [...hole.scores];
                  sc[i] = v;
                  onUpdate({ ...hole, scores: sc });
                }}
              />
            </div>
          </div>
        ))}

      {/* Bottom navigation buttons */}
      <div className="flex justify-between mt-4">
        <button
          onClick={onPrev}
          disabled={holeIndex === 0}
          className="rounded-lg border px-4 py-2"
        >
          Prev
        </button>
        <button onClick={onLedger} className="rounded-lg border px-4 py-2">
          Ledger
        </button>
        <button
          onClick={onNext}
          disabled={holeIndex === 17}
          className="rounded-lg border px-4 py-2"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------- Ledger ----------
function Ledger({
  players,
  deltas,
  totals,
  activeIdx,
  onBack,
}: {
  players: string[];
  deltas: number[][];
  totals: number[];
  activeIdx: number[];
  onBack: () => void;
}) {
  const activeNames = activeIdx.map((oi) => players[oi]);

  return (
    <div className="rounded-xl border bg-white p-4 shadow">
      <h2 className="text-lg font-semibold mb-3">Ledger</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs mb-3 border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white text-left">Player</th>
              {deltas.map((_, hi) => (
                <th key={hi}>H{hi + 1}</th>
              ))}
              <th className="sticky right-0 bg-white">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeNames.map((p, pi) => (
              <tr key={pi}>
                <td className="sticky left-0 bg-white font-medium">{p}</td>
                {deltas.map((row, hi) => {
                  const d = row[pi] || 0;
                  return (
                    <td key={hi} className={d > 0 ? "text-green-600" : d < 0 ? "text-red-600" : ""}>
                      {d === 0 ? "$0" : (d > 0 ? "+$" : "-$") + Math.abs(d).toFixed(2)}
                    </td>
                  );
                })}
                <td
                  className={
                    totals[pi] > 0
                      ? "sticky right-0 bg-white text-green-600"
                      : totals[pi] < 0
                      ? "sticky right-0 bg-white text-red-600"
                      : "sticky right-0 bg-white"
                  }
                >
                  {totals[pi] === 0 ? "$0" : (totals[pi] > 0 ? "+$" : "-$") + Math.abs(totals[pi]).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onBack} className="rounded-lg border px-4 py-2">
        Back to Hole
      </button>
    </div>
  );
}

import React, { useMemo, useState, useEffect } from "react";

// Side Bets Tracker — Mobile-first with Setup Screen + Course Management + Random Teams + Sticky Ledger
// Includes inline sanity tests for payout math (console-only)

// ---------------- Types ----------------

type TeamPick = "T1" | "T2" | "Sit";

type Settings = {
  wager: number;
  carryOver: boolean;
  birdieDouble: boolean;
  eagleTriple: boolean;
};

type HoleState = {
  par: number;
  teamPicks: TeamPick[]; // length >= players
  scores: (number | "")[]; // length >= players
};

type Course = {
  name: string;
  pars: number[]; // 18 values
};

// ---------------- UI Primitives ----------------

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700">{children}</label>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={"relative inline-flex h-6 w-11 items-center rounded-full transition " + (checked ? "bg-green-600" : "bg-gray-300")}>
      <span className={"inline-block h-5 w-5 transform rounded-full bg-white transition " + (checked ? "translate-x-5" : "translate-x-1")} />
    </button>
  );
}

type NumberFieldProps = {
  value: number | "";
  step?: number;
  min?: number;
  onChange: (v: number | "") => void;
  className?: string;
  forceNumberType?: boolean;
};

function NumberField({
  value,
  step = 1,
  min,
  onChange,
  className = "",
  forceNumberType = false,
}: NumberFieldProps) {
  return (
    <input
      type={forceNumberType ? "number" : "tel"}
      inputMode="numeric"
      pattern="[0-9]*"
      step={step}
      min={min}
      value={value}
      onChange={(e) =>
        onChange(e.target.value === "" ? "" : Number(e.target.value))
      }
      className={
        "w-full rounded-md border border-gray-300 px-2 py-2 text-lg outline-none focus:ring-2 focus:ring-indigo-500 " +
        className
      }
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-lg outline-none focus:ring-2 focus:ring-indigo-500">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------------- Core Computation ----------------
// Payout logic (LOCKED):
// - Team mode: Each LOSER pays full baseStake; winners split the total pot equally.
// - Tie pays $0; if carryOver=true, carry += 1.
// - Individual mode (all-on-one-team): single low wins; each loser pays FULL baseStake to the winner; ties for low = push.
// - baseStake = wager × (1 + carryCount) × multiplier, multiplier = ×2 birdie, ×3 eagle (based on winning best score vs par).
function computeDeltas(holes: HoleState[], settings: Settings, players: string[]) {
  const activeIdx: number[] = [];
  players.forEach((p, i) => { if (p && p.trim()) activeIdx.push(i); });
  const nPlayers = activeIdx.length;

  const deltas = holes.map(() => Array(nPlayers).fill(0));
  let carry = 0;

  holes.forEach((hole, hi) => {
    const par = hole.par || 4;

    const t1: number[] = [];
    const t2: number[] = [];
    for (let aj = 0; aj < nPlayers; aj++) {
      const oi = activeIdx[aj];
      const pick = hole.teamPicks[oi];
      if (pick === "T1") t1.push(aj);
      else if (pick === "T2") t2.push(aj);
    }

    const computeBaseStake = (winningBest: number) => {
      const units = 1 + (settings.carryOver ? carry : 0);
      let multiplier = 1;
      const rel = winningBest - par;
      if (settings.eagleTriple && rel <= -2) multiplier = 3;
      else if (settings.birdieDouble && rel === -1) multiplier = 2;
      return settings.wager * units * multiplier;
    };

    // Individual mode (all on one team)
    const onlyOneTeam = (t1.length > 0 && t2.length === 0) || (t2.length > 0 && t1.length === 0);
    if (onlyOneTeam) {
      const participants = t1.length > 0 ? t1 : t2;
      const scores = participants.map((aj) => {
        const oi = activeIdx[aj];
        const s = hole.scores[oi];
        return s === "" ? Infinity : Number(s);
      });
      const best = Math.min(...scores);
      if (!isFinite(best)) return;

      const lowCompressed: number[] = [];
      for (let k = 0; k < participants.length; k++) if (scores[k] === best) lowCompressed.push(participants[k]);
      if (lowCompressed.length !== 1) {
        if (settings.carryOver) carry += 1;
        return;
      }

      const winner = lowCompressed[0];
      const losers = participants.filter((aj) => aj !== winner);
      const baseStake = computeBaseStake(best);

      losers.forEach((aj) => (deltas[hi][aj] -= baseStake));
      deltas[hi][winner] += baseStake * losers.length;

      carry = 0;
      return;
    }

    if (!t1.length || !t2.length) return;

    const bestOfTeam = (team: number[]) => {
      const vals = team.map((aj) => {
        const oi = activeIdx[aj];
        const s = hole.scores[oi];
        return s === "" ? Infinity : Number(s);
      });
      return Math.min(...vals);
    };

    const best1 = bestOfTeam(t1);
    const best2 = bestOfTeam(t2);
    if (!isFinite(best1) || !isFinite(best2)) return;

    if (best1 === best2) {
      if (settings.carryOver) carry += 1;
      return;
    }

    const winners = best1 < best2 ? t1 : t2;
    const losers  = best1 < best2 ? t2 : t1;
    const winningBest = Math.min(best1, best2);

    const baseStake = computeBaseStake(winningBest);
    if (!winners.length || !losers.length) return;

    // Payout with floor rules per spec:
    // - Each loser pays base × max(1, W/L)
    // - Each winner gets base × max(1, L/W)
    const W = winners.length;
    const L = losers.length;
    const perLoser = baseStake * (W > L ? W / L : 1);
    const perWinner = baseStake * (L > W ? L / W : 1);

    losers.forEach((aj) => (deltas[hi][aj] -= perLoser));
    winners.forEach((aj) => (deltas[hi][aj] += perWinner));

    carry = 0;
  });

  const totals = Array(nPlayers).fill(0);
  deltas.forEach((row) => row.forEach((v, i) => (totals[i] += v)));
  return { deltas, totals };
}

// ---------------- Dev Sanity Tests ----------------
function runComputeDeltasTests() {
  const S = (overrides: Partial<Settings> = {}): Settings => ({
    wager: 1,
    carryOver: true,
    birdieDouble: true,
    eagleTriple: true,
    ...overrides,
  });

  const H = (h: Partial<HoleState> = {}): HoleState => ({
    par: 4,
    teamPicks: ["T1", "T1", "T2", "T2", "Sit"],
    scores: [4, 4, 5, 5, ""],
    ...h,
  });

  // Test 1: Basic 2v2, $1, T1 wins by 1 → A:+1, B:+1, C:-1, D:-1
  {
    const players = ["A", "B", "C", "D", ""];
    const holes = [H()];
    const { totals } = computeDeltas(holes, S({ carryOver: true, birdieDouble: false, eagleTriple: false }), players);
    console.assert(
      Math.abs(totals[0] - 1) < 1e-6 && Math.abs(totals[1] - 1) < 1e-6 && Math.abs(totals[2] + 1) < 1e-6 && Math.abs(totals[3] + 1) < 1e-6,
      "Test 1 failed (2v2 basic)"
    );
  }

  // Test 2: Carry after tie, then 1v2 with par → base=2, losers pay 2 each, winner gets 4
  {
    const players = ["A", "B", "C", "D", ""];
    const holes: HoleState[] = [
      H({ scores: [4, 4, 4, 4, ""], teamPicks: ["T1", "T1", "T2", "T2", "Sit"] }), // tie → carry=1
      H({ par: 4, teamPicks: ["T1", "Sit", "T2", "T2", "Sit"], scores: [4, "", 5, 6, ""] }), // A (T1) wins vs C+D
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble: false, eagleTriple: false }), players);
    console.assert(
      Math.abs(totals[0] - 4) < 1e-6 && Math.abs(totals[2] + 2) < 1e-6 && Math.abs(totals[3] + 2) < 1e-6,
      "Test 2 failed (carry + 1v2 with fixed-per-loser)"
    );
  }

  // Test 3: Individual mode, A beats B/C/D/E; 2 carries + birdie → base=6; A +24, others -6
  {
    const players = ["A", "B", "C", "D", "E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1", "T1", "T1", "T1", "T1"], scores: [4, 4, 4, 4, 4] }, // tie → carry 1
      { par: 4, teamPicks: ["T1", "T1", "T1", "T1", "T1"], scores: [5, 5, 5, 5, 5] }, // tie → carry 2
      { par: 4, teamPicks: ["T1", "T1", "T1", "T1", "T1"], scores: [3, 4, 4, 4, 4] }, // A birdie wins
    ];
    const { totals } = computeDeltas(holes, S(), players);
    console.assert(
      Math.abs(totals[0] - 24) < 1e-6 && [1, 2, 3, 4].every((i) => Math.abs(totals[i] + 6) < 1e-6),
      "Test 3 failed (individual mode with carries + birdie)"
    );
  }

  // Test 4: Individual mode, no carry, birdie double → A +8, others -2
  {
    const players = ["A", "B", "C", "D", "E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T1","T1","T1"], scores: [3,4,4,4,4] },
    ];
    const { totals } = computeDeltas(holes, S({ carryOver: true, birdieDouble: true, eagleTriple: true }), players);
    console.assert(
      Math.abs(totals[0] - 8) < 1e-6 && [1,2,3,4].every(i => Math.abs(totals[i] + 2) < 1e-6),
      "Test 4 failed (individual mode, birdie double no carry)"
    );
  }

  // Test 5: Individual mode with one SIT (exclude sits). A wins vs B/C/D; E sits → A +6, B/C/D -2 each, E 0
  {
    const players = ["A", "B", "C", "D", "E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T1","T1","Sit"], scores: [3,4,4,4,""] },
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble: true, eagleTriple: false, carryOver: false }), players);
    console.assert(
      Math.abs(totals[0] - 6) < 1e-6 && [1,2,3].every(i => Math.abs(totals[i] + 2) < 1e-6) && Math.abs(totals[4] - 0) < 1e-6,
      "Test 5 failed (individual mode excluding sits)"
    );
  }

  // Test 6: Uneven teams with carry + birdie — A&B vs C/D/E, carry=1, A birdie → base=4; C/D/E -4 each; A/B +6 each
  {
    const players = ["A","B","C","D","E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T2","T2","T2"], scores: [4,5,4,5,5] }, // tie → best1=4, best2=4 → carry=1
      { par: 4, teamPicks: ["T1","T1","T2","T2","T2"], scores: [3,5,4,5,5] }, // A birdie wins for T1
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble: true, eagleTriple: true, carryOver: true }), players);
    console.assert(
      Math.abs(totals[0] - 6) < 1e-6 && Math.abs(totals[1] - 6) < 1e-6 && [2,3,4].every(i => Math.abs(totals[i] + 4) < 1e-6),
      "Test 6 failed (team uneven with carry + birdie double)"
    );
  }

  // Test 7: Example 1 (no carry, no multiplier) — A&B vs C/D/E → A:+1.5, B:+1.5, C/D/E:-1 each
  {
    const players = ["A","B","C","D","E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T2","T2","T2"], scores: [4,5,5,5,5] },
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble:false, eagleTriple:false, carryOver:false }), players);
    console.assert(
      Math.abs(totals[0] - 1.5) < 1e-6 && Math.abs(totals[1] - 1.5) < 1e-6 && [2,3,4].every(i=>Math.abs(totals[i] + 1) < 1e-6),
      "Test 7 failed (AB vs CDE no carry)"
    );
  }

  // Test 8: Example 2 (no carry, no multiplier) — A/B/C vs D/E → A/B/C:+1 each; D/E:-1.5 each
  {
    const players = ["A","B","C","D","E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T1","T2","T2"], scores: [4,4,4,5,5] },
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble:false, eagleTriple:false, carryOver:false }), players);
    console.assert(
      [0,1,2].every(i=>Math.abs(totals[i] - 1) < 1e-6) && [3,4].every(i=>Math.abs(totals[i] + 1.5) < 1e-6),
      "Test 8 failed (ABC vs DE no carry)"
    );
  }

  // Test 9: Example 3 (EMF no carry) — A wins vs B/C/D/E → A:+4; others:-1 each
  {
    const players = ["A","B","C","D","E"];
    const holes: HoleState[] = [
      { par: 4, teamPicks: ["T1","T1","T1","T1","T1"], scores: [4,5,5,5,5] },
    ];
    const { totals } = computeDeltas(holes, S({ birdieDouble:true, eagleTriple:true, carryOver:false }), players);
    console.assert(
      Math.abs(totals[0] - 4) < 1e-6 && [1,2,3,4].every(i=>Math.abs(totals[i] + 1) < 1e-6),
      "Test 9 failed (EMF no carry)"
    );
  }
}

// ---------------- Main Component ----------------
export default function SideBetsTracker() {
  const [players, setPlayers] = useState(["A", "B", "C", "D", ""]);
  const [settings, setSettings] = useState<Settings>({ wager: 1, carryOver: true, birdieDouble: true, eagleTriple: true });
  const [holes, setHoles] = useState<HoleState[]>(Array.from({ length: 18 }, () => ({ par: 4, teamPicks: ["Sit","Sit","Sit","Sit","Sit"], scores: ["","","","",""] })));

  // Course management
  const [courseName, setCourseName] = useState("");
  const [savedCourses, setSavedCourses] = useState<Course[]>(() => {
    try {
      const raw = localStorage.getItem("savedCourses");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem("savedCourses", JSON.stringify(savedCourses)); } catch {}
  }, [savedCourses]);

  const { deltas, totals } = useMemo(() => computeDeltas(holes, settings, players), [holes, settings, players]);

  const [screen, setScreen] = useState<"setup" | "play" | "ledger">("setup");
  const [activeHole, setActiveHole] = useState(0);

  // Run inline tests once (dev only)
  useEffect(() => {
    try {
      if (!(window as any).__SIDE_BETS_TESTED__) {
        runComputeDeltasTests();
        (window as any).__SIDE_BETS_TESTED__ = true;
      }
    } catch {}
  }, []);

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
            courseName={courseName}
            setCourseName={setCourseName}
            savedCourses={savedCourses}
            setSavedCourses={setSavedCourses}
            onStart={() => setScreen("play")}
          />
        )}
        {screen === "play" && (
          <HoleEntry
            holeIndex={activeHole}
            players={players}
            hole={holes[activeHole]}
            onUpdate={(next) => setHoles((h) => h.map((x,i) => i===activeHole?next:x))}
            onNext={() => setActiveHole((i)=>Math.min(i+1,17))}
            onPrev={() => setActiveHole((i)=>Math.max(i-1,0))}
            onLedger={() => setScreen("ledger")}
          />
        )}
        {screen === "ledger" && (
          <Ledger players={players} deltas={deltas} totals={totals} onBack={() => setScreen("play")} />
        )}
      </main>
    </div>
  );
}

// ---------------- Setup Screen ----------------
function SetupScreen({ players, setPlayers, settings, setSettings, holes, setHoles, courseName, setCourseName, savedCourses, setSavedCourses, onStart }: { players: string[]; setPlayers: (p: string[])=>void; settings: Settings; setSettings: (s: Settings)=>void; holes: HoleState[]; setHoles: (h: HoleState[])=>void; courseName: string; setCourseName: (s: string)=>void; savedCourses: Course[]; setSavedCourses: (c: Course[])=>void; onStart: ()=>void }) {
  return (
    <div className="space-y-4 rounded-xl border bg-white p-4 shadow">
      <h2 className="text-lg font-semibold">Match Setup</h2>
      <div>
        <Label>Wager / Hole ($)</Label>
        <NumberField value={settings.wager} step={0.5} min={0} onChange={(v)=>setSettings({...settings, wager: v===""?0:Number(v)})} />
      </div>
      <div className="flex justify-between"><span>Carry Over</span><Toggle checked={settings.carryOver} onChange={(v)=>setSettings({...settings, carryOver:v})} /></div>
      <div className="flex justify-between"><span>Birdie = Double</span><Toggle checked={settings.birdieDouble} onChange={(v)=>setSettings({...settings, birdieDouble:v})} /></div>
      <div className="flex justify-between"><span>Eagle = Triple</span><Toggle checked={settings.eagleTriple} onChange={(v)=>setSettings({...settings, eagleTriple:v})} /></div>

      <h3 className="font-medium mt-4">Players (max 5)</h3>
      {players.map((p,i)=>(
        <input key={i} type="text" value={p} onChange={(e)=>{const next=[...players]; next[i]=e.target.value; setPlayers(next);}} placeholder={`Player ${i+1}`} className="w-full rounded-md border px-3 py-2 mb-2" />
      ))}

      <h3 className="font-medium mt-4">Course Setup (Par per Hole)</h3>
      <input type="text" value={courseName} onChange={(e)=>setCourseName(e.target.value)} placeholder="Course Name" className="w-full rounded-md border px-3 py-2 mb-2" />
      <div className="grid grid-cols-6 gap-2 text-sm">
        {holes.map((h,hi)=>(
          <div key={hi} className="flex flex-col items-center">
            <span className="text-xs">H{hi+1}</span>
            <NumberField value={h.par} min={3} step={1} onChange={(v)=>{
              const newHoles=[...holes];
              newHoles[hi] = {...newHoles[hi], par: v===""?4:Number(v)};
              setHoles(newHoles);
            }} />
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-2">
        <button onClick={()=>{
          if (!courseName.trim()) return;
          const newCourse: Course = { name: courseName, pars: holes.map(h=>h.par) };
          setSavedCourses([...savedCourses.filter(c=>c.name!==courseName), newCourse]);
        }} className="flex-1 rounded-lg border px-3 py-2">💾 Save Course</button>
        <select className="flex-1 rounded-lg border px-3 py-2" value="" onChange={(e)=>{
          const c = savedCourses.find(x=>x.name===e.target.value);
          if (c){
            setCourseName(c.name);
            const newHoles = holes.map((h,hi)=>({...h, par: c.pars[hi]}));
            setHoles(newHoles);
          }
        }}>
          <option value="">Load Course</option>
          {savedCourses.map((c)=>(<option key={c.name} value={c.name}>{c.name}</option>))}
        </select>
      </div>

      <button onClick={onStart} className="w-full rounded-lg bg-indigo-600 text-white py-2 mt-4">Start Match</button>
    </div>
  );
}

// ---------------- Hole Entry ----------------
function HoleEntry({ holeIndex, players, hole, onUpdate, onNext, onPrev, onLedger }: { holeIndex:number; players:string[]; hole:HoleState; onUpdate:(h:HoleState)=>void; onNext:()=>void; onPrev:()=>void; onLedger:()=>void; }) {
  function randomizeTeams(){
    // Assign every active player randomly to T1 or T2; empty player slots remain Sit. Scores remain untouched.
    const newTeams: TeamPick[] = hole.teamPicks.map((_, i) => {
      return players[i] && players[i].trim() ? (Math.random() < 0.5 ? "T1" as TeamPick : "T2" as TeamPick) : "Sit";
    });
    onUpdate({ ...hole, teamPicks: newTeams });
  }

  return (
    <div className="rounded-xl border bg-white p-4 shadow">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Hole {holeIndex+1}</h2>
        <button onClick={randomizeTeams} className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm">🎲 Randomize Teams</button>
      </div>
      <div className="mb-4"><Label>Par</Label><NumberField value={hole.par} min={3} step={1} onChange={(v)=>onUpdate({...hole, par:v===""?4:Number(v)})}/></div>
      {players.map((p,i)=> p && p.trim() ? (
        <div key={i} className="mb-3">
          <span className="font-medium">{p}</span>
          <div className="flex gap-2 mt-1">
            <Select value={hole.teamPicks[i]} onChange={(val)=>{const tp=[...hole.teamPicks]; tp[i]=val as TeamPick; onUpdate({...hole, teamPicks:tp});}} options={[{label:"T1", value:"T1"},{label:"T2", value:"T2"},{label:"Sit", value:"Sit"}]} />
            <NumberField value={hole.scores[i]} min={1} step={1} onChange={(v)=>{const sc=[...hole.scores]; sc[i]=v; onUpdate({...hole, scores:sc});}} />
          </div>
        </div>
      ) : null)}
      <div className="flex justify-between mt-4">
        <button onClick={onPrev} disabled={holeIndex===0} className="rounded-lg border px-4 py-2">Prev</button>
        <button onClick={onLedger} className="rounded-lg border px-4 py-2">Ledger</button>
        <button onClick={onNext} disabled={holeIndex===17} className="rounded-lg border px-4 py-2">Next</button>
      </div>
    </div>
  );
}

// ---------------- Ledger ----------------
function Ledger({ players, deltas, totals, onBack }: { players:string[]; deltas:number[][]; totals:number[]; onBack:()=>void }) {
  const activePlayers = players.filter((p) => p && p.trim());
  return (
    <div className="rounded-xl border bg-white p-4 shadow">
      <h2 className="text-lg font-semibold mb-3">Ledger</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs min-w-full">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white p-2 text-left">Player</th>
              {deltas.map((_,hi)=>(
                <th key={hi} className="p-2 text-center whitespace-nowrap">H{hi+1}</th>
              ))}
              <th className="sticky right-0 z-10 bg-white p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {activePlayers.map((p,pi)=>{
              return (
                <tr key={pi}>
                  <td className="sticky left-0 z-10 bg-white p-2 font-medium">{p}</td>
                  {deltas.map((row,hi)=>{
                    const d = row[pi] || 0;
                    return (
                      <td key={hi} className={"p-2 text-center whitespace-nowrap "+(d>0?"text-green-600":d<0?"text-red-600":"text-gray-600")}>{d===0?"$0":(d>0?"+$":"-$")+Math.abs(d).toFixed(2)}</td>
                    );
                  })}
                  <td className={"sticky right-0 z-10 bg-white p-2 text-right "+(totals[pi]>0?"text-green-600":totals[pi]<0?"text-red-600":"text-gray-600")}>{totals[pi]===0?"$0":(totals[pi]>0?"+$":"-$")+Math.abs(totals[pi]).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={onBack} className="mt-3 rounded-lg border px-4 py-2">Back to Hole</button>
    </div>
  );
}

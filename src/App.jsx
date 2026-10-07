import { useState, useMemo, useRef, useEffect } from "react";

const LS_KEY = "pm_tracker_v2";
function loadState(init) {
  try { const s = localStorage.getItem(LS_KEY); return s ? { ...init, ...JSON.parse(s), onboardingDone: JSON.parse(s).onboardingDone ?? false } : init; }
  catch { return init; }
}
function saveState(st) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch {}
}

/* ─── RYSER-PERMANENTE (korrekte Vorzeichen für alle n) ─── */
function ryserPerm(M) {
  const n = M.length;
  if (n === 0) return 1;
  let total = 0;
  for (let S = 1; S < (1 << n); S++) {
    const cols = [];
    for (let j = 0; j < n; j++) if ((S >> j) & 1) cols.push(j);
    let prod = 1;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const j of cols) s += M[i][j];
      prod *= s;
      if (prod === 0) break;
    }
    // Korrektes Vorzeichen: (-1)^|S|
    total += (cols.length & 1 ? -1 : 1) * prod;
  }
  // Abschließender Faktor: (-1)^n
  return (n & 1 ? -1 : 1) * total;
}

/* ─── WAHRSCHEINLICHKEIT (mit Paarungen aus Matching Nights) ─── */
function calcProbs(frauen, maenner, matchboxen, matchingNights, extraConf = [], doppelmatches = []) {
  // ── Setup: active participants ──
  const allConf = [...matchboxen.filter(m => m.ergebnis === "match"), ...extraConf.filter(a => !a.typ || a.typ === "match")];
  const cF = new Set(allConf.map(m => m.frauId));
  const cM = new Set(allConf.map(m => m.mannId));
  doppelmatches.forEach(d => { if (d.gender === "frau") cF.add(d.personId); else cM.add(d.personId); });

  const excl = new Set(matchboxen.filter(m => m.ergebnis === "kein_match").map(m => `${m.frauId}|${m.mannId}`));
  const confirmedCount = allConf.length;

  // Licht=0-Nights → alle Paarungen dieser Night ausschliessen
  (matchingNights || []).forEach(night => {
    if ((night.lichter - confirmedCount) <= 0) {
      (night.paarungen || []).forEach(p => {
        if (!cF.has(p.frauId) && !cM.has(p.mannId)) excl.add(`${p.frauId}|${p.mannId}`);
      });
    }
  });
  // Kein-Match-Annahmen auch ausschliessen
  extraConf.filter(a => a.typ === "kein_match").forEach(a => excl.add(`${a.frauId}|${a.mannId}`));

  const aF = frauen.filter(f => !cF.has(f.id));
  const aM = maenner.filter(m => !cM.has(m.id));
  const nF = aF.length, nM = aM.length, n = Math.max(nF, nM);
  if (!n) return { probs: {}, aF, aM, confirmed: allConf, impossible: false };

  // ── Night constraints: exact pair count per night ──
  // Build set of confirmed pair keys for quick lookup
  const confPairKeys = new Set(allConf.map(c => `${c.frauId}|${c.mannId}`));

  const constraints = (matchingNights || [])
    .map(night => {
      // Only subtract confirmed matches that ACTUALLY APPEARED in this night
      const confInThisNight = (night.paarungen || []).filter(p => confPairKeys.has(`${p.frauId}|${p.mannId}`)).length;
      const needed = Math.max(0, night.lichter - confInThisNight);
      // Only consider active unconfirmed pairs in this night
      const activePairs = (night.paarungen || [])
        .filter(p => !confPairKeys.has(`${p.frauId}|${p.mannId}`)) // skip already confirmed
        .map(p => {
          const fi = aF.findIndex(f => f.id === p.frauId && !(f.eintrittNachNight >= night.nummer));
          const mi = aM.findIndex(m => m.id === p.mannId && !(m.eintrittNachNight >= night.nummer));
          return (fi >= 0 && mi >= 0) ? fi * 100 + mi : -1;
        })
        .filter(x => x >= 0);
      if (activePairs.length === 0 && needed === 0) return null;
      if (activePairs.length === 0) return null;
      return { needed, pairs: new Set(activePairs), total: activePairs.length };
    })
    .filter(Boolean);

  // ── Backtracking with constraint propagation ──
  const pairHits = {}; // "fi|mi" → count of valid assignments where this pair appears
  let total = 0;
  const colUsed = new Array(n).fill(false);
  const assign = new Array(n).fill(-1);
  const nightCounts = new Array(constraints.length).fill(0);

  function bt(row) {
    if (row === n) {
      // Verify all night constraints exactly
      for (let t = 0; t < constraints.length; t++) {
        if (nightCounts[t] !== constraints[t].needed) return;
      }
      total++;
      for (let i = 0; i < nF; i++) {
        if (assign[i] < nM) {
          const k = `${i}|${assign[i]}`;
          pairHits[k] = (pairHits[k] || 0) + 1;
        }
      }
      return;
    }

    for (let col = 0; col < n; col++) {
      if (colUsed[col]) continue;
      // Real pair: check exclusions
      if (row < nF && col < nM && excl.has(`${aF[row].id}|${aM[col].id}`)) continue;

      // Update night counts
      const delta = [];
      let feasible = true;
      const encKey = row * 100 + col;

      for (let t = 0; t < constraints.length; t++) {
        const hit = (row < nF && col < nM && constraints[t].pairs.has(encKey)) ? 1 : 0;
        const newCount = nightCounts[t] + hit;
        const remaining = n - row - 1;
        const needed = constraints[t].needed - newCount;

        // Prune: can't get enough correct pairs or already too many
        if (needed < 0 || needed > remaining) { feasible = false; break; }

        // Additional pruning: max possible hits in remaining rows
        // (conservative: assume all remaining active pairs in this night hit)
        delta.push(hit);
      }

      if (!feasible) continue;

      // Apply delta
      for (let t = 0; t < constraints.length; t++) nightCounts[t] += delta[t];
      colUsed[col] = true;
      assign[row] = col;

      bt(row + 1);

      // Rollback
      for (let t = 0; t < constraints.length; t++) nightCounts[t] -= delta[t];
      colUsed[col] = false;
      assign[row] = -1;
    }
  }

  bt(0);

  if (total === 0) return { probs: {}, aF, aM, confirmed: allConf, impossible: true };

  const probs = {};
  for (let i = 0; i < nF; i++) {
    for (let j = 0; j < nM; j++) {
      const key = `${aF[i].id}|${aM[j].id}`;
      const k = `${i}|${j}`;
      probs[key] = Math.round((pairHits[k] || 0) / total * 100);
    }
  }

  return { probs, aF, aM, confirmed: allConf, impossible: false };
}

const uid = () => Math.random().toString(36).slice(2, 9);
const firstName = name => name.split(" ")[0].slice(0, 6);

/* ─── SOFT LUXURY DESIGN SYSTEM ─── */
const C = {
  bg:     "#fef9f0",
  surf:   "#ffffff",
  brd:    "#e8d5b0",
  brd2:   "rgba(212,83,126,0.18)",
  pink:   "#d4537e", pinkD: "rgba(212,83,126,0.10)",
  gold:   "#b8860b", goldD: "rgba(184,134,11,0.10)",
  goldL:  "#c8920a",
  blue:   "#4a72a0", blueD: "rgba(74,114,160,0.10)",
  green:  "#4a8c6a", greenD: "rgba(74,140,106,0.10)",
  red:    "#c0392b", redD: "rgba(192,57,43,0.10)",
  purple: "#7b5ea0", purpleD: "rgba(123,94,160,0.10)",
  brown:  "#3a2000",
  cream:  "#fef9f0",
  warm:   "#b89a6a",
  txt:    "#2a1500",
  mut:    "rgba(42,21,0,0.45)",
};
const GR  = (a,b)   => `linear-gradient(135deg,${a},${b})`;
const GR3 = (a,b,c) => `linear-gradient(135deg,${a},${b},${c})`;
const MESH = `radial-gradient(ellipse at 20% 10%, rgba(212,83,126,0.07) 0%, transparent 55%),
  radial-gradient(ellipse at 85% 80%, rgba(184,134,11,0.06) 0%, transparent 50%),
  #fef9f0`;
const LUXURY = GR3(C.pink, "#b8506e", C.goldL);
const shadow = () => `0 2px 12px rgba(42,21,0,0.07), 0 1px 0 rgba(255,255,255,0.9) inset`;

/* ─── PRIMITIVES ─── */
const Card = ({ children, acc, sx = {} }) => (
  <div style={{
    background: C.surf,
    border: `1px solid ${acc || C.brd}`,
    borderRadius: 18,
    padding: 18,
    boxShadow: shadow(),
    ...sx
  }}>{children}</div>
);
const GlassCard = ({ children, sx = {} }) => (
  <div style={{
    background: "rgba(254,249,240,0.85)",
    border: `1px solid ${C.brd}`,
    borderRadius: 18,
    padding: 18,
    boxShadow: shadow(),
    ...sx
  }}>{children}</div>
);
const Pill = ({ children, col, solid }) => (
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: "3px 11px", borderRadius: 99, fontSize: 11, fontWeight: 600,
    background: solid ? col : `${col}18`,
    color: solid ? "#fff" : col,
    border: `1px solid ${col}33`,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: "0.03em",
  }}>{children}</span>
);
const Btn = ({ children, onClick, v = "pri", sm, dis, full, sx = {} }) => {
  const vs = {
    pri:    { background: LUXURY, color: "#fff", border: "none", boxShadow: "0 3px 14px rgba(212,83,126,0.30)" },
    ghost:  { background: "#fff", color: C.brown, border: `1px solid ${C.brd}`, boxShadow: shadow() },
    gold:   { background: GR(C.goldL, C.gold), color: "#fff", border: "none", boxShadow: "0 3px 12px rgba(184,134,11,0.25)" },
    danger: { background: C.redD, color: C.red, border: `1px solid ${C.red}33` },
    purple: { background: GR(C.purple, "#5d3f8a"), color: "#fff", border: "none", boxShadow: "0 3px 12px rgba(123,94,160,0.25)" },
  };
  return <button onClick={onClick} disabled={dis} style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: sm ? "7px 16px" : "12px 22px",
    borderRadius: 12, cursor: dis ? "not-allowed" : "pointer",
    fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: sm ? 13 : 14, fontWeight: 600,
    opacity: dis ? 0.38 : 1, width: full ? "100%" : "auto",
    letterSpacing: "0.015em",
    ...vs[v], ...sx
  }}>{children}</button>;
};
const inputStyle = { width: "100%", boxSizing: "border-box", background: "#fffdf7", border: `1px solid ${C.brd}`, borderRadius: 11, padding: "11px 14px", color: C.txt, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14, outline: "none" };
const Inp = ({ val, set, ph, tp = "text", sx = {} }) => (
  <input value={val} type={tp} onChange={e => set(e.target.value)} placeholder={ph} style={{ ...inputStyle, ...sx }} />
);
const Sel = ({ val, set, dis, children }) => (
  <select value={val} onChange={e => set(e.target.value)} disabled={dis}
    style={{ ...inputStyle, color: val ? C.txt : C.mut, cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.45 : 1 }}>{children}</select>
);
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={{ display: "block", fontSize: 11, color: C.mut, marginBottom: 6, fontWeight: 800, letterSpacing: "0.08em" }}>{label.toUpperCase()}</label>}
    {children}
  </div>
);

/* ─── APP ICON (Herz + Kreuztabelle) ─── */
const AppIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" style={{ display: "block", flexShrink: 0 }}>
    <defs>
      <clipPath id="hclip">
        <path d="M36 62 C36 62 8 44 8 24 C8 14 16 8 24 8 C29 8 33.5 10.5 36 14.5 C38.5 10.5 43 8 48 8 C56 8 64 14 64 24 C64 44 36 62 36 62Z"/>
      </clipPath>
    </defs>
    <path d="M36 62 C36 62 8 44 8 24 C8 14 16 8 24 8 C29 8 33.5 10.5 36 14.5 C38.5 10.5 43 8 48 8 C56 8 64 14 64 24 C64 44 36 62 36 62Z"
      fill="rgba(255,31,114,0.13)" stroke="#ff1f72" strokeWidth="2.5"/>
    <g clipPath="url(#hclip)" opacity="0.45">
      {[27,37,47].map(y => <line key={y} x1="8" y1={y} x2="64" y2={y} stroke="#ff1f72" strokeWidth="0.9"/>)}
      {[23,36,49].map(x => <line key={x} x1={x} y1="8" x2={x} y2="62" stroke="#ff1f72" strokeWidth="0.9"/>)}
    </g>
    <g clipPath="url(#hclip)">
      <rect x="23" y="27" width="13" height="10" rx="2.5" fill="#00906a"/>
      <rect x="36" y="37" width="13" height="10" rx="2.5" fill="#00906a" opacity="0.85"/>
      <rect x="10" y="37" width="13" height="10" rx="2.5" fill="#ff1f72" opacity="0.75"/>
      <rect x="36" y="17" width="13" height="10" rx="2.5" fill="#e08800" opacity="0.85"/>
    </g>
  </svg>
);

/* ─── BEST GUESS MATCHING ─── */
function bestGuessMatching(frauen, maenner, probs, confirmed, doppelmatches) {
  // Start with confirmed matches
  const result = confirmed.map(c => ({ frauId: c.frauId, mannId: c.mannId, prob: 100, status: "confirmed" }));
  const usedF = new Set(confirmed.map(c => c.frauId));
  const usedM = new Set(confirmed.map(c => c.mannId));
  // Doppelmatch exits: person left, their match unknown → skip them
  const dmF = new Set((doppelmatches||[]).filter(d=>d.gender==="frau").map(d=>d.personId));
  const dmM = new Set((doppelmatches||[]).filter(d=>d.gender==="mann").map(d=>d.personId));

  // Build candidates
  const candidates = [];
  frauen.forEach(f => {
    if (usedF.has(f.id) || dmF.has(f.id)) return;
    maenner.forEach(m => {
      if (usedM.has(m.id) || dmM.has(m.id)) return;
      const key = `${f.id}|${m.id}`;
      const p = probs?.[key] ?? 0;
      candidates.push({ frauId: f.id, mannId: m.id, prob: p, status: p === 0 ? "excluded" : "guess" });
    });
  });
  candidates.sort((a, b) => b.prob - a.prob);

  // Greedy max-weight matching
  for (const c of candidates) {
    if (!usedF.has(c.frauId) && !usedM.has(c.mannId) && c.prob > 0) {
      result.push(c);
      usedF.add(c.frauId);
      usedM.add(c.mannId);
    }
  }
  return result;
}

function BestGuess({ st, pd }) {
  const { probs, confirmed } = pd;
  if (!probs || Object.keys(probs).length === 0) return null;

  const matches = bestGuessMatching(
    st.teilnehmer.frauen, st.teilnehmer.maenner,
    probs, confirmed || [], st.doppelmatches || []
  );
  if (matches.length === 0) return null;

  const total = matches.length;
  const avgConf = Math.round(matches.filter(m=>m.status!=="confirmed").reduce((s,m)=>s+m.prob,0) / Math.max(1,matches.filter(m=>m.status!=="confirmed").length));
  const confident = matches.filter(m => m.prob >= 60 && m.status !== "confirmed").length;

  return (
    <Card sx={{ marginBottom: 14, border: `1.5px solid ${C.brd2}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, fontStyle: "italic", color: C.brown, fontWeight: 600 }}>Meine aktuelle Vermutung</div>
          <div style={{ fontSize: 11, color: C.warm, marginTop: 2 }}>Basierend auf Night-Paarungen & Matchbox-Ergebnissen</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.pink }}>{avgConf}%</div>
          <div style={{ fontSize: 10, color: C.warm }}>ø Konfidenz</div>
        </div>
      </div>

      {matches.map((m, i) => {
        const f = st.teilnehmer.frauen.find(x => x.id === m.frauId);
        const ma = st.teilnehmer.maenner.find(x => x.id === m.mannId);
        const isConf = m.status === "confirmed";
        const col = isConf ? C.green : m.prob >= 60 ? C.pink : m.prob >= 35 ? C.gold : C.warm;
        const bg  = isConf ? C.greenD : m.prob >= 60 ? C.pinkD : m.prob >= 35 ? C.goldD : "#f9f5ef";

        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 12, background: bg, marginBottom: 6, border: `1px solid ${col}33` }}>
            <div style={{ fontSize: 13, color: C.warm, fontWeight: 700, width: 20, flexShrink: 0, textAlign: "center" }}>{i+1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: C.pink }}>{f?.name?.split(" ")[0]}</span>
                <span style={{ color: C.warm, margin: "0 6px" }}>+</span>
                <span style={{ color: C.blue }}>{ma?.name?.split(" ")[0]}</span>
              </div>
              {!isConf && (
                <div style={{ height: 4, borderRadius: 2, background: "rgba(0,0,0,0.08)", marginTop: 5 }}>
                  <div style={{ height: "100%", width: `${m.prob}%`, background: col, borderRadius: 2, transition: "width 0.5s" }} />
                </div>
              )}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {isConf
                ? <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ Match</span>
                : <span style={{ fontSize: 16, fontWeight: 800, color: col }}>{m.prob}%</span>
              }
            </div>
          </div>
        );
      })}

      {matches.length < 10 && (
        <div style={{ fontSize: 11, color: C.warm, textAlign: "center", marginTop: 6, fontStyle: "italic" }}>
          {10 - matches.length} Paarung{10-matches.length>1?"en":""} noch offen – mehr Daten helfen!
        </div>
      )}
      <div style={{ fontSize: 11, color: C.warm, textAlign: "center", marginTop: 8, padding: "8px 0 0", borderTop: `1px solid ${C.brd}`, fontStyle: "italic" }}>
        💡 Je mehr Matchbox-Ergebnisse und Nights, desto präziser wird die Vermutung.
      </div>
    </Card>
  );
}

/* ─── TOP PAARE ─── */
function TopPaare({ st }) {
  const pd = useMemo(() =>
    calcProbs(st.teilnehmer.frauen, st.teilnehmer.maenner, st.matchboxen, st.matchingNights),
    [st]
  );
  if (!pd.probs || Object.keys(pd.probs).length === 0) return null;
  if (st.matchingNights.length === 0 && st.matchboxen.length === 0) return null;

  // Collect all active pairs sorted by probability
  const pairs = [];
  pd.aF.forEach(f => {
    pd.aM.forEach(m => {
      const key = `${f.id}|${m.id}`;
      const p = pd.probs[key] ?? 0;
      if (p > 0) pairs.push({ f, m, p, key });
    });
  });
  pairs.sort((a, b) => b.p - a.p);
  const top = pairs.slice(0, 5);
  if (top.length === 0) return null;

  // Pair counts from nights
  const pairCounts = {};
  st.matchingNights.forEach(n => (n.paarungen || []).forEach(p => {
    const k = `${p.frauId}|${p.mannId}`;
    pairCounts[k] = (pairCounts[k] || 0) + 1;
  }));

  return (
    <Card acc={`${C.pink}33`} sx={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.pink, marginBottom: 10 }}>🔥 Wahrscheinlichste Paare</div>
      {top.map(({ f, m, p, key }, i) => {
        const cnt = pairCounts[key] || 0;
        const barCol = p >= 60 ? "#005c38" : p >= 35 ? "#7a5000" : C.mut;
        const barBg = p >= 60 ? "#d4f5e8" : p >= 35 ? "#fff0cc" : "#f5f5f5";
        return (
          <div key={key} style={{ marginBottom: 10, padding: "9px 12px", borderRadius: 12, background: barBg, border: `1px solid ${barCol}22` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#999", width: 16 }}>#{i+1}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  <span style={{ color: C.pink }}>{f.name.split(" ")[0]}</span>
                  <span style={{ color: C.mut, margin: "0 4px" }}>+</span>
                  <span style={{ color: C.blue }}>{m.name.split(" ")[0]}</span>
                </span>
                {cnt > 0 && <span style={{ fontSize: 11, color: C.blue, background: C.blueD, padding: "1px 7px", borderRadius: 99, fontWeight: 600 }}>{cnt}× zusammen</span>}
              </div>
              <span style={{ fontWeight: 800, fontSize: 16, color: barCol }}>{p}%</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(0,0,0,0.08)" }}>
              <div style={{ height: "100%", width: `${p}%`, background: barCol, borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>Basierend auf Matchbox-Ergebnissen & Matching Night Paarungen</div>
    </Card>
  );
}

/* ─── HOME ─── */
function Home({ st, onShowOnboarding, setPage, pd }) {
  const conf = st.matchboxen.filter(m => m.ergebnis === "match");
  const lastNight = st.matchingNights[st.matchingNights.length - 1];
  const canAddNight = st.matchboxen.length > st.matchingNights.length || (st.matchingNights.length === 0 && st.matchboxen.length === 0);
  const nextStep = canAddNight ? { icon: "🌙", lbl: "Matching Night eintragen", tab: "nights", col: C.pink } : { icon: "📦", lbl: "Matchbox eintragen", tab: "matchbox", col: C.gold };

  // Mini Kreuztabelle data
  const pairCounts = {};
  st.matchingNights.forEach(n => (n.paarungen || []).forEach(p => {
    const k = `${p.frauId}|${p.mannId}`; pairCounts[k] = (pairCounts[k] || 0) + 1;
  }));
  const mbStatus = {};
  st.matchboxen.forEach(mb => { mbStatus[`${mb.frauId}|${mb.mannId}`] = mb.ergebnis; });
  const hasData = st.matchingNights.length > 0 || st.matchboxen.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "20px 0 18px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <AppIcon size={64} />
        </div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 26, margin: "0 0 4px", background: GR3(C.pink, "#ff8800", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }}>Are You The One</h1>
        <p style={{ color: C.warm, fontSize: 12, margin: "0 0 12px", fontFamily: "'Cormorant Garamond',Georgia,serif", letterSpacing: "0.08em" }}>Staffel 6 &nbsp;·&nbsp; Von Sabrina</p>
        <button onClick={onShowOnboarding} style={{ background: "none", border: `1px solid ${C.brd}`, borderRadius: 99, padding: "4px 12px", fontSize: 11, color: C.mut, cursor: "pointer", fontFamily: "inherit" }}>❓ Anleitung</button>
      </div>

      {/* A) Nächster Schritt */}
      <button onClick={() => setPage(nextStep.tab)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 18px", borderRadius: 14, background: LUXURY, border: "none", cursor: "pointer", marginBottom: 14, boxShadow: "0 4px 16px rgba(212,83,126,0.28)", fontFamily: "inherit" }}>
        <span style={{ fontSize: 28 }}>{nextStep.icon}</span>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 600, letterSpacing: "0.05em" }}>NÄCHSTER SCHRITT</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{nextStep.lbl}</div>
        </div>
        <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.7)", fontSize: 20 }}>→</span>
      </button>

      {/* B) Stats – kompakt */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
        {[
          { lbl: "Matches", val: conf.length, icon: "💚", col: C.green },
          { lbl: "Nights", val: `${st.matchingNights.length}/10`, icon: "🌙", col: C.pink },
          { lbl: "Lichter", val: lastNight?.lichter ?? "–", icon: "💡", col: C.gold },
          { lbl: "Matchboxen", val: st.matchboxen.length, icon: "📦", col: C.blue },
        ].map(s => (
          <div key={s.lbl} style={{ background: `linear-gradient(145deg,#fff,${s.col}12)`, border: `1.5px solid ${s.col}33`, borderRadius: 14, padding: "10px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 18 }}>{s.icon}</div>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, fontWeight: 700, color: s.col, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* C) Bestätigte Matches */}
      {conf.length > 0 && (
        <Card acc={`${C.green}44`} sx={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8 }}>💕 Perfect Matches</div>
          {conf.map(m => {
            const f = st.teilnehmer.frauen.find(x => x.id === m.frauId);
            const ma = st.teilnehmer.maenner.find(x => x.id === m.mannId);
            return <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: `1px solid ${C.brd}`, fontSize: 13 }}>
              <span style={{ color: C.pink, fontWeight: 700 }}>{f?.name}</span>
              <span style={{ color: C.pink }}>💕</span>
              <span style={{ color: C.blue, fontWeight: 700 }}>{ma?.name}</span>
            </div>;
          })}
        </Card>
      )}

      {/* D) Letzte Night */}
      {lastNight && (
        <Card sx={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, marginBottom: 8 }}>🌙 LETZTE MATCHING NIGHT (Night {lastNight.nummer})</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Pill col={C.gold}>💡 {lastNight.lichter} Lichter</Pill>
            {(() => { const cu = lastNight.lichter - conf.length; return cu > 0 ? <Pill col={C.green}>{cu} korrekt</Pill> : <Pill col={C.red}>alle ✗</Pill>; })()}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(lastNight.paarungen || []).map((p, i) => {
              const f = st.teilnehmer.frauen.find(x => x.id === p.frauId);
              const m = st.teilnehmer.maenner.find(x => x.id === p.mannId);
              const isMatch = conf.some(c => c.frauId === p.frauId && c.mannId === p.mannId);
              return <span key={i} style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: isMatch ? "#b8f0d8" : "#f0edf9", color: isMatch ? "#005c38" : C.txt, border: `1px solid ${isMatch ? "#00906a33" : C.brd}` }}>
                {isMatch ? "✅ " : ""}{f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]}
              </span>;
            })}
          </div>
        </Card>
      )}

      {/* E) Top 5 Paare */}

      {/* F) Mini-Kreuztabelle */}
      {hasData && (
        <Card sx={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mut }}>🔢 ÜBERSICHT</div>
            <button onClick={() => setPage("analyse")} style={{ fontSize: 11, color: C.pink, background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>Vollständig →</button>
          </div>
          <Kreuztabelle
            frauen={st.teilnehmer.frauen}
            maenner={st.teilnehmer.maenner}
            pairCounts={pairCounts}
            mbStatus={mbStatus}
            annahmen={[]}
            nightExclSet={new Set()}
            interactive={false}
          />
        </Card>
      )}
    </div>
  );
}

/* ─── SETUP ─── */
function Setup({ st, setSt }) {
  const [fn, setFn] = useState(""); const [mn, setMn] = useState("");
  const add = (g, name, clr) => { if (!name.trim()) return; setSt(s => ({ ...s, teilnehmer: { ...s.teilnehmer, [g]: [...s.teilnehmer[g], { id: uid(), name: name.trim() }] } })); clr(""); };
  const rm = (g, id) => setSt(s => ({ ...s, teilnehmer: { ...s.teilnehmer, [g]: s.teilnehmer[g].filter(p => p.id !== id) } }));
  const Col = ({ g, col, icon, v, sv }) => (
    <Card sx={{ flex: 1, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: col, marginBottom: 12 }}>{icon} {g === "frauen" ? "Frauen" : "Männer"} ({st.teilnehmer[g].length})</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <Inp val={v} set={sv} ph="Name…" sx={{ flex: 1 }} />
        <Btn onClick={() => add(g, v, sv)} sm sx={{ flexShrink: 0 }}>＋</Btn>
      </div>
      {st.teilnehmer[g].map(p => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 8, background: `${col}0d`, marginBottom: 4, border: `1px solid ${col}22` }}>
          <span style={{ fontSize: 13 }}>{p.name}</span>
          <button onClick={() => rm(g, p.id)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
      ))}
    </Card>
  );
  const diff = st.teilnehmer.frauen.length - st.teilnehmer.maenner.length;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <Col g="frauen" col={C.pink} icon="👩" v={fn} sv={setFn} />
        <Col g="maenner" col={C.blue} icon="👨" v={mn} sv={setMn} />
      </div>
      {diff !== 0 && <div style={{ padding: "10px 16px", background: C.goldD, border: `1px solid ${C.gold}44`, borderRadius: 12, color: C.gold, fontSize: 13 }}>
        ⚠️ {Math.abs(diff)} Extra-{Math.abs(diff) === 1 ? "Person" : "Personen"} – Doppelmatch möglich.
      </div>}
    </div>
  );
}

/* ─── MATCHING NIGHTS ─── */
function MatchingNights({ st, setSt }) {
  const [open, setOpen] = useState(false);
  const [lichter, setLichter] = useState("");
  const [paare, setPaare] = useState({}); // chooserId → pickedId
  const [waehler, setWaehler] = useState("frauen");

  const conf = st.matchboxen.filter(m => m.ergebnis === "match");
  const dmExits = st.doppelmatches || [];
  const dmFIds = new Set(dmExits.filter(d => d.gender === "frau").map(d => d.personId));
  const dmMIds = new Set(dmExits.filter(d => d.gender === "mann").map(d => d.personId));
  const cF = new Set([...conf.map(m => m.frauId), ...dmFIds]);
  const cM = new Set([...conf.map(m => m.mannId), ...dmMIds]);
  const currentNightNr = st.matchingNights.length + 1;
  const aF = st.teilnehmer.frauen.filter(f => !cF.has(f.id) && !(f.eintrittNachNight >= currentNightNr));
  const aM = st.teilnehmer.maenner.filter(m => !cM.has(m.id) && !(m.eintrittNachNight >= currentNightNr));
  const choosers = waehler === "frauen" ? aF : aM;
  const pool = waehler === "frauen" ? aM : aF;
  const pickedPool = new Set(Object.values(paare).filter(Boolean));

  // Flow: Night only after a Matchbox (matchboxen.length > matchingNights.length)
  const canAddNight = st.matchboxen.length > st.matchingNights.length || st.matchingNights.length === 0 && st.matchboxen.length === 0;

  const toggle = (chooserId, pickedId) =>
    setPaare(p => ({ ...p, [chooserId]: p[chooserId] === pickedId ? "" : pickedId }));

  const save = () => {
    if (lichter === "") return;
    const paarungen = Object.entries(paare).filter(([, v]) => v).map(([cId, pId]) =>
      waehler === "frauen" ? { frauId: cId, mannId: pId } : { frauId: pId, mannId: cId }
    );
    setSt(s => ({ ...s, matchingNights: [...s.matchingNights, { id: uid(), nummer: s.matchingNights.length + 1, paarungen, lichter: +lichter, waehler }] }));
    setOpen(false); setLichter(""); setPaare({});
  };
  const rm = id => setSt(s => ({ ...s, matchingNights: s.matchingNights.filter(n => n.id !== id).map((n, i) => ({ ...n, nummer: i + 1 })) }));

  return (
    <div>
      {st.matchingNights.map(night => {
        // korrekte unbestätigte = Lichter - ausgezogene Matches
        const unconf = night.lichter - conf.length;
        return (
          <Card key={night.id} sx={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: night.paarungen.length ? 8 : 0 }}>
              <div>
                <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 16 }}>🌙 Night {night.nummer}</span>
                <span style={{ marginLeft: 7, fontSize: 11, color: C.mut }}>{night.waehler === "frauen" ? "Frauen wählen" : "Männer wählen"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Pill col={C.gold}>💡 {night.lichter}</Pill>
                {unconf <= 0 && night.paarungen.length > 0
                  ? <Pill col={C.red}>alle ✗</Pill>
                  : unconf > 0 ? <Pill col={C.green}>{unconf} korrekt</Pill> : null}
                <button onClick={() => rm(night.id)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 3px" }}>×</button>
              </div>
            </div>
            {night.paarungen.length > 0 && (
              <div>
                {/* Light count summary */}
                {(() => {
                  // Only count confirmed pairs that were IN THIS night
                  const confInNight = conf.filter(c => night.paarungen.some(p => p.frauId===c.frauId && p.mannId===c.mannId)).length;
                  const cu = Math.max(0, night.lichter - confInNight);
                  const annMatch = (st.annahmen||[]).filter(a =>
                    night.paarungen.some(p => p.frauId===a.frauId && p.mannId===a.mannId) &&
                    (!a.typ||a.typ==="match")
                  ).length;
                  return cu > 0 ? (
                    <div style={{ fontSize: 11, marginBottom: 6, fontWeight: annMatch > cu ? 700 : 400, color: annMatch > cu ? C.red : C.warm }}>
                      {annMatch > cu
                        ? `❌ Zu viele! Nur ${cu} korrekte Paarung${cu!==1?"en":""} möglich, du hast ${annMatch} markiert.`
                        : <>{annMatch} von {cu} noch unbestätigten Lichtern als ★ markiert{annMatch === cu && <span style={{ color: C.green, fontWeight: 700 }}> · ✅ vollständig!</span>}</>
                      }
                    </div>
                  ) : null;
                })()}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>

                  {night.paarungen.map((p, i) => {
                    const f = st.teilnehmer.frauen.find(x => x.id === p.frauId);
                    const m = st.teilnehmer.maenner.find(x => x.id === p.mannId);
                    const isConfirmed = conf.some(c => c.frauId === p.frauId && c.mannId === p.mannId);
                    const isMbKeinMatch = st.matchboxen.some(mb => mb.ergebnis==="kein_match" && mb.frauId===p.frauId && mb.mannId===p.mannId);
                    const ann = (st.annahmen||[]).find(a => a.frauId===p.frauId && a.mannId===p.mannId);
                    const isAnnMatch = ann && (!ann.typ || ann.typ==="match");
                    const isAnnKein  = isMbKeinMatch || (ann && ann.typ==="kein_match");

                    // Auto-exclude: Person ist anderswo als Perfect Match bestätigt oder ★ markiert
                    const fConfTaken = conf.some(c => c.frauId===p.frauId && c.mannId!==p.mannId);
                    const mConfTaken = conf.some(c => c.mannId===p.mannId && c.frauId!==p.frauId);
                    const fAnnTaken  = (st.annahmen||[]).some(a => a.frauId===p.frauId && a.mannId!==p.mannId && (!a.typ||a.typ==="match"));
                    const mAnnTaken  = (st.annahmen||[]).some(a => a.mannId===p.mannId && a.frauId!==p.frauId && (!a.typ||a.typ==="match"));
                    const takenF = fConfTaken || fAnnTaken;
                    const takenM = mConfTaken || mAnnTaken;
                    const isAutoExcl = !isAnnMatch && !isConfirmed && (takenF || takenM);

                    let bg, col, brd, prefix;
                    if (isConfirmed)   { bg="#b8f0d8"; col="#005c38"; brd="#00906a44"; prefix="✅ "; }
                    else if (isAnnMatch)  { bg="#e0f0ff"; col="#0060b0"; brd="#3b82f644"; prefix="★ "; }
                    else if (isAnnKein)   { bg="#ffc0c8"; col="#9a0018"; brd="#ef444444"; prefix="✗ "; }
                    else if (isAutoExcl)  { bg="#fef0f0"; col="#ccaaa0"; brd="#e0c0bc44"; prefix="✕ "; }
                    else               { bg="#f9f5ef"; col=C.mut; brd=C.brd; prefix=""; }

                    const clickable = !isConfirmed && !isAutoExcl && !isMbKeinMatch;
                    return (
                      <span key={i}
                        onClick={() => {
                          if (!clickable) return;
                          setSt(s => {
                            const ann2 = s.annahmen || [];
                            const ex = ann2.find(a => a.frauId===p.frauId && a.mannId===p.mannId);
                            if (!ex)                return { ...s, annahmen: [...ann2, { frauId: p.frauId, mannId: p.mannId, typ: "match" }] };
                            if (ex.typ==="match")   return { ...s, annahmen: ann2.map(a => a.frauId===p.frauId&&a.mannId===p.mannId ? {...a,typ:"kein_match"} : a) };
                            return { ...s, annahmen: ann2.filter(a => !(a.frauId===p.frauId&&a.mannId===p.mannId)) };
                          });
                        }}
                        style={{ padding: "5px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: bg, border: `1px solid ${brd}`, color: col, cursor: clickable ? "pointer" : "default", userSelect: "none", transition: "all 0.15s", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {prefix}{f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {/* Flow enforcement */}
      {!canAddNight && !open && (
        <div style={{ padding: "10px 14px", background: "#ffe8a0", border: `1px solid ${C.gold}55`, borderRadius: 12, fontSize: 13, color: "#7a5000", marginBottom: 10 }}>
          📦 Zuerst Matchbox-Ergebnis eintragen, dann Night {st.matchingNights.length + 1}.
        </div>
      )}

      {!open ? (
        <Btn onClick={() => setOpen(true)} dis={!canAddNight || st.matchingNights.length >= 10 || !st.teilnehmer.frauen.length}>
          ＋ Matching Night {st.matchingNights.length + 1} eintragen
        </Btn>
      ) : (
        <Card acc={`${C.pink}44`}>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 19, marginBottom: 12 }}>
            🌙 Night {st.matchingNights.length + 1}
          </div>

          {/* Wer wählt */}
          <div style={{ display: "flex", background: "#ffe8ee", borderRadius: 10, padding: 3, gap: 3, marginBottom: 14 }}>
            {[{ v: "frauen", lbl: "👩 Frauen wählen" }, { v: "maenner", lbl: "👨 Männer wählen" }].map(opt => (
              <button key={opt.v} onClick={() => { setWaehler(opt.v); setPaare({}); }}
                style={{ flex: 1, padding: "8px 6px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, border: "none", background: waehler === opt.v ? (opt.v === "frauen" ? C.pink : C.blue) : "transparent", color: waehler === opt.v ? "#fff" : C.mut, transition: "all 0.15s" }}>
                {opt.lbl}
              </button>
            ))}
          </div>

          {/* Lichter – Zahlen antippen */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, letterSpacing: "0.05em", marginBottom: 6 }}>💡 WIE VIELE LICHTER LEUCHTEN?</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {Array.from({ length: Math.max(aF.length, aM.length) + 1 }, (_, i) => i).map(n => {
                const sel = lichter === String(n);
                return (
                  <button key={n} onClick={() => setLichter(String(n))}
                    style={{ width: 38, height: 38, borderRadius: 9, border: `2px solid ${sel ? C.gold : C.brd}`, background: sel ? "#ffe8a0" : "#fafafa", fontWeight: 700, fontSize: 15, color: sel ? "#7a5000" : C.mut, cursor: "pointer", fontFamily: "inherit", transition: "all 0.12s" }}>
                    {n}
                  </button>
                );
              })}
            </div>
            {lichter !== "" && (
              <div style={{ marginTop: 6, fontSize: 12, color: +lichter < conf.length ? C.red : C.mut }}>
                {+lichter < conf.length
                  ? `⚠️ Widerspruch: ${conf.length} bestätigte Matches, aber nur ${lichter} Lichter!`
                  : `Inkl. ${conf.length} ausgezogene${conf.length !== 1 ? "" : "s"} Paar${conf.length !== 1 ? "e" : ""} → ${Math.max(0, +lichter - conf.length)} davon noch aktiv`}
              </div>
            )}
          </div>

          {/* Paarungen – Dropdown pro wählende Person */}
          <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, letterSpacing: "0.05em", marginBottom: 8 }}>
            {waehler === "frauen" ? "👩 PAARUNGEN EINTRAGEN" : "👨 PAARUNGEN EINTRAGEN"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
            {choosers.map(ch => {
              const picked = paare[ch.id];
              const chooserCol = waehler === "frauen" ? C.pink : C.blue;
              return (
                <div key={ch.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 80, flexShrink: 0, fontSize: 13, fontWeight: 700, color: picked ? chooserCol : C.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ch.name.split(" ")[0]}
                  </div>
                  <select value={picked || ""} onChange={e => toggle(ch.id, e.target.value)}
                    style={{ flex: 1, background: picked ? "#d4f5e8" : "#fff8f6", border: `1.5px solid ${picked ? C.green : C.brd}`, borderRadius: 9, padding: "7px 10px", color: picked ? "#005c38" : C.mut, fontFamily: "inherit", fontSize: 13, fontWeight: picked ? 700 : 400, outline: "none", cursor: "pointer" }}>
                    <option value="">– wählen –</option>
                    {pool.map(p => (
                      <option key={p.id} value={p.id} disabled={pickedPool.has(p.id) && picked !== p.id}>
                        {p.name}{pickedPool.has(p.id) && picked !== p.id ? " ✗" : ""}
                      </option>
                    ))}
                  </select>
                  {picked && <button onClick={() => toggle(ch.id, "")} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>}
                </div>
              );
            })}
          </div>

          {/* Confirmed matches still count as lights */}
          {conf.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: C.greenD, borderRadius: 12, border: `1px solid ${C.green}44` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 6 }}>✅ Ausgezogene Paare – leuchten weiterhin ({conf.length} Licht{conf.length>1?"er":""})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {conf.map(mb => {
                  const f = st.teilnehmer.frauen.find(x => x.id === mb.frauId);
                  const m = st.teilnehmer.maenner.find(x => x.id === mb.mannId);
                  return <span key={mb.id} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 99, background: "#b8f0d8", color: "#005c38", fontWeight: 600, border: "1px solid #00906a33" }}>
                    {f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]}
                  </span>;
                })}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={save} dis={lichter === ""}>Speichern</Btn>
            <Btn onClick={() => { setOpen(false); setLichter(""); setPaare({}); }} v="ghost">Abbrechen</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─── MATCHBOXEN ─── */
function Matchboxen({ st, setSt }) {
  const [open, setOpen] = useState(false);
  const [fId, setFId] = useState(""); const [mId, setMId] = useState(""); const [erg, setErg] = useState("");
  const [dmId, setDmId] = useState(""); const [dmGender, setDmGender] = useState("");
  const conf = st.matchboxen.filter(m => m.ergebnis === "match");
  const dmExits = st.doppelmatches || [];
  const cF = new Set([...conf.map(m => m.frauId), ...dmExits.filter(d => d.gender === "frau").map(d => d.personId)]);
  const cM = new Set([...conf.map(m => m.mannId), ...dmExits.filter(d => d.gender === "mann").map(d => d.personId)]);
  const aF = st.teilnehmer.frauen.filter(f => !cF.has(f.id));
  const aM = st.teilnehmer.maenner.filter(m => !cM.has(m.id));
  const sold = new Set(st.matchboxen.filter(m => m.ergebnis === "verkauft").map(m => `${m.frauId}|${m.mannId}`));
  const availM = aM.filter(m => !sold.has(`${fId}|${m.id}`));
  // Für Doppelmatch: alle aktiven Personen ausser den gerade gewählten
  const dmCandidatesFrauen = st.teilnehmer.frauen.filter(f => !cF.has(f.id) && f.id !== fId);
  const dmCandidatesMaenner = st.teilnehmer.maenner.filter(m => !cM.has(m.id) && m.id !== mId);
  const save = () => {
    if (!fId || !mId || !erg) return;
    const newMb = { id: uid(), nummer: st.matchboxen.length + 1, frauId: fId, mannId: mId, ergebnis: erg };
    const newDm = (erg === "match" && dmId && dmGender) ? [...(st.doppelmatches || []), { id: uid(), personId: dmId, gender: dmGender, matchboxId: newMb.id }] : (st.doppelmatches || []);
    setSt(s => ({ ...s, matchboxen: [...s.matchboxen, newMb], doppelmatches: newDm }));
    setOpen(false); setFId(""); setMId(""); setErg(""); setDmId(""); setDmGender("");
  };
  const rm = id => setSt(s => ({ ...s, matchboxen: s.matchboxen.filter(m => m.id !== id).map((m, i) => ({ ...m, nummer: i + 1 })) }));
  const EC = { match: { lbl: "💚 Match!", col: C.green }, kein_match: { lbl: "❌ Kein Match", col: C.red }, verkauft: { lbl: "💰 Verkauft", col: C.gold } };
  return (
    <div>
      {st.matchboxen.map(mb => {
        const f = st.teilnehmer.frauen.find(x => x.id === mb.frauId);
        const m = st.teilnehmer.maenner.find(x => x.id === mb.mannId);
        const cfg = EC[mb.ergebnis];
        return <Card key={mb.id} acc={`${cfg.col}44`} sx={{ marginBottom: 10, background: `${cfg.col}07`, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: C.mut, marginBottom: 3, fontWeight: 700, letterSpacing: "0.05em" }}>MATCHBOX {mb.nummer}</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}><span style={{ color: C.pink }}>{f?.name}</span><span style={{ color: C.mut, margin: "0 8px" }}>×</span><span style={{ color: C.blue }}>{m?.name}</span></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill col={cfg.col}>{cfg.lbl}</Pill>
              <button onClick={() => rm(mb.id)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
          </div>
          {mb.ergebnis === "verkauft" && <div style={{ marginTop: 8, fontSize: 12, color: C.gold }}>⚠️ Dieses Paar kann nie wieder in eine Matchbox.</div>}
          {mb.ergebnis === "match" && <div style={{ marginTop: 8, fontSize: 12, color: C.green }}>✅ Ausgezogen – leuchten weiterhin als Licht.</div>}
          {mb.ergebnis === "match" && (() => {
            const dm = (st.doppelmatches || []).find(d => d.matchboxId === mb.id);
            if (!dm) return null;
            const p = dm.gender === "frau" ? st.teilnehmer.frauen.find(x => x.id === dm.personId) : st.teilnehmer.maenner.find(x => x.id === dm.personId);
            return <div style={{ marginTop: 4, fontSize: 12, color: C.pink }}>💔 Doppelmatch: {p?.name} ausgezogen</div>;
          })()}
        </Card>;
      })}
      {!open ? (
        <Btn onClick={() => setOpen(true)} dis={!aF.length || !aM.length}>＋ Matchbox eintragen</Btn>
      ) : (
        <Card acc={`${C.gold}66`}>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, marginBottom: 18 }}>📦 Neue Matchbox</div>
          <Field label="Frau"><Sel val={fId} set={v => { setFId(v); setMId(""); }}>
            <option value="">– Frau wählen –</option>
            {aF.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Sel></Field>
          <Field label="Mann">
            <Sel val={mId} set={setMId} dis={!fId}>
              <option value="">– Mann wählen –</option>
              {availM.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Sel>
            {fId && aM.length !== availM.length && <div style={{ fontSize: 11, color: C.mut, marginTop: 5 }}>Verkaufte Paare ausgeblendet</div>}
          </Field>
          <Field label="Ergebnis">
            <div style={{ display: "flex", gap: 8 }}>
              {Object.entries(EC).map(([k, cfg]) => (
                <button key={k} onClick={() => setErg(k)} style={{ flex: 1, padding: "10px 6px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, border: `2px solid ${erg === k ? cfg.col : C.brd}`, background: erg === k ? `${cfg.col}15` : "#fff8f6", color: erg === k ? cfg.col : C.mut, transition: "all 0.15s" }}>{cfg.lbl}</button>
              ))}
            </div>
          </Field>
          {/* Doppelmatch */}
          {erg === "match" && (
            <div style={{ marginBottom: 14, padding: "12px 14px", background: "#fff0f5", borderRadius: 12, border: `1px solid ${C.pink}33` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.pink, marginBottom: 8 }}>💔 Doppelmatch?</div>
              <div style={{ fontSize: 12, color: C.mut, marginBottom: 10 }}>
                War eine weitere Person in dieses Match involviert? Diese Person zieht dann ebenfalls aus – ohne bestätigtes Match.
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[{ v: "", lbl: "Kein Doppelmatch" }, { v: "frau", lbl: "👩 Frau" }, { v: "mann", lbl: "👨 Mann" }].map(opt => (
                  <button key={opt.v} onClick={() => { setDmGender(opt.v); setDmId(""); }}
                    style={{ flex: 1, padding: "7px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, border: `2px solid ${dmGender === opt.v ? C.pink : C.brd}`, background: dmGender === opt.v ? C.pinkD : "#fff", color: dmGender === opt.v ? C.pink : C.mut }}>
                    {opt.lbl}
                  </button>
                ))}
              </div>
              {dmGender === "frau" && (
                <Sel val={dmId} set={setDmId}>
                  <option value="">– Frau wählen –</option>
                  {dmCandidatesFrauen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Sel>
              )}
              {dmGender === "mann" && (
                <Sel val={dmId} set={setDmId}>
                  <option value="">– Mann wählen –</option>
                  {dmCandidatesMaenner.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Sel>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={save} dis={!fId || !mId || !erg} v="gold">Speichern</Btn>
            <Btn onClick={() => { setOpen(false); setFId(""); setMId(""); setErg(""); setDmId(""); setDmGender(""); }} v="ghost">Abbrechen</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─── KREUZTABELLE ─── */
function Kreuztabelle({ frauen, maenner, pairCounts, mbStatus, annahmen = [], nightExclSet = new Set(), dmExitIds = new Set(), onToggle, interactive = false }) {
  const annSet = new Set(annahmen.map(a => `${a.frauId}|${a.mannId}`));

  // Confirmed real matches
  const matchedFrau = {}, matchedMann = {};
  Object.entries(mbStatus).forEach(([key, val]) => {
    if (val === "match") { const [fId, mId] = key.split("|"); matchedFrau[fId] = mId; matchedMann[mId] = fId; }
  });

  // In interactive mode: annahmen also "block" a row/col
  const annFrau = {}, annMann = {};
  if (interactive) {
    annahmen.forEach(a => { annFrau[a.frauId] = a.mannId; annMann[a.mannId] = a.frauId; });
  }

  const getCell = (fId, mId) => {
    const key = `${fId}|${mId}`;
    const status = mbStatus[key];
    const cnt = pairCounts[key] || 0;
    const isAnn = annSet.has(key);

    // Bestätigtes Match
    if (status === "match")
      return { bg: "#b8f0d8", col: "#005c38", brd: "#00906a", txt: "✓", dim: false, click: false };

    // Frau/Mann durch echtes Match vergeben
    if (matchedFrau[fId] || matchedMann[mId])
      return { bg: "#eeeeee", col: "#aaaaaa", brd: "#cccccc", txt: "✕", dim: true, click: false };

    // Diese Zelle IST die Annahme
    if (interactive && isAnn) {
      const aTyp = annahmen.find(a => a.frauId===fId&&a.mannId===mId)?.typ;
      if (aTyp === "kein_match") return { bg: "#ffc0c8", col: "#9a0018", brd: "#d4001e", txt: "✗", dim: false, click: true };
      return { bg: "#e0c8ff", col: "#5500aa", brd: "#7a00cc", txt: "★", dim: false, click: true };
    }

    // Frau/Mann durch Annahme vergeben → ausgelöscht
    if (interactive && (annFrau[fId] || annMann[mId]))
      return { bg: "#f0eeff", col: "#aaaaaa", brd: "#cccccc", txt: "✕", dim: true, click: false };

    if (status === "kein_match")
      return { bg: "#ffc0c8", col: "#9a0018", brd: "#d4001e", txt: "✗", dim: false, click: false };

    if (status === "verkauft" && !isAnn)
      return { bg: "#ffe8a0", col: "#7a5000", brd: "#e08800", txt: "€", dim: false, click: interactive };

    if (status === "verkauft" && isAnn)
      return { bg: "#e0c8ff", col: "#5500aa", brd: "#7a00cc", txt: "★€", dim: false, click: true };

    if (nightExclSet.has(key))
      return { bg: "#ffdde2", col: "#c0003a", brd: "#ff8099", txt: "–", dim: false, click: false };

    if (cnt > 0)
      return { bg: "#cce4ff", col: "#003d99", brd: "#0066cc", txt: String(cnt), dim: false, click: interactive };

    return { bg: "#fafafa", col: "#bbbbbb", brd: "#e0e0e0", txt: "", dim: false, click: interactive };
  };

  const W = 32, NW = 64;
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: NW + maenner.length * W }}>
        {/* Header */}
        <div style={{ display: "flex", marginBottom: 3 }}>
          <div style={{ width: NW, flexShrink: 0 }} />
          {maenner.map(m => (
            <div key={m.id} style={{ width: W, flexShrink: 0, textAlign: "center", fontSize: 9, fontWeight: 700,
              color: dmExitIds.has(m.id) ? "#ccc" : matchedMann[m.id] ? "#aaa" : C.blue,
              padding: "2px 1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              textDecoration: (matchedMann[m.id] || dmExitIds.has(m.id)) ? "line-through" : "none",
              opacity: dmExitIds.has(m.id) ? 0.4 : 1 }}>
              {firstName(m.name)}
            </div>
          ))}
        </div>
        {/* Rows */}
        {frauen.map(f => {
          const isDmExitRow = dmExitIds.has(f.id);
          return (
          <div key={f.id} style={{ display: "flex", marginBottom: 2, opacity: isDmExitRow ? 0.38 : 1 }}>
            <div style={{ width: NW, flexShrink: 0, fontSize: 9, fontWeight: 700,
              color: isDmExitRow ? "#bbb" : matchedFrau[f.id] ? "#aaa" : C.pink,
              textAlign: "right", paddingRight: 5, display: "flex", alignItems: "center", justifyContent: "flex-end",
              textDecoration: (matchedFrau[f.id] || isDmExitRow) ? "line-through" : "none",
              overflow: "hidden", whiteSpace: "nowrap" }}>
              {firstName(f.name)}
            </div>
            {maenner.map(m => {
              const isDmExitCol = dmExitIds.has(m.id);
              const c = (isDmExitRow || isDmExitCol)
                ? { bg: "#f5f5f5", col: "#ccc", brd: "#e0e0e0", txt: "", dim: true, click: false }
                : getCell(f.id, m.id);
              return (
                <div key={m.id}
                  onClick={() => c.click && !c.dim && !isDmExitRow && !isDmExitCol && onToggle && onToggle(f.id, m.id)}
                  style={{ width: W - 2, height: W - 2, flexShrink: 0, margin: "0 1px", borderRadius: 5, background: c.bg, border: `1px solid ${c.brd}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: c.col, cursor: c.click && !c.dim ? "pointer" : "default", userSelect: "none", opacity: c.dim ? 0.4 : 1 }}>
                  {c.txt}
                </div>
              );
            })}
          </div>
        );})}
      </div>
    </div>
  );
}

/* ─── PROBABILITY BARS ─── */
function ProbBars({ probs, prevProbs, cps, sel, gender, confirmed, cF, cM, teilnehmer, matchboxen, matchingNights }) {
  const isCon = sel && (gender === "frauen" ? cF.has(sel) : cM.has(sel));
  const selMatch = confirmed?.find(m => gender === "frauen" ? m.frauId === sel : m.mannId === sel);
  const selPart = selMatch && (gender === "frauen"
    ? teilnehmer.maenner.find(m => m.id === selMatch.mannId)
    : teilnehmer.frauen.find(f => f.id === selMatch.frauId));

  const getKey = (cpId) => gender === "frauen" ? `${sel}|${cpId}` : `${cpId}|${sel}`;

  const getInfo = (cp) => {
    const fId = gender === "frauen" ? sel : cp.id;
    const mId = gender === "frauen" ? cp.id : sel;
    const p = probs?.[getKey(cp.id)] ?? 0;
    const prev = prevProbs?.[getKey(cp.id)];
    const delta = prev != null ? p - prev : null;
    const cnt = (matchingNights||[]).filter(n => (n.paarungen||[]).some(pa => pa.frauId === fId && pa.mannId === mId)).length;
    const neverTogether = cnt === 0 && p > 0;
    const keinMatch = (matchboxen||[]).some(mb => mb.ergebnis === "kein_match" && mb.frauId === fId && mb.mannId === mId);
    const onlyOption = p >= 75;
    const lastNights = (matchingNights||[]).slice(-3);
    const streak = lastNights.length >= 2 && lastNights.every(n => (n.paarungen||[]).some(pa => pa.frauId === fId && pa.mannId === mId));
    return { p, delta, cnt, neverTogether, keinMatch, onlyOption, streak };
  };

  if (isCon) return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ color: C.green, marginBottom: 6, fontWeight: 600 }}>✅ Bereits bestätigtes Perfect Match!</div>
      {selPart && <div style={{ fontWeight: 700, fontSize: 16 }}>💕 {selPart.name}</div>}
    </div>
  );
  if (!cps?.length) return <div style={{ color: C.mut, fontSize: 14 }}>Keine aktiven Gegenüber vorhanden.</div>;

  const sorted = [...cps].sort((a, b) => (probs?.[getKey(b.id)] ?? 0) - (probs?.[getKey(a.id)] ?? 0));

  // Group into categories
  const hot = sorted.filter(cp => (probs?.[getKey(cp.id)] ?? 0) >= 50);
  const maybe = sorted.filter(cp => { const p = probs?.[getKey(cp.id)] ?? 0; return p > 0 && p < 50; });
  const out = sorted.filter(cp => (probs?.[getKey(cp.id)] ?? 0) === 0);

  const PairRow = ({ cp }) => {
    const { p, delta, cnt, neverTogether, keinMatch, onlyOption, streak } = getInfo(cp);
    const col = keinMatch ? "#a00018" : p >= 75 ? "#005c38" : p >= 40 ? "#7a5000" : C.mut;
    const bg = keinMatch ? "#ffc8cc" : p >= 75 ? "#b8f0d8" : p >= 40 ? "#fff0cc" : "#f5f5f5";

    return (
      <div style={{ marginBottom: 8, padding: "11px 14px", borderRadius: 14, background: bg, border: `1.5px solid ${col}33`, position: "relative" }}>
        {/* AHA badges */}
        <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
          {onlyOption && !keinMatch && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: "#005c38", color: "#fff" }}>⚡ Fast sicher!</span>}
          {streak && !keinMatch && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#0060b0", color: "#fff" }}>🔥 {cnt}× in Folge!</span>}
          {delta != null && Math.abs(delta) >= 10 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: delta > 0 ? "#005c38" : "#9a0018", color: "#fff" }}>
              {delta > 0 ? `↑ +${delta}%` : `↓ ${delta}%`}
            </span>
          )}
          {neverTogether && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#f0f0f0", color: "#888" }}>Noch nie zusammen</span>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: p > 0 ? 6 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{gender === "frauen" ? "👨" : "👩"} {cp.name}</span>
            {cnt > 0 && !streak && <span style={{ fontSize: 11, color: C.blue, background: C.blueD, padding: "1px 7px", borderRadius: 99, fontWeight: 600 }}>{cnt}×</span>}
          </div>
          <span style={{ color: col, fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px" }}>{p}%</span>
        </div>

        {p > 0 && (
          <div style={{ height: 7, borderRadius: 4, background: "rgba(0,0,0,0.10)" }}>
            <div style={{ height: "100%", width: `${p}%`, background: `linear-gradient(90deg, ${col}, ${col}aa)`, borderRadius: 4, transition: "width 0.6s ease" }} />
          </div>
        )}
        {keinMatch && <div style={{ fontSize: 11, color: "#a00018", fontWeight: 700, marginTop: 4 }}>❌ Kein Match (Matchbox)</div>}
      </div>
    );
  };

  const Section = ({ label, items, col }) => items.length === 0 ? null : (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: col, letterSpacing: "0.08em", marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
      {items.map(cp => <PairRow key={cp.id} cp={cp} />)}
    </div>
  );

  return (
    <div>
      <Section label="🔥 Sehr wahrscheinlich" items={hot} col="#005c38" />
      <Section label="🤔 Möglich" items={maybe} col="#7a5000" />
      <Section label="❌ Ausgeschlossen" items={out} col="#a00018" />
      {prevProbs && <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>↑↓ Änderung seit letzter Matchbox</div>}
    </div>
  );
}

/* ─── ANALYSE (3 Sub-Tabs) ─── */
function Analyse({ st, setSt, pd }) {
  const [sub, setSub] = useState("personen");
  const [sel, setSel] = useState(null);
  const [gender, setGender] = useState("frauen");
  const [expSel, setExpSel] = useState(null);
  const [expGender, setExpGender] = useState("frauen");

  const annahmen = st.annahmen || [];
  const toggleAnnahme = (frauId, mannId, forcTyp) => {
    setSt(s => {
      const ann = s.annahmen || [];
      const existing = ann.find(a => a.frauId === frauId && a.mannId === mannId);
      if (forcTyp) {
        // from Night-Check: cycle neutral→match→kein_match→neutral
        if (!existing) return { ...s, annahmen: [...ann, { frauId, mannId, typ: "match" }] };
        if (existing.typ === "match") return { ...s, annahmen: ann.map(a => a.frauId===frauId&&a.mannId===mannId ? {...a,typ:"kein_match"} : a) };
        return { ...s, annahmen: ann.filter(a => !(a.frauId===frauId&&a.mannId===mannId)) };
      }
      // from Experiment tab: toggle match on/off
      if (!existing) return { ...s, annahmen: [...ann, { frauId, mannId, typ: "match" }] };
      return { ...s, annahmen: ann.filter(a => !(a.frauId===frauId&&a.mannId===mannId)) };
    });
  };
  const clearAnnahmen = () => setSt(s => ({ ...s, annahmen: [] }));

  const pdExp = useMemo(() => calcProbs(st.teilnehmer.frauen, st.teilnehmer.maenner, st.matchboxen, st.matchingNights, annahmen), [st]);

  const pairCounts = useMemo(() => {
    const c = {};
    st.matchingNights.forEach(n => (n.paarungen || []).forEach(p => {
      const k = `${p.frauId}|${p.mannId}`;
      c[k] = (c[k] || 0) + 1;
    }));
    return c;
  }, [st.matchingNights]);

  const mbStatus = useMemo(() => {
    const s = {};
    st.matchboxen.forEach(mb => { s[`${mb.frauId}|${mb.mannId}`] = mb.ergebnis; });
    return s;
  }, [st.matchboxen]);

  // Night-basierte Ausschlüsse (0-Lichter-Nights) für Kreuztabelle
  const nightExclSet = useMemo(() => {
    const s = new Set();
    const M = st.matchboxen.filter(mb => mb.ergebnis === "match").length;
    const confF = new Set(st.matchboxen.filter(mb => mb.ergebnis === "match").map(mb => mb.frauId));
    const confM = new Set(st.matchboxen.filter(mb => mb.ergebnis === "match").map(mb => mb.mannId));
    const dmF = new Set((st.doppelmatches || []).filter(d => d.gender === "frau").map(d => d.personId));
    const dmM = new Set((st.doppelmatches || []).filter(d => d.gender === "mann").map(d => d.personId));
    st.matchingNights.forEach(night => {
      if ((night.lichter - M) <= 0) {
        (night.paarungen || []).forEach(p => {
          if (!confF.has(p.frauId) && !confM.has(p.mannId) && !dmF.has(p.frauId) && !dmM.has(p.mannId))
            s.add(`${p.frauId}|${p.mannId}`);
        });
      }
    });
    return s;
  }, [st]);

  const { frauen, maenner } = st.teilnehmer;
  const { probs, aF, aM, confirmed, impossible } = pd;
  const cF = new Set((confirmed || []).map(m => m.frauId));
  const cM = new Set((confirmed || []).map(m => m.mannId));
  // Doppelmatch-Exits auch aus aktiver Ansicht ausschliessen
  const dmEx = st.doppelmatches || [];
  dmEx.forEach(d => { if (d.gender === "frau") cF.add(d.personId); else cM.add(d.personId); });
  const people = gender === "frauen" ? frauen : maenner;
  const expPeople = expGender === "frauen" ? frauen : maenner;
  const cps = gender === "frauen" ? aM : aF;
  const expCps = expGender === "frauen" ? pdExp.aM : pdExp.aF;

  const TABS = [
    { id: "personen", icon: "📊", lbl: "Personen" },
    { id: "tabelle", icon: "🔢", lbl: "Tabelle" },
    { id: "nightcheck", icon: "🌙", lbl: "Night-Check" },
    { id: "experiment", icon: "🧪", lbl: `Exp.${annahmen.length ? ` (${annahmen.length})` : ""}` },
  ];

  return (
    <div>
      {/* Sub-Tab Nav */}
      <div style={{ display: "flex", background: "#ffe8ee", borderRadius: 12, padding: 4, marginBottom: 14, gap: 4, border: `1px solid ${C.brd}` }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, border: "none", background: sub === t.id ? "#fff" : "transparent", color: sub === t.id ? C.pink : C.mut, transition: "all 0.18s", boxShadow: sub === t.id ? "0 1px 4px rgba(0,0,0,0.1)" : "none" }}>
            {t.icon} {t.lbl}
          </button>
        ))}
      </div>

      {impossible && <div style={{ padding: "10px 16px", background: C.redD, border: `1px solid ${C.red}44`, borderRadius: 12, color: C.red, fontSize: 13, marginBottom: 14 }}>⚠️ Widerspruch erkannt – Daten prüfen.</div>}

      {/* ── PERSONEN ── */}
      {sub === "personen" && (
        <div>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 12, padding: "8px 12px", background: C.blueD, borderRadius: 10, border: `1px solid ${C.blue}33` }}>
            💡 Wahrscheinlichkeiten berücksichtigen sowohl Matchbox-Ergebnisse als auch wie oft Paare in Matching Nights zusammenstanden.
          </div>
          <div style={{ display: "flex", background: "#ffe8ee", borderRadius: 10, padding: 3, marginBottom: 12, gap: 3 }}>
            {["frauen", "maenner"].map(g => (
              <button key={g} onClick={() => { setGender(g); setSel(null); }} style={{ flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, border: "none", background: gender === g ? (g === "frauen" ? C.pink : C.blue) : "transparent", color: gender === g ? "#fff" : C.mut, transition: "all 0.18s" }}>
                {g === "frauen" ? "👩 Frauen" : "👨 Männer"}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginBottom: 14 }}>
            {people.map(p => {
              const active = gender === "frauen" ? !cF.has(p.id) : !cM.has(p.id);
              const isDm = dmEx.some(d => d.personId === p.id && d.gender === (gender === "frauen" ? "frau" : "mann"));
              const isMatch = !isDm && !active;
              const isSel = sel === p.id;
              const col = gender === "frauen" ? C.pink : C.blue;
              return <button key={p.id} onClick={() => active && !isDm && setSel(p.id === sel ? null : p.id)} style={{ padding: "12px 4px 10px", borderRadius: 13, cursor: active && !isDm ? "pointer" : "default", fontFamily: "inherit", textAlign: "center", border: `2px solid ${isSel ? col : (isMatch ? `${C.green}55` : isDm ? `${C.pink}33` : C.brd)}`, background: isSel ? `${col}12` : (isMatch ? C.greenD : isDm ? "#fff0f5" : C.surf), transition: "all 0.18s", boxShadow: isSel ? "0 2px 8px rgba(0,0,0,0.1)" : "none", opacity: isDm ? 0.5 : 1 }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{gender === "frauen" ? "👩" : "👨"}</div>
                <div style={{ fontSize: 11, fontWeight: isSel ? 700 : 500, color: isSel ? col : C.txt, lineHeight: 1.2 }}>{p.name.split(" ")[0]}</div>
                {isMatch && <div style={{ fontSize: 9, color: C.green, marginTop: 2, fontWeight: 700 }}>✅</div>}
                {isDm && <div style={{ fontSize: 9, color: C.pink, marginTop: 2, fontWeight: 700 }}>💔 out</div>}
                {!isMatch && !isDm && p.eintrittNachNight && <div style={{ fontSize: 9, color: C.purple, marginTop: 2, fontWeight: 700 }}>🆕 N{p.eintrittNachNight + 1}</div>}
              </button>;
            })}
          </div>
          {sel ? (
            <Card acc={`${gender === "frauen" ? C.pink : C.blue}44`}>
              <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 16, marginBottom: 12 }}>
                {gender === "frauen" ? "👩" : "👨"} {people.find(p => p.id === sel)?.name}
              </div>
              <ProbBars probs={probs} prevProbs={pdPrev?.probs} cps={cps} sel={sel} gender={gender} confirmed={confirmed} cF={cF} cM={cM} teilnehmer={st.teilnehmer} matchboxen={st.matchboxen} matchingNights={st.matchingNights} />
              <div style={{ marginTop: 10, height: 1, background: C.brd }} />
              <div style={{ marginTop: 10, fontSize: 11, color: C.mut, lineHeight: 1.6 }}>
                <strong style={{ color: C.txt }}>Berechnung:</strong> Matrizenpermanente (Ryser). Höhere Gewichte für Paare die öfter zusammenstanden. Bestätigte Nicht-Matches werden ausgeschlossen.
              </div>
            </Card>
          ) : (
            <div style={{ textAlign: "center", color: C.mut, fontSize: 14, paddingTop: 20 }}>Person auswählen um Wahrscheinlichkeiten zu sehen 👆</div>
          )}
        </div>
      )}

      {/* ── KREUZTABELLE ── */}
      {sub === "tabelle" && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[
              { col: "#005c38", bg: "#c8f5e0", lbl: "✓ Match" },
              { col: "#a00018", bg: "#ffc8cc", lbl: "✗ Kein Match" },
              { col: "#7a5000", bg: "#ffe5a0", lbl: "€ Verkauft" },
              { col: "#c0003a", bg: "#fde0e3", lbl: "– Night-Ausschluss" },
              { col: "#004a99", bg: "#d0e8ff", lbl: "# Nights zusammen" },
            ].map(l => (
              <span key={l.lbl} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 8px", borderRadius: 99, background: l.bg, color: l.col, fontWeight: 600, border: `1px solid ${l.col}44` }}>{l.lbl}</span>
            ))}
          </div>
          <Card sx={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>👩 Frauen = Zeilen &nbsp;·&nbsp; 👨 Männer = Spalten</div>
            <Kreuztabelle frauen={frauen} maenner={maenner} pairCounts={pairCounts} mbStatus={mbStatus} annahmen={[]} nightExclSet={nightExclSet} />
          </Card>
        </div>
      )}

      {/* ── EXPERIMENT ── */}
      {sub === "experiment" && (
        <div>
          <div style={{ padding: "10px 14px", background: C.purpleD, border: `1px solid ${C.purple}33`, borderRadius: 12, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: C.purple, marginBottom: 4 }}>🧪 Experiment-Modus</div>
            <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.6 }}>
              Tippe auf eine Zelle in der Tabelle um ein Paar als <strong>angenommenes Match (★)</strong> zu markieren. Die Wahrscheinlichkeiten unten werden entsprechend neu berechnet.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {annahmen.length === 0 ? "Keine Annahmen aktiv" : `${annahmen.length} Annahme${annahmen.length > 1 ? "n" : ""} aktiv`}
            </span>
            {annahmen.length > 0 && <Btn onClick={clearAnnahmen} v="danger" sm>Zurücksetzen</Btn>}
          </div>

          <Card sx={{ padding: 12, marginBottom: 14 }}>
            <Kreuztabelle frauen={frauen} maenner={maenner} pairCounts={pairCounts} mbStatus={mbStatus} annahmen={annahmen} nightExclSet={nightExclSet} dmExitIds={new Set(dmEx.map(d => d.personId))} onToggle={toggleAnnahme} interactive />
          </Card>

          {annahmen.length > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: C.purpleD, borderRadius: 10, border: `1px solid ${C.purple}33` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 5 }}>★ Aktive Annahmen:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {annahmen.map(a => {
                  const f = frauen.find(x => x.id === a.frauId);
                  const m = maenner.find(x => x.id === a.mannId);
                  return <span key={`${a.frauId}|${a.mannId}`} onClick={() => toggleAnnahme(a.frauId, a.mannId)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 99, background: a.typ==="kein_match" ? "#ffc0c8" : "#fff", color: a.typ==="kein_match" ? "#9a0018" : C.purple, border: `1px solid ${a.typ==="kein_match" ? "#d4001e" : C.purple}55`, cursor: "pointer", fontWeight: 600 }}>
                    {a.typ==="kein_match" ? "✗ " : "★ "}{f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]} ×
                  </span>;
                })}
              </div>
            </div>
          )}

          {/* Hypothetical probability view */}
          {pdExp.impossible ? (
            <div style={{ padding: "10px 14px", background: C.redD, borderRadius: 12, color: C.red, fontSize: 13 }}>⚠️ Diese Annahmen sind widersprüchlich – kein vollständiges Matching möglich.</div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, color: C.purple, marginBottom: 10 }}>Hypothetische Wahrscheinlichkeiten:</div>
              <div style={{ display: "flex", background: "#ffe8ee", borderRadius: 10, padding: 3, marginBottom: 12, gap: 3 }}>
                {["frauen", "maenner"].map(g => (
                  <button key={g} onClick={() => { setExpGender(g); setExpSel(null); }} style={{ flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, border: "none", background: expGender === g ? (g === "frauen" ? C.pink : C.blue) : "transparent", color: expGender === g ? "#fff" : C.mut, transition: "all 0.18s" }}>
                    {g === "frauen" ? "👩 Frauen" : "👨 Männer"}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
                {expPeople.filter(p => expGender === "frauen" ? !(new Set(pdExp.confirmed.map(c => c.frauId))).has(p.id) : !(new Set(pdExp.confirmed.map(c => c.mannId))).has(p.id)).map(p => (
                  <button key={p.id} onClick={() => setExpSel(p.id === expSel ? null : p.id)} style={{ padding: "8px 4px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "center", border: `2px solid ${expSel === p.id ? C.purple : C.brd}`, background: expSel === p.id ? C.purpleD : C.surf, transition: "all 0.18s" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: expSel === p.id ? C.purple : C.txt }}>{p.name.split(" ")[0]}</div>
                  </button>
                ))}
              </div>
              {expSel && (
                <Card acc={`${C.purple}44`}>
                  <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 15, marginBottom: 12, color: C.purple }}>
                    {expPeople.find(p => p.id === expSel)?.name} – Hypothetisch
                  </div>
                  <ProbBars probs={pdExp.probs} prevProbs={null} cps={expCps} sel={expSel} gender={expGender} confirmed={pdExp.confirmed} cF={new Set(pdExp.confirmed.map(c => c.frauId))} cM={new Set(pdExp.confirmed.map(c => c.mannId))} teilnehmer={st.teilnehmer} matchboxen={st.matchboxen} matchingNights={st.matchingNights} />
                </Card>
              )}
              {!expSel && <div style={{ textAlign: "center", color: C.mut, fontSize: 13, padding: "10px 0" }}>Person auswählen für hypothetische Wahrscheinlichkeiten 👆</div>}
            </div>
          )}
        </div>
      )}

      {/* ── NIGHT-CHECK ── */}
      {sub === "nightcheck" && (() => {
        const confirmedCount = (confirmed || []).length;
        const mbSt = {};
        st.matchboxen.forEach(mb => { mbSt[`${mb.frauId}|${mb.mannId}`] = mb.ergebnis; });
        return (
          <div>
            <div style={{ padding: "8px 12px", background: "#fff0f5", border: `1px solid ${C.pink}33`, borderRadius: 10, marginBottom: 14, fontSize: 12, color: C.mut, lineHeight: 1.6 }}>
              🌙 <strong style={{ color: C.txt }}>Night-Check:</strong> Tippe auf Paarungen um sie als Annahme zu markieren (★). Die App zeigt ob deine Annahmen mit der Lichteranzahl übereinstimmen.
            </div>
            {st.matchingNights.length === 0 && (
              <div style={{ textAlign: "center", color: C.mut, padding: "30px 0", fontSize: 14 }}>Noch keine Matching Nights eingetragen.</div>
            )}
            {st.matchingNights.map(night => {
              // correctNeeded = wie viele der Lichter noch UNBESTÄTIGT sind (nicht durch Matchbox erklärt)
              const confInThisNight = (night.paarungen || []).filter(p =>
                (confirmed||[]).some(c => c.frauId===p.frauId && c.mannId===p.mannId)
              ).length;
              const correctNeeded = Math.max(0, night.lichter - confInThisNight);
              // annInNight = Annahmen die in DIESER Night als Paarung stehen
              const annInNight = (night.paarungen || []).filter(p =>
                annahmen.some(a => a.frauId === p.frauId && a.mannId === p.mannId)
              ).length;
              // confInNight = nur für Anzeige (✓), NICHT für accountedFor zählen
              // (schon durch confirmedCount in correctNeeded abgezogen)
              const accountedFor = annInNight; // confirmed already subtracted from correctNeeded
              const allFound = correctNeeded === 0 || accountedFor === correctNeeded;
              const tooMany = accountedFor > correctNeeded;
              const stillOpen = Math.max(0, correctNeeded - accountedFor);
              const statusCol = tooMany ? C.red : allFound && correctNeeded > 0 ? C.green : correctNeeded === 0 ? C.red : C.blue;
              const statusLbl = correctNeeded === 0 ? "alle ✗" : tooMany ? "❌ Zu viele!" : allFound ? "✅ Passt!" : `${stillOpen} noch offen`;
              return (
                <div key={night.id} style={{ background: "#fff", border: `1.5px solid ${statusCol}44`, borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 17 }}>🌙 Night {night.nummer}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <Pill col={C.gold}>💡 {night.lichter}</Pill>
                      <Pill col={statusCol}>{statusLbl}</Pill>
                    </div>
                  </div>
                  {correctNeeded > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: C.mut, marginBottom: 4 }}>
                        {annInNight} von {correctNeeded} unbestätigte korrekte Paarungen mit ★ markiert
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: "rgba(0,0,0,0.08)" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, correctNeeded > 0 ? accountedFor / correctNeeded * 100 : 100)}%`, background: statusCol, borderRadius: 3, transition: "width 0.4s" }} />
                      </div>
                    </div>
                  )}
                  {correctNeeded === 0 && (
                    <div style={{ fontSize: 12, color: C.mut, marginBottom: 8 }}>Alle Lichter durch bestätigte Matches erklärt → alle Paarungen dieser Night sind falsch.</div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(night.paarungen || []).map((p, i) => {
                      const f = st.teilnehmer.frauen.find(x => x.id === p.frauId);
                      const m = st.teilnehmer.maenner.find(x => x.id === p.mannId);
                      const key = `${p.frauId}|${p.mannId}`;
                      const isConf = (confirmed || []).some(c => c.frauId === p.frauId && c.mannId === p.mannId);
                      const isKein = mbSt[key] === "kein_match";
                      const isAnn = annahmen.some(a => a.frauId === p.frauId && a.mannId === p.mannId);
                      const isElim = (correctNeeded === 0 || (allFound && !isAnn && !isConf)) && !isKein;
                      const clickable = !isConf && !isKein;
                      // 3-state: neutral→★match→✗kein_match→neutral
                      const annTyp = annahmen.find(a => a.frauId===p.frauId&&a.mannId===p.mannId)?.typ;
                      const isAnnMatch = isAnn && annTyp === "match";
                      const isAnnKein  = isAnn && annTyp === "kein_match";
                      let icon, bg, col, hint;
                      if (isConf)       { icon="✓"; bg="#b8f0d8"; col="#005c38"; hint=""; }
                      else if (isKein)  { icon="✗"; bg="#ffc0c8"; col="#9a0018"; hint=""; }
                      else if (isAnnMatch){ icon="★"; bg="#e8f5ff"; col="#0060b0"; hint="2× = Kein Match"; }
                      else if (isAnnKein){ icon="✗"; bg="#ffc0c8"; col="#9a0018"; hint="3× = Neutral"; }
                      else if (isElim)  { icon="–"; bg="#ffdde2"; col="#c0003a"; hint=""; }
                      else              { icon="?"; bg="#f9f9f9"; col=C.mut; hint="1× = Match-Annahme"; }
                      return (
                        <div key={i} onClick={() => clickable && toggleAnnahme(p.frauId, p.mannId, true)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, background: bg, cursor: clickable ? "pointer" : "default", border: `1px solid ${col}33`, transition: "all 0.15s" }}>
                          <div style={{ width: 26, height: 26, borderRadius: 99, background: `${col}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: col, flexShrink: 0 }}>{icon}</div>
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                            <span style={{ color: C.pink }}>{f?.name}</span>
                            <span style={{ color: C.mut, margin: "0 6px" }}>+</span>
                            <span style={{ color: C.blue }}>{m?.name}</span>
                          </div>
                          {clickable && hint && <div style={{ fontSize: 10, color: col, opacity: 0.65 }}>{hint}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

/* ─── DATEN ─── */
function Daten({ st, setSt }) {
  const ref = useRef(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [fn, setFn] = useState(""); const [mn, setMn] = useState("");
  const addP = (g, name, clr) => { if (!name.trim()) return; setSt(s => ({ ...s, teilnehmer: { ...s.teilnehmer, [g]: [...s.teilnehmer[g], { id: uid(), name: name.trim() }] } })); clr(""); };
  const rmP = (g, id) => setSt(s => ({ ...s, teilnehmer: { ...s.teilnehmer, [g]: s.teilnehmer[g].filter(p => p.id !== id) } }));
  const exp = () => { const b = new Blob([JSON.stringify(st, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `perfect-match-s6-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  const imp = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { setSt(JSON.parse(ev.target.result)); } catch { alert("Ungültige JSON-Datei."); } }; r.readAsText(f); e.target.value = ""; };
  const diff = st.teilnehmer.frauen.length - st.teilnehmer.maenner.length;
  const setEintritt = (g, id, val) => setSt(s => ({
    ...s,
    teilnehmer: {
      ...s.teilnehmer,
      [g]: s.teilnehmer[g].map(p => p.id === id ? { ...p, eintrittNachNight: val === "" ? undefined : +val } : p)
    }
  }));

  const ColSetup = ({ g, col, icon, v, sv }) => (
    <Card sx={{ flex: 1, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: col, marginBottom: 10 }}>{icon} {g === "frauen" ? "Frauen" : "Männer"} ({st.teilnehmer[g].length})</div>
      <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
        <Inp val={v} set={sv} ph="Name…" sx={{ flex: 1, padding: "7px 10px", fontSize: 13 }} />
        <Btn onClick={() => addP(g, v, sv)} sm sx={{ flexShrink: 0, padding: "7px 11px" }}>＋</Btn>
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {st.teilnehmer[g].map(p => (
          <div key={p.id} style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", borderRadius: 7, background: p.eintrittNachNight ? `${C.purple}0d` : `${col}0d`, border: `1px solid ${p.eintrittNachNight ? C.purple : col}22` }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                {p.eintrittNachNight && <span style={{ fontSize: 10, color: C.purple, marginLeft: 5, fontWeight: 700 }}>🆕 ab Night {p.eintrittNachNight + 1}</span>}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <select
                  value={p.eintrittNachNight ?? ""}
                  onChange={e => setEintritt(g, p.id, e.target.value)}
                  style={{ fontSize: 10, border: `1px solid ${C.brd}`, borderRadius: 5, padding: "2px 4px", background: "#fff", color: C.mut, cursor: "pointer" }}
                  title="Eintritt nach Night..."
                >
                  <option value="">Anfang</option>
                  {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>nach Night {n}</option>)}
                </select>
                <button onClick={() => rmP(g, p.id)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
  const stats = [["👩", "Frauen", st.teilnehmer.frauen.length], ["👨", "Männer", st.teilnehmer.maenner.length], ["🌙", "Matching Nights", st.matchingNights.length], ["📦", "Matchboxen", st.matchboxen.length], ["💚", "Bestätigte Matches", st.matchboxen.filter(m => m.ergebnis === "match").length], ["💰", "Verkaufte Paare", st.matchboxen.filter(m => m.ergebnis === "verkauft").length]];
  return (
    <div>
      <Card sx={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: C.pink }}>👥 Teilnehmer</div>
        <div style={{ display: "flex", gap: 10, marginBottom: diff !== 0 ? 10 : 0 }}>
          <ColSetup g="frauen" col={C.pink} icon="👩" v={fn} sv={setFn} />
          <ColSetup g="maenner" col={C.blue} icon="👨" v={mn} sv={setMn} />
        </div>
        {diff !== 0 && <div style={{ padding: "8px 12px", background: C.goldD, border: `1px solid ${C.gold}44`, borderRadius: 10, color: C.gold, fontSize: 12 }}>⚠️ {Math.abs(diff)} Extra-{Math.abs(diff) === 1 ? "Person" : "Personen"} – Doppelmatch möglich.</div>}
      </Card>
      <Card sx={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>📊 Aktueller Stand</div>
        {stats.map(([icon, lbl, val]) => (
          <div key={lbl} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.brd}`, fontSize: 14 }}>
            <span style={{ color: C.mut }}>{icon} {lbl}</span><strong>{val}</strong>
          </div>
        ))}
      </Card>
      <Card sx={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>💾 Daten sichern</div>
        <p style={{ color: C.mut, fontSize: 14, marginBottom: 14, lineHeight: 1.6 }}>Exportiere deinen Stand als JSON. Beim nächsten Mal einfach wieder importieren.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={exp} v="gold" full>⬇️ Exportieren (JSON herunterladen)</Btn>
          <Btn onClick={() => ref.current?.click()} v="ghost" full>⬆️ Importieren (JSON laden)</Btn>
          <input ref={ref} type="file" accept=".json" onChange={imp} style={{ display: "none" }} />
        </div>
      </Card>
      <Card acc={`${C.green}55`} sx={{ background: "#d4f5e8", marginBottom: 12 }}><div style={{ fontSize: 13, color: "#005c38", lineHeight: 1.7 }}>✅ Daten werden <strong>automatisch im Browser gespeichert</strong> (localStorage). Exportieren für andere Geräte oder als Backup.</div></Card><Card acc={`${C.gold}55`} sx={{ background: C.goldD, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.gold, lineHeight: 1.7 }}>⚠️ Daten werden <strong>nicht automatisch gespeichert</strong>. Nach jeder Folge exportieren!</div>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, color: C.red, marginBottom: 8 }}>🗑️ Zurücksetzen</div>
        <p style={{ color: C.mut, fontSize: 13, marginBottom: confirmDel ? 10 : 12 }}>Nights, Matchboxen und Annahmen löschen. Teilnehmerliste bleibt erhalten.</p>
        {!confirmDel ? (
          <Btn v="danger" onClick={() => setConfirmDel(true)}>Alle Daten löschen</Btn>
        ) : (
          <div>
            <div style={{ padding: "10px 14px", background: "#ffc0c8", borderRadius: 10, fontSize: 13, color: "#9a0018", fontWeight: 600, marginBottom: 10 }}>
              ⚠️ Wirklich löschen? Das kann nicht rückgängig gemacht werden.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn v="danger" sx={{ flex: 1 }} onClick={() => {
                const fresh = { ...INIT, onboardingDone: true, impressum: st.impressum, doppelmatches: [] };
                try { localStorage.removeItem(LS_KEY); } catch {}
                setSt(fresh);
                setConfirmDel(false);
              }}>Ja, löschen</Btn>
              <Btn v="ghost" sx={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Abbrechen</Btn>
            </div>
          </div>
        )}
      </Card>
      <button onClick={() => setSt(s => ({ ...s, onboardingDone: false }))} style={{ display: "block", width: "100%", marginTop: 10, padding: "10px", background: "none", border: `1px solid ${C.brd}`, borderRadius: 11, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.mut }}>
        ❓ Anleitung erneut anzeigen
      </button>

      {/* Impressum */}
      <div style={{ marginTop: 24, borderTop: `1px solid ${C.brd}`, paddingTop: 20 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><AppIcon size={44} /></div>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, background: GR3(C.pink, "#ff7700", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }}>Über diese App</div>
        </div>
        <Card sx={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.pink, marginBottom: 10 }}>👋 Hallo, ich bin Sabrina!</div>
          <p style={{ fontSize: 13, color: C.txt, lineHeight: 1.8, marginBottom: 10 }}>
            Ich schaue leidenschaftlich gerne Reality TV – und bei <strong>Are You The One</strong> habe ich immer mitgeschaut. Aber wer wen eingeloggt hat, wer mit wem stand, was die Lichter bedeuten – das konnte ich mir nie merken. Und ohne dieses Wissen kommt man beim Mitraten einfach nicht weit.
          </p>
          <p style={{ fontSize: 13, color: C.txt, lineHeight: 1.8 }}>
            Also habe ich diese App gebaut: alles eintragen, Wahrscheinlichkeiten berechnen lassen, und endlich wissen worüber man redet. 📊 Vielleicht hilft sie ja auch dir – viel Spass dabei! 🎉
          </p>
        </Card>
        <Card sx={{ marginBottom: 10, background: "#fff0f5", border: `1px solid ${C.pink}22` }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.pink, marginBottom: 8 }}>📋 Rechtliches</div>
          <p style={{ fontSize: 12, color: C.mut, lineHeight: 1.7 }}>
            Privates, nicht-kommerzielles Freizeitprojekt von Sabrina. Steht in keiner Verbindung zu den Produzenten oder Rechteinhabern der Sendung „Are You The One". Alle Inhalte dienen ausschliesslich der privaten Unterhaltung.
          </p>
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.pink, marginBottom: 8 }}>🔒 Datenschutz</div>
          {[
            ["✅", "Keine Server – alles läuft lokal in deinem Browser"],
            ["🚫", "Keine Werbung"],
            ["💾", "Eingaben lokal gespeichert, jederzeit löschbar"],
            ["🔤", "Google Fonts: IP-Adresse kann von Google erfasst werden"],
          ].map(([icon, txt]) => (
            <div key={txt} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.brd}`, fontSize: 12, color: C.mut }}>
              <span style={{ flexShrink: 0 }}>{icon}</span><span>{txt}</span>
            </div>
          ))}
        </Card>
        <div style={{ textAlign: "center", fontSize: 11, color: C.mut, marginTop: 14, paddingBottom: 4 }}>
          Erstellt von Sabrina · Are You The One Staffel 6 · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

/* ─── ONBOARDING ─── */
const OB_STEPS = [
  {
    icon: "💕",
    title: "Willkommen!",
    desc: "Der Perfect Match Tracker hilft dir, während der Show mitzuraten – wer ist wessen Perfect Match? Alle 10 Frauen und 10 Männer der Staffel 6 sind bereits eingetragen.",
    hint: [["👩 10 Frauen", "#c8005a"], ["👨 10 Männer", "#0060b0"]],
  },

  {
    icon: "📦",
    title: "Schritt 1: Matchbox",
    desc: "Zuerst kommt immer eine Matchbox. Trag das Ergebnis unter 'Matchbox' ein: Match (Paar zieht aus), Kein Match (ausgeschlossen), oder Verkauft (Ergebnis unbekannt, nie wieder Matchbox möglich).",
    hint: [["💚 Match", "#006838"], ["❌ Kein Match", "#b50020"], ["💰 Verkauft", "#8a5c00"]],
  },
  {
    icon: "🌙",
    title: "Schritt 2: Matching Night",
    desc: "Danach die Matching Night. Trag unter 'Nights' ein, wer wen gewählt hat. Und: wie viele Lichter leuchten insgesamt – ausgezogene Paare zählen dabei weiterhin als Licht.",
  },
  {
    icon: "📊",
    title: "Analyse & Mitraten",
    desc: "Die App berechnet laufend wie wahrscheinlich jede Paarung ist. Auf der Startseite siehst du die Top 5. Im Analyse-Tab kannst du Annahmen testen und prüfen ob sie mit den Lichtern aufgehen.",
  },
  {
    icon: "💾",
    title: "Daten werden automatisch gespeichert",
    desc: "Alles wird automatisch in deinem Browser gespeichert – du kannst die App jederzeit schliessen und weitermachen. Für andere Geräte: Export unter 'Daten'.",
  },
  {
    icon: "🚀",
    title: "Los geht's!",
    desc: "Die Staffel-6-Besetzung ist bereits eingetragen. Denk an die Reihenfolge: erst Matchbox, dann Matching Night – und viel Spass beim Mitraten!",
    isLast: true,
  },
];

function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const s = OB_STEPS[step];
  const progress = (step + 1) / OB_STEPS.length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(245,242,251,0.98)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 24px 40px" }}>
      {/* Progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "#ffe8ee" }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, background: LUXURY, transition: "width 0.4s ease", borderRadius: "0 3px 3px 0" }} />
      </div>

      {/* Step counter */}
      <div style={{ position: "absolute", top: 16, right: 20, fontSize: 12, color: C.mut, fontWeight: 600 }}>{step + 1} / {OB_STEPS.length}</div>

      {/* Content */}
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          {step === 0 ? <AppIcon size={72} /> : <div style={{ fontSize: 56, lineHeight: 1 }}>{s.icon}</div>}
        </div>
        <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, marginBottom: 14, color: C.txt, lineHeight: 1.2 }}>{s.title}</h2>
        <p style={{ fontSize: 15, color: C.mut, lineHeight: 1.7, marginBottom: s.hint ? 20 : 0 }}>{s.desc}</p>

        {s.hint && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 0 }}>
            {s.hint.map(([lbl, col]) => (
              <span key={lbl} style={{ fontSize: 13, fontWeight: 700, padding: "5px 14px", borderRadius: 99, background: `${col}14`, color: col, border: `1px solid ${col}44` }}>{lbl}</span>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ position: "absolute", bottom: 40, left: 24, right: 24, display: "flex", gap: 10 }}>
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: "13px", borderRadius: 13, background: "#ffe8ee", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 600, color: C.mut }}>
            ← Zurück
          </button>
        )}
        <button
          onClick={() => s.isLast ? onDone() : setStep(s => s + 1)}
          style={{ flex: 2, padding: "13px", borderRadius: 13, background: s.isLast ? GR(C.green, "#004d2a") : GR3(C.pink, "#ff7700", C.gold), border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff", boxShadow: "0 3px 12px rgba(0,0,0,0.15)" }}>
          {s.isLast ? "🚀 Los geht's!" : "Weiter →"}
        </button>
      </div>

      {/* Skip */}
      {!s.isLast && (
        <button onClick={onDone} style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "none", border: "none", fontSize: 12, color: C.mut, cursor: "pointer", fontFamily: "inherit", padding: "4px 12px" }}>
          Überspringen
        </button>
      )}
    </div>
  );
}

/* ─── IMPRESSUM ─── */
function Impressum({ st, setSt }) {
  return (
    <div>
      <div style={{ textAlign: "center", padding: "20px 0 24px" }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>💕</div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, margin: "0 0 6px", background: GR3(C.pink, "#ff7700", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Über diese App</h1>
        <p style={{ color: C.mut, fontSize: 13 }}>Gemacht mit Leidenschaft für Reality TV</p>
      </div>

      <Card sx={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.pink, marginBottom: 14 }}>👋 Hallo, ich bin Sabrina!</div>
        <p style={{ fontSize: 14, color: C.txt, lineHeight: 1.8, marginBottom: 12 }}>
          Ich schaue leidenschaftlich gerne Reality TV – und bei <strong>Are You The One</strong> habe ich immer mitgeschaut. Aber wer wen eingeloggt hat, wer mit wem stand, was die Lichter bedeuten – das konnte ich mir nie merken. Und ohne dieses Wissen kommt man beim Mitraten einfach nicht weit.
        </p>
        <p style={{ fontSize: 14, color: C.txt, lineHeight: 1.8, marginBottom: 12 }}>
          Also habe ich diese App gebaut: alles eintragen, Wahrscheinlichkeiten berechnen lassen, und endlich wissen worüber man redet. 📊
        </p>
        <p style={{ fontSize: 14, color: C.txt, lineHeight: 1.8 }}>
          Vielleicht hilft sie ja auch dir – viel Spass dabei! 🎉
        </p>
      </Card>

      <Card sx={{ marginBottom: 14, background: "#fff0f5", border: `1px solid ${C.pink}22` }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.pink, marginBottom: 10 }}>📋 Rechtliches</div>
        <p style={{ fontSize: 13, color: C.mut, lineHeight: 1.7 }}>
          Diese App ist ein <strong style={{ color: C.txt }}>privates, nicht-kommerzielles Freizeitprojekt</strong> von Sabrina. Sie steht in keiner Verbindung zu den Produzenten oder Rechteinhabern der Sendung „Perfect Match". Alle Inhalte dienen ausschliesslich der privaten Unterhaltung.
        </p>
      </Card>

      <Card sx={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.pink, marginBottom: 10 }}>🔒 Datenschutz</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { icon: "✅", title: "Keine Server", desc: "Die App läuft vollständig in deinem Browser. Deine Daten verlassen dein Gerät nie." },
            { icon: "💾", title: "Lokale Speicherung", desc: "Alle Eingaben (Nights, Matchboxen) werden nur lokal gespeichert und können jederzeit gelöscht werden." },
            { icon: "🚫", title: "Keine Werbung", desc: "Die App ist vollständig werbefrei und kostenlos." },
            { icon: "🔤", title: "Google Fonts", desc: "Die App lädt Schriftarten von Google Fonts – dabei kann Google die IP-Adresse erfassen." },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.brd}` }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
              <div><strong style={{ fontSize: 13 }}>{title}</strong><div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>{desc}</div></div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ textAlign: "center", padding: "16px 0 8px", color: C.mut, fontSize: 12 }}>
        Erstellt von Sabrina · Staffel 6 · {new Date().getFullYear()}
      </div>
    </div>
  );
}

/* ─── ROOT ─── */
const INIT = {
  teilnehmer: {
    frauen: [
      { id: "f01", name: "Janice Barat" }, { id: "f02", name: "Michelle Bendig" },
      { id: "f03", name: "Marta Dobrowolska" }, { id: "f04", name: "Emma Fernlund" },
      { id: "f05", name: "Jenny Grassl" }, { id: "f06", name: "Alexandra Leonhard" },
      { id: "f07", name: "Francesca Morgese" }, { id: "f08", name: "Zoe Müllner" },
      { id: "f09", name: "Christin Pawlowski" }, { id: "f10", name: "Julia Römmelt" },
    ],
    maenner: [
      { id: "m01", name: "Bennett Bacher" }, { id: "m02", name: "Cansin" },
      { id: "m03", name: "Brian Gamlien" }, { id: "m04", name: "Fabi Hesdahl" },
      { id: "m05", name: "Johannes Jowovicz" }, { id: "m06", name: "Marwin Klute" },
      { id: "m07", name: "Robin Njie" }, { id: "m08", name: "Raúl Richter" },
      { id: "m09", name: "Daymian Weiss" }, { id: "m10", name: "Germain Wolf" },
    ],
  },
  matchingNights: [],
  matchboxen: [],
  annahmen: [],
  doppelmatches: [],
  onboardingDone: false,
  impressum: {},
};

const NAV = [
  { id: "home", icon: "🏠", lbl: "Home" },
  { id: "nights", icon: "🌙", lbl: "Nights" }, { id: "matchbox", icon: "📦", lbl: "Matchbox" },
  { id: "analyse", icon: "📊", lbl: "Analyse" }, { id: "data", icon: "💾", lbl: "Daten" },
];

export default function App() {
  const [st, setSt] = useState(() => loadState(INIT));
  useEffect(() => { saveState(st); }, [st]);
  const [page, setPage] = useState("home");
  const pd = useMemo(() => calcProbs(st.teilnehmer.frauen, st.teilnehmer.maenner, st.matchboxen, st.matchingNights, [], st.doppelmatches || []), [st]);
  const pages = {
    home: <Home st={st} onShowOnboarding={() => setSt(s => ({ ...s, onboardingDone: false }))} setPage={setPage} pd={pd} />,
    nights: <MatchingNights st={st} setSt={setSt} />,
    matchbox: <Matchboxen st={st} setSt={setSt} />,
    analyse: <Analyse st={st} setSt={setSt} pd={pd} />,
    data: <Daten st={st} setSt={setSt} />,
  };
  return (
    <>
      {!st.onboardingDone && <Onboarding onDone={() => setSt(s => ({ ...s, onboardingDone: true }))} />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #fef9f0; -webkit-font-smoothing: antialiased; }
        input, select, button, textarea { font-family: 'Plus Jakarta Sans', sans-serif; }
        input::placeholder { color: rgba(42,21,0,0.28); }
        select option { background: #fffdf7; color: #2a1500; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(212,83,126,0.25); border-radius: 2px; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp 0.3s ease both; }
      `}</style>
      <div style={{ minHeight: "100vh", background: MESH, color: C.txt, fontFamily: "'Plus Jakarta Sans',sans-serif", maxWidth: 520, margin: "0 auto" }}>

        {/* Sticky Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "11px 18px", background: "rgba(254,249,240,0.94)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${C.brd}`, boxShadow: "0 1px 0 rgba(255,255,255,0.95)", display: "flex", alignItems: "center", gap: 10 }}>
          <AppIcon size={28} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, color: C.brown, fontWeight: 600, fontStyle: "italic", lineHeight: 1.1 }}>Are You The One</div>
          </div>
          <div style={{ fontSize: 10, color: C.warm, letterSpacing: "0.10em", fontWeight: 600 }}>STAFFEL 6</div>
        </div>

        {/* Page Content */}
        <div style={{ padding: "20px 16px 110px" }}>{pages[page]}</div>

        {/* Bottom Nav – luxury bar */}
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 520, background: "rgba(254,249,240,0.96)", backdropFilter: "blur(20px)", borderTop: `1px solid ${C.brd}`, display: "flex", padding: "9px 8px 18px", gap: 4 }}>
          {NAV.map(n => {
            const on = page === n.id;
            return (
              <button key={n.id} onClick={() => setPage(n.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "5px 2px", background: on ? `${C.pink}0d` : "none", borderRadius: 10, border: on ? `1px solid ${C.pink}22` : "1px solid transparent", cursor: "pointer", transition: "all 0.18s" }}>
                <span style={{ fontSize: 18, lineHeight: 1, opacity: on ? 1 : 0.55, transition: "opacity 0.18s" }}>{n.icon}</span>
                <span style={{ fontSize: 9, fontWeight: on ? 700 : 500, color: on ? C.pink : C.warm, letterSpacing: "0.04em", fontFamily: "'Plus Jakarta Sans',sans-serif", transition: "color 0.18s" }}>{n.lbl.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

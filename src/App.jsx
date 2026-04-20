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
function calcProbs(frauen, maenner, matchboxen, matchingNights, extraConf = []) {
  const allConf = [...matchboxen.filter(m => m.ergebnis === "match"), ...extraConf];
  const cF = new Set(allConf.map(m => m.frauId));
  const cM = new Set(allConf.map(m => m.mannId));
  const excl = new Set(matchboxen.filter(m => m.ergebnis === "kein_match").map(m => `${m.frauId}|${m.mannId}`));
  const aF = frauen.filter(f => !cF.has(f.id));
  const aM = maenner.filter(m => !cM.has(m.id));
  const nF = aF.length, nM = aM.length, n = Math.max(nF, nM);
  if (!n) return { probs: {}, aF, aM, confirmed: allConf, impossible: false };

  // Bestätigte Matches (M) als Grundlage für Licht-Auswertung
  const confirmedCount = allConf.length;

  // Paaring-Häufigkeit UND Licht-basierte Ausschlüsse
  const pairCounts = {};
  (matchingNights || []).forEach(night => {
    // korrekte unbestätigte Paare = Lichter - bestätigte Matches
    const correctUnconfirmed = night.lichter - confirmedCount;
    (night.paarungen || []).forEach(p => {
      const k = `${p.frauId}|${p.mannId}`;
      pairCounts[k] = (pairCounts[k] || 0) + 1;
      // Wenn keine unbestätigten korrekten Paare → alle aktiven Paarungen dieser Night ausschließen
      if (correctUnconfirmed <= 0 && !cF.has(p.frauId) && !cM.has(p.mannId)) {
        excl.add(k);
      }
    });
  });

  const build = (si = -1, sj = -1) => {
    const mat = [];
    for (let i = 0; i < n; i++) {
      if (i === si) continue;
      const row = [];
      for (let j = 0; j < n; j++) {
        if (j === sj) continue;
        if (i < nF && j < nM) {
          const key = `${aF[i].id}|${aM[j].id}`;
          if (excl.has(key)) { row.push(0); continue; }
          // Gewicht: 1 + Anzahl gemeinsamer Nights (je öfter zusammen, desto höher)
          row.push(1 + (pairCounts[key] || 0));
        } else {
          row.push(1);
        }
      }
      mat.push(row);
    }
    return mat;
  };

  const tot = ryserPerm(build());
  if (tot <= 0) return { probs: {}, aF, aM, confirmed: allConf, impossible: true };
  const probs = {};
  for (let i = 0; i < nF; i++) for (let j = 0; j < nM; j++) {
    const key = `${aF[i].id}|${aM[j].id}`;
    probs[key] = excl.has(key) ? 0 : Math.min(100, Math.max(0, Math.round(ryserPerm(build(i, j)) / tot * 100)));
  }
  return { probs, aF, aM, confirmed: allConf, impossible: false };
}

const uid = () => Math.random().toString(36).slice(2, 9);
const firstName = name => name.split(" ")[0].slice(0, 6);

/* ─── LIGHT THEME ─── */
const C = {
  bg: "#fff8f5", surf: "#ffffff", brd: "rgba(220,60,80,0.12)",
  pink: "#ff1f72", pinkD: "rgba(255,31,114,0.09)",
  gold: "#e08800", goldD: "rgba(224,136,0,0.10)",
  blue: "#0066cc", blueD: "rgba(0,102,204,0.09)",
  green: "#00906a", greenD: "rgba(0,144,106,0.09)",
  red: "#d4001e", redD: "rgba(212,0,30,0.09)",
  purple: "#7a00cc", purpleD: "rgba(122,0,204,0.09)",
  coral: "#ff5c2e", coralD: "rgba(255,92,46,0.09)",
  txt: "#1a0810", mut: "rgba(26,8,16,0.50)",
};
const GR = (a, b) => `linear-gradient(135deg,${a},${b})`;
const GR3 = (a, b, c) => `linear-gradient(135deg,${a},${b},${c})`;

/* ─── PRIMITIVES ─── */
const Card = ({ children, acc, sx = {} }) => (
  <div style={{ background: C.surf, border: `1px solid ${acc || C.brd}`, borderRadius: 16, padding: 18, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", ...sx }}>{children}</div>
);
const Pill = ({ children, col }) => (
  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 700, background: `${col}18`, color: col, border: `1px solid ${col}44` }}>{children}</span>
);
const Btn = ({ children, onClick, v = "pri", sm, dis, full, sx = {} }) => {
  const vs = {
    pri: { background: GR(C.pink, "#cc0040"), color: "#fff", border: "none", boxShadow: "0 3px 12px rgba(255,31,114,0.30)" },
    ghost: { background: "#fff2ee", color: C.txt, border: `1px solid ${C.brd}` },
    gold: { background: GR(C.gold, "#5a3c00"), color: "#fff", border: "none" },
    danger: { background: C.redD, color: C.red, border: `1px solid ${C.red}44` },
    purple: { background: GR(C.purple, "#440088"), color: "#fff", border: "none" },
  };
  return <button onClick={onClick} disabled={dis} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: sm ? "6px 14px" : "10px 20px", borderRadius: 11, cursor: dis ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: sm ? 13 : 14, fontWeight: 600, opacity: dis ? 0.35 : 1, width: full ? "100%" : "auto", ...vs[v], ...sx }}>{children}</button>;
};
const Inp = ({ val, set, ph, tp = "text", sx = {} }) => (
  <input value={val} type={tp} onChange={e => set(e.target.value)} placeholder={ph}
    style={{ width: "100%", boxSizing: "border-box", background: "#fff8f6", border: `1px solid ${C.brd}`, borderRadius: 10, padding: "10px 14px", color: C.txt, fontFamily: "inherit", fontSize: 14, outline: "none", ...sx }} />
);
const Sel = ({ val, set, dis, children }) => (
  <select value={val} onChange={e => set(e.target.value)} disabled={dis}
    style={{ width: "100%", boxSizing: "border-box", background: "#fff8f6", border: `1px solid ${C.brd}`, borderRadius: 10, padding: "10px 14px", color: val ? C.txt : C.mut, fontFamily: "inherit", fontSize: 14, outline: "none", cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.45 : 1 }}>{children}</select>
);
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <label style={{ display: "block", fontSize: 11, color: C.mut, marginBottom: 6, fontWeight: 700, letterSpacing: "0.06em" }}>{label.toUpperCase()}</label>}
    {children}
  </div>
);

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
function Home({ st, onShowOnboarding, setPage }) {
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
      <div style={{ textAlign: "center", padding: "16px 0 16px" }}>
        <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 10 }}>💕</div>
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, margin: "0 0 4px", background: GR3(C.pink, "#ff7700", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Are You The One</h1>
        <p style={{ color: C.mut, fontSize: 12, margin: "0 0 10px" }}>Staffel 6 · Tracker von Sabrina</p>
        <button onClick={onShowOnboarding} style={{ background: "none", border: `1px solid ${C.brd}`, borderRadius: 99, padding: "4px 12px", fontSize: 11, color: C.mut, cursor: "pointer", fontFamily: "inherit" }}>❓ Anleitung</button>
      </div>

      {/* A) Nächster Schritt */}
      <button onClick={() => setPage(nextStep.tab)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 16px", borderRadius: 16, background: `linear-gradient(135deg, ${nextStep.col}, ${nextStep.col}bb)`, border: "none", cursor: "pointer", marginBottom: 12, boxShadow: `0 4px 14px ${nextStep.col}40`, fontFamily: "inherit" }}>
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
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: s.col, lineHeight: 1 }}>{s.val}</div>
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
  const cF = new Set(conf.map(m => m.frauId));
  const cM = new Set(conf.map(m => m.mannId));
  const aF = st.teilnehmer.frauen.filter(f => !cF.has(f.id));
  const aM = st.teilnehmer.maenner.filter(m => !cM.has(m.id));
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
                <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16 }}>🌙 Night {night.nummer}</span>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {night.paarungen.map((p, i) => {
                  const f = st.teilnehmer.frauen.find(x => x.id === p.frauId);
                  const m = st.teilnehmer.maenner.find(x => x.id === p.mannId);
                  const isMatch = conf.some(c => c.frauId === p.frauId && c.mannId === p.mannId);
                  return <span key={i} style={{ padding: "3px 9px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: isMatch ? "#b8f0d8" : "#f0edf9", border: `1px solid ${isMatch ? "#00906a55" : C.brd}`, color: isMatch ? "#005c38" : C.txt }}>
                    {isMatch ? "✅ " : ""}{f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]}
                  </span>;
                })}
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
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, marginBottom: 12 }}>
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
  const conf = st.matchboxen.filter(m => m.ergebnis === "match");
  const cF = new Set(conf.map(m => m.frauId)); const cM = new Set(conf.map(m => m.mannId));
  const aF = st.teilnehmer.frauen.filter(f => !cF.has(f.id));
  const aM = st.teilnehmer.maenner.filter(m => !cM.has(m.id));
  const sold = new Set(st.matchboxen.filter(m => m.ergebnis === "verkauft").map(m => `${m.frauId}|${m.mannId}`));
  const availM = aM.filter(m => !sold.has(`${fId}|${m.id}`));
  const save = () => {
    if (!fId || !mId || !erg) return;
    setSt(s => ({ ...s, matchboxen: [...s.matchboxen, { id: uid(), nummer: s.matchboxen.length + 1, frauId: fId, mannId: mId, ergebnis: erg }] }));
    setOpen(false); setFId(""); setMId(""); setErg("");
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
        </Card>;
      })}
      {!open ? (
        <Btn onClick={() => setOpen(true)} dis={!aF.length || !aM.length}>＋ Matchbox eintragen</Btn>
      ) : (
        <Card acc={`${C.gold}66`}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, marginBottom: 18 }}>📦 Neue Matchbox</div>
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
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={save} dis={!fId || !mId || !erg} v="gold">Speichern</Btn>
            <Btn onClick={() => { setOpen(false); setFId(""); setMId(""); setErg(""); }} v="ghost">Abbrechen</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─── KREUZTABELLE ─── */
function Kreuztabelle({ frauen, maenner, pairCounts, mbStatus, annahmen = [], nightExclSet = new Set(), onToggle, interactive = false }) {
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
    if (interactive && isAnn)
      return { bg: "#e0c8ff", col: "#5500aa", brd: "#7a00cc", txt: "★", dim: false, click: true };

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
            <div key={m.id} style={{ width: W, flexShrink: 0, textAlign: "center", fontSize: 9, fontWeight: 700, color: matchedMann[m.id] ? "#aaa" : C.blue, padding: "2px 1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: matchedMann[m.id] ? "line-through" : "none" }}>
              {firstName(m.name)}
            </div>
          ))}
        </div>
        {/* Rows */}
        {frauen.map(f => (
          <div key={f.id} style={{ display: "flex", marginBottom: 2 }}>
            <div style={{ width: NW, flexShrink: 0, fontSize: 9, fontWeight: 700, color: matchedFrau[f.id] ? "#aaa" : C.pink, textAlign: "right", paddingRight: 5, display: "flex", alignItems: "center", justifyContent: "flex-end", textDecoration: matchedFrau[f.id] ? "line-through" : "none", overflow: "hidden", whiteSpace: "nowrap" }}>
              {firstName(f.name)}
            </div>
            {maenner.map(m => {
              const c = getCell(f.id, m.id);
              return (
                <div key={m.id}
                  onClick={() => c.click && !c.dim && onToggle && onToggle(f.id, m.id)}
                  style={{ width: W - 2, height: W - 2, flexShrink: 0, margin: "0 1px", borderRadius: 5, background: c.bg, border: `1px solid ${c.brd}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: c.col, cursor: c.click && !c.dim ? "pointer" : "default", userSelect: "none", opacity: c.dim ? 0.5 : 1 }}>
                  {c.txt}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── PROBABILITY BARS ─── */
function ProbBars({ probs, cps, sel, gender, confirmed, cF, cM, teilnehmer, matchboxen, matchingNights }) {
  const isCon = sel && (gender === "frauen" ? cF.has(sel) : cM.has(sel));
  const selMatch = confirmed?.find(m => gender === "frauen" ? m.frauId === sel : m.mannId === sel);
  const selPart = selMatch && (gender === "frauen"
    ? teilnehmer.maenner.find(m => m.id === selMatch.mannId)
    : teilnehmer.frauen.find(f => f.id === selMatch.frauId));
  const pc = p => p === 0 ? "#a00018" : p >= 60 ? "#005c38" : p >= 30 ? "#7a5000" : C.mut;
  const pb = p => p === 0 ? "#ffc8cc" : p >= 60 ? "#d4f5e8" : p >= 30 ? "#fff0cc" : "#f8f6ff";

  const getReason = (fId, mId) => {
    const key = gender === "frauen" ? `${fId}|${mId}` : `${mId}|${fId}`;
    const normKey = gender === "frauen" ? `${sel}|${(cps.find(c=>c.id===mId)||cps.find(c=>c.id===fId))?.id}` : `${(cps.find(c=>c.id===fId)||cps.find(c=>c.id===mId))?.id}|${sel}`;
    const realKey = gender === "frauen" ? `${sel}|${mId}` : `${fId}|${sel}`;
    const keinMatch = (matchboxen||[]).some(mb => mb.ergebnis === "kein_match" && mb.frauId === (gender==="frauen"?sel:mId||fId) && mb.mannId === (gender==="frauen"?mId||fId:sel));
    if (keinMatch) return { txt: "Kein Match bestätigt (Matchbox)", col: "#a00018" };
    const cnt = (matchingNights||[]).filter(n => (n.paarungen||[]).some(p => p.frauId === (gender==="frauen"?sel:mId) && p.mannId === (gender==="frauen"?mId:sel))).length;
    if (cnt >= 3) return { txt: `${cnt}× zusammengestanden – starkes Signal`, col: "#005c38" };
    if (cnt >= 1) return { txt: `${cnt}× in Matching Night zusammen`, col: "#7a5000" };
    return null;
  };

  if (isCon) return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ color: C.green, marginBottom: 6, fontWeight: 600 }}>✅ Bereits bestätigtes Perfect Match!</div>
      {selPart && <div style={{ fontWeight: 700, fontSize: 16 }}>💕 {selPart.name}</div>}
    </div>
  );
  if (!cps?.length) return <div style={{ color: C.mut, fontSize: 14 }}>Keine aktiven Gegenüber vorhanden.</div>;
  return (
    <div>
      {[...cps].sort((a, b) => {
        const ka = gender === "frauen" ? `${sel}|${a.id}` : `${a.id}|${sel}`;
        const kb = gender === "frauen" ? `${sel}|${b.id}` : `${b.id}|${sel}`;
        return (probs?.[kb] ?? 0) - (probs?.[ka] ?? 0);
      }).map(cp => {
        const p = probs?.[gender === "frauen" ? `${sel}|${cp.id}` : `${cp.id}|${sel}`] ?? 0;
        const reason = getReason(gender==="frauen"?sel:cp.id, gender==="frauen"?cp.id:sel);
        return <div key={cp.id} style={{ marginBottom: 9, padding: "10px 12px", borderRadius: 12, background: pb(p), border: `1px solid ${pc(p)}33` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.txt }}>{gender === "frauen" ? "👨" : "👩"} {cp.name}</span>
            <span style={{ color: pc(p), fontWeight: 800, fontSize: 17 }}>{p}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(0,0,0,0.08)", marginBottom: reason ? 5 : 0 }}>
            <div style={{ height: "100%", width: `${p}%`, background: pc(p), borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
          {reason && <div style={{ fontSize: 11, color: reason.col, fontWeight: 600, marginTop: 3 }}>{reason.txt}</div>}
        </div>;
      })}
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
  const toggleAnnahme = (frauId, mannId) => {
    setSt(s => {
      const ann = s.annahmen || [];
      const exists = ann.some(a => a.frauId === frauId && a.mannId === mannId);
      return { ...s, annahmen: exists ? ann.filter(a => !(a.frauId === frauId && a.mannId === mannId)) : [...ann, { frauId, mannId }] };
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
    st.matchingNights.forEach(night => {
      if ((night.lichter - M) <= 0) {
        (night.paarungen || []).forEach(p => {
          if (!confF.has(p.frauId) && !confM.has(p.mannId)) s.add(`${p.frauId}|${p.mannId}`);
        });
      }
    });
    return s;
  }, [st]);

  const { frauen, maenner } = st.teilnehmer;
  const { probs, aF, aM, confirmed, impossible } = pd;
  const cF = new Set((confirmed || []).map(m => m.frauId));
  const cM = new Set((confirmed || []).map(m => m.mannId));
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
              const isSel = sel === p.id;
              const col = gender === "frauen" ? C.pink : C.blue;
              return <button key={p.id} onClick={() => setSel(p.id === sel ? null : p.id)} style={{ padding: "12px 4px 10px", borderRadius: 13, cursor: "pointer", fontFamily: "inherit", textAlign: "center", border: `2px solid ${isSel ? col : (!active ? `${C.green}55` : C.brd)}`, background: isSel ? `${col}12` : (!active ? C.greenD : C.surf), transition: "all 0.18s", boxShadow: isSel ? "0 2px 8px rgba(0,0,0,0.1)" : "none" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{gender === "frauen" ? "👩" : "👨"}</div>
                <div style={{ fontSize: 11, fontWeight: isSel ? 700 : 500, color: isSel ? col : C.txt, lineHeight: 1.2 }}>{p.name.split(" ")[0]}</div>
                {!active && <div style={{ fontSize: 9, color: C.green, marginTop: 2, fontWeight: 700 }}>✅</div>}
              </button>;
            })}
          </div>
          {sel ? (
            <Card acc={`${gender === "frauen" ? C.pink : C.blue}44`}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, marginBottom: 12 }}>
                {gender === "frauen" ? "👩" : "👨"} {people.find(p => p.id === sel)?.name}
              </div>
              <ProbBars probs={probs} cps={cps} sel={sel} gender={gender} confirmed={confirmed} cF={cF} cM={cM} teilnehmer={st.teilnehmer} matchboxen={st.matchboxen} matchingNights={st.matchingNights} />
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
            <Kreuztabelle frauen={frauen} maenner={maenner} pairCounts={pairCounts} mbStatus={mbStatus} annahmen={annahmen} nightExclSet={nightExclSet} onToggle={toggleAnnahme} interactive />
          </Card>

          {annahmen.length > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: C.purpleD, borderRadius: 10, border: `1px solid ${C.purple}33` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 5 }}>★ Aktive Annahmen:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {annahmen.map(a => {
                  const f = frauen.find(x => x.id === a.frauId);
                  const m = maenner.find(x => x.id === a.mannId);
                  return <span key={`${a.frauId}|${a.mannId}`} onClick={() => toggleAnnahme(a.frauId, a.mannId)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 99, background: "#fff", color: C.purple, border: `1px solid ${C.purple}55`, cursor: "pointer", fontWeight: 600 }}>
                    {f?.name?.split(" ")[0]} + {m?.name?.split(" ")[0]} ×
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
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, marginBottom: 12, color: C.purple }}>
                    {expPeople.find(p => p.id === expSel)?.name} – Hypothetisch
                  </div>
                  <ProbBars probs={pdExp.probs} cps={expCps} sel={expSel} gender={expGender} confirmed={pdExp.confirmed} cF={new Set(pdExp.confirmed.map(c => c.frauId))} cM={new Set(pdExp.confirmed.map(c => c.mannId))} teilnehmer={st.teilnehmer} matchboxen={st.matchboxen} matchingNights={st.matchingNights} />
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
              const correctNeeded = Math.max(0, night.lichter - confirmedCount);
              // annInNight = Annahmen die in DIESER Night als Paarung stehen
              const annInNight = (night.paarungen || []).filter(p =>
                annahmen.some(a => a.frauId === p.frauId && a.mannId === p.mannId)
              ).length;
              // confInNight = nur für Anzeige (✓), NICHT für accountedFor zählen
              // (schon durch confirmedCount in correctNeeded abgezogen)
              const confInNight = (night.paarungen || []).filter(p =>
                (confirmed || []).some(c => c.frauId === p.frauId && c.mannId === p.mannId)
              ).length;
              const accountedFor = annInNight; // NUR Annahmen zählen!
              const allFound = correctNeeded === 0 || accountedFor === correctNeeded;
              const tooMany = accountedFor > correctNeeded;
              const stillOpen = Math.max(0, correctNeeded - accountedFor);
              const statusCol = tooMany ? C.red : allFound && correctNeeded > 0 ? C.green : correctNeeded === 0 ? C.red : C.blue;
              const statusLbl = correctNeeded === 0 ? "alle ✗" : tooMany ? "❌ Zu viele!" : allFound ? "✅ Passt!" : `${stillOpen} noch offen`;
              return (
                <div key={night.id} style={{ background: "#fff", border: `1.5px solid ${statusCol}44`, borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 17 }}>🌙 Night {night.nummer}</span>
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
                      let icon, bg, col;
                      if (isConf)      { icon = "✓"; bg = "#b8f0d8"; col = "#005c38"; }
                      else if (isKein) { icon = "✗"; bg = "#ffc0c8"; col = "#9a0018"; }
                      else if (isAnn)  { icon = "★"; bg = "#e0c8ff"; col = "#5500aa"; }
                      else if (isElim) { icon = "–"; bg = "#ffdde2"; col = "#c0003a"; }
                      else             { icon = "?"; bg = "#f5f5f5"; col = C.mut; }
                      return (
                        <div key={i} onClick={() => clickable && toggleAnnahme(p.frauId, p.mannId)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, background: bg, cursor: clickable ? "pointer" : "default", border: `1px solid ${col}33` }}>
                          <div style={{ width: 26, height: 26, borderRadius: 99, background: `${col}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: col, flexShrink: 0 }}>{icon}</div>
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
                            <span style={{ color: C.pink }}>{f?.name}</span>
                            <span style={{ color: C.mut, margin: "0 6px" }}>+</span>
                            <span style={{ color: C.blue }}>{m?.name}</span>
                          </div>
                          {clickable && <div style={{ fontSize: 10, color: col, opacity: 0.8 }}>{isAnn ? "× entfernen" : "+ Annahme"}</div>}
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
  const ColSetup = ({ g, col, icon, v, sv }) => (
    <Card sx={{ flex: 1, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: col, marginBottom: 10 }}>{icon} {g === "frauen" ? "Frauen" : "Männer"} ({st.teilnehmer[g].length})</div>
      <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
        <Inp val={v} set={sv} ph="Name…" sx={{ flex: 1, padding: "7px 10px", fontSize: 13 }} />
        <Btn onClick={() => addP(g, v, sv)} sm sx={{ flexShrink: 0, padding: "7px 11px" }}>＋</Btn>
      </div>
      <div style={{ maxHeight: 180, overflowY: "auto" }}>
        {st.teilnehmer[g].map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: 7, background: `${col}0d`, marginBottom: 3, border: `1px solid ${col}22` }}>
            <span style={{ fontSize: 12 }}>{p.name}</span>
            <button onClick={() => rmP(g, p.id)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
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
                const fresh = { ...INIT, onboardingDone: true, impressum: st.impressum };
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
          <div style={{ fontSize: 36, marginBottom: 8 }}>💕</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, background: GR3(C.pink, "#ff7700", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }}>Über diese App</div>
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
    icon: "🔄",
    title: "So läuft die Show ab",
    desc: "Jede Folge hat denselben Ablauf – merke dir diese Reihenfolge für die App:",
    hint: [["1. 📦 Matchbox", "#8a5c00"], ["2. 🌙 Matching Night", "#c8005a"], ["3. 📦 Matchbox", "#8a5c00"]],
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
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "#ffe8ee" }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, background: GR3(C.pink, "#ff7700", C.gold), transition: "width 0.4s ease", borderRadius: "0 2px 2px 0" }} />
      </div>

      {/* Step counter */}
      <div style={{ position: "absolute", top: 16, right: 20, fontSize: 12, color: C.mut, fontWeight: 600 }}>{step + 1} / {OB_STEPS.length}</div>

      {/* Content */}
      <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 20 }}>{s.icon}</div>
        <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, marginBottom: 14, color: C.txt, lineHeight: 1.2 }}>{s.title}</h2>
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
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, margin: "0 0 6px", background: GR3(C.pink, "#ff7700", C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Über diese App</h1>
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
  const pd = useMemo(() => calcProbs(st.teilnehmer.frauen, st.teilnehmer.maenner, st.matchboxen, st.matchingNights), [st]);
  const pages = {
    home: <Home st={st} onShowOnboarding={() => setSt(s => ({ ...s, onboardingDone: false }))} setPage={setPage} />,
    nights: <MatchingNights st={st} setSt={setSt} />,
    matchbox: <Matchboxen st={st} setSt={setSt} />,
    analyse: <Analyse st={st} setSt={setSt} pd={pd} />,
    data: <Daten st={st} setSt={setSt} />,
  };
  return (
    <>
      {!st.onboardingDone && <Onboarding onDone={() => setSt(s => ({ ...s, onboardingDone: true }))} />}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap');*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{background:#f5f2fb}input,select,button{font-family:'DM Sans',sans-serif}input::placeholder{color:rgba(20,8,32,0.3)}select option{background:#fff;color:#140820}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(200,0,90,0.3);border-radius:2px}`}</style>
      <div style={{ minHeight: "100vh", background: C.bg, color: C.txt, fontFamily: "'DM Sans',sans-serif", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "12px 18px", background: "rgba(255,248,245,0.97)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${C.brd}`, boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
          <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, background: GR(C.pink, C.gold), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }}>💕 Perfect Match Tracker</span>
        </div>
        <div style={{ padding: "16px 14px 100px" }}>{pages[page]}</div>
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 520, background: "rgba(255,248,245,0.97)", backdropFilter: "blur(20px)", borderTop: `1px solid ${C.brd}`, display: "flex", padding: "7px 0 14px", boxShadow: "0 -2px 12px rgba(0,0,0,0.06)" }}>
          {NAV.map(n => {
            const on = page === n.id;
            return <button key={n.id} onClick={() => setPage(n.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "5px 2px", background: "none", border: "none", cursor: "pointer" }}>
              <span style={{ fontSize: 19, filter: on ? "drop-shadow(0 2px 6px rgba(255,31,114,0.55))" : "none", transition: "filter 0.2s" }}>{n.icon}</span>
              <span style={{ fontSize: 10, fontWeight: on ? 700 : 400, color: on ? C.pink : C.mut }}>{n.lbl}</span>
            </button>;
          })}
        </div>
      </div>
    </>
  );
}

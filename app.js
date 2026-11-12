"use strict";
const TZ = "Europe/Madrid";
const COLORS = {LEAD:"#a98bff",GOLD:"#ffcc4d",OIL:"#ff8a4d",SP500:"#2ee6a6",NAS100:"#c77dff",RISK:"#ff5c7a",REP:"#9fb3c8"};
const AV = {LEAD:"DL",GOLD:"Au",OIL:"WTI",SP500:"500",NAS100:"NDX",RISK:"RM",REP:"RP"};
const AGENTS = [
  {code:"LEAD",name:"Desk Lead"},{code:"GOLD",name:"Gold Bot",key:"gold"},{code:"OIL",name:"Oil Bot",key:"oil"},
  {code:"SP500",name:"SP500 Bot",key:"sp500"},{code:"NAS100",name:"NAS100 Bot",key:"nas100"},{code:"RISK",name:"Risk Manager"},{code:"REP",name:"Reporter"}];
let D = null, lastFetchOk = 0;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const usd = (v, d=2) => v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const sgn = (v, d=2) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const eur = (v, d=2) => v == null ? "—" : (v < 0 ? "−€" : "€") + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const seur = (v, d=2) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + "€" + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const pct = (v, d=2) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%";
const px = v => v == null ? "—" : Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "flat";
const fmtT = (t, opt) => new Intl.DateTimeFormat("ru-RU", Object.assign({timeZone:TZ,hour:"2-digit",minute:"2-digit"}, opt||{})).format(new Date(t*1000));
const fmtDT = t => fmtT(t,{day:"2-digit",month:"short"});
const hms = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return [h,m,x].map(n=>String(n).padStart(2,"0")).join(":"); };

const FAST_SRC = "https://5-180-180-55.sslip.io/data.json"; // VPS: снимок движка (выкладка каждые 5 с, движок — цикл 10 с)
const LIVE_SRC = "https://5-180-180-55.sslip.io/live.json"; // VPS: только котировки IC Markets, пишутся каждую 1 с
let SRC = "VPS";
let LQ = null, lqOk = 0, lqBusy = false, loadBusy = false;
async function getJSON(u, ms){
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try{ const r = await fetch(u + "?t=" + Date.now(), {cache:"no-store", signal:c.signal}); if(!r.ok) throw new Error(r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}
async function load(){
  if(loadBusy) return; loadBusy = true;
  try{
    let d = null;
    try{ d = await getJSON(FAST_SRC, 4000); SRC = "VPS"; }
    catch(e){ d = await getJSON("data.json", 8000); SRC = "GitHub"; }
    if(D && d.generated_t < D.generated_t) return;
    D = d; lastFetchOk = Date.now(); applyLive(); render();
  }catch(e){ console.warn("data.json", e); setLive(); }
  finally{ loadBusy = false; }
}
// Живые котировки раз в 1 с: цена, плавающий PnL и эквити пересчитываются в браузере по формуле движка
// (unreal: (mid − entry) × qty × dir, не хуже −маржи, USD → EUR по EURUSD; equity = cash + Σ unreal).
// Стопы, тейки, сделки и кэш считает только движок (цикл 10 с).
async function loadLive(){
  if(lqBusy) return; lqBusy = true;
  try{
    const q = await getJSON(LIVE_SRC, 900);
    if(!q || !q.quotes || q.status !== "LIVE") throw new Error("no live");
    if(LQ && q.written_t <= LQ.written_t) return;
    LQ = q; lqOk = Date.now();
    if(D && applyLive()) renderFast();
  }catch(e){ /* остаёмся на data.json */ }
  finally{ lqBusy = false; setLive(); }
}
function liveFresh(){ return LQ && (Date.now()/1000 - LQ.written_t) < 10; }
function applyLive(){
  if(!D || !liveFresh()) return false;
  if(LQ.written_t <= D.generated_t) return false;      // снимок движка свежее котировки
  const Q = LQ.quotes, fxq = Q.eurusd && Q.eurusd.mid;
  const fx = fxq || (D.fx && D.fx.rate) || 1;
  if(fxq && D.fx) D.fx.rate = fxq;
  let u = 0, any = false;
  Object.values(D.assets).forEach(a => {
    const q = Q[a.key]; if(!q || q.mid == null) return;
    if(!a.live) return;                                   // движок сейчас не на живом фиде этого символа — не подменяем
    a.price = q.mid; a.bid = q.bid; a.ask = q.ask; a.quote_t = q.t; any = true;
    const bump = c => { if(!c || !c.length) return; const b = c[c.length-1], end = Math.floor(b.t/300)*300 + 300;
      if(q.t >= b.t && q.t < end){ b.c = q.mid; if(q.mid > b.h) b.h = q.mid; if(q.mid < b.l) b.l = q.mid; } };
    bump(a.candles);
    const p = a.position;
    if(p){
      bump(p.candles);
      const d = p.side === "LONG" ? 1 : -1;
      let x = (q.mid - p.entry) * p.qty * d;
      if(p.margin) x = Math.max(x, -p.margin);
      p.price = q.mid; p.upnl = x / fx;
      p.upnl_pct_margin = p.margin ? x / p.margin * 100 : null;
    }
  });
  Object.values(D.assets).forEach(a => { if(a.position) u += a.position.upnl || 0; });
  const e = D.equity;
  if(e && e.cash != null){
    e.equity = e.cash + u; e.change = e.equity - e.start; e.change_pct = (e.equity / e.start - 1) * 100; e.multiple = e.equity / e.start;
    if(e.day_start) e.day_dd_pct = (e.equity / e.day_start - 1) * 100;
  }
  return any;
}
function renderFast(){
  [renderAgents, renderEquity, renderPositions, renderLWC, renderTicker].forEach(f => { try{ f(); }catch(e){ console.error(f.name, e); } });
  tick();
}

function setLive(){
  const el = $("live"), tx = $("live-text");
  if(!D){ el.className="live"; tx.textContent="нет данных"; return; }
  const age = Date.now()/1000 - D.generated_t;
  el.className = "live " + (age < 900 ? "ok" : "stale");
  const lv = liveFresh() && LQ.written_t > D.generated_t;
  const qa = lv ? Math.max(0, Date.now()/1000 - LQ.written_t) : null;
  tx.textContent = (age < 900 ? "LIVE SIM · " : "STALE · ") + ((D.live_feed||{}).any_live ? "IC Markets LIVE · " : "Yahoo delayed · ")
    + (lv ? "цены " + Math.round(qa) + " с назад · VPS · движок " + (age < 120 ? Math.round(age) + " с" : Math.round(age/60) + " мин") + " назад"
          : "данные " + fmtT(D.generated_t,{second:"2-digit"}) + " (Мадрид) · " + (age < 120 ? Math.round(age) + " с назад" : Math.round(age/60) + " мин назад") + " · " + SRC);
}

function tick(){
  if(!D) return;
  setLive();
  const st = D.engine.created_t; $("session-timer").textContent = st ? hms(Date.now()/1000 - st) : "--:--:--";
}

function agentState(code){
  const a = D.assets;
  if(code === "LEAD") return {s: D.desk_lead.status || "—", d:"on"};
  if(code === "RISK") return {s: D.risk.kill_switch ? "KILL SWITCH: " + D.risk.reason : (D.risk.status || "OK"), d: D.risk.kill_switch ? "bad" : "on"};
  if(code === "REP") return {s: "сделок " + D.stats.trades + ", winrate " + (D.stats.winrate ?? "—") + "%", d:"on"};
  const k = AGENTS.find(x=>x.code===code).key, x = a[k];
  if(!x) return {s:"—", d:""};
  if(x.paused && !x.position) return {s: "ПАУЗА — новые входы выключены" + (x.paused_note ? " · " + x.paused_note : ""), d:""};
  return {s: (x.paused ? "ПАУЗА (только сопровождение) · " : "") + x.status || "—", d: x.position ? "pos" : (!x.market_open ? "" : /REJECT|нет данных/.test(x.status) ? "warn" : "on")};
}

function renderAgents(){
  $("agents").innerHTML = AGENTS.map(g => { const s = agentState(g.code);
    return `<div class="chip" data-tip="${esc(g.name + ": " + s.s)}"><span class="av" style="background:${COLORS[g.code]}">${AV[g.code]}</span><b>${g.code}</b><span class="sd ${s.d}"></span><span class="st">${esc(s.s)}</span></div>`; }).join("");
}

function sparkSVG(pts, w=800, h=96){
  if(pts.length < 2) return `<svg viewBox="0 0 ${w} ${h}"><line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="#273141" stroke-dasharray="4 6"/></svg>`;
  const ys = pts.map(p=>p.eq), start = D.equity.start;
  let lo = Math.min(...ys, start), hi = Math.max(...ys, start); if(hi-lo < 2){ lo -= 1; hi += 1; }
  const t0 = pts[0].t, t1 = pts[pts.length-1].t || t0+1;
  const X = t => (t-t0)/(t1-t0||1)*w, Y = v => h-6 - (v-lo)/(hi-lo)*(h-12);
  const d = pts.map((p,i)=>(i?"L":"M")+X(p.t).toFixed(1)+","+Y(p.eq).toFixed(1)).join("");
  const up = ys[ys.length-1] >= start, c = up ? "#2ee6a6" : "#ff5c7a";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
  <line x1="0" x2="${w}" y1="${Y(start)}" y2="${Y(start)}" stroke="#3a4656" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>
  <path d="${d}L${w},${h}L0,${h}Z" fill="url(#sg)"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  <circle cx="${X(pts[pts.length-1].t)}" cy="${Y(ys[ys.length-1])}" r="4" fill="${c}"/></svg>`;
}

function renderEquity(){
  const e = D.equity;
  $("eq-big").textContent = eur(e.equity);
  $("eq-change").innerHTML = `<span class="${cls(e.change)}">${seur(e.change)} · ${pct(e.change_pct)}</span>`;
  renderPnlRows();
  $("eq-sub").innerHTML = `<b class="mono">${e.multiple.toFixed(3)}x</b> от €${e.start.toFixed(0)} · кэш ${eur(e.cash)} · реализовано ${seur(D.stats.realized)} · EURUSD ${D.fx && D.fx.rate ? D.fx.rate.toFixed(5) : "—"} · ${D.engine.cycles} циклов движка`;
  $("spark").innerHTML = sparkSVG(D.curve);
  const p = Math.max(0, Math.min(1, e.multiple - 1));
  $("prog-fill").style.width = (p*100).toFixed(1) + "%";
  $("prog-label").textContent = e.multiple >= 1 ? `${(p*100).toFixed(1)}% пути до 2x` : `ниже старта: ${pct(e.change_pct)}`;
  $("k-trades").textContent = D.stats.trades;
  $("k-open").textContent = Object.values(D.assets).filter(a=>a.position).length + "/" + D.settings.max_positions_total;
  $("k-veto").textContent = D.stats.vetoes;
  const dd = e.day_dd_pct || 0; $("k-dd").innerHTML = `<span class="${cls(dd)}">${pct(dd)}</span>`;
  $("eq-mode").textContent = `SIM · €${e.start.toFixed(0)} start`;
}

// Дневной / Недельный / Месячный PnL: реализованная часть из data.json (закрытые сделки в окне − комиссии входа открытых позиций, открытых в окне)
// + нереализованный PnL открытых позиций — живой (пересчитывается в applyLive каждую секунду, как equity)
function renderPnlRows(){
  const W = D.pnl_windows, el = $("pnl-rows"); if(!el) return;
  if(!W || !W.length){ el.innerHTML = ""; return; }   // (строку «Текущий» без окон тоже не показываем — данные ещё не пришли)
  // нереализованное — то же, что заложено в строку equity (equity − кэш): после живого пересчёта это Σ upnl по live.json,
  // до него — снимок движка; так строки всегда согласованы с equity
  const e = D.equity, u = (e && e.cash != null && e.equity != null) ? e.equity - e.cash
    : Object.values(D.assets).reduce((s, a) => s + (a.position ? (a.position.upnl || 0) : 0), 0);
  el.innerHTML = curRow(u) + W.map(w => { const v = w.realized + u, p = w.start_equity ? v / w.start_equity * 100 : null;
    return `<div class="pnl-row-w" title="с ${new Date(w.start_t*1000).toLocaleString("ru-RU",{timeZone:TZ})} (Мадрид) · equity на начало окна ${eur(w.start_equity)} (${esc(w.start_src)}) · закрыто сделок ${w.closed_trades}: ${seur(w.closed_pnl)} · комиссии входа открытых ${seur(-w.open_entry_fees)} · нереализовано ${seur(u)}"><span class="l">${esc(w.label)}</span><span class="v mono ${cls(v)}">${seur(v)}</span><span class="p mono ${cls(v)}">${pct(p)}</span></div>`; }).join("");
}

// «Текущий»: нереализованный PnL всех открытых позиций = equity − кэш (то же, что в строке equity, живое каждую 1 с);
// % — к кэшу, т.е. к equity без нереализованного. Нет позиций -> 0,00 €
function curRow(u){
  const e = D.equity, n = Object.values(D.assets).filter(a => a.position).length;
  const v = n ? (Math.abs(u) < 0.005 ? 0 : u) : 0, base = e && e.cash ? e.cash : null, p = base ? v / base * 100 : null;
  const tip = `Нереализованный PnL открытых позиций (${n}) = equity − кэш, обновляется каждую секунду по живым котировкам. % — от кэша ${eur(base)} (equity без нереализованного). Комиссии входа уже списаны из кэша и сюда не входят.`;
  return `<div class="pnl-row-w" title="${esc(tip)}"><span class="l">Текущий</span><span class="v mono ${cls(v)}">${n ? seur(v) : "€0.00"}</span><span class="p mono ${cls(v)}">${pct(p)}</span></div>`;
}

function renderDesk(){
  const r = D.risk;
  $("risk-pill").className = "pill " + (r.kill_switch ? "r" : "g");
  $("risk-pill").textContent = r.kill_switch ? "KILL SWITCH" : "RISK OK";
  const rows = [
    ["LEAD","Desk Lead", D.desk_lead.status],
    ["RISK","Risk Manager", r.kill_switch ? r.reason : r.status],
    ["REP","Reporter", `${D.stats.trades} сделок · winrate ${D.stats.winrate ?? "—"}% · одобрено ${D.stats.approved} / вето ${D.stats.vetoes}`],
  ];
  if(D.engine.data_issues && D.engine.data_issues.length) rows.push(["!","Данные", D.engine.data_issues.join("; ")]);
  if(D.filters){ const F = D.filters, bl = Object.values(D.assets).filter(a=>a.filter&&a.filter.blocked);
    rows.push(["F","Фильтры новостей/сессий", (F.enabled ? "ВКЛ — блокируют новые входы" : "ВЫКЛ — только показ, на торговлю не влияют") +
      (bl.length ? " · сейчас окно: " + bl.map(a=>a.code+" ("+a.filter.reason+")").join(", ") : "") +
      (F.calendar && !F.calendar.ok ? " · календарь FF недоступен — новости не блокируют" : "")]); }
  $("desk-rows").innerHTML = rows.map(([c,n,t]) => `<div class="drow"><span class="av" style="background:${COLORS[c]||"#ffb547"}">${AV[c]||c}</span><div class="t"><b>${n}</b><br>${esc(t||"—")}</div></div>`).join("");
  const as = Object.values(D.assets);
  $("alloc").innerHTML = as.map(a => `<div style="flex:${(a.allocation.weight||0)};background:${COLORS[a.code]}" title="${a.code}"></div>`).join("");
  $("alloc").insertAdjacentHTML("afterend", "");
  let leg = document.querySelector(".alloc-leg"); if(!leg){ leg = document.createElement("div"); leg.className="alloc-leg"; $("alloc").after(leg); }
  leg.innerHTML = as.map(a => `<span><i style="background:${COLORS[a.code]}"></i>${a.code} ${Math.round((a.allocation.weight||0)*100)}% · ${eur(a.allocation.capital,0)}</span>`).join("");
  const s = D.settings;
  $("settings").innerHTML = [
    ["Плечо", s.leverage + "x " + (s.margin_mode||"")], ["Риск/сделка", s.risk_per_trade_pct + "%"],
    ["Дневной стоп", "−" + s.daily_stop_pct + "%"], ["Макс. позиций", s.max_positions_total],
    ["SL / TP", s.sl_atr + " / " + s.tp_atr + " ATR(15m)"], ["Трейлинг", s.trailing ? "вкл · BE @1 ATR" : "выкл"], ["Трейлинг-тейк", s.trailing_tp && s.trailing_tp.enabled ? "вкл · с TP " + s.trailing_tp.activate_at_atr + " ATR, шаг " + s.trailing_tp.tp_step_atr + " ATR" : "выкл"],
    ["Фильтры", D.filters ? (D.filters.enabled ? "вкл" : "выкл (показ)") + " · новости ±" + D.filters.before_min + " мин · сессии" : "—"], ["Издержки (IC Markets)", s.costs && Object.keys(s.costs).length ? Object.entries(s.costs).map(([k,c])=>(CODES_RU[k]||k)+" "+c.per_side_bps.toFixed(2)).join(" · ") + " bp/сторона" : s.fee_bps + " + " + s.slip_bps + " bp"], ["Таймфреймы", "5m · 15m · 30m"],
    ["Счёт", "EUR · EURUSD " + (D.fx && D.fx.rate ? D.fx.rate.toFixed(4) : "—")], ["Цены", feedLabel()]
  ].map(([k,v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("");
  $("lev-sub").textContent = s.leverage + "x";
}

// ---------- candle chart ----------
function candleSVG(c, levels, opt){
  opt = opt || {}; const w = opt.w || 860, h = opt.h || 300, padR = opt.mini ? 4 : 78, padL = 6, padT = 12, padB = opt.mini ? 6 : 22;
  if(!c || !c.length) return `<svg viewBox="0 0 ${w} ${h}"><text x="${w/2}" y="${h/2}" fill="#5b6675" text-anchor="middle" font-size="13">нет свечей</text></svg>`;
  let lo = Math.min(...c.map(b=>b.l)), hi = Math.max(...c.map(b=>b.h));
  const span0 = hi - lo || hi*0.001, off = [];
  (levels||[]).forEach(L => { if(L.v == null) return;
    if(L.v >= lo - span0*1.6 && L.v <= hi + span0*1.6){ lo = Math.min(lo, L.v); hi = Math.max(hi, L.v); L.in = true; } else { L.in = false; off.push(L); } });
  const pad = (hi-lo)*0.06; lo -= pad; hi += pad;
  const n = c.length, cw = (w-padL-padR)/n, Y = v => padT + (hi-v)/(hi-lo)*(h-padT-padB), X = i => padL + i*cw + cw/2;
  let s = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`;
  if(!opt.mini){ for(let g=0; g<=4; g++){ const v = lo + (hi-lo)*g/4, y = Y(v);
      s += `<line x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}" stroke="#161d27"/><text x="${w-padR+6}" y="${y+4}" fill="#5b6675" font-size="10.5" font-family="JetBrains Mono">${px(v)}</text>`; }
    const step = Math.max(1, Math.round(n/6));
    for(let i=0;i<n;i+=step) s += `<text x="${X(i)}" y="${h-6}" fill="#5b6675" font-size="10.5" text-anchor="middle" font-family="JetBrains Mono">${fmtT(c[i].t)}</text>`; }
  if(opt.from_t){ const i0 = c.findIndex(b=>b.t >= opt.from_t); const i1 = opt.to_t ? c.findIndex(b=>b.t >= opt.to_t) : n-1;
    if(i0 >= 0){ const x0 = padL + i0*cw, x1 = padL + ((i1<0?n-1:i1)+1)*cw; s += `<rect x="${x0}" y="${padT}" width="${Math.max(2,x1-x0)}" height="${h-padT-padB}" fill="rgba(90,169,255,.05)"/>`; } }
  c.forEach((b,i) => { const up = b.c >= b.o, col = up ? "#2ee6a6" : "#ff5c7a", x = X(i), bw = Math.max(1, cw*0.62);
    s += `<line x1="${x}" x2="${x}" y1="${Y(b.h)}" y2="${Y(b.l)}" stroke="${col}" stroke-width="1" opacity=".9"/>`;
    const y1 = Y(Math.max(b.o,b.c)), y2 = Y(Math.min(b.o,b.c));
    s += `<rect x="${x-bw/2}" y="${y1}" width="${bw}" height="${Math.max(1,y2-y1)}" fill="${col}" rx="1"/>`; });
  (levels||[]).filter(L=>L.in).forEach(L => { const y = Y(L.v);
    s += `<line x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}" stroke="${L.c}" stroke-width="1.3" stroke-dasharray="${L.dash||"0"}"/>`;
    if(!opt.mini) s += `<rect x="${w-padR+2}" y="${y-9}" width="${padR-4}" height="18" rx="5" fill="${L.c}"/><text x="${w-padR/2}" y="${y+4}" fill="#061018" font-size="10" font-weight="700" text-anchor="middle" font-family="Inter">${L.t}</text>`; });
  if(!opt.mini) off.forEach((L,j) => { const below = L.v < lo; const y = below ? h-padB-10-j*16 : padT+10+j*16;
    s += `<text x="${w-padR-6}" y="${y}" fill="${L.c}" font-size="11" text-anchor="end" font-weight="700" font-family="Inter">${below?"↓":"↑"} ${L.t} ${px(L.v)}</text>`; });
  if(opt.lastLine){ const y = Y(c[n-1].c); s += `<line x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}" stroke="#8b97a8" stroke-dasharray="2 3" opacity=".6"/>`; }
  return s + "</svg>";
}

function levelsOf(p){
  const L = [{v:p.entry,t:"ENTRY",c:"#5aa9ff"},{v:p.tp,t:p.trail_tp_active?"TTP":"TP",c:"#2ee6a6",dash:"6 4"},{v:p.liq,t:"LIQ",c:"#ff9f43",dash:"2 3"}];
  if(p.sl_initial != null && p.sl != null && Math.abs(p.sl_initial - p.sl) > 1e-9){ L.push({v:p.sl_initial,t:"SL init",c:"#6b3b48",dash:"3 4"}); L.push({v:p.sl,t:p.trail_tp_active?"TTP STOP":p.trailing_active?"TRAIL":"SL BE",c:"#ff5c7a"}); }
  if(p.trail_tp_active && p.tp_initial != null && Math.abs(p.tp_initial - p.tp) > 1e-9) L.push({v:p.tp_initial,t:"TP init",c:"#1f6b55",dash:"3 4"});
  else L.push({v:p.sl,t:"STOP",c:"#ff5c7a"});
  return L;
}

function strip(active){ return `<div class="strip">` + AGENTS.map(g => `<span class="${active.includes(g.code)?"act":""}" style="${active.includes(g.code)?"background:"+COLORS[g.code]:""}">${g.code}</span>`).join("") + `</div>`; }

// Результат в EUR, если цена дойдёт до уровня (формула движка: (уровень − entry) × qty × dir, не хуже −маржи, USD → EUR по EURUSD; без комиссий, как «нереализ.»)
function levelEur(p, lvl){
  if(lvl == null || p.entry == null || !p.qty) return null;
  const fx = (D.fx && D.fx.rate) || p.fx_entry || 1, d = p.side === "LONG" ? 1 : -1;
  let x = (lvl - p.entry) * p.qty * d; if(p.margin) x = Math.max(x, -p.margin);
  return x / fx;
}
function lvlEur(p, lvl){ const v = levelEur(p, lvl); return v == null ? "" : `<div class="mono ${cls(v)}" style="font-size:12px;margin-top:2px" title="результат, если цена дойдёт до уровня (без комиссий)">${seur(v)}${v > 0 && lvl === p.sl ? " · зафиксировано" : ""}</div>`; }

function posCard(a, p, closed){
  const lev = p.leverage || D.settings.leverage, side = p.side;
  const pnl = closed ? p.pnl : p.upnl, pp = closed ? p.pnl_pct_margin : p.upnl_pct_margin;
  const badge = closed ? `<div class="badge-closed ${pnl>0?"g":"r"}">CLOSED ${seur(pnl)}</div>` : `<div class="badge-closed b">OPEN ${seur(pnl)}</div>`;
  const lv = closed ? [{v:p.entry,t:"ENTRY",c:"#5aa9ff"},{v:p.exit,t:"EXIT",c:pnl>0?"#2ee6a6":"#ff5c7a"},{v:p.sl,t:"STOP",c:"#ff5c7a",dash:"4 4"},{v:p.tp,t:"TP",c:"#2ee6a6",dash:"6 4"},{v:p.liq,t:"LIQ",c:"#ff9f43",dash:"2 3"}] : levelsOf(p);
  const trailTxt = (p.trail_events||[]).map(e=>esc(e.event)).slice(-3).join(" · ");
  const head = closed ? `Последняя закрытая сделка ${p.id} · ${esc(p.reason)}` : `Открыта ${esc(p.opened)} (Мадрид)` + (p.trail_tp_active ? " · трейлинг-тейк активен" : p.trailing_active ? " · трейлинг активен" : p.breakeven ? " · стоп в безубытке" : "");
  return `<article class="card pos-card">
    <div class="pos-left">
      <div class="asset"><span class="asset-name">${esc(a.label || a.code)}</span><span class="side ${side}">${side} ${lev}x</span></div>
      <div class="asset-sub">${srcBadge(a)} ${esc(a.icm_symbol||a.symbol)} · ${esc(a.name)} · ${head}</div>
      <span class="approved">✓ APPROVED by Risk Manager</span>${!closed && p.trail_tp_active ? ` <span class="pill g ttp-badge" title="TP достигнут: позиция не закрыта, TP и стоп идут за лучшей ценой (шаг 1 ATR)">трейлинг-тейк</span>` : ""}
      <div class="levels">
        <div class="lvl"><div class="l">ENTRY</div><div class="v mono">${px(p.entry)}</div></div>
        <div class="lvl"><div class="l">${closed?"EXIT":"PRICE"}</div><div class="v mono">${px(closed?p.exit:p.price)}</div></div>
        <div class="lvl"><div class="l">${!closed && p.trailing_active?"TRAILING STOP":"STOP"}</div><div class="v mono down">${px(p.sl)}</div>${closed?"":lvlEur(p, p.sl)}</div>
        <div class="lvl"><div class="l">${!closed && p.trail_tp_active?"TRAILING TAKE":"TAKE PROFIT"}</div><div class="v mono up">${px(p.tp)}</div>${closed?"":lvlEur(p, p.tp)}</div>
        <div class="lvl"><div class="l">LIQUIDATION</div><div class="v mono" style="color:#ff9f43">${px(p.liq)}</div></div>
        <div class="lvl"><div class="l">MARGIN / NOTIONAL</div><div class="v mono">${eur(p.margin_eur ?? p.margin)} / ${usd(p.notional,0)}</div></div>
      </div>
      <div class="pnl-row"><span class="pnl-big mono ${cls(pnl)}">${seur(pnl)}</span><span class="mono ${cls(pp)}" style="font-size:18px;font-weight:600">${pct(pp,1)}</span><span class="m" style="color:var(--mut);font-size:12px">${closed?"нетто":"нереализ."} · к марже</span></div>
      ${trailTxt ? `<div style="color:var(--mut);font-size:12px;margin-top:8px">Трейлинг: ${trailTxt}</div>` : ""}
      ${closed ? "" : tsLine(p)}
      ${strip(["LEAD", a.code, "RISK", "REP"])}
    </div>
    <div class="chart-wrap">${badge}<div class="lwc" data-lwc="${closed?"closed":"open"}:${esc(a.key)}"></div></div>
  </article>`;
}

function renderPositions(){
  const as = Object.values(D.assets), open = as.filter(a=>a.position);
  let html = open.map(a => posCard(a, a.position, false)).join("");
  if(!open.length){
    if(D.last_trade && D.assets[D.last_trade.bot]){ const a = D.assets[D.last_trade.bot]; html += posCard(a, D.last_trade, true); $("pos-note").textContent = "открытых позиций нет — показана последняя закрытая сделка"; }
    else { html += `<div class="empty"><div class="big">Пока ни одной сделки</div>Боты ждут сигнала по правилам 30m тренд → 15m подтверждение → 5m пересечение EMA. Ниже — реальные 5m-свечи, которые они сейчас смотрят.</div>`; $("pos-note").textContent = "открытых позиций нет"; }
  } else $("pos-note").textContent = open.length + " открыто · уровни пересчитываются каждые 10 с (цикл движка)";
  html += `<div class="watch">` + as.map(a => { const ch = a.chg_24h_pct;
    return `<div class="wcard"><div class="h"><span class="n" style="color:${COLORS[a.code]}">${a.code}</span><span class="p mono">${px(a.price)}</span></div>
    <div class="h" style="margin-top:2px">${srcBadge(a)}<span class="mono" style="font-size:11px;color:var(--mut)">${a.bid!=null?"bid "+px(a.bid)+" · ask "+px(a.ask):esc(a.symbol)+" · USD"}</span></div>
    <div class="h" style="margin-top:2px"><span class="mono ${cls(ch)}" style="font-size:12px">${pct(ch)} 24ч</span><span>${a.paused?`<span class="tag closed" title="${esc(a.paused_note||"")}">⏸ пауза</span> `:""}${a.market_open?`<span class="tag ${a.trend_30m||""}">30m ${a.trend_30m||"—"}</span>`:`<span class="tag closed">рынок закрыт</span>`}</span></div>
    <div class="s">${esc(a.position ? "в позиции " + a.position.side + (a.position.trail_tp_active ? " · трейлинг-тейк" : "") : a.status)}</div>
    ${fltLine(a)}
    ${adxLine(a)}
    ${candleSVG(a.candles.slice(-60), a.position ? levelsOf(a.position) : [], {mini:true,w:300,h:90})}</div>`; }).join("") + `</div>`;
  const keep = {}; document.querySelectorAll("#positions [data-lwc]").forEach(el => keep[el.getAttribute("data-lwc")] = el);
  $("positions").innerHTML = html;
  document.querySelectorAll("#positions [data-lwc]").forEach(el => { const o = keep[el.getAttribute("data-lwc")]; if(o) el.replaceWith(o); });
  Object.keys(LW).forEach(id => { if(!document.body.contains(LW[id].el)){ try{ LW[id].ch.remove(); }catch(e){} delete LW[id]; } });
}

// Тайм-стоп: через 8×15m с входа позиция закрывается, если лучший ход < +0.5 ATR (цель = вход ± 0.5 ATR)
function tsLine(p){
  const t = p.time_stop; if(!t) return "";
  const best = p.best ?? p.entry, long = p.side === "LONG";
  const fav = long ? best - p.entry : p.entry - best, reached = fav >= t.need - 1e-12;
  if(reached) return `<div class="ts-line" style="color:var(--mut);font-size:12px;margin-top:8px">⏱ Тайм-стоп снят: +${t.min_atr} ATR (${px(t.target)}) уже достигнуто</div>`;
  const left = Math.round(t.deadline_t - Date.now()/1000), mm = Math.floor(Math.abs(left)/60), ss = Math.abs(left) % 60;
  const cnt = left > 0 ? `через ${mm}:${String(ss).padStart(2,"0")}` : "срок вышел — закрытие в ближайшем цикле";
  return `<div class="ts-line" style="color:${left>0&&left<1800?"var(--amber)":"var(--mut)"};font-size:12px;margin-top:8px" title="Если за ${t.minutes} мин с входа цена ни разу не прошла +${t.min_atr} ATR в сторону сделки — закрытие TIME_STOP">⏱ Тайм-стоп ${cnt}, если цена не дойдёт до ${px(t.target)} (+${t.min_atr} ATR; сейчас лучший ход ${(fav/(t.need/t.min_atr)).toFixed(2)} ATR)</div>`;
}
// ADX(14) 1h: фильтр новых входов (вход только при ADX > порога)
function adxLine(a){
  const x = a.adx; if(!x) return "";
  if(x.value == null) return `<div class="s" style="color:var(--amber);font-size:11px" title="${esc(x.error||"")}">ADX 1h —: недоступен · вход заблокирован</div>`;
  return `<div class="s" style="color:${x.pass?"var(--mut)":"var(--amber)"};font-size:11px" title="ADX(${x.period}) последнего закрытого 1h-бара; новые входы только при ADX > ${x.min}">ADX 1h ${x.value.toFixed(1)} ${x.pass?">":"≤"} ${x.min} · ${x.pass?"вход разрешён":"вход заблокирован"}</div>`;
}
const CODES_RU = {gold:"GOLD", oil:"OIL", sp500:"SP500", nas100:"NAS100"};
function fltLine(a){
  const f = a.filter; if(!f || !f.text) return "";
  const on = D.filters && D.filters.enabled;
  if(f.blocked) return `<div class="s" style="color:var(--amber)" title="${on?"фильтр включён: новые входы блокируются":"фильтр выключен: только показ, вход не блокируется"}">⏸ ${esc(f.text)}${on?"":" · фильтр выкл"}</div>`;
  return `<div class="s" style="color:var(--mut);font-size:11px">${esc(f.text)}</div>`;
}

function renderCloses(){
  const T = D.trades, s = D.stats;
  $("close-count").textContent = T.length + " closes";
  $("close-stats").innerHTML = `<div class="cs"><div class="v mono">${s.winrate==null?"—":s.winrate.toFixed(0)+"%"}</div><div class="l">winrate (${s.wins}W / ${s.losses}L)</div></div>
    <div class="cs"><div class="v mono up">${s.avg_win==null?"—":seur(s.avg_win)}</div><div class="l">avg win</div></div>
    <div class="cs"><div class="v mono down">${s.avg_loss==null?"—":seur(s.avg_loss)}</div><div class="l">avg loss</div></div>`;
  if(!T.length){ $("lollipop").innerHTML = `<div class="empty"><div class="big">Закрытых сделок пока нет</div>Каждое закрытие появится здесь палочкой: вверх — прибыль, вниз — убыток.</div>`; return; }
  const w = 760, h = 220, m = 18, items = T.slice(-60), mx = Math.max(...items.map(t=>Math.abs(t.pnl)), 1), mid = h/2, cw = (w-2*m)/items.length;
  let svg = `<svg viewBox="0 0 ${w} ${h}"><line x1="${m}" x2="${w-m}" y1="${mid}" y2="${mid}" stroke="#273141"/>`;
  items.forEach((t,i) => { const x = m + cw*i + cw/2, y = mid - t.pnl/mx*(mid-18), c = t.pnl>0 ? "#2ee6a6" : "#ff5c7a";
    const tip = `${t.id} ${t.code} ${t.side} · ${seur(t.pnl)} (${pct(t.pnl_pct_margin,1)} маржи) · ${t.reason} · ${fmtDT(t.closed_t)}`;
    svg += `<line x1="${x}" x2="${x}" y1="${mid}" y2="${y}" stroke="${c}" stroke-width="2" opacity=".75"/><circle cx="${x}" cy="${y}" r="${Math.min(7, 3+cw/6)}" fill="${c}" data-tip="${esc(tip)}"/>`; });
  $("lollipop").innerHTML = svg + "</svg>";
}

function renderTimeline(){
  const T = D.trades;
  if(!T.length){ $("timeline").innerHTML = `<div class="empty" style="margin-left:-18px"><div class="big">Пока пусто</div>Сюда попадут самые крупные закрытия — с активом, направлением, временем и причиной выхода.</div>`; return; }
  const big = [...T].sort((a,b)=>Math.abs(b.pnl)-Math.abs(a.pnl)).slice(0,6).sort((a,b)=>b.closed_t-a.closed_t);
  $("timeline").innerHTML = big.map(t => `<div class="tl ${t.pnl>0?"g":"r"}"><div class="row"><span class="w">${t.id} · ${t.code} <span class="side ${t.side}" style="font-size:10px;padding:2px 6px">${t.side} ${t.leverage}x</span></span><span class="mono ${cls(t.pnl)}" style="font-weight:700">${seur(t.pnl)}</span></div>
    <div class="m">${fmtDT(t.closed_t)} · ${px(t.entry)} → ${px(t.exit)} · ${esc(t.reason)} · ${pct(t.pnl_pct_margin,1)} маржи</div></div>`).join("");
}

function renderTicker(){
  const items = [];
  Object.values(D.assets).forEach(a => items.push(`<span class="tk"><b style="color:${COLORS[a.code]}">${a.code}</b><span class="mono">${px(a.price)}</span> <span class="mono" style="color:${a.live?"#2ee6a6":"#ffb547"}">${a.live?"LIVE":"DELAYED"}</span> <span class="mono ${cls(a.chg_24h_pct)}">${pct(a.chg_24h_pct)}</span></span>`));
  if(D.fx && D.fx.rate) items.push(`<span class="tk"><b>EURUSD</b><span class="mono">${D.fx.rate.toFixed(5)}</span></span>`);
  items.push(`<span class="tk sim">SIM · ILLUSTRATIVE FILLS · NOT A REAL ACCOUNT · ACCOUNT IN EUR</span>`);
  AGENTS.forEach(g => { const s = agentState(g.code); items.push(`<span class="tk"><b>${g.code}</b>${esc(s.s.length>80?s.s.slice(0,80)+"…":s.s)}</span>`); });
  items.push(`<span class="tk sim">SIM · ILLUSTRATIVE FILLS · NOT A REAL ACCOUNT</span>`);
  const one = items.join("");
  $("ticker").innerHTML = one + one;
}

function renderFoot(){
  $("foot").innerHTML = `<span>Цены: ${esc(feedLabel())} · история индикаторов: Yahoo Finance (ребейз к CFD) · движок: цикл ${D.engine.cycle_seconds} с, последний ${esc(D.engine.last_cycle)} (Мадрид) · data.json ${esc(D.generated_at)} (Мадрид)</span><span>Цены и плавающий PnL на странице — каждую 1 с (live.json с VPS). Стопы, тейки, сделки и кэш считает движок каждые 10 с; data.json опрашивается каждые 5 с. Если VPS недоступен — копия на GitHub Pages (~60 с + задержка CDN). Графики TradingView — живые.</span>`;
  $("h-liq").textContent = `Ликвидация ≈ ${(100/D.settings.leverage - D.settings.maintenance_margin_pct).toFixed(1)}% от входа при ${D.settings.leverage}x.`;
}

function render(){
  [renderAgents, renderEquity, renderDesk, renderPositions, renderLWC, renderCloses, renderTimeline, renderTicker, renderFoot, renderTV].forEach(f => { try{ f(); }catch(e){ console.error(f.name, e); } });
  tick();
}

document.addEventListener("mousemove", e => { const t = e.target.closest && e.target.closest("[data-tip]"), tip = $("tip");
  if(t){ tip.textContent = t.getAttribute("data-tip"); tip.style.display = "block"; tip.style.left = Math.min(e.clientX+14, innerWidth-330) + "px"; tip.style.top = (e.clientY+14) + "px"; } else tip.style.display = "none"; });
load(); setInterval(load, 5000); loadLive(); setInterval(loadLive, 1000); setInterval(tick, 1000);

// ---------- price source ----------
function feedLabel(){
  const f = D.live_feed || {};
  if(f.any_live) return "IC Markets LIVE (cTrader FIX)";
  return "Yahoo (задержка) · IC Markets: " + ({DOWN:"нет соединения",NOT_RUNNING:"фидер не запущен",AUTH_REJECTED:"логин отклонён",CONNECTING:"подключение",LOGON_SENT:"логин…",LIVE_NO_TICKS:"нет тиков",STOPPED:"остановлен"}[f.status] || f.status || "—");
}
function srcBadge(a){ return a.live ? `<span class="src live">● IC MARKETS LIVE</span>` : `<span class="src delayed">YAHOO DELAYED</span>`; }

// ---------- TradingView Lightweight Charts (наш график позиции) ----------
const LW = {};
function renderLWC(){
  if(!window.LightweightCharts) return;
  document.querySelectorAll("[data-lwc]").forEach(el => {
    const [kind, key] = el.getAttribute("data-lwc").split(":");
    const a = D.assets[key], p = kind === "closed" ? D.last_trade : a && a.position;
    if(!p) return;
    const id = kind + ":" + key;
    let o = LW[id];
    if(!o || o.el !== el){
      const ch = LightweightCharts.createChart(el, {height: 300, layout:{background:{type:"solid",color:"transparent"}, textColor:"#8b97a8", fontFamily:"JetBrains Mono"},
        grid:{vertLines:{color:"#141b24"}, horzLines:{color:"#141b24"}}, rightPriceScale:{borderColor:"#1e2834"},
        timeScale:{borderColor:"#1e2834", timeVisible:true, secondsVisible:false}, localization:{timeFormatter: t => fmtT(t)}, crosshair:{mode:0}});
      const s = ch.addCandlestickSeries({upColor:"#2ee6a6", downColor:"#ff5c7a", borderVisible:false, wickUpColor:"#2ee6a6", wickDownColor:"#ff5c7a"});
      o = LW[id] = {el, ch, s, lines:[]};
      new ResizeObserver(() => ch.applyOptions({width: el.clientWidth})).observe(el);
    }
    const c = (p.candles || []).map(b => ({time:b.t, open:b.o, high:b.h, low:b.l, close:b.c}));
    o.s.setData(c);
    o.lines.forEach(l => o.s.removePriceLine(l)); o.lines = [];
    const L = kind === "closed" ? [{v:p.entry,t:"ENTRY",c:"#5aa9ff"},{v:p.exit,t:"EXIT",c:p.pnl>0?"#2ee6a6":"#ff5c7a"},{v:p.sl,t:"STOP",c:"#ff5c7a",dash:1},{v:p.tp,t:"TP",c:"#2ee6a6",dash:1},{v:p.liq,t:"LIQ",c:"#ff9f43",dash:2}]
      : levelsOf(p).map(x => ({v:x.v, t:x.t, c:x.c, dash: x.dash ? (x.t==="LIQ"?2:1) : 0}));
    L.filter(x => x.v != null).forEach(x => o.lines.push(o.s.createPriceLine({price:x.v, color:x.c, lineWidth:x.t==="TRAIL"||x.t==="STOP"?2:1, lineStyle:x.dash||0, axisLabelVisible:true, title:x.t})));
    if(p.opened_t) o.s.setMarkers([{time: c.length ? c.reduce((m,b)=> b.time <= p.opened_t ? b.time : m, c[0].time) : p.opened_t, position: p.side==="LONG"?"belowBar":"aboveBar", color:"#5aa9ff", shape: p.side==="LONG"?"arrowUp":"arrowDown", text:"IN"}]);
    if(!o.fitted){ o.ch.timeScale().fitContent(); o.fitted = true; }
  });
}

// ---------- TradingView Advanced Chart (живые виджеты) ----------
let TV_DONE = false;
function renderTV(){
  if(TV_DONE) return; TV_DONE = true;
  const box = $("tv-grid"); if(!box) return;
  Object.values(D.assets).forEach(a => {
    const sym = a.tv_symbol || ({gold:"ICMARKETS:XAUUSD",oil:"ICMARKETS:XTIUSD",sp500:"ICMARKETS:US500",nas100:"ICMARKETS:USTEC"}[a.key]);
    const w = document.createElement("div"); w.className = "card tv-card";
    const q = new URLSearchParams({symbol:sym, interval:"5", theme:"dark", style:"1", timezone:"Europe/Madrid", locale:"ru",
      hidesidetoolbar:"1", symboledit:"1", saveimage:"0", withdateranges:"1", studies:"[]", toolbarbg:"0a0e14"});
    w.innerHTML = `<div class="card-head"><span class="eyebrow" style="color:${COLORS[a.code]}">${a.code} · ${esc(sym)}</span><span class="pill">TradingView · live</span></div>
      <iframe class="tv-frame" loading="eager" allowtransparency="true" frameborder="0" scrolling="no" allowfullscreen src="https://s.tradingview.com/widgetembed/?${q.toString()}"></iframe>`;
    box.appendChild(w);
  });
}

/* Página "Renda": fundos listados na B3 que distribuem rendimentos (FII, Fiagro, FI-Infra e ETFs).
   Ranking descritivo (sem "melhor/pior") + comparação de histórico de proventos, DY, variação da cota e retorno total.
   Dados: data/listados (pipeline/listados.py). Nada é calculado com dado ausente: fora da cobertura = N/D. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt, CH = () => App.charts;
  App.views = App.views || {};
  const st = App.store;
  const S = {
    tipo: st.get("rdTipo", ""), seg: st.get("rdSeg", ""), q: "", liq: st.get("rdLiq", "0"), todos12: st.get("rdTodos12", false),
    sort: st.get("rdSort", { key: "liq3m", dir: -1 }), shown: 60,
    period: st.get("rd_period", "48"), provMode: st.get("rd_provMode", "rs"), volMode: st.get("rd_volMode", "px"),
    histMetric: st.get("rd_histMetric", "rt"),
    alloc: st.get("rdAlloc", {}), // simulação de renda mensal: {id: R$ alocados}
  };
  const allocOf = (id) => (S.alloc[id] != null ? S.alloc[id] : 10000);
  let rootRef = null;
  const sel = () => App.state.rendaSel;
  const saveSel = () => st.set("rendaSel", App.state.rendaSel);
  const TIPOS = [["", "Todos"], ["FII", "FII"], ["Fiagro", "Fiagro"], ["FI-Infra", "FI-Infra"], ["ETF", "ETF"]];
  const LIQ = [["0", "Qualquer liquidez"], ["100000", "≥ R$ 100 mil/dia"], ["1000000", "≥ R$ 1 mi/dia"], ["5000000", "≥ R$ 5 mi/dia"]];
  const PERIODS = [["12", "12M"], ["24", "24M"], ["36", "36M"], ["48", "48M"], ["common", "Máx. comum"]];
  const BADGE = (t) => `<span class="badge lst">${esc(t)}</span>`;
  const styleOf = (id) => {
    const i = Math.max(0, sel().indexOf(id)), n = App.SERIES_COLORS.length;
    const cycle = Math.floor(i / n) % App.LINE_TYPES.length;
    return { color: App.SERIES_COLORS[i % n], lineType: App.LINE_TYPES[cycle], symbol: App.SYMBOLS[cycle], cycle };
  };
  const swatch = (id) => {
    const s = styleOf(id);
    return s.cycle === 0 ? `<span class="legend-dot" style="background:${s.color}"></span>` : `<span class="legend-line" style="border-top:3px ${s.lineType} ${s.color}"></span>`;
  };
  const toggle = (id, force) => {
    const a = sel(), has = a.includes(id), want = force == null ? !has : force;
    if (want && !has) a.push(id); else if (!want && has) a.splice(a.indexOf(id), 1);
    saveSel();
    if (!rootRef) return;
    // Atualiza só a tabela e a comparação (preserva rolagem e busca).
    const upd = () => { if (!rootRef) return; renderTable(); renderCompare(rootRef.querySelector("#rd-cmp")); };
    if (want && !App.getFund(id)) App.lst.ensure([id]).then(upd, upd); else upd();
  };

  /* ---------------- Séries auxiliares ---------------- */
  const fullOf = (s) => { const out = new Array(App.axis.length).fill(null); if (s && s.q) s.q.forEach((v, k) => { out[s.i0 + k] = v; }); return out; };
  const cache = new Map();
  const seriesOf = (f) => {
    if (!cache.has(f.id)) cache.set(f.id, { rt: fullOf(f.serie), px: fullOf(f.serie_preco) });
    return cache.get(f.id);
  };
  const monthEndIdx = (k) => { const [y, m] = k.split("-").map(Number); const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return App.idxOnOrBefore(d < App.meta.data_base ? d : App.meta.data_base); };
  const prevMonth = (k) => { const [y, m] = k.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
  const cdi = App.benchSeries("CDI");
  const cdiMonth = (k) => { const a = monthEndIdx(prevMonth(k)), b = monthEndIdx(k); return a != null && b != null && cdi[a] && cdi[b] ? cdi[b] / cdi[a] - 1 : null; };
  const cdiYear = (y) => { const a = App.idxOnOrBefore(`${y - 1}-12-31`), b = App.idxOnOrBefore(`${y}-12-31`); return a != null && b != null && cdi[a] && cdi[b] ? cdi[b] / cdi[a] - 1 : null; };
  const lastMonths = (n) => { const out = []; let k = App.meta.data_base.slice(0, 7); for (let i = 0; i < n; i++) { out.unshift(k); k = prevMonth(k); } return out; };

  /* ---------------- Render ---------------- */
  function render(root) {
    rootRef = root;
    const idx = App.lst.index;
    if (!idx) {
      root.innerHTML = `<div class="card empty"><h3>${App.lst.failed ? "Base de fundos listados indisponível" : "Carregando fundos listados…"}</h3><p class="muted small">${App.lst.failed ? esc(App.lst.error || "") + ". A base está disponível no site e no painel local (dashboard/index.html), não no relatório em arquivo único." : "Cotações (B3), proventos (B3 e Fundos.NET) e dados da CVM."}</p></div>`;
      if (!App.lst.failed) App.lst.loadIndex().then(() => render(root), () => render(root));
      return;
    }
    const pending = sel().filter((id) => !App.getFund(id));
    if (pending.length && !App.lst.failed && !render._tried) {
      render._tried = true;
      root.innerHTML = `<div class="card empty"><h3>Carregando fundos selecionados…</h3></div>`;
      App.lst.ensure(pending).then(() => render(root), () => render(root));
      return;
    }
    render._tried = false;
    const m = idx.meta;
    root.innerHTML = `
      <div class="page-head">
        <div><h2>Renda — fundos listados</h2><p>FII, Fiagro, FI-Infra e ETFs que distribuem rendimentos. Marque fundos na tabela para simular a renda mensal e ver o histórico de proventos, da cota e da rentabilidade.</p></div>
      </div>
      ${coverageNote(m)}
      <div class="card"><div class="card-b" style="padding-bottom:10px">
        <div class="toolbar">
          <label class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" id="rd-q" type="search" placeholder="Buscar por ticker, nome, segmento ou CNPJ" value="${esc(S.q)}" aria-label="Buscar fundos listados"></label>
          <div class="seg" id="rd-tipo" role="group" aria-label="Tipo de fundo">${TIPOS.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${S.tipo === v}">${t}</button>`).join("")}</div>
          <select class="select" id="rd-seg" aria-label="Segmento"></select>
          <select class="select" id="rd-liq" aria-label="Liquidez mínima">${LIQ.map(([v, t]) => `<option value="${v}" ${S.liq === v ? "selected" : ""}>${t}</option>`).join("")}</select>
          <label class="f-check small" title="Proventos em todos os 12 últimos meses"><input type="checkbox" id="rd-12" ${S.todos12 ? "checked" : ""}> Pagou nos 12 meses</label>
          <span class="result-count" id="rd-count"></span>
        </div>
      </div>
      <div class="table-wrap" id="rd-table" style="max-height:560px"></div>
      <div class="card-note">DY 12M = proventos dos últimos 12 meses ÷ preço na data-base (${fmt.date(App.meta.data_base)}). Retorno total = preço + proventos reinvestidos. Liquidez = volume médio diário na B3 (3 meses). Clique nos títulos para ordenar; <b>N/D</b> = não disponível (passe o mouse para ver o motivo).</div>
      </div>
      <div id="rd-cmp"></div>`;
    bindToolbar(root);
    renderTable();
    renderCompare(root.querySelector("#rd-cmp"));
  }

  function coverageNote(m) {
    const parts = [];
    if (m.b3_cobertura) parts.push(`eventos corporativos da B3 a partir de ${fmt.monthLabel(m.b3_cobertura)}`);
    parts.push(m.fnet_cobertura ? `avisos de rendimentos do Fundos.NET (FII e Fiagro) desde ${fmt.monthLabel(m.fnet_cobertura)}` : "avisos do Fundos.NET (FII e Fiagro) ainda em coleta");
    return `<div class="small muted" style="margin:-6px 0 12px">${fmt.int(m.n)} fundos com negociação no último mês (${Object.entries(m.por_tipo || {}).map(([k, v]) => `${k} ${v}`).join(" · ")}). Histórico oficial de proventos: ${parts.join("; ")}. FI-Infra e ETFs: proventos só a partir da janela da B3 (cresce a cada mês).</div>`;
  }

  /* ---------------- Ranking ---------------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const COLS = [
    { k: "preco", l: "Preço", kind: "money2", t: "Fechamento na data-base (R$)" },
    { k: "dy12", l: "DY 12M", kind: "pctu", t: "Proventos dos últimos 12 meses ÷ preço na data-base" },
    { k: "prov12", l: "Prov. 12M", kind: "num2", t: "Proventos por cota nos últimos 12 meses (R$, data-com)" },
    { k: "meses_pag12", l: "Meses c/ pag.", kind: "int", t: "Meses com provento nos últimos 12" },
    { k: "var12", l: "Var. cota 12M", kind: "pct", t: "Variação do preço (ajustado por desdobramentos), sem proventos" },
    { k: "rt12", l: "Ret. total 12M", kind: "pct", t: "Preço + proventos reinvestidos" },
    { k: "pvp", l: "P/VP", kind: "ratio", t: "Preço ÷ valor patrimonial da cota (CVM)" },
    { k: "liq3m", l: "Liquidez 3M", kind: "money", t: "Volume financeiro médio diário na B3, 3 meses" },
  ];
  const ndWhy = (r, k) => {
    if (["dy12", "prov12", "meses_pag12", "cv12", "rt12", "rt24a"].includes(k) && r.cobertura) return `Histórico oficial de proventos completo apenas para data-com a partir de ${fmt.date(r.cobertura)}`;
    if (k === "pvp") return "Valor patrimonial da cota não disponível na CVM";
    if (k === "pl") return "PL não disponível na CVM";
    if (k === "cv12") return "Sem proventos no período";
    return "Histórico insuficiente";
  };
  function cell(v, kind, why) {
    if (v == null) return App.ND(why);
    switch (kind) {
      case "money2": return `<span class="num">${fmt.num(v, 2)}</span>`;
      case "num2": return `<span class="num">${fmt.num(v, 2)}</span>`;
      case "pctu": return App.cell(v, "pct", why, { sign: false, color: false });
      case "cv": return `<span class="num">${fmt.num(v, 2)}</span>`;
      case "int": return `<span class="num">${v}</span>`;
      case "ratio": return App.cell(v, "ratio", why);
      case "money": return App.cell(v, "money", why);
      default: return App.cell(v, "pct", why);
    }
  }
  function rows() {
    const R = App.lst.index.fundos.map(App.lstRow);
    const q = norm(S.q), qd = S.q.replace(/\D/g, "");
    return R.filter((r) => {
      // Página de renda: FII, Fiagro, FI-Infra; ETFs só se já distribuíram proventos.
      if (r.tipo === "ETF" && !r.n_prov) return false;
      if (S.tipo && r.tipo !== S.tipo) return false;
      if (S.seg && r.segmento !== S.seg) return false;
      if (+S.liq && !(r.liq3m >= +S.liq)) return false;
      if (S.todos12 && r.meses_pag12 !== 12) return false;
      if (q && !(norm(r.ticker + " " + r.nome + " " + r.segmento + " " + r.gestor).includes(q) || (qd.length >= 4 && (r.cnpj || "").replace(/\D/g, "").includes(qd)))) return false;
      return true;
    });
  }
  function renderTable() {
    const wrap = document.getElementById("rd-table");
    if (!wrap) return;
    const segs = [...new Set(App.lst.index.fundos.map(App.lstRow).filter((r) => (!S.tipo || r.tipo === S.tipo) && !(r.tipo === "ETF" && !r.n_prov)).map((r) => r.segmento).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    if (S.seg && !segs.includes(S.seg)) S.seg = "";
    document.getElementById("rd-seg").innerHTML = `<option value="">Todos os segmentos</option>` + segs.map((s) => `<option ${s === S.seg ? "selected" : ""}>${esc(s)}</option>`).join("");
    const { key, dir } = S.sort;
    const list = rows().sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return a.ticker.localeCompare(b.ticker);
      if (va == null) return 1; if (vb == null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
      return c * dir || a.ticker.localeCompare(b.ticker);
    });
    document.getElementById("rd-count").textContent = `${list.length} fundos`;
    const arrow = (k) => (key === k ? (dir > 0 ? "▲" : "▼") : "");
    let h = `<table class="data"><thead><tr><th class="sel-col"><span class="hidden">Selecionar</span></th>
      <th class="l sortable sticky-col" data-sort="ticker" style="left:36px">Fundo <span class="arrow">${arrow("ticker")}</span></th>
      ${COLS.map((c) => `<th class="sortable" data-sort="${c.k}" title="${esc(c.t)}">${esc(c.l)} <span class="arrow">${arrow(c.k)}</span></th>`).join("")}</tr></thead><tbody>`;
    list.slice(0, S.shown).forEach((r) => {
      const on = sel().includes(r.id);
      h += `<tr data-id="${esc(r.id)}" class="${on ? "selected" : ""}">
        <td class="sel-col"><input type="checkbox" data-sel="${esc(r.id)}" ${on ? "checked" : ""} aria-label="Selecionar ${esc(r.ticker)}"></td>
        <td class="l fund sticky-col" style="left:36px"><div class="name">${esc(r.ticker)} ${BADGE(r.tipo)}</div><div class="meta">${esc(r.nome.replace(r.ticker + " · ", ""))}${r.segmento ? " · " + esc(r.segmento) : ""}</div></td>
        ${COLS.map((c) => `<td>${cell(r[c.k], c.kind, ndWhy(r, c.k))}</td>`).join("")}</tr>`;
    });
    if (!list.length) h += `<tr><td class="l" colspan="${COLS.length + 2}"><div class="empty"><h3>Nenhum fundo atende aos filtros</h3></div></td></tr>`;
    h += "</tbody></table>";
    if (list.length > S.shown) h += `<div style="padding:10px 18px"><button class="btn" type="button" data-more>Mostrar mais (${list.length - S.shown} restantes)</button></div>`;
    wrap.innerHTML = h;
  }
  function bindToolbar(root) {
    let t;
    root.querySelector("#rd-q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; S.shown = 60; renderTable(); }, 120); });
    root.querySelector("#rd-tipo").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      S.tipo = b.dataset.v; st.set("rdTipo", S.tipo); S.shown = 60;
      root.querySelectorAll("#rd-tipo button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === S.tipo)));
      renderTable();
    });
    root.querySelector("#rd-seg").addEventListener("change", (e) => { S.seg = e.target.value; st.set("rdSeg", S.seg); renderTable(); });
    root.querySelector("#rd-liq").addEventListener("change", (e) => { S.liq = e.target.value; st.set("rdLiq", S.liq); renderTable(); });
    root.querySelector("#rd-12").addEventListener("change", (e) => { S.todos12 = e.target.checked; st.set("rdTodos12", S.todos12); renderTable(); });
    root.querySelector("#rd-table").addEventListener("click", (e) => {
      if (e.target.closest("[data-more]")) { S.shown += 60; renderTable(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) { const k = th.dataset.sort; S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: k === "ticker" || k === "cv12" || k === "vol12" || k === "pvp" ? 1 : -1 }; st.set("rdSort", S.sort); renderTable(); return; }
      const tr = e.target.closest("tr[data-id]");
      if (tr) toggle(tr.dataset.id);
    });
  }

  /* ---------------- Comparação de renda (fundos marcados) ----------------
     1) Resumo · 2) Simulador de renda mensal · 3) Histórico de proventos · 4) Cota e volatilidade · 5) Rentabilidade mês a mês */
  function renderCompare(el) {
    const funds = sel().map((id) => App.getFund(id)).filter(Boolean);
    const missing = sel().filter((id) => !App.getFund(id));
    if (!funds.length) {
      el.innerHTML = `<div class="card empty" style="margin-top:16px"><h3>Selecione fundos para comparar a renda</h3><p>Marque fundos na tabela acima (por exemplo, FIIs do mesmo segmento ou FI-Infras).</p>${missing.length ? `<p class="small muted">${missing.length} fundo(s) selecionado(s) antes não estão na base desta data-base. <a href="#" data-drop>Limpar</a></p>` : ""}</div>`;
      const d = el.querySelector("[data-drop]"); if (d) d.addEventListener("click", (e) => { e.preventDefault(); App.state.rendaSel.length = 0; saveSel(); renderTable(); renderCompare(el); });
      return;
    }
    el.innerHTML = `
      <div class="card" style="margin-top:16px"><div class="card-b">
        <div class="toolbar">
          <div class="chips">${funds.map((f) => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px">${swatch(f.id)}<b>${esc(f.ticker)}</b> ${BADGE(f.tipo)}<button type="button" data-rm="${esc(f.id)}" style="border:0;background:none;padding:0 0 0 4px;color:var(--muted)" aria-label="Remover ${esc(f.ticker)}">×</button></span>`).join("")}</div>
          <button class="btn ghost" type="button" data-clear>Limpar</button>
          <span style="flex:1"></span>
          <button class="btn" type="button" data-send title="Adicionar estes fundos à página Comparação (risco, correlação, quadro completo)">Abrir na Comparação →</button>
        </div>
        ${missing.length ? `<div class="warn-note" style="margin-top:10px">${missing.map((id) => esc(App.fundName(id))).join(", ")}: fora da base desta data-base (sem negociação recente ou indisponível).</div>` : ""}
      </div>
      <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-resumo"></table></div>
      <div class="card-note">Data-base ${fmt.date(App.meta.data_base)}. DY 12M = proventos dos últimos 12 meses ÷ preço atual. Valores lado a lado, sem destaque de "melhor" ou "pior".</div></div>

      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Simulação de renda mensal</h3><span class="sub">Informe quanto aplicar em cada fundo</span></div>
        <div class="card-b" style="padding-bottom:4px">
          <div class="toolbar" id="rd-alloc">${funds.map((f) => `<label class="small" style="display:inline-flex;align-items:center;gap:6px">${swatch(f.id)}<b>${esc(f.ticker)}</b> R$ <input class="input" data-alloc="${esc(f.id)}" inputmode="numeric" value="${esc(fmt.num(allocOf(f.id), 0))}" style="width:110px" aria-label="Valor alocado em ${esc(f.ticker)}"></label>`).join("")}
            <span class="small muted" id="rd-alloc-total"></span></div>
        </div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-cart"></table></div>
        <div class="card-b" style="padding-top:8px"><div class="chart short" id="rd-ch-cart" role="img" aria-label="Renda mensal da carteira por fundo"></div></div>
        <div class="card-note" id="rd-cart-note"></div></div>

      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Histórico de distribuição de proventos</h3>
          <div class="toolbar no-print"><div class="seg" id="rd-provmode" role="group"><button type="button" data-v="rs">R$ por cota</button><button type="button" data-v="dy">DY mensal</button></div>
          <div class="seg" id="rd-period" role="group" aria-label="Período">${PERIODS.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("")}</div></div></div>
        <div class="card-b"><div class="chart" id="rd-ch-prov"></div></div><div class="card-note" id="rd-prov-note"></div></div>

      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Histórico da cota e volatilidade</h3>
          <div class="seg no-print" id="rd-volmode" role="group"><button type="button" data-v="px">Preço da cota</button><button type="button" data-v="vol">Volatilidade móvel</button><button type="button" data-v="dd">Queda desde o pico</button></div></div>
        <div class="card-b"><div class="chart" id="rd-ch-vol"></div></div><div class="card-note" id="rd-vol-note"></div></div>

      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Rentabilidade histórica mês a mês</h3>
          <div class="seg no-print" id="rd-histmetric" role="group"><button type="button" data-v="rt">Retorno total</button><button type="button" data-v="var">Variação da cota</button><button type="button" data-v="dy">DY</button></div></div>
        <div class="card-b" id="rd-hist"></div>
        <div class="card-note" id="rd-hist-note"></div></div>`;
    el.querySelector(".chips").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) toggle(b.dataset.rm, false); });
    el.querySelector("[data-clear]").addEventListener("click", () => { App.state.rendaSel.length = 0; saveSel(); renderTable(); renderCompare(el); });
    el.querySelector("[data-send]").addEventListener("click", () => { funds.forEach((f) => { App.rememberName(f.id, f.nome); App.toggleSelect(f.id, true); }); location.hash = "#/comparacao"; });
    const bindSeg = (id, key, fn) => {
      const s = el.querySelector(id);
      const sync = () => s.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S[key])));
      sync();
      s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S[key] = b.dataset.v; st.set("rd_" + key, S[key]); sync(); fn(); });
    };
    bindSeg("#rd-period", "period", () => { drawProv(el, funds); drawVol(el, funds); });
    bindSeg("#rd-provmode", "provMode", () => drawProv(el, funds));
    bindSeg("#rd-volmode", "volMode", () => drawVol(el, funds));
    bindSeg("#rd-histmetric", "histMetric", () => drawHist(el, funds));
    el.querySelector("#rd-alloc").addEventListener("change", (e) => {
      const inp = e.target.closest("[data-alloc]"); if (!inp) return;
      const v = +String(inp.value).replace(/\./g, "").replace(",", ".");
      if (v >= 0 && isFinite(v)) { S.alloc[inp.dataset.alloc] = v; st.set("rdAlloc", S.alloc); inp.value = fmt.num(v, 0); drawCart(el, funds); }
      else inp.value = fmt.num(allocOf(inp.dataset.alloc), 0);
    });
    drawResumo(el, funds);
    drawCart(el, funds);
    drawProv(el, funds);
    drawVol(el, funds);
    drawHist(el, funds);
  }

  const nMonths = () => (S.period === "common" ? 48 : +S.period);
  const firstMonth = (funds) => { // 1º mês com histórico comum a todos os fundos (Máx. comum)
    const fs = funds.map((f) => Object.keys(f.meses || {}).filter((k) => (f.meses[k] || [])[0] != null).sort()[0]).filter(Boolean);
    return fs.length ? fs.sort().slice(-1)[0] : App.meta.data_base.slice(0, 7);
  };
  const keysFor = (funds) => {
    if (S.period !== "common") return lastMonths(+S.period);
    const k0 = firstMonth(funds); return lastMonths(48).filter((k) => k >= k0);
  };

  function drawResumo(el, funds) {
    const r = (f) => f.renda || {}, nd = (f) => App.LST_ND_PROV(f);
    const rows = [
      ["Preço na data-base", (f) => (r(f).preco == null ? App.ND() : `<span class="num">R$ ${fmt.num(r(f).preco, 2)}</span>`)],
      ["DY 12M", (f) => App.cell(r(f).dy12, "pct", nd(f), { sign: false, color: false })],
      ["Proventos 12M (R$/cota)", (f) => (r(f).prov12 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).prov12, 2)}</span>`)],
      ["Meses com pagamento (12M)", (f) => (r(f).meses_pag12 == null ? App.ND(nd(f)) : `<span class="num">${r(f).meses_pag12}/12</span>`)],
      ["Retorno total 12M", (f) => App.cell((f.ret["12m"] || {}).f, "pct", (f.ret["12m"] || {}).nd)],
      ["Variação da cota 12M", (f) => App.cell(((f.ret_preco || {})["12m"] || {}).f, "pct", ((f.ret_preco || {})["12m"] || {}).nd)],
      ["Volatilidade 12M", (f) => App.cell(((f.risk || {})["12m"] || {}).vol, "pct", ((f.risk || {})["12m"] || {}).nd || "Histórico insuficiente", { sign: false, color: false })],
      ["P/VP", (f) => App.cell(r(f).pvp, "ratio", "Valor patrimonial da cota não disponível na CVM")],
      ["Liquidez média diária (3M)", (f) => App.cell((f.liq || {}).vol_3m, "money", "Histórico de negociação insuficiente")],
      ["Segmento", (f) => `<span class="small">${esc(f.segmento || f.tipo)}</span>`],
    ];
    el.querySelector("#rd-resumo").innerHTML = `<thead><tr><th class="l"></th>${funds.map((f) => `<th class="l">${swatch(f.id)}${esc(f.ticker)}<div class="small muted" style="font-weight:400;text-transform:none;letter-spacing:0">${esc(f.nome.replace(f.ticker + " · ", ""))}</div></th>`).join("")}<th class="l" style="color:var(--muted)">CDI</th></tr></thead><tbody>` +
      rows.map(([label, fn]) => `<tr style="cursor:default"><td class="l">${label}</td>${funds.map((f) => `<td>${fn(f)}</td>`).join("")}<td>${label === "Retorno total 12M" ? App.cell((funds[0].ret["12m"] || {}).cdi, "pct", "", { color: false }) : '<span class="muted">—</span>'}</td></tr>`).join("") + "</tbody>";
  }

  /* Simulação de renda mensal: X reais no fundo A, Y no fundo B… → renda com os proventos efetivamente pagos
     nos últimos 12 meses (mesmo nº de cotas o período todo). Cotas inteiras ao preço da data-base. */
  function drawCart(el, funds) {
    const keys = lastMonths(12), kdb = App.meta.data_base.slice(0, 7);
    const money = (v, why) => (v == null ? App.ND(why || "") : `<span class="num">R$ ${fmt.num(v, 2)}</span>`);
    const R = funds.map((f) => {
      const p = (f.renda || {}).preco, X = allocOf(f.id);
      const cotas = p ? Math.floor(X / p) : 0, inv = cotas * p;
      const mes = keys.map((k) => { const m = (f.meses || {})[k]; return m === undefined ? undefined : m[0] == null ? null : cotas * m[0]; });
      const cov = mes.filter((v) => v != null);
      const media = cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null;
      return { f, p, X, cotas, inv, mes, n: cov.length, media, min: cov.length ? Math.min(...cov) : null, max: cov.length ? Math.max(...cov) : null,
        ult: mes[11], soma12: cov.length === 12 ? cov.reduce((a, b) => a + b, 0) : null, yld: media != null && inv > 0 ? (media * 12) / inv : null };
    });
    const totInv = R.reduce((a, r) => a + r.inv, 0), totX = R.reduce((a, r) => a + r.X, 0);
    const all = (fn) => (R.every((r) => fn(r) != null) ? R.reduce((a, r) => a + fn(r), 0) : null);
    const totMes = keys.map((_, j) => all((r) => r.mes[j]));
    const totMedia = all((r) => r.media);
    const cdiMes = keys.map((k) => { const c = cdiMonth(k); return c == null ? null : totInv * c; });
    el.querySelector("#rd-alloc-total").textContent = `Total: R$ ${fmt.num(totX, 0)}`;
    const ndWhy = (r) => (r.p ? App.LST_ND_PROV(r.f) : "Sem preço na data-base");
    const partial = (r) => (r.n && r.n < 12 ? ` <span class="small muted" title="Média dos meses com histórico oficial de proventos">(${r.n} meses)</span>` : "");
    const rows = [
      ["Cotas compradas (preço da data-base)", (r) => `<span class="num">${fmt.int(r.cotas)}</span> <span class="small muted">× R$ ${fmt.num(r.p || 0, 2)}</span>`, `<span class="num">R$ ${fmt.num(totInv, 2)}</span>`],
      [`<b>Renda média por mês</b> (12M)`, (r) => `<b>${money(r.media, ndWhy(r))}</b>` + partial(r), `<b>${money(totMedia, "Algum fundo sem histórico de proventos")}</b>`],
      [`Renda no último mês (${fmt.monthLabel(kdb)})`, (r) => money(r.ult, ndWhy(r)), money(totMes[11], "Algum fundo sem provento conhecido no mês")],
      ["Menor / maior mês (12M)", (r) => (r.min == null ? App.ND(ndWhy(r)) : `<span class="num">R$ ${fmt.num(r.min, 2)} / R$ ${fmt.num(r.max, 2)}</span>`), ""],
      ["Renda em 12 meses", (r) => money(r.soma12, ndWhy(r)), money(all((r) => r.soma12), "Algum fundo sem 12 meses de histórico oficial de proventos")],
      ["Renda anual ÷ valor investido", (r) => App.cell(r.yld, "pct", ndWhy(r), { sign: false, color: false }) + partial(r), App.cell(totMedia != null && totInv ? (totMedia * 12) / totInv : null, "pct", "", { sign: false, color: false })],
      ["CDI sobre o mesmo valor (média mensal, bruto)", () => '<span class="muted">—</span>', money(cdiMes.every((v) => v != null) ? cdiMes.reduce((a, b) => a + b, 0) / 12 : null)],
    ];
    el.querySelector("#rd-cart").innerHTML = `<thead><tr><th class="l"></th>${R.map((r) => `<th>${swatch(r.f.id)}${esc(r.f.ticker)}</th>`).join("")}<th>Carteira</th></tr></thead><tbody>` +
      rows.map(([label, fn, tot]) => `<tr style="cursor:default"><td class="l">${label}</td>${R.map((r) => `<td>${fn(r)}</td>`).join("")}<td><b>${tot}</b></td></tr>`).join("") + "</tbody>";
    const series = R.map((r) => ({ name: r.f.ticker, color: styleOf(r.f.id).color, data: r.mes.map((v) => (v == null ? null : +v.toFixed(2))) }));
    series.push({ name: "CDI s/ valor investido (bruto)", color: App.BENCH_COLOR, line: true, dashed: true, data: cdiMes.map((v) => (v == null ? null : +v.toFixed(2))) });
    CH().monthly(el.querySelector("#rd-ch-cart"), keys.map(fmt.monthLabel), series, { bars: true, stack: true, fmt: (v) => "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) });
    el.querySelector("#rd-cart-note").textContent = `Renda que a carteira teria recebido em cada um dos últimos 12 meses, com as cotas compradas hoje (inteiras, ao fechamento de ${fmt.date(App.meta.data_base)}) × rendimento pago por cota em cada mês (data-com), sem reinvestir. Rendimentos de FII, Fiagro e FI-Infra podem ser isentos de IR para pessoa física sob condições legais; o CDI é bruto. Renda passada não garante renda futura. Sem custos de negociação.`;
  }

  function drawProv(el, funds) {
    const keys = keysFor(funds);
    const series = funds.map((f) => {
      const s = styleOf(f.id);
      return { name: f.ticker, color: s.color, lineType: s.lineType, symbol: s.symbol, data: keys.map((k) => { const m = (f.meses || {})[k]; return m ? (S.provMode === "dy" ? m[1] : m[0]) : null; }) };
    });
    if (S.provMode === "dy") series.push({ name: "CDI (mês)", color: App.BENCH_COLOR, dashed: true, data: keys.map(cdiMonth) });
    CH().monthly(el.querySelector("#rd-ch-prov"), keys.map(fmt.monthLabel), series, {
      bars: S.provMode === "rs" && funds.length <= 3, fmt: S.provMode === "dy" ? (v) => CH().pct(v, 2) : (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }),
    });
    const semHist = funds.filter((f) => (f.renda || {}).cobertura > App.axis[0]).map((f) => f.ticker);
    el.querySelector("#rd-prov-note").textContent = (S.provMode === "dy" ? "DY do mês = proventos com data-com no mês ÷ fechamento do mês anterior; CDI do mês tracejado. " : "Rendimentos pagos por cota (data-com), ajustados a desdobramentos/grupamentos. ") +
      `Fontes: avisos aos cotistas do Fundos.NET (FII/Fiagro, desde ${fmt.monthLabel((App.lst.index.meta.fnet_cobertura || "2022-07"))}) e eventos da B3.` +
      (semHist.length ? ` ${semHist.join(", ")}: histórico oficial só a partir de ${fmt.date(funds.find((f) => semHist.includes(f.ticker)).renda.cobertura)} (FI-Infra/ETF não publicam avisos estruturados; o histórico cresce a cada mês).` : "");
  }

  /* Volatilidade móvel: desvio-padrão dos retornos diários do preço em 63 pregões (~3 meses) × √252. */
  const VOL_N = 63;
  function drawVol(el, funds) {
    const last = App.axis.length - 1;
    let i0 = S.period === "common" ? Math.max(...funds.map((f) => App.firstIdx(seriesOf(f).px) ?? 0)) : CH().periodStart(nMonths());
    const lines = funds.map((f) => {
      const px = seriesOf(f).px, stl = styleOf(f.id);
      const fi = App.firstIdx(px); if (fi == null) return null;
      const s0 = Math.max(i0, fi);
      let data;
      if (S.volMode === "px") data = px.slice(s0, last + 1).map((v, k) => [App.axis[s0 + k], v]);
      else if (S.volMode === "dd") data = CH().drawdown(px, s0, last);
      else {
        data = [];
        for (let i = Math.max(s0, fi + VOL_N); i <= last; i++) {
          const r = [];
          for (let j = i - VOL_N + 1; j <= i; j++) if (px[j] != null && px[j - 1] != null) r.push(px[j] / px[j - 1] - 1);
          if (r.length < 0.9 * VOL_N) { data.push([App.axis[i], null]); continue; }
          const m = r.reduce((a, b) => a + b, 0) / r.length;
          data.push([App.axis[i], Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(App.meta.dias_uteis_ano)]);
        }
      }
      return { name: f.ticker, color: stl.color, lineType: stl.lineType, data };
    }).filter(Boolean);
    const fy = S.volMode === "px" ? (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (v) => CH().pct(v, 1);
    CH().timeLines(el.querySelector("#rd-ch-vol"), lines, { fmtY: fy, yMax: S.volMode === "dd" ? 0 : undefined, zoom: true });
    el.querySelector("#rd-vol-note").textContent = {
      px: "Preço de fechamento na B3, ajustado a desdobramentos/grupamentos (base atual de cotas). Não inclui proventos.",
      vol: "Volatilidade anualizada da cota em janela móvel de 63 pregões (~3 meses): desvio-padrão dos retornos diários do preço × √252. Em fundos pouco negociados, dias sem negócio repetem o último preço (até 5 pregões).",
      dd: "Queda do preço em relação ao maior preço anterior no período (drawdown da cota, sem proventos).",
    }[S.volMode];
  }

  /* Rentabilidade histórica mês a mês, no formato de lâmina: um quadro por fundo, anos × meses + ano + acumulado. */
  const HIST = { rt: [3, "Retorno total (preço + proventos reinvestidos)"], var: [2, "Variação da cota (só preço)"], dy: [1, "DY do mês (proventos ÷ preço do mês anterior)"] };
  const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  function drawHist(el, funds) {
    const [pos, label] = HIST[S.histMetric];
    const yearPos = { rt: 3, var: 2, dy: 1 }[S.histMetric];
    const kdb = App.meta.data_base.slice(0, 7);
    const cellv = (v, f, k) => {
      if (v === undefined) return '<span class="muted">—</span>';
      if (v == null) return App.ND(pos === 1 || pos === 3 ? App.LST_ND_PROV(f) : "Sem cotação");
      return App.cell(v, "pct", "", S.histMetric === "dy" ? { sign: false, color: false } : {});
    };
    el.querySelector("#rd-hist").innerHTML = funds.map((f) => {
      const years = [...new Set(Object.keys(f.meses || {}).map((k) => k.slice(0, 4)))].sort().reverse();
      return `<div style="margin-bottom:18px"><div style="font-weight:600;margin-bottom:6px">${swatch(f.id)}${esc(f.ticker)} <span class="small muted" style="font-weight:400">${esc(f.nome.replace(f.ticker + " · ", ""))}</span></div>
        <div class="table-wrap" style="max-height:none"><table class="compact monthly"><thead><tr><th>Ano</th>${MESES.map((m) => `<th>${m}</th>`).join("")}<th>Ano</th><th style="color:var(--muted)">CDI ano</th></tr></thead><tbody>
        ${years.map((y) => {
          const a = (f.anos || {})[y];
          const cdiA = y === kdb.slice(0, 4) ? (cdi[App.idxOnOrBefore(`${y - 1}-12-31`)] ? cdi[App.axis.length - 1] / cdi[App.idxOnOrBefore(`${y - 1}-12-31`)] - 1 : null) : cdiYear(+y);
          return `<tr><td><b>${y}</b>${y === kdb.slice(0, 4) ? "*" : ""}</td>${MESES.map((_, i) => { const k = `${y}-${String(i + 1).padStart(2, "0")}`; const m = (f.meses || {})[k]; return `<td class="cell">${k > kdb ? "" : cellv(m ? m[pos] : undefined, f, k)}</td>`; }).join("")}
            <td class="cell"><b>${cellv(a ? a[yearPos] : undefined, f)}</b></td><td class="cell">${y <= App.axis[0].slice(0, 4) ? '<span class="muted">—</span>' : App.cell(cdiA, "pct", "", { color: false })}</td></tr>`;
        }).join("")}</tbody></table></div></div>`;
    }).join("");
    el.querySelector("#rd-hist-note").textContent = `${label}. Fim de mês a fim de mês, pelo fechamento na B3 (* ano/mês da data-base ${fmt.date(App.meta.data_base)}). — = fora do histórico do fundo; N/D = proventos fora da cobertura oficial. Coluna "Ano": ${S.histMetric === "dy" ? "proventos do ano ÷ preço no fim do ano anterior" : "composição dos meses"}.`;
  }

  App.views.renda = { render, destroy() { rootRef = null; } };
})();

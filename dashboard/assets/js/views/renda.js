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
    period: st.get("rdPeriod", "12"), provMode: st.get("rdProvMode", "dy"), growthMode: st.get("rdGrowth", "rt"),
    tabMetric: st.get("rdTabMetric", "dy"), yearMetric: st.get("rdYearMetric", "rt"), amount: st.get("rdAmount", 10000),
    alloc: st.get("rdAlloc", {}), // simulador de carteira: {id: R$ alocados}
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
        <div><h2>Renda — fundos listados</h2><p>Fundos negociados na B3 que distribuem rendimentos: FII, Fiagro, FI-Infra e ETFs. Compare o histórico de pagamentos, o dividend yield (DY), a variação da cota e o retorno total (proventos reinvestidos). Marque fundos na tabela para compará-los abaixo.</p></div>
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
      <div class="card-note">DY 12M = proventos (data-com) dos últimos 12 meses ÷ preço de fechamento na data-base (${fmt.date(App.meta.data_base)}). Retorno total = preço + proventos reinvestidos na data ex. Liquidez = volume financeiro médio diário na B3 (3 meses). P/VP = preço ÷ valor patrimonial da cota informado à CVM. Ordem da tabela apenas descritiva — clique nos títulos para ordenar. <b>N/D</b> = não disponível (passe o mouse para ver o motivo).</div>
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
    return `<div class="small muted" style="margin:-6px 0 12px">${fmt.int(m.n)} fundos com negociação no último mês (${Object.entries(m.por_tipo || {}).map(([k, v]) => `${k} ${v}`).join(" · ")}). Histórico oficial de proventos: ${parts.join("; ")}. Para FI-Infra e ETFs, o histórico de proventos começa na janela da B3 e cresce a cada atualização; antes disso, retorno total e DY aparecem como N/D (a variação da cota tem histórico completo).</div>`;
  }

  /* ---------------- Ranking ---------------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const COLS = [
    { k: "preco", l: "Preço", kind: "money2", t: "Fechamento na data-base (R$)" },
    { k: "dy12", l: "DY 12M", kind: "pctu", t: "Proventos dos últimos 12 meses ÷ preço na data-base" },
    { k: "prov12", l: "Prov. 12M", kind: "num2", t: "Proventos por cota nos últimos 12 meses (R$, data-com)" },
    { k: "meses_pag12", l: "Meses c/ pag.", kind: "int", t: "Meses com provento nos últimos 12" },
    { k: "cv12", l: "Variabilidade", kind: "cv", t: "Coeficiente de variação dos proventos mensais (12M): quanto menor, mais estável o pagamento" },
    { k: "var12", l: "Var. cota 12M", kind: "pct", t: "Variação do preço (ajustado por desdobramentos), sem proventos" },
    { k: "rt12", l: "Ret. total 12M", kind: "pct", t: "Preço + proventos reinvestidos" },
    { k: "rt24a", l: "Ret. total 24M a.a.", kind: "pct", t: "Retorno total anualizado, 24 meses" },
    { k: "pvp", l: "P/VP", kind: "ratio", t: "Preço ÷ valor patrimonial da cota (CVM)" },
    { k: "liq3m", l: "Liquidez 3M", kind: "money", t: "Volume financeiro médio diário na B3, 3 meses" },
    { k: "pl", l: "PL", kind: "money", t: "Patrimônio líquido (CVM)" },
    { k: "vol12", l: "Vol. 12M", kind: "pctu", t: "Volatilidade anualizada do retorno total, 12 meses" },
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

  /* ---------------- Comparação de renda ---------------- */
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
          <span class="small muted">Período:</span>
          <div class="seg" id="rd-period" role="group" aria-label="Período">${PERIODS.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${S.period === v}">${t}</button>`).join("")}</div>
          <button class="btn" type="button" data-send title="Adicionar estes fundos à página Comparação (gráficos de risco, correlação etc.)">Abrir na Comparação →</button>
        </div>
        ${missing.length ? `<div class="warn-note" style="margin-top:10px">${missing.map((id) => esc(App.fundName(id))).join(", ")}: fora da base desta data-base (sem negociação recente ou indisponível).</div>` : ""}
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Quadro de renda</h3><span class="sub">Data-base ${fmt.date(App.meta.data_base)} · valores por cota na base atual de cotas</span></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-quadro"></table></div>
        <div class="card-note">Valores lado a lado, sem destaque de "melhor" ou "pior": a escolha depende do objetivo de renda, do risco aceito e da diversificação da carteira. DY e proventos pela data-com; valores declarados com pagamento após a data-base estão incluídos.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Simulador de carteira de renda</h3><span class="sub">Quanto a carteira teria rendido por mês com os proventos pagos pelos fundos</span></div>
        <div class="card-b" style="padding-bottom:4px">
          <div class="toolbar" id="rd-alloc">${funds.map((f) => `<label class="small" style="display:inline-flex;align-items:center;gap:6px">${swatch(f.id)}<b>${esc(f.ticker)}</b> R$ <input class="input" data-alloc="${esc(f.id)}" inputmode="numeric" value="${esc(fmt.num(allocOf(f.id), 0))}" style="width:110px" aria-label="Valor alocado em ${esc(f.ticker)}"></label>`).join("")}
            <span class="small muted" id="rd-alloc-total"></span></div>
        </div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-cart"></table></div>
        <div class="card-b" style="padding-top:8px"><div class="chart short" id="rd-ch-cart" role="img" aria-label="Renda mensal da carteira por fundo"></div></div>
        <div class="card-note" id="rd-cart-note"></div></div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Proventos mês a mês</h3><div class="seg no-print" id="rd-provmode" role="group"><button type="button" data-v="dy">DY mensal</button><button type="button" data-v="rs">R$ por cota</button></div></div>
          <div class="card-b"><div class="chart" id="rd-ch-prov"></div></div><div class="card-note" id="rd-prov-note"></div></div>
        <div class="card"><div class="card-h"><h3>Evolução de R$ 100</h3><div class="seg no-print" id="rd-growth" role="group"><button type="button" data-v="rt">Retorno total</button><button type="button" data-v="px">Só variação da cota</button></div></div>
          <div class="card-b"><div id="rd-g-warn"></div><div class="chart" id="rd-ch-growth"></div></div><div class="card-note" id="rd-growth-note"></div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Simulação de renda</h3><span class="sub" id="rd-sim-sub"></span></div>
        <div class="card-b" style="padding-bottom:6px"><label class="small">Valor investido (R$) <input class="input" id="rd-amount" inputmode="numeric" value="${esc(fmt.num(S.amount, 0))}" style="width:130px;margin-left:6px"></label></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-sim"></table></div>
        <div class="card-note">Compra pelo fechamento no início do período (cotas fracionárias, sem custos de corretagem, impostos ou emolumentos); proventos recebidos em dinheiro e não reinvestidos; valor das cotas pelo fechamento na data-base. CDI: mesmo valor aplicado no CDI no mesmo período, bruto de IR. Ilustração com dados passados — não é promessa de renda futura.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Mês a mês</h3><div class="seg no-print" id="rd-tabmetric" role="group">
          <button type="button" data-v="dy">DY</button><button type="button" data-v="rs">Provento (R$/cota)</button><button type="button" data-v="var">Variação da cota</button><button type="button" data-v="rt">Retorno total</button></div></div>
        <div class="table-wrap" style="max-height:520px"><table class="data cmp-table" id="rd-monthly"></table></div>
        <div class="card-note">DY do mês = proventos com data-com no mês ÷ fechamento do mês anterior. Variação da cota e retorno total: fechamento de fim de mês a fim de mês (* mês da data-base). CDI do mês para referência. — = fora do histórico do fundo; N/D = proventos do mês fora da cobertura oficial.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Ano a ano</h3><div class="seg no-print" id="rd-yearmetric" role="group">
          <button type="button" data-v="rt">Retorno total</button><button type="button" data-v="var">Variação da cota</button><button type="button" data-v="dy">DY do ano</button><button type="button" data-v="rs">Proventos (R$/cota)</button></div></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="rd-yearly"></table></div>
        <div class="card-note">DY do ano = proventos com data-com no ano ÷ fechamento do ano anterior. Ano da data-base: até ${fmt.date(App.meta.data_base)} (*). Primeiro ano do histórico: a partir da primeira cotação no período analisado.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Últimos proventos</h3><span class="sub">Por data-com · R$ por cota (base atual)</span></div>
        <div class="card-b"><div class="grid g-3" id="rd-last"></div></div>
        <div class="card-note">Fonte: eventos corporativos da B3 e avisos aos cotistas estruturados do Fundos.NET. R = rendimento, A = amortização (devolução de capital).</div></div>`;
    el.querySelector(".chips").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) toggle(b.dataset.rm, false); });
    el.querySelector("[data-clear]").addEventListener("click", () => { App.state.rendaSel.length = 0; saveSel(); renderTable(); renderCompare(el); });
    el.querySelector("[data-send]").addEventListener("click", () => { funds.forEach((f) => { App.rememberName(f.id, f.nome); App.toggleSelect(f.id, true); }); location.hash = "#/comparacao"; });
    const bindSeg = (id, key, stKey, fn) => {
      const s = el.querySelector(id);
      const sync = () => s.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S[key])));
      sync();
      s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S[key] = b.dataset.v; st.set(stKey, S[key]); sync(); fn(); });
    };
    const drawAll = () => { drawProv(el, funds); drawGrowth(el, funds); drawSim(el, funds); drawMonthly(el, funds); drawYearly(el, funds); };
    bindSeg("#rd-period", "period", "rdPeriod", drawAll);
    bindSeg("#rd-provmode", "provMode", "rdProvMode", () => drawProv(el, funds));
    bindSeg("#rd-growth", "growthMode", "rdGrowth", () => drawGrowth(el, funds));
    bindSeg("#rd-tabmetric", "tabMetric", "rdTabMetric", () => drawMonthly(el, funds));
    bindSeg("#rd-yearmetric", "yearMetric", "rdYearMetric", () => drawYearly(el, funds));
    el.querySelector("#rd-amount").addEventListener("change", (e) => {
      const v = +String(e.target.value).replace(/\./g, "").replace(",", ".");
      if (v > 0) { S.amount = v; st.set("rdAmount", v); e.target.value = fmt.num(v, 0); drawSim(el, funds); }
    });
    el.querySelector("#rd-alloc").addEventListener("change", (e) => {
      const inp = e.target.closest("[data-alloc]"); if (!inp) return;
      const v = +String(inp.value).replace(/\./g, "").replace(",", ".");
      if (v >= 0 && isFinite(v)) { S.alloc[inp.dataset.alloc] = v; st.set("rdAlloc", S.alloc); inp.value = fmt.num(v, 0); drawCart(el, funds); }
      else inp.value = fmt.num(allocOf(inp.dataset.alloc), 0);
    });
    drawQuadro(el, funds);
    drawCart(el, funds);
    drawAll();
    drawLast(el, funds);
  }

  /* Período (índice inicial no eixo) */
  function periodStart(funds) {
    const last = App.axis.length - 1;
    if (S.period === "common") {
      const fs = funds.map((f) => App.firstIdx(S.growthMode === "px" ? seriesOf(f).px : seriesOf(f).rt)).filter((x) => x != null);
      return fs.length ? Math.max(...fs) : last;
    }
    return CH().periodStart(+S.period);
  }
  const nMonths = () => (S.period === "common" ? 48 : +S.period);

  function drawQuadro(el, funds) {
    const r = (f) => f.renda || {}, nd = (f) => App.LST_ND_PROV(f);
    const W = (f, w, k = "f") => (f.ret[w] || {})[k];
    const rows = [
      ["Renda", null],
      ["Preço na data-base", (f) => (r(f).preco == null ? App.ND() : `<span class="num">R$ ${fmt.num(r(f).preco, 2)}</span>`)],
      ["DY 12M (s/ preço atual)", (f) => App.cell(r(f).dy12, "pct", nd(f), { sign: false, color: false })],
      ["DY 12M (s/ preço há 12M)", (f) => App.cell(r(f).dy_12m, "pct", nd(f), { sign: false, color: false })],
      ["DY 24M (s/ preço há 24M)", (f) => App.cell(r(f).dy_24m, "pct", nd(f), { sign: false, color: false })],
      ["Proventos 12M (R$/cota)", (f) => (r(f).prov12 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).prov12, 2)}</span>`)],
      ["Proventos 24M (R$/cota)", (f) => (r(f).prov24 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).prov24, 2)}</span>`)],
      ["Média mensal 12M (R$/cota)", (f) => (r(f).prov_med12 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).prov_med12, 3)}</span>`)],
      ["Menor / maior mês 12M", (f) => (r(f).prov_min12 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).prov_min12, 3)} / ${fmt.num(r(f).prov_max12, 3)}</span>`)],
      ["Meses com pagamento (12M / 24M)", (f) => (r(f).meses_pag12 == null ? App.ND(nd(f)) : `<span class="num">${r(f).meses_pag12}/12${r(f).meses_pag24 != null ? ` · ${r(f).meses_pag24}/24` : ""}</span>`)],
      ["Variabilidade dos proventos 12M", (f) => (r(f).cv12 == null ? App.ND(r(f).prov12 === 0 ? "Sem proventos em 12 meses" : nd(f)) : `<span class="num" title="Coeficiente de variação (desvio-padrão ÷ média dos proventos mensais)">${fmt.num(r(f).cv12, 2)}</span>`)],
      ["Tendência (últimos 6M vs 6M anteriores)", (f) => App.cell(r(f).tend6, "pct", r(f).prov12 == null ? nd(f) : "Sem proventos no semestre anterior")],
      ["Amortizações 12M (R$/cota)", (f) => (r(f).amort12 == null ? App.ND(nd(f)) : `<span class="num">${fmt.num(r(f).amort12, 2)}</span>`)],
      ["Último provento", (f) => (r(f).ultimo ? `<span class="num small">R$ ${fmt.num(r(f).ultimo.valor, 4)} · com ${fmt.date(r(f).ultimo.data_com)}${r(f).ultimo.pagamento ? ` · pg ${fmt.date(r(f).ultimo.pagamento)}` : ""}</span>` : App.ND("Nenhum provento no histórico coberto"))],
      ["Isenção de IR (aviso ao cotista)", (f) => (r(f).isento_ir == null ? App.ND("Não informado nos avisos estruturados (consultar regulamento)") : r(f).isento_ir ? "Isento (PF)" : "Tributado")],
      ["Retorno", null],
      ["Retorno total 12M", (f) => App.cell(W(f, "12m"), "pct", (f.ret["12m"] || {}).nd)],
      ["Variação da cota 12M", (f) => App.cell(((f.ret_preco || {})["12m"] || {}).f, "pct", ((f.ret_preco || {})["12m"] || {}).nd)],
      ["CDI 12M (referência)", (f) => App.cell(W(f, "12m", "cdi"), "pct", "", { color: false })],
      ["Retorno total − CDI 12M", (f) => App.cell(W(f, "12m", "x_cdi"), "pp", (f.ret["12m"] || {}).nd)],
      ...["24m", "36m", "48m"].map((w) => [`Retorno total ${App.W[w].label} a.a.`, (f) => App.cell(W(f, w, "fa"), "pct", (f.ret[w] || {}).nd)]),
      ...["24m", "36m", "48m"].map((w) => [`Variação da cota ${App.W[w].label} a.a.`, (f) => App.cell(((f.ret_preco || {})[w] || {}).fa, "pct", ((f.ret_preco || {})[w] || {}).nd)]),
      ["Risco e liquidez (12M)", null],
      ["Volatilidade a.a.", (f) => App.cell(((f.risk || {})["12m"] || {}).vol, "pct", ((f.risk || {})["12m"] || {}).nd || "Histórico insuficiente", { sign: false, color: false })],
      ["Máximo drawdown", (f) => App.cell(((f.risk || {})["12m"] || {}).mdd, "pct", ((f.risk || {})["12m"] || {}).nd || "Histórico insuficiente")],
      ["Liquidez média diária (3M / 12M)", (f) => (f.liq && f.liq.vol_3m != null ? `<span class="num">${fmt.money(f.liq.vol_3m)}${f.liq.vol_12m != null ? " / " + fmt.money(f.liq.vol_12m) : ""}</span>` : App.ND("Histórico de negociação insuficiente"))],
      ["Pregões com negócio 12M", (f) => App.cell((f.liq || {}).pregoes_12m, "pctb", "Histórico insuficiente")],
      ["Fundo", null],
      ["P/VP", (f) => (r(f).pvp == null ? App.ND("Valor patrimonial da cota não disponível na CVM") : `<span class="num" title="VP R$ ${fmt.num(r(f).vp, 2)} (${esc(r(f).vp_fonte || "")}, ${esc(r(f).vp_data || "")})">${fmt.num(r(f).pvp, 2)}</span>`)],
      ["PL", (f) => App.cell((f.flow || {}).pl, "money", "Não disponível na CVM")],
      ["Cotistas", (f) => App.cell((f.flow || {}).cotistas, "int", "Não disponível na CVM")],
      ["Tipo / segmento", (f) => `<span class="small">${esc(f.categoria)}</span>`],
      ["Gestor / administrador", (f) => `<span class="small">${esc((f.cvm || {}).gestor || (f.cvm || {}).administrador || "N/D")}</span>`],
      ["CNPJ", (f) => `<span class="small num">${esc(f.cnpj || "N/D")}</span>`],
      ["Alertas de dados", (f) => ((f.qc || []).length ? `<span class="small" style="white-space:normal;display:block;max-width:260px;text-align:left">${f.qc.map((q) => `<span class="lvl ${q.nivel}">${q.nivel}</span> ${esc(q.mensagem)}`).join("<br>")}</span>` : '<span class="muted small">—</span>')],
    ];
    el.querySelector("#rd-quadro").innerHTML = `<thead><tr><th class="l">Indicador</th>${funds.map((f) => `<th class="l">${swatch(f.id)}${esc(f.ticker)} ${BADGE(f.tipo)}<div class="small muted" style="font-weight:400;text-transform:none;letter-spacing:0">${esc(f.nome.replace(f.ticker + " · ", ""))}</div></th>`).join("")}</tr></thead><tbody>` +
      rows.map(([label, fn]) => (fn ? `<tr style="cursor:default"><td class="l">${label}</td>${funds.map((f) => `<td class="${label === "Alertas de dados" ? "l" : ""}">${fn(f)}</td>`).join("")}</tr>` : `<tr><td class="group-h" colspan="${funds.length + 1}">${label}</td></tr>`)).join("") + "</tbody>";
  }

  function drawProv(el, funds) {
    const keys = lastMonths(nMonths());
    const many = funds.length > 4;
    const series = funds.map((f) => {
      const s = styleOf(f.id);
      return { name: f.ticker, color: s.color, lineType: s.lineType, symbol: s.symbol, data: keys.map((k) => { const m = (f.meses || {})[k]; return m ? (S.provMode === "dy" ? m[1] : m[0]) : null; }) };
    });
    if (S.provMode === "dy") series.push({ name: "CDI (mês)", color: App.BENCH_COLOR, dashed: true, data: keys.map(cdiMonth) });
    CH().monthly(el.querySelector("#rd-ch-prov"), keys.map(fmt.monthLabel), series, {
      bars: S.provMode === "rs" && !many, fmt: S.provMode === "dy" ? (v) => CH().pct(v, 2) : (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }),
    });
    el.querySelector("#rd-prov-note").textContent = (S.provMode === "dy" ? "DY do mês = proventos com data-com no mês ÷ fechamento do mês anterior. CDI do mês (tracejado) como referência de custo de oportunidade." : "Proventos por cota pela data-com, ajustados a desdobramentos/grupamentos (base atual de cotas).") + " Pontos ausentes = proventos fora da cobertura oficial (N/D).";
  }

  function drawGrowth(el, funds) {
    const last = App.axis.length - 1;
    const i0 = periodStart(funds);
    const lines = [], short = [];
    funds.forEach((f) => {
      const arr = S.growthMode === "px" ? seriesOf(f).px : seriesOf(f).rt;
      const fi = App.firstIdx(arr);
      if (fi == null) { short.push(f.ticker + " (sem dado)"); return; }
      let s0 = Math.max(i0, fi); while (s0 < last && arr[s0] == null) s0++;
      if (s0 > i0 + 5) short.push(f.ticker);
      const stl = styleOf(f.id);
      lines.push({ name: f.ticker, color: stl.color, lineType: stl.lineType, data: CH().growth(arr, s0, last) });
    });
    let c0 = i0; while (c0 < last && cdi[c0] == null) c0++;
    lines.push({ name: "CDI", color: App.BENCH_COLOR, dashed: true, data: CH().growth(cdi, c0, last) });
    CH().timeLines(el.querySelector("#rd-ch-growth"), lines, { fmtY: (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
    el.querySelector("#rd-g-warn").innerHTML = short.length ? `<div class="warn-note">${short.map(esc).join(", ")}: ${S.growthMode === "rt" ? "retorno total disponível só a partir da cobertura oficial de proventos" : "histórico de cotação menor que o período"} — linha inicia depois (base 100 própria). Use “Máx. comum” para comparar no mesmo período.</div>` : "";
    el.querySelector("#rd-growth-note").textContent = `Base 100 em ${fmt.date(App.axis[i0])}. ${S.growthMode === "rt" ? "Retorno total: proventos reinvestidos na data ex (1º pregão após a data-com)." : "Só variação do preço de fechamento (ajustado a desdobramentos), sem proventos."} Bruto de IR e de custos de negociação.`;
  }

  /* Simulador de carteira: X reais no fundo A, Y no fundo B… → renda mensal com os proventos efetivamente pagos
     nos últimos 12 meses (mesmo nº de cotas o período todo). Cotas inteiras ao preço da data-base. */
  function drawCart(el, funds) {
    const keys = lastMonths(12), kdb = App.meta.data_base.slice(0, 7);
    const money = (v, why) => (v == null ? App.ND(why || "") : `<span class="num">R$ ${fmt.num(v, 2)}</span>`);
    const R = funds.map((f) => {
      const p = (f.renda || {}).preco, X = allocOf(f.id);
      const cotas = p ? Math.floor(X / p) : 0, inv = cotas * p;
      const mes = keys.map((k) => { const m = (f.meses || {})[k]; return m === undefined ? undefined : m[0] == null ? null : cotas * m[0]; });
      const am = keys.map((k) => { const m = (f.meses || {})[k]; return m && m[4] != null ? cotas * m[4] : null; });
      const cov = mes.filter((v) => v != null);
      const media = cov.length ? cov.reduce((a, b) => a + b, 0) / cov.length : null;
      return { f, p, X, cotas, inv, sobra: X - inv, mes, n: cov.length, media, min: cov.length ? Math.min(...cov) : null, max: cov.length ? Math.max(...cov) : null,
        ult: mes[11], soma12: cov.length === 12 ? cov.reduce((a, b) => a + b, 0) : null, amort: cov.length === 12 ? am.reduce((a, b) => a + (b || 0), 0) : null,
        yld: media != null && inv > 0 ? (media * 12) / inv : null };
    });
    const totInv = R.reduce((a, r) => a + r.inv, 0), totX = R.reduce((a, r) => a + r.X, 0);
    const all = (fn) => (R.every((r) => fn(r) != null) ? R.reduce((a, r) => a + fn(r), 0) : null);
    const totMes = keys.map((_, j) => all((r) => r.mes[j]));
    const totMedia = all((r) => r.media);
    const cdiMes = keys.map((k) => { const c = cdiMonth(k); return c == null ? null : totInv * c; });
    el.querySelector("#rd-alloc-total").textContent = `Total alocado: R$ ${fmt.num(totX, 0)}`;
    const ndWhy = (r) => (r.p ? App.LST_ND_PROV(r.f) : "Sem preço na data-base");
    const partial = (r) => (r.n && r.n < 12 ? ` <span class="small muted" title="Média dos meses com histórico oficial de proventos">(${r.n} meses)</span>` : "");
    const rows = [
      ["Alocação", null],
      ["Valor alocado", (r) => money(r.X), money(totX)],
      ["Preço da cota (data-base)", (r) => (r.p ? `<span class="num">R$ ${fmt.num(r.p, 2)}</span>` : App.ND("Sem preço")), ""],
      ["Cotas (inteiras)", (r) => `<span class="num">${fmt.int(r.cotas)}</span>`, ""],
      ["Valor investido · sobra", (r) => `<span class="num">R$ ${fmt.num(r.inv, 2)}</span> <span class="small muted">· sobra R$ ${fmt.num(r.sobra, 2)}</span>`, `<span class="num">R$ ${fmt.num(totInv, 2)}</span>`],
      ["Renda mensal (rendimentos)", null],
      [`Último mês (${fmt.monthLabel(kdb)})`, (r) => money(r.ult, ndWhy(r)), money(totMes[11], "Algum fundo sem provento conhecido no mês")],
      ["Média mensal (12M)", (r) => money(r.media, ndWhy(r)) + partial(r), money(totMedia, "Algum fundo sem histórico de proventos")],
      ["Menor / maior mês", (r) => (r.min == null ? App.ND(ndWhy(r)) : `<span class="num">R$ ${fmt.num(r.min, 2)} / R$ ${fmt.num(r.max, 2)}</span>`), ""],
      ["Total nos últimos 12 meses", (r) => money(r.soma12, ndWhy(r)), money(all((r) => r.soma12), "Algum fundo sem 12 meses de histórico oficial de proventos")],
      ["Renda anual ÷ valor investido", (r) => App.cell(r.yld, "pct", ndWhy(r), { sign: false, color: false }) + partial(r), App.cell(totMedia != null && totInv ? (totMedia * 12) / totInv : null, "pct", "", { sign: false, color: false })],
      ["Participação na renda da carteira", (r) => App.cell(totMedia && r.media != null ? r.media / totMedia : null, "pctb", ""), ""],
      ["Amortizações 12M (devolução de capital)", (r) => money(r.amort, ndWhy(r)), money(all((r) => r.amort), "")],
      ["Referência", null],
      ["CDI sobre o valor investido (média mensal 12M, bruto)", () => "", money(cdiMes.every((v) => v != null) ? cdiMes.reduce((a, b) => a + b, 0) / 12 : null)],
      ["Mês a mês", null],
      ...keys.slice().reverse().map((k, jj) => { const j = 11 - jj; return [fmt.monthLabel(k) + (k === kdb ? "*" : ""), (r) => (r.mes[j] === undefined ? '<span class="muted">—</span>' : money(r.mes[j], ndWhy(r))), money(totMes[j], "Algum fundo sem provento conhecido no mês")]; }),
    ];
    el.querySelector("#rd-cart").innerHTML = `<thead><tr><th class="l"></th>${R.map((r) => `<th>${swatch(r.f.id)}${esc(r.f.ticker)}</th>`).join("")}<th>Carteira</th></tr></thead><tbody>` +
      rows.map(([label, fn, tot]) => (fn ? `<tr style="cursor:default"><td class="l">${label}</td>${R.map((r) => `<td>${fn(r)}</td>`).join("")}<td><b>${tot}</b></td></tr>` : `<tr><td class="group-h" colspan="${R.length + 2}">${label}</td></tr>`)).join("") + "</tbody>";
    const series = R.map((r) => ({ name: r.f.ticker, color: styleOf(r.f.id).color, data: r.mes.map((v) => (v == null ? null : +v.toFixed(2))) }));
    series.push({ name: "CDI s/ valor investido (bruto)", color: App.BENCH_COLOR, line: true, dashed: true, data: cdiMes.map((v) => (v == null ? null : +v.toFixed(2))) });
    CH().monthly(el.querySelector("#rd-ch-cart"), keys.map(fmt.monthLabel), series, { bars: true, stack: true, fmt: (v) => "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) });
    el.querySelector("#rd-cart-note").textContent = `Cotas inteiras compradas ao fechamento de ${fmt.date(App.meta.data_base)}, mantidas constantes nos 12 meses anteriores; renda = cotas × rendimento por cota de cada mês (data-com, base atual de cotas), sem reinvestir. Amortizações são devolução de capital e aparecem à parte. Rendimentos de FII, Fiagro e FI-Infra podem ser isentos de IR para pessoa física sob condições legais; o CDI é bruto. Renda passada não garante renda futura: os proventos variam e as cotas oscilam de preço. Sem custos de corretagem e emolumentos.`;
  }

  function drawSim(el, funds) {
    const last = App.axis.length - 1;
    const i0 = periodStart(funds);
    const A = S.amount;
    const brl = (v) => (v == null ? App.ND("") : `<span class="num">R$ ${fmt.num(v, 2)}</span>`);
    el.querySelector("#rd-sim-sub").textContent = `R$ ${fmt.num(A, 0)} investidos em ${fmt.date(App.axis[i0])} até ${fmt.date(App.axis[last])}`;
    const d0 = App.axis[i0], months = Math.max(1, Math.round((last - i0) / 21));
    const sim = funds.map((f) => {
      const px = seriesOf(f).px;
      let k = i0; while (k > i0 - 6 && k >= 0 && px[k] == null) k--;
      const p0 = k >= 0 ? px[k] : null, p1 = px[last];
      const cov = (f.renda || {}).cobertura;
      if (p0 == null || p1 == null) return { nd: "Sem cotação no início do período" };
      if (cov && d0 < cov) return { nd: App.LST_ND_PROV(f) };
      const cotas = A / p0;
      const prov = (f.proventos || []).filter((e) => e[0] >= d0 && e[0] <= App.meta.data_base);
      const renda = cotas * prov.reduce((s, e) => s + e[2], 0);
      const valor = cotas * p1;
      const lastM = App.meta.data_base.slice(0, 7);
      const rendaMes = cotas * prov.filter((e) => e[0].slice(0, 7) === lastM).reduce((s, e) => s + e[2], 0);
      return { cotas, renda, valor, total: renda + valor, ret: (renda + valor) / A - 1, media: renda / months, rendaMes };
    });
    const cdiV = cdi[i0] && cdi[last] ? A * cdi[last] / cdi[i0] : null;
    const R = [
      ["Cotas compradas", (s) => `<span class="num">${fmt.num(s.cotas, 2)}</span>`],
      ["Renda recebida no período", (s) => brl(s.renda)],
      ["Renda média por mês", (s) => brl(s.media)],
      [`Renda no mês da data-base`, (s) => brl(s.rendaMes)],
      ["Valor das cotas na data-base", (s) => brl(s.valor)],
      ["Total (renda + cotas)", (s) => `<b>${brl(s.total)}</b>`],
      ["Resultado total", (s) => App.cell(s.ret, "pct", "")],
    ];
    el.querySelector("#rd-sim").innerHTML = `<thead><tr><th class="l"></th>${funds.map((f) => `<th class="l">${swatch(f.id)}${esc(f.ticker)}</th>`).join("")}<th class="l" style="color:var(--muted)">CDI</th></tr></thead><tbody>` +
      R.map(([label, fn], j) => `<tr style="cursor:default"><td class="l">${label}</td>${sim.map((s) => `<td>${s.nd ? App.ND(s.nd) : fn(s)}</td>`).join("")}<td>${j === 5 ? brl(cdiV) : j === 6 ? App.cell(cdiV ? cdiV / A - 1 : null, "pct", "") : '<span class="muted">—</span>'}</td></tr>`).join("") + "</tbody>";
  }

  const METRIC = { dy: [1, "pct", "DY"], rs: [0, "rs", "R$/cota"], var: [2, "pct", "Variação"], rt: [3, "pct", "Retorno total"] };
  function valCell(v, kind, why, signed) {
    if (v === undefined) return '<span class="muted">—</span>';
    if (v == null) return App.ND(why);
    if (kind === "rs") return `<span class="num">${fmt.num(v, 3)}</span>`;
    return App.cell(v, "pct", why, signed ? {} : { sign: false, color: false });
  }
  function drawMonthly(el, funds) {
    const [pos, kind] = METRIC[S.tabMetric];
    const keys = lastMonths(nMonths()).reverse();
    const withCdi = S.tabMetric !== "rs";
    el.querySelector("#rd-monthly").innerHTML = `<thead><tr><th class="l">Mês</th>${funds.map((f) => `<th>${swatch(f.id)}${esc(f.ticker)}</th>`).join("")}${withCdi ? '<th style="color:var(--muted)">CDI</th>' : ""}</tr></thead><tbody>` +
      keys.map((k) => `<tr style="cursor:default"><td class="l">${fmt.monthLabel(k)}${App.meta.data_base.slice(0, 7) === k ? "*" : ""}</td>${funds.map((f) => {
        const m = (f.meses || {})[k];
        return `<td>${valCell(m ? m[pos] : undefined, kind, pos <= 1 ? App.LST_ND_PROV(f) : "Sem cotação no mês", S.tabMetric !== "dy")}</td>`;
      }).join("")}${withCdi ? `<td>${valCell(cdiMonth(k), "pct", "", false)}</td>` : ""}</tr>`).join("") + "</tbody>";
  }
  function drawYearly(el, funds) {
    const [pos, kind] = METRIC[S.yearMetric];
    const years = [...new Set(funds.flatMap((f) => Object.keys(f.anos || {})))].sort().reverse();
    const withCdi = S.yearMetric !== "rs";
    const y0 = App.axis[0].slice(0, 4), yb = App.meta.data_base.slice(0, 4);
    el.querySelector("#rd-yearly").innerHTML = `<thead><tr><th class="l">Ano</th>${funds.map((f) => `<th>${swatch(f.id)}${esc(f.ticker)}</th>`).join("")}${withCdi ? '<th style="color:var(--muted)">CDI</th>' : ""}</tr></thead><tbody>` +
      years.map((y) => `<tr style="cursor:default"><td class="l">${y}${y === yb ? "*" : ""}</td>${funds.map((f) => {
        const a = (f.anos || {})[y];
        return `<td>${valCell(a ? a[pos] : undefined, kind, pos <= 1 ? App.LST_ND_PROV(f) : "Ano incompleto no histórico", S.yearMetric !== "dy")}</td>`;
      }).join("")}${withCdi ? `<td>${y === y0 ? '<span class="muted">—</span>' : valCell(y === yb ? (cdi[App.idxOnOrBefore(`${y - 1}-12-31`)] ? cdi[App.axis.length - 1] / cdi[App.idxOnOrBefore(`${y - 1}-12-31`)] - 1 : null) : cdiYear(+y), "pct", "", false)}</td>` : ""}</tr>`).join("") + "</tbody>";
  }
  function drawLast(el, funds) {
    el.querySelector("#rd-last").innerHTML = funds.map((f) => {
      const ev = (f.proventos || []).slice(-12).reverse();
      return `<div><div style="font-weight:600;margin-bottom:6px">${swatch(f.id)}${esc(f.ticker)}</div>${ev.length ? `<table class="compact"><thead><tr><th>Data-com</th><th>Pagamento</th><th>R$/cota</th><th></th></tr></thead><tbody>${ev.map((e) => `<tr><td>${fmt.date(e[0])}</td><td>${fmt.date(e[1]) || "—"}</td><td class="num">${fmt.num(e[2], 4)}</td><td class="muted" title="${e[4] === "B" ? "B3 — eventos corporativos" : "Fundos.NET — aviso aos cotistas"}">${e[3]}</td></tr>`).join("")}</tbody></table>` : `<p class="small muted">Nenhum provento no histórico coberto (desde ${fmt.date((f.renda || {}).cobertura) || "N/D"}).</p>`}</div>`;
    }).join("");
  }

  App.views.renda = { render, destroy() { rootRef = null; } };
})();

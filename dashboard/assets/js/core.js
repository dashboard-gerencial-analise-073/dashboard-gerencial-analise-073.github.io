/* Núcleo: dados, formatação, registro de indicadores e estado global.
   Nenhuma informação de fundo é codificada aqui — tudo vem de window.FUNDS_DATASET. */
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  const DS = window.FUNDS_DATASET;
  if (!DS) { document.body.innerHTML = '<p style="padding:40px">Dataset não encontrado. Execute <code>python pipeline/build.py</code>.</p>'; return; }
  App.ds = DS;
  App.meta = DS.meta;
  App.funds = DS.fundos;
  App.byId = Object.fromEntries(DS.fundos.map((f) => [f.id, f]));
  App.benchById = Object.fromEntries(DS.benchmarks.map((b) => [b.id, b]));
  App.gestoraById = Object.fromEntries(DS.gestoras.map((g) => [g.gestora_id, g]));
  App.axis = DS.eixo;
  App.windows = DS.meta.janelas;
  App.riskWindows = DS.meta.janelas_risco;
  // Paleta categórica validada (8 cores, ordem fixa). Do 9º fundo em diante as cores se repetem
  // com outro tipo de linha/marcador (codificação secundária), nunca com novas cores geradas.
  App.SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
  App.LINE_TYPES = ["solid", "dashed", "dotted"];
  App.SYMBOLS = ["circle", "triangle", "diamond"];
  App.BENCH_COLOR = "#7d8f95";
  App.MAX_COMPARE = Infinity; // sem limite de fundos na comparação

  /* ---------------- Formatação ---------------- */
  const nf = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF = { 0: nf(0), 1: nf(1), 2: nf(2), 3: nf(3) };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  App.esc = esc;
  const ND = (why) => `<span class="nd" title="${esc(why || "Informação não disponível")}">N/D</span>`;
  App.ND = ND;
  App.fmt = {
    pct(v, d = 2, sign = true) {
      if (v == null || !isFinite(v)) return null;
      const s = NF[d].format(v * 100);
      return (sign && v > 0 ? "+" : "") + s + "%";
    },
    pp(v, d = 2) { return v == null || !isFinite(v) ? null : (v > 0 ? "+" : "") + NF[d].format(v * 100) + " p.p."; },
    num(v, d = 2) { return v == null || !isFinite(v) ? null : NF[d].format(v); },
    int(v) { return v == null ? null : NF[0].format(v); },
    money(v) {
      if (v == null || !isFinite(v)) return null;
      const a = Math.abs(v), s = v < 0 ? "-" : "";
      if (a >= 1e9) return `${s}R$ ${NF[2].format(a / 1e9)} bi`;
      if (a >= 1e6) return `${s}R$ ${NF[1].format(a / 1e6)} mi`;
      if (a >= 1e3) return `${s}R$ ${NF[0].format(a / 1e3)} mil`;
      return `${s}R$ ${NF[0].format(a)}`;
    },
    date(iso) { if (!iso) return null; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; },
    monthLabel(key) { const [y, m] = key.split("-"); return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][+m - 1] + "/" + y.slice(2); },
    dplus(n) { return n == null ? null : "D+" + NF[0].format(n); },
  };
  /* Renderiza valor com classe de sinal ou N/D com o motivo em tooltip. */
  App.cell = function (v, kind, why, opts) {
    opts = opts || {};
    const f = App.fmt;
    let s;
    switch (kind) {
      case "pct": s = f.pct(v, opts.d ?? 2, opts.sign ?? true); break;
      case "pp": s = f.pp(v); break;
      case "money": s = f.money(v); break;
      case "ratio": s = f.num(v, 2); break;
      case "pctb": s = v == null ? null : NF[0].format(v * 100) + "%"; break;
      case "days": s = f.dplus(v); break;
      case "int": s = f.int(v); break;
      case "date": s = f.date(v); break;
      default: s = v == null ? null : esc(v);
    }
    if (s == null) return ND(why);
    const signed = opts.color !== false && (kind === "pct" || kind === "pp") && opts.sign !== false;
    const cls = signed ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "";
    return `<span class="num ${cls}">${s}</span>`;
  };

  /* ---------------- Séries ---------------- */
  const seriesCache = new Map();
  /* Cota alinhada ao eixo completo (null onde não há dado). */
  App.fullSeries = function (f) {
    if (seriesCache.has(f.id)) return seriesCache.get(f.id);
    const out = new Array(App.axis.length).fill(null);
    const s = f.serie || {};
    if (s.q) s.q.forEach((v, k) => { out[s.i0 + k] = v; });
    seriesCache.set(f.id, out);
    return out;
  };
  App.benchSeries = (id) => (DS.bench_series || {})[id] || null;
  App.firstIdx = (arr) => { if (!arr) return null; for (let i = 0; i < arr.length; i++) if (arr[i] != null) return i; return null; };
  /* Índice do último dia útil <= data ISO. */
  App.idxOnOrBefore = function (iso) {
    const a = App.axis; let lo = 0, hi = a.length - 1, ans = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  App.addMonthsISO = function (iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    return t.toISOString().slice(0, 10);
  };
  App.benchName = (id) => (App.benchById[id] || {}).nome || id;
  App.benchAvailable = (id) => !!(App.benchById[id] || {}).disponivel;

  /* ---------------- Estado ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("rf:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("rf:" + k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } },
  };
  App.store = store;
  App.state = {
    retMode: store.get("retMode", "abs"),     // abs | excess | pctb
    retBase: store.get("retBase", "cum"),     // cum | ann
    riskWin: store.get("riskWin", "12m"),
    selection: store.get("selection", []).filter((id) => App.byId[id] || String(id).startsWith("m:")),
  };
  const listeners = {};
  App.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  App.emit = (ev, p) => { (listeners[ev] || []).forEach((fn) => fn(p)); };

  App.toggleSelect = function (id, force) {
    const sel = App.state.selection;
    const has = sel.includes(id);
    const want = force == null ? !has : force;
    if (want && !has) {
      sel.push(id);
    } else if (!want && has) sel.splice(sel.indexOf(id), 1);
    store.set("selection", sel);
    App.emit("selection");
    return true;
  };
  App.clearSelection = () => { App.state.selection.length = 0; store.set("selection", []); App.emit("selection"); };
  App.styleOf = (id) => {
    const i = Math.max(0, App.state.selection.indexOf(id)), n = App.SERIES_COLORS.length;
    const cycle = Math.floor(i / n) % App.LINE_TYPES.length;
    return { color: App.SERIES_COLORS[i % n], lineType: App.LINE_TYPES[cycle], symbol: App.SYMBOLS[cycle], cycle };
  };
  App.colorOf = (id) => App.styleOf(id).color;
  /* Amostra de cor + tipo de linha (para legendas em HTML). */
  App.swatch = (id) => {
    const st = App.styleOf(id);
    return st.cycle === 0
      ? `<span class="legend-dot" style="background:${st.color}"></span>`
      : `<span class="legend-line" style="border-top:3px ${st.lineType} ${st.color}" title="Linha ${st.lineType === "dashed" ? "tracejada" : "pontilhada"}"></span>`;
  };

  /* ---------------- Fundos de mercado (só na Comparação, carregados sob demanda) ----------------
     data/mercado/indice.js  -> window.__MKT_INDEX({meta, fundos: [[id, nome, cnpj, gestor, classe, anbima, pl, r12, lote], ...]})
     data/mercado/s/NNN.js   -> window.__MKT_SHARD(NNN, {id: fundo, ...})
     Carregados por <script> (funciona também abrindo o HTML direto do disco). */
  const MKT_DIR = "data/mercado/";
  const mkt = (App.mkt = { index: null, byId: {}, funds: {}, shards: {}, indexPromise: null, failed: false });
  const loadScript = (src) => new Promise((ok, fail) => {
    const el = document.createElement("script");
    el.src = src; el.onload = ok; el.onerror = () => fail(new Error("Não foi possível carregar " + src));
    document.head.appendChild(el);
  });
  window.__MKT_INDEX = (d) => { mkt.index = d; };
  window.__MKT_SHARD = (n, funds) => { mkt.shards[n] = true; Object.assign(mkt.funds, funds); };
  mkt.loadIndex = () => mkt.indexPromise || (mkt.indexPromise = loadScript(MKT_DIR + "indice.js").then(() => {
    if (!mkt.index) throw new Error("Índice de mercado vazio");
    if (mkt.index.meta.data_base !== App.meta.data_base) throw new Error("Base de mercado com data-base diferente do relatório — gere novamente");
    mkt.byId = Object.fromEntries(mkt.index.fundos.map((r) => [r[0], r]));
    return mkt.index;
  }).catch((e) => { mkt.failed = true; mkt.error = e.message; throw e; }));
  mkt.ensure = async (ids) => {
    const need = ids.filter((id) => String(id).startsWith("m:") && !mkt.funds[id]);
    if (!need.length) return;
    await mkt.loadIndex();
    const lotes = [...new Set(need.map((id) => (mkt.byId[id] || [])[8]).filter((x) => x != null))];
    await Promise.all(lotes.filter((n) => !mkt.shards[n]).map((n) => loadScript(`${MKT_DIR}s/${String(n).padStart(3, "0")}.js`)));
  };
  App.getFund = (id) => App.byId[id] || mkt.funds[id] || null;
  App.rememberName = (id, nome) => { const m = store.get("mktNames", {}); m[id] = nome; store.set("mktNames", m); };
  App.fundName = (id) => (App.getFund(id) || {}).nome || store.get("mktNames", {})[id] || String(id).replace(/^m:/, "CNPJ ");

  App.toast = function (msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div"); t.id = "toast";
      t.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#0e2a33;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:100;box-shadow:0 6px 20px rgba(0,0,0,.2);transition:opacity .2s";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = "0"; }, 2600);
  };

  /* ---------------- Registro de indicadores ----------------
     Fonte única para tabela, filtros, comparação e análises.
     get(f) -> { v, nd } ; dir: +1 maior é "mais", usado apenas para ordenar rankings descritivos. */
  const W = Object.fromEntries(App.windows.map((w) => [w.id, w]));
  App.W = W;
  const isAnnualizable = (w) => w.type === "months" && w.n >= 12;

  function retValue(f, wid, mode, base) {
    const r = (f.ret || {})[wid] || {};
    const w = W[wid];
    const ann = base === "ann" && isAnnualizable(w);
    if (mode === "abs") return { v: ann ? r.fa : r.f, nd: r.nd };
    const bench = App.benchById[f.benchmark_id] || {};
    const ndb = r.nd || r.nd_b || (!bench.disponivel ? "Benchmark sem série histórica pública" : null);
    if (mode === "excess") return { v: ann ? r.xa : r.x, nd: ndb };
    if (mode === "pctb") {
      if (bench.mercado) return { v: null, nd: "% do benchmark só se aplica a índices de juros (ex.: CDI). Use o excesso de retorno." };
      return { v: r.pb, nd: ndb || (r.b != null && r.b <= 0 ? "Benchmark com retorno não positivo no período" : null) };
    }
  }
  App.retValue = retValue;

  const M = [];
  App.windows.forEach((w) => {
    M.push({ id: "ret:" + w.id, label: w.label, long: "Rentabilidade — " + w.long, group: "Rentabilidade", kind: "ret", dir: 1, win: w.id,
      get: (f) => retValue(f, w.id, App.state.retMode, App.state.retBase) });
    M.push({ id: "retabs:" + w.id, label: "Retorno " + w.label, long: "Rentabilidade (absoluta) — " + w.long, group: "Rentabilidade", kind: "pct", dir: 1, hidden: true,
      get: (f) => { const r = (f.ret || {})[w.id] || {}; return { v: r.f, nd: r.nd }; } });
    M.push({ id: "bench:" + w.id, label: "Bench " + w.label, long: "Benchmark — " + w.long, group: "Rentabilidade", kind: "pct", dir: 1, hidden: true,
      get: (f) => { const r = (f.ret || {})[w.id] || {}; return { v: r.b, nd: r.nd_b || "Benchmark sem série histórica pública" }; } });
  });
  App.riskWindows.forEach((rw) => {
    const lbl = W[rw].label;
    const g = (f) => (f.risk || {})[rw] || {};
    M.push({ id: "vol:" + rw, label: "Vol. " + lbl, long: `Volatilidade anualizada ${lbl}`, group: "Risco", kind: "pct", sign: false, dir: -1, get: (f) => ({ v: g(f).vol, nd: g(f).nd }) });
    M.push({ id: "sharpe:" + rw, label: "Sharpe " + lbl, long: `Índice de Sharpe ${lbl} (vs CDI)`, group: "Risco", kind: "ratio", dir: 1, get: (f) => ({ v: g(f).sharpe, nd: g(f).nd }) });
    M.push({ id: "mdd:" + rw, label: "Máx. DD " + lbl, long: `Máximo drawdown ${lbl}`, group: "Risco", kind: "pct", dir: 1, get: (f) => ({ v: g(f).mdd, nd: g(f).nd }) });
    M.push({ id: "mpos:" + rw, label: "Meses + " + lbl, long: `% de meses positivos ${lbl}`, group: "Risco", kind: "pctb", dir: 1, get: (f) => ({ v: g(f).pct_meses_pos, nd: g(f).nd || "Sem meses completos na janela" }) });
    M.push({ id: "macima:" + rw, label: "Meses > bench " + lbl, long: `% de meses acima do benchmark ${lbl}`, group: "Risco", kind: "pctb", dir: 1, get: (f) => ({ v: g(f).pct_meses_acima_bench, nd: g(f).nd || "Benchmark sem série histórica pública" }) });
    M.push({ id: "beta:" + rw, label: "Beta " + lbl, long: `Beta vs benchmark de mercado ${lbl}`, group: "Risco", kind: "ratio", dir: 0, get: (f) => ({ v: g(f).beta, nd: g(f).nd || "Calculado apenas para benchmark de mercado com série disponível (ex.: Ibovespa)" }) });
    M.push({ id: "te:" + rw, label: "Tracking error " + lbl, long: `Tracking error anualizado ${lbl}`, group: "Risco", kind: "pct", sign: false, dir: -1, get: (f) => ({ v: g(f).te, nd: g(f).nd || "Calculado apenas para benchmark de mercado com série disponível (ex.: Ibovespa)" }) });
  });
  M.push(
    { id: "pl", label: "PL", long: "Patrimônio líquido na data-base", group: "Fundo", kind: "money", dir: 1, get: (f) => ({ v: (f.flow || {}).pl, nd: "PL não disponível na data-base (CVM)" }) },
    { id: "cotistas", label: "Cotistas", long: "Número de cotistas na data-base", group: "Fundo", kind: "int", dir: 1, get: (f) => ({ v: (f.flow || {}).cotistas, nd: "Não disponível (CVM)" }) },
    { id: "capt12", label: "Capt. líq. 12M", long: "Captação líquida nos últimos 12 meses", group: "Fundo", kind: "money", dir: 1, get: (f) => ({ v: (f.flow || {}).captacao_liquida_12m, nd: "Histórico de fluxos insuficiente" }) },
    { id: "plmed12", label: "PL médio 12M", long: "PL médio diário dos últimos 12 meses", group: "Fundo", kind: "money", dir: 1, get: (f) => ({ v: (f.flow || {}).pl_medio_12m, nd: "Histórico insuficiente" }) },
    { id: "resg", label: "Resgate", long: "Prazo total de resgate (cotização + liquidação)", group: "Liquidez e custos", kind: "days", dir: -1, get: (f) => ({ v: f.liq_resg, nd: "Não informado" }) },
    { id: "cotresg", label: "Cotiz. resgate", long: "Cotização do resgate", group: "Liquidez e custos", kind: "days", dir: -1, get: (f) => ({ v: f.cot_resg, nd: "Não informado" }) },
    { id: "taxa_adm", label: "Tx. adm.", long: "Taxa de administração (% a.a.)", group: "Liquidez e custos", kind: "pct", sign: false, raw100: true, dir: -1, get: (f) => ({ v: f.taxa_adm == null ? null : f.taxa_adm / 100, nd: "Não informado" }) },
    { id: "taxa_perf", label: "Tx. perf.", long: "Taxa de performance (% do excedente)", group: "Liquidez e custos", kind: "pctb", dir: -1, get: (f) => ({ v: f.taxa_perf == null ? null : f.taxa_perf / 100, nd: "Não há taxa de performance" }) },
    { id: "inicio", label: "Início", long: "Data de início do fundo (CVM)", group: "Fundo", kind: "date", dir: 0, get: (f) => ({ v: f.inicio, nd: "Não localizado no cadastro CVM" }) },
  );
  App.M = Object.fromEntries(M.map((m) => [m.id, m]));
  App.metricList = M;
  App.metricCell = function (f, id, opts) {
    const m = App.M[id];
    const { v, nd } = m.get(f);
    let kind = m.kind;
    if (kind === "ret") kind = App.state.retMode === "excess" ? "pp" : App.state.retMode === "pctb" ? "pctb" : "pct";
    return App.cell(v, kind, nd, Object.assign({ sign: m.sign }, opts));
  };
  App.metricText = function (f, id) {
    const m = App.M[id]; const { v } = m.get(f);
    let kind = m.kind;
    if (kind === "ret") kind = App.state.retMode === "excess" ? "pp" : App.state.retMode === "pctb" ? "pctb" : "pct";
    const tmp = document.createElement("div"); tmp.innerHTML = App.cell(v, kind, null, { sign: m.sign }); return tmp.textContent;
  };
  App.retModeLabel = function () {
    const base = App.state.retBase === "ann" ? " (anualizada ≥ 12M)" : "";
    return { abs: "Rentabilidade", excess: "Excesso sobre o benchmark", pctb: "% do benchmark" }[App.state.retMode] + base;
  };

  /* Liquidez em texto: "D0 / D+21 / D+22" (aplicação / cotização resgate / crédito) */
  App.liquidityText = (f) => {
    const p = (n) => (n == null ? "N/D" : n === 0 ? "D0" : "D+" + n);
    return `${p(f.cot_apl)} / ${p(f.cot_resg)} / ${p(f.liq_resg)}`;
  };
  /* Campo "Tributacao_Longo_Prazo" do cadastro CVM: S / N / N/A */
  App.tribText = (v) => ({ S: "Longo prazo", N: "Não é longo prazo", "N/A": "Não se aplica" }[v] || (v ? v : null));
  App.badges = (f) =>
    (f.qualificado ? '<span class="badge iq" title="Destinado a investidores qualificados">IQ</span> ' : "") +
    (f.previdencia ? '<span class="badge prev" title="Estratégia disponível em versão previdenciária">PREV</span> ' : "") +
    (f.isento_ir ? '<span class="badge isento" title="Rendimentos isentos de IR para pessoa física">ISENTO</span> ' : "") +
    ((f.qc || []).some((q) => q.nivel !== "info") ? '<span class="badge warn" title="Há alertas de qualidade de dados — ver detalhes do fundo">!</span>' : "");
})();

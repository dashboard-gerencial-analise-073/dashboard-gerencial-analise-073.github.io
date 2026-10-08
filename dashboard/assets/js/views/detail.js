/* Página de detalhe do fundo. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt, C = () => App.charts;
  App.views = App.views || {};
  const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  function kpi(label, valueHtml, hint) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${valueHtml}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }

  function render(root, params) {
    const f = App.byId[params[0]];
    if (!f) { root.innerHTML = `<div class="card empty"><h3>Fundo não encontrado</h3><p><a href="#/fundos">Voltar à lista de fundos</a></p></div>`; return; }
    const bench = App.benchById[f.benchmark_id] || {};
    const r12 = f.ret["12m"] || {}, k12 = (f.risk || {})["12m"] || {};
    const fl = f.flow || {};
    const sel = App.state.selection.includes(f.id);
    const qcWarn = (f.qc || []).filter((q) => q.nivel !== "info" && !/^CARTEIRA|SEM_CARTEIRA/.test(q.codigo));
    const TABS = [["resumo", "Resumo"], ["mensal", "Rentabilidade mensal"], ["carteira", "Carteira"]];
    const tab = TABS.some((t) => t[0] === params[1]) ? params[1] : "resumo";

    root.innerHTML = `
      <div class="detail-head">
        <div style="min-width:0">
          <div class="crumbs"><a href="#/fundos">Fundos</a> › ${esc(f.categoria)}</div>
          <h2>${esc(f.nome)}</h2>
          <div class="small" style="color:var(--text-2)">${App.badges(f)} ${esc(f.familia || "")} · ${esc(f.estrutura || "")} · CNPJ <span class="num">${esc(f.cnpj)}</span></div>
          ${f.cvm && f.cvm.denominacao ? `<div class="small muted" style="margin-top:2px">CVM: ${esc(f.cvm.denominacao)}</div>` : ""}
        </div>
        <div class="toolbar no-print">
          <button class="btn ${sel ? "" : "primary"}" id="btn-sel" type="button">${sel ? "✓ Na comparação" : "+ Adicionar à comparação"}</button>
          ${App.state.selection.length ? `<a class="btn" href="#/comparacao">Ir para comparação</a>` : ""}
        </div>
      </div>
      ${qcWarn.length ? `<div class="warn-note" style="margin-top:14px"><b>Atenção aos dados:</b> ${qcWarn.map((q) => esc(q.mensagem)).join(" ")}</div>` : ""}
      <nav class="subtabs no-print" aria-label="Seções do fundo">${TABS.map(([k, t]) => `<a href="#/fundo/${encodeURIComponent(f.id)}/${k}" aria-current="${k === tab ? "page" : "false"}">${t}</a>`).join("")}</nav>

      <div data-tab="resumo">
      <div class="card kpi-strip" style="margin-top:16px">
        ${kpi("Patrimônio líquido", App.cell(fl.pl, "money", "PL não disponível na data-base"), fl.data ? `em ${fmt.date(fl.data)}` : "")}
        ${kpi("Rentabilidade 12M", App.cell(r12.f, "pct", r12.nd), r12.b != null ? `${esc(bench.nome)}: ${fmt.pct(r12.b)}` : `${esc(bench.nome || "Benchmark")}: N/D`)}
        ${kpi("Volatilidade 12M", App.cell(k12.vol, "pct", k12.nd, { sign: false }), f.alvo_tipo === "Vol target" && f.alvo ? `Vol target: ${esc(f.alvo)}` : "anualizada")}
        ${kpi("Sharpe 12M", App.cell(k12.sharpe, "ratio", k12.nd), "vs CDI")}
        ${kpi("Máx. drawdown 12M", App.cell(k12.mdd, "pct", k12.nd), k12.mdd_vale ? `vale em ${fmt.date(k12.mdd_vale)}` : "")}
        ${kpi("Resgate", App.cell(f.liq_resg, "days", "Não informado"), `cotização ${f.cot_resg == null ? "N/D" : "D+" + f.cot_resg} · ${esc(f.prazo_tipo || "")}`)}
      </div>

      <div class="grid g-main" style="margin-top:16px">
        <div class="card">
          <div class="card-h"><h3>Evolução de R$ 100 e drawdown</h3>
            <div class="seg no-print" id="period" role="group" aria-label="Período"></div></div>
          <div class="card-b"><div class="chart tall" id="ch-growth" role="img" aria-label="Evolução de R$ 100 investidos"></div></div>
          <div class="card-note" id="growth-note"></div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Sobre o fundo</h3></div>
          <div class="card-b">
            <p class="desc">${f.descricao ? esc(f.descricao) : App.ND("Descrição não disponível") + ' <span class="muted small">— descrição não disponível na fonte</span>'}</p>
            <dl class="kv" style="margin-top:12px" id="kv"></dl>
          </div>
        </div>
      </div>

      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Rentabilidade por janela</h3><span class="sub">Acumulada; anualizada a partir de 12M</span></div>
          <div class="card-b" style="overflow-x:auto"><table class="compact" id="t-ret"></table></div></div>
        <div class="card"><div class="card-h"><h3>Indicadores de risco</h3><span class="sub">Base diária, anualizados por √252</span></div>
          <div class="card-b" style="overflow-x:auto"><table class="compact" id="t-risk"></table></div></div>
      </div>


      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Patrimônio líquido</h3><span class="sub">Último dia útil de cada mês (CVM)</span></div>
          <div class="card-b"><div class="chart short" id="ch-pl"></div></div></div>
        <div class="card"><div class="card-h"><h3>Fluxos e cotistas</h3><span class="sub">Últimos 12 meses</span></div>
          <div class="card-b"><dl class="kv" id="kv-flow"></dl></div></div>
      </div>

      <details class="card" style="margin-top:16px" ${qcWarn.length ? "open" : ""}><summary class="card-h" style="cursor:pointer;padding-bottom:14px"><h3 style="display:inline">Qualidade e rastreabilidade dos dados</h3></summary>
        <div class="card-b"><ul class="qc-list" id="qc"></ul></div></details>
      </div>

      <div data-tab="mensal">
        <div class="card" style="margin-top:16px"><div class="card-h"><h3>Rentabilidade mês a mês</h3><span class="sub">Fundo vs. ${esc(bench.nome || "benchmark")} · últimos 24 meses</span></div>
          <div class="card-b"><div class="chart" id="ch-month"></div></div></div>
        <div class="card" style="margin-top:16px"><div class="card-h"><h3>Tabela mensal</h3><span class="sub">Fundo, ${esc(bench.nome || "benchmark")} e relação com o benchmark · * mês corrente até ${fmt.date(App.meta.data_base)}</span>
          <div class="seg no-print" id="m-mode" role="group" aria-label="Linha de comparação"></div></div>
          <div class="card-b" style="overflow-x:auto"><table class="compact monthly" id="t-month"></table></div>
          <div class="card-note">Rentabilidade de fim de mês a fim de mês, calculada pelas cotas da CVM. Mês sem cota no início e no fim (inclusive o mês de início do fundo, que seria parcial) aparece como —. "Ano" = composição dos meses (ano corrente = YTD). "Acum." = composição de todos os meses do histórico coletado (desde o primeiro mês completo). Rentabilidade líquida de taxas, bruta de IR.</div></div>
      </div>

      <div data-tab="carteira" id="tab-carteira"></div>`;
    root.querySelectorAll("[data-tab]").forEach((el) => el.classList.toggle("hidden", el.dataset.tab !== tab));

    document.getElementById("btn-sel").addEventListener("click", () => { App.toggleSelect(f.id); render(root, params); });

    // Características
    const perf = f.taxa_perf == null ? "Não há" : `${fmt.num(f.taxa_perf, 0)}% do que exceder ${esc(f.taxa_perf_indice || "o índice")}`;
    const kv = [
      ["Categoria", esc(f.categoria)], ["Classificação ANBIMA (CVM)", esc((f.cvm || {}).classificacao_anbima) || App.ND("Não informada no cadastro CVM")],
      ["Benchmark", esc(bench.nome || f.benchmark_id) + (bench.disponivel ? "" : ' <span class="muted small">(sem série pública — comparações N/D)</span>')],
      [esc(f.alvo_tipo || "Objetivo"), esc(f.alvo) || App.ND()],
      ["Taxa de administração", f.taxa_adm == null ? App.ND() : `${fmt.num(f.taxa_adm, 2)}% a.a.`], ["Taxa de performance", perf],
      ["Aplicação / resgate / crédito", `<span class="num">${App.liquidityText(f)}</span> <span class="muted small">(${esc(f.prazo_tipo || "")})</span>`],
      ["Público-alvo", f.qualificado ? "Investidores qualificados" : "Investidores em geral"],
      ["Tributação", f.isento_ir ? "Isento de IR para pessoa física" : esc(App.tribText((f.cvm || {}).tributacao_lp) || "Conforme regulamento")],
      ["Versão previdência", f.previdencia ? "Disponível" : "Não informada"],
      ["Início do fundo", App.cell(f.inicio, "date", "Não localizado na CVM")],
      ["Primeira cota na base", App.cell(f.primeira_cota, "date", "Sem cotas no período coletado")],
      ["Administrador", esc((f.cvm || {}).administrador) || App.ND()], ["Gestor", esc((f.cvm || {}).gestor) || App.ND()],
      ["Situação na CVM", esc((f.cvm || {}).situacao) || App.ND()],
      ["Classificação de risco (lâmina)", f.risco_lamina ? esc(f.risco_lamina) : App.ND("Não disponível na base")],
    ];
    document.getElementById("kv").innerHTML = kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    // Fluxos
    const dpl = fl.pl != null && fl.pl_12m_atras ? fl.pl / fl.pl_12m_atras - 1 : null;
    document.getElementById("kv-flow").innerHTML = [
      ["PL atual", App.cell(fl.pl, "money", "N/D")], ["PL há 12 meses", App.cell(fl.pl_12m_atras, "money", "Sem dado há 12 meses")],
      ["Variação do PL", App.cell(dpl, "pct", "N/D")], ["PL médio 12M", App.cell(fl.pl_medio_12m, "money", "Histórico insuficiente")],
      ["Captação líquida 12M", App.cell(fl.captacao_liquida_12m, "money", "Histórico insuficiente")],
      ["Cotistas", App.cell(fl.cotistas, "int", "N/D")], ["Cotistas há 12 meses", App.cell(fl.cotistas_12m_atras, "int", "N/D")],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    // Tabela de rentabilidade
    const W = App.windows;
    const row = (label, get, kind, cls) => `<tr class="${cls || ""}"><td>${label}</td>${W.map((w) => `<td>${get(f.ret[w.id] || {}, w)}</td>`).join("")}</tr>`;
    const bnd = (r) => r.nd_b || "Benchmark sem série histórica";
    document.getElementById("t-ret").innerHTML = `<thead><tr><th></th>${W.map((w) => `<th title="${esc(w.long)}">${esc(w.label)}</th>`).join("")}</tr></thead><tbody>` +
      row("Fundo", (r) => App.cell(r.f, "pct", r.nd)) +
      row(esc(bench.nome || "Benchmark"), (r) => App.cell(r.b, "pct", bnd(r), { color: false }), null, "bench") +
      row("Excesso (p.p.)", (r) => App.cell(r.x, "pp", r.nd || bnd(r))) +
      (bench.mercado ? "" : row("% do benchmark", (r) => App.cell(r.pb, "pctb", r.nd || bnd(r)), null, "sub")) +
      row("Fundo a.a.", (r, w) => (w.type === "months" && w.n >= 12 ? App.cell(r.fa, "pct", r.nd) : '<span class="muted">—</span>'), null, "sub") +
      row(esc(bench.nome || "Bench") + " a.a.", (r, w) => (w.type === "months" && w.n >= 12 ? App.cell(r.ba, "pct", bnd(r), { color: false }) : '<span class="muted">—</span>'), null, "sub") +
      `</tbody>`;

    // Tabela de risco
    const RW = App.riskWindows;
    const rrow = (label, key, kind, opts, nd2) => `<tr><td>${label}</td>${RW.map((w) => { const k = (f.risk || {})[w] || {}; return `<td>${App.cell(k[key], kind, k.nd || nd2, opts)}</td>`; }).join("")}</tr>`;
    const mk = "Calculado apenas para benchmark de mercado com série disponível";
    document.getElementById("t-risk").innerHTML = `<thead><tr><th></th>${RW.map((w) => `<th>${App.W[w].label}</th>`).join("")}</tr></thead><tbody>` +
      rrow("Volatilidade a.a.", "vol", "pct", { sign: false }) + rrow("Sharpe (vs CDI)", "sharpe", "ratio") +
      rrow("Máximo drawdown", "mdd", "pct") + rrow("% meses positivos", "pct_meses_pos", "pctb", null, "Sem meses completos") +
      rrow("% meses acima do bench.", "pct_meses_acima_bench", "pctb", null, "Benchmark sem série histórica") +
      (bench.mercado ? rrow("Beta", "beta", "ratio", null, mk) + rrow("Tracking error a.a.", "te", "pct", { sign: false }, mk) + rrow("Information ratio", "ir", "ratio", null, mk) : "") +
      `</tbody>`;

    // Rentabilidade mensal
    if (tab === "mensal") renderMonthly(f, bench);

    if (tab === "carteira") App.renderCarteira(document.getElementById("tab-carteira"), f, params[2]);

    if (tab === "resumo") {
    // PL mensal
    const plm = Object.entries(f.pl_mensal || {});
    if (plm.length) {
      App.charts.mount(document.getElementById("ch-pl"), {
        grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
        tooltip: Object.assign({}, App.charts.tooltipBase, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(14,42,51,.04)" } },
          formatter: (ps) => `<div class="tt"><div class="tt-h">${fmt.monthLabel(plm[ps[0].dataIndex][0])}</div><div class="row"><span>PL</span><b>${fmt.money(ps[0].value)}</b></div><div class="row"><span>Cotistas</span><b>${fmt.int(plm[ps[0].dataIndex][1][1])}</b></div></div>` }),
        xAxis: Object.assign({ type: "category", data: plm.map(([k]) => fmt.monthLabel(k)) }, App.charts.axisCommon, { splitLine: { show: false } }),
        yAxis: Object.assign({ type: "value" }, App.charts.axisCommon, { axisLabel: { color: "#7d8f95", fontSize: 11, formatter: (v) => fmt.money(v).replace("R$ ", "") } }),
        series: [{ type: "bar", data: plm.map(([, v]) => v[0]), itemStyle: { color: "#2e5562", borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 }],
      });
    } else document.getElementById("ch-pl").outerHTML = `<div class="empty">${App.ND()} Sem dados de PL no Informe Diário da CVM.</div>`;

    // Qualidade
    const qc = f.qc || [];
    const trace = [
      { nivel: "info", mensagem: `Cadastro: ${f.fonte_cadastro || "N/D"}${f.data_fonte_cadastro ? " (" + f.data_fonte_cadastro + ")" : " — documento sem data informada"}.` },
      { nivel: "info", mensagem: `Cotas, PL, cotistas e fluxos: CVM — Informe Diário (${(f.cvm || {}).fonte ? "cadastro " + f.cvm.fonte : "cadastro não localizado"}). Última cota: ${fmt.date(f.ultima_cota) || "N/D"}.` },
      { nivel: "info", mensagem: `Benchmark ${bench.nome || f.benchmark_id}: ${bench.disponivel ? "fonte " + bench.fonte + ", última observação " + fmt.date(bench.ultima_data) : "sem série histórica pública — métricas relativas N/D"}.` },
    ];
    document.getElementById("qc").innerHTML = trace.concat(qc).map((q) => `<li><span class="lvl ${q.nivel}">${q.nivel}</span><span>${esc(q.mensagem)}</span></li>`).join("");

    // Gráfico de evolução
    const periods = [["12", "12M"], ["24", "24M"], ["36", "36M"], ["48", "48M"], ["max", "Máx."]];
    const pEl = document.getElementById("period");
    let per = App.store.get("detailPeriod", "36");
    pEl.innerHTML = periods.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("");
    const draw = () => {
      pEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === per)));
      const q = App.fullSeries(f), last = App.axis.length - 1;
      let i0 = C().periodStart(per === "max" ? "max" : +per);
      const fi = App.firstIdx(q);
      const note = [];
      if (fi == null) { document.getElementById("ch-growth").innerHTML = `<div class="empty">${App.ND()} Sem cotas disponíveis para este fundo.</div>`; return; }
      if (fi > i0) { note.push(`Histórico disponível a partir de ${fmt.date(App.axis[fi])}; gráfico inicia nessa data.`); i0 = fi; }
      while (i0 < last && q[i0] == null) i0++;
      const series = [{ name: f.nome, color: App.SERIES_COLORS[0], data: C().growth(q, i0, last) }];
      const bs = App.benchSeries(f.benchmark_id);
      if (bs && bs[i0] != null) series.push({ name: bench.nome, color: App.BENCH_COLOR, dashed: true, data: C().growth(bs, i0, last) });
      else note.push(`${bench.nome || "Benchmark"}: sem série histórica pública.`);
      if (f.benchmark_id !== "CDI") { const cs = App.benchSeries("CDI"); series.push({ name: "CDI", color: "#b7c2c5", dashed: true, data: C().growth(cs, i0, last) }); }
      const dd = C().drawdown(q, i0, last);
      const fmtV = (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      App.charts.mount(document.getElementById("ch-growth"), {
        grid: [{ left: 8, right: 16, top: 40, height: "56%", containLabel: true }, { left: 8, right: 16, top: "76%", bottom: 8, containLabel: true }],
        legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: "#4b5f66", fontSize: 12 } },
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        tooltip: Object.assign({}, App.charts.tooltipBase, { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#cfd6cf" } },
          formatter: (ps) => `<div class="tt"><div class="tt-h">${fmt.date(ps[0].data[0])}</div>` + ps.filter((p) => p.data[1] != null).map((p) => `<div class="row"><span>${App.charts.dot(p.color, p.seriesName !== f.nome && p.seriesName !== "Drawdown")}${esc(p.seriesName)}</span><b>${p.seriesName === "Drawdown" ? App.charts.pct(p.data[1], 2) : fmtV(p.data[1])}</b></div>`).join("") + "</div>" }),
        xAxis: [0, 1].map((gi) => Object.assign({ type: "time", gridIndex: gi, boundaryGap: false }, App.charts.axisCommon, { splitLine: { show: false }, axisLabel: { show: gi === 1, color: "#7d8f95", fontSize: 11, hideOverlap: true, formatter: { year: "{yyyy}", month: "{MMM}/{yy}", day: "{dd}/{MM}" } } })),
        yAxis: [Object.assign({ type: "value", scale: true, gridIndex: 0 }, App.charts.axisCommon, { axisLabel: { color: "#7d8f95", fontSize: 11 } }),
          Object.assign({ type: "value", gridIndex: 1, max: 0, splitNumber: 2 }, App.charts.axisCommon, { axisLabel: { color: "#7d8f95", fontSize: 11, formatter: (v) => App.charts.pct(v, 0) } })],
        series: series.map((s) => ({ name: s.name, type: "line", xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, data: s.data, z: s.dashed ? 1 : 2,
          lineStyle: { width: s.dashed ? 1.5 : 2, type: s.dashed ? "dashed" : "solid", color: s.color }, itemStyle: { color: s.color } }))
          .concat([{ name: "Drawdown", type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: dd, lineStyle: { width: 1.5, color: "#b4282c" }, itemStyle: { color: "#b4282c" }, areaStyle: { color: "#b4282c", opacity: 0.1 } }]),
      });
      document.getElementById("growth-note").textContent = [`Base 100 em ${fmt.date(App.axis[i0])}. Painel inferior: queda em relação ao pico anterior do fundo.`].concat(note).join(" ");
    };
    pEl.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; per = b.dataset.v; App.store.set("detailPeriod", per); draw(); });
    draw();
    }
  }

  /* ---------- Aba: rentabilidade mês a mês ---------- */
  function renderMonthly(f, bench) {
    const mensal = f.mensal || {}, anual = f.anual || {};
    const years = [...new Set(Object.keys(mensal).map((k) => k.slice(0, 4)).concat(Object.keys(anual)))].sort().reverse();
    const key = (y, i) => `${y}-${String(i + 1).padStart(2, "0")}`;
    const isCurrent = (k) => App.meta.data_base.slice(0, 7) === k;
    const hasB = bench.disponivel;
    const modes = hasB ? (bench.mercado ? [["x", "Excesso (p.p.)"]] : [["pb", `% do ${bench.nome}`], ["x", "Excesso (p.p.)"]]) : [];
    let mode = App.store.get("monthMode", modes[0] ? modes[0][0] : null);
    if (!modes.some((m) => m[0] === mode)) mode = modes[0] ? modes[0][0] : null;
    const mEl = document.getElementById("m-mode");
    const dash = '<span class="muted">—</span>';
    const rel = (fv, bv) => {
      if (fv == null || bv == null) return dash;
      if (mode === "pb") return bv > 0 ? App.cell(fv / bv, "pctb") : App.ND("Benchmark com retorno não positivo no mês");
      return App.cell(fv - bv, "pp");
    };
    // Acumulado: composição de todos os meses disponíveis, apenas se forem consecutivos (sem lacunas).
    const ks = Object.keys(mensal).sort();
    const consecutive = ks.every((k, i) => i === 0 || App.addMonthsISO(ks[i - 1] + "-01", 1).slice(0, 7) === k);
    const acc = consecutive && ks.length ? ks.reduce((p, k) => p * (1 + mensal[k][0]), 1) - 1 : null;
    const accB = consecutive && ks.length && ks.every((k) => mensal[k][1] != null) ? ks.reduce((p, k) => p * (1 + mensal[k][1]), 1) - 1 : null;
    const accWhy = consecutive ? "" : "Há meses sem rentabilidade no histórico: acumulado não calculado";
    const accTitle = ks.length ? `Acumulado de ${fmt.monthLabel(ks[0])} a ${fmt.monthLabel(ks[ks.length - 1])}` : "";
    const draw = () => {
      mEl.innerHTML = modes.map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${k === mode}">${t}</button>`).join("");
      document.getElementById("t-month").innerHTML = years.length ? `<thead><tr><th>Ano</th>${MONTHS.map((m) => `<th>${m}</th>`).join("")}<th>Ano</th><th title="${esc(accTitle)}">Acum.*</th></tr></thead><tbody>` +
        years.map((y, yi) => {
          const fr = MONTHS.map((_, i) => { const v = mensal[key(y, i)]; return `<td class="cell">${v ? App.cell(v[0], "pct", "", { sign: false }) + (isCurrent(key(y, i)) ? "*" : "") : dash}</td>`; }).join("");
          const br = MONTHS.map((_, i) => { const v = mensal[key(y, i)]; return `<td>${v && v[1] != null ? App.cell(v[1], "pct", "", { sign: false, color: false }) : dash}</td>`; }).join("");
          const xr = MONTHS.map((_, i) => { const v = mensal[key(y, i)]; return `<td>${v ? rel(v[0], v[1]) : dash}</td>`; }).join("");
          const a = anual[y];
          return `<tr><td><b>${y}</b></td>${fr}<td><b>${a ? App.cell(a[0], "pct", "", { sign: false }) : dash}</b></td><td>${yi === 0 ? App.cell(acc, "pct", accWhy, { sign: false }) : ""}</td></tr>` +
            (hasB ? `<tr class="sub bench"><td>${esc(bench.nome)}</td>${br}<td>${a && a[1] != null ? App.cell(a[1], "pct", "", { sign: false, color: false }) : dash}</td><td>${yi === 0 ? App.cell(accB, "pct", accWhy || "Benchmark sem dado em algum mês", { sign: false, color: false }) : ""}</td></tr>` +
              `<tr class="sub"><td>${esc(modes.find((m) => m[0] === mode)[1])}</td>${xr}<td>${a ? rel(a[0], a[1]) : dash}</td><td></td></tr>` : "");
        }).join("") + `</tbody>` : `<tbody><tr><td>${App.ND("Sem histórico de cotas")} Sem histórico de cotas no período coletado.</td></tr></tbody>`;
    };
    mEl.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; mode = b.dataset.v; App.store.set("monthMode", mode); draw(); });
    draw();
    // Gráfico: últimos 24 meses, fundo vs benchmark
    const last24 = Object.keys(mensal).sort().slice(-24);
    if (!last24.length) { document.getElementById("ch-month").outerHTML = `<div class="empty">${App.ND()} Sem rentabilidade mensal disponível.</div>`; return; }
    const series = [{ name: f.nome, color: App.SERIES_COLORS[0], data: last24.map((k) => mensal[k][0]) }];
    if (hasB) series.push({ name: bench.nome, color: "#b7c2c5", data: last24.map((k) => mensal[k][1] ?? null) });
    App.charts.groupedBars(document.getElementById("ch-month"), last24.map((k) => fmt.monthLabel(k) + (isCurrent(k) ? "*" : "")), series, { fmt: (v) => App.charts.pct(v, 2) });
  }

  App.views.detail = { render };
})();

/* Página "Comparação": até 6 fundos lado a lado. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt, CH = () => App.charts;
  App.views = App.views || {};
  let period = App.store.get("cmpPeriod", "common");
  let rootRef = null;
  App.on("selection", () => { if (rootRef && document.body.contains(rootRef) && (location.hash.split("/")[1] || "") === "comparacao") render(rootRef); });

  function render(root) {
    const sel = App.state.selection.map((id) => App.byId[id]).filter(Boolean);
    root.innerHTML = `
      <div class="page-head">
        <div><h2>Comparação</h2><p>Selecione de 2 a ${App.MAX_COMPARE} fundos. Os gráficos usam o mesmo período e a mesma data-base para todos.</p></div>
      </div>
      <div class="card"><div class="card-b">
        <div class="toolbar">
          <div class="ac" id="ac"><input class="input" id="ac-in" type="search" placeholder="Adicionar fundo por nome ou CNPJ…" autocomplete="off" aria-label="Adicionar fundo à comparação" ${sel.length >= App.MAX_COMPARE ? "disabled" : ""}><div class="ac-list hidden" id="ac-list" role="listbox"></div></div>
          <div class="chips" id="sel-chips">${sel.map((f) => `<span class="chip" style="display:inline-flex;align-items:center;gap:6px"><span class="legend-dot" style="background:${App.colorOf(f.id)};margin:0"></span><a href="#/fundo/${f.id}" style="color:inherit;text-decoration:none">${esc(f.nome)}</a><button type="button" data-rm="${f.id}" style="border:0;background:none;padding:0 0 0 4px;color:var(--muted)" aria-label="Remover ${esc(f.nome)}">×</button></span>`).join("")}</div>
          ${sel.length ? '<button class="btn ghost" type="button" id="btn-clear">Limpar seleção</button>' : ""}
        </div>
      </div></div>
      <div id="cmp-body"></div>`;
    bindAc(root);
    root.querySelector("#sel-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) App.toggleSelect(b.dataset.rm, false); });
    const bc = root.querySelector("#btn-clear"); if (bc) bc.addEventListener("click", () => App.clearSelection());
    rootRef = root;

    const body = root.querySelector("#cmp-body");
    if (sel.length < 2) {
      body.innerHTML = `<div class="card empty" style="margin-top:16px"><h3>${sel.length ? "Adicione mais um fundo" : "Nenhum fundo selecionado"}</h3>
        <p>Use a busca acima ou marque fundos na <a href="#/fundos">tabela de fundos</a>.</p>
        <p class="small muted">Sugestão: compare fundos da mesma categoria e com o mesmo benchmark.</p></div>`;
      return;
    }
    renderBody(body, sel);
  }

  function bindAc(root) {
    const inp = root.querySelector("#ac-in"), list = root.querySelector("#ac-list");
    const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    let hl = 0, items = [];
    const show = () => {
      const q = norm(inp.value.trim()), qd = inp.value.replace(/\D/g, "");
      items = App.funds.filter((f) => !App.state.selection.includes(f.id) && (!q || norm(f.nome + " " + f.familia + " " + f.categoria).includes(q) || (qd.length >= 4 && f.cnpj.replace(/\D/g, "").includes(qd)))).slice(0, 12);
      list.innerHTML = items.map((f, i) => `<button type="button" role="option" data-id="${f.id}" class="${i === hl ? "hl" : ""}">${esc(f.nome)}<small>${esc(f.categoria)} · ${esc(f.cnpj)}</small></button>`).join("") || '<div class="small muted" style="padding:10px 12px">Nenhum fundo encontrado</div>';
      list.classList.remove("hidden");
    };
    inp.addEventListener("focus", show);
    inp.addEventListener("input", () => { hl = 0; show(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { hl = Math.min(hl + 1, items.length - 1); show(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); show(); e.preventDefault(); }
      else if (e.key === "Enter" && items[hl]) { App.toggleSelect(items[hl].id, true); }
      else if (e.key === "Escape") list.classList.add("hidden");
    });
    list.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-id]"); if (b) { e.preventDefault(); App.toggleSelect(b.dataset.id, true); } });
    inp.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 120));
  }

  function renderBody(body, sel) {
    const last = App.axis.length - 1;
    const series = sel.map((f) => ({ f, q: App.fullSeries(f), fi: App.firstIdx(App.fullSeries(f)), color: App.colorOf(f.id) }));
    const withData = series.filter((s) => s.fi != null);
    const commonStart = withData.length ? Math.max(...withData.map((s) => s.fi)) : last;
    const noData = series.filter((s) => s.fi == null).map((s) => s.f.nome);
    const benches = [...new Set(sel.map((f) => f.benchmark_id))];
    const periods = [["common", "Máx. comum"], ["12", "12M"], ["24", "24M"], ["36", "36M"], ["48", "48M"]];

    body.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>Evolução de R$ 100 investidos</h3><div class="seg no-print" id="cmp-period" role="group" aria-label="Período">${periods.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("")}</div></div>
        <div class="card-b"><div id="per-warn"></div><div class="chart tall" id="ch-growth" role="img" aria-label="Evolução de R$ 100 investidos por fundo"></div></div>
        <div class="card-note" id="growth-note"></div>
      </div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Drawdown</h3><span class="sub">Queda em relação ao pico anterior, mesmo período</span></div><div class="card-b"><div class="chart" id="ch-dd"></div></div></div>
        <div class="card"><div class="card-h"><h3>Risco × retorno</h3><span class="sub">Período selecionado, anualizados</span></div><div class="card-b"><div class="chart" id="ch-rr"></div></div><div class="card-note" id="rr-note"></div></div>
      </div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Rentabilidade por janela</h3><span class="sub">Acumulada até a data-base</span></div><div class="card-b"><div class="chart" id="ch-win"></div></div><div class="card-note">Barras ausentes = N/D (histórico insuficiente).</div></div>
        <div class="card"><div class="card-h"><h3>Correlação dos retornos diários</h3><span class="sub">Período selecionado</span></div><div class="card-b"><div class="chart" id="ch-corr"></div></div><div class="card-note">Correlação de Pearson dos retornos diários em datas comuns (mínimo de 60 observações). −1 a +1.</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Quadro comparativo</h3><span class="sub">Janela de risco: ${App.W[App.state.riskWin].label} (altere na página Fundos)</span></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cmp-table"></table></div>
        <div class="card-note">Valores lado a lado, sem destaque de "melhor" ou "pior": a leitura depende do objetivo e do perfil de cada investidor.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Rentabilidade mês a mês</h3><span class="sub">Últimos 12 meses · * mês corrente até ${fmt.date(App.meta.data_base)}</span></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cmp-monthly"></table></div>
        <div class="card-note">Fim de mês a fim de mês, pelas cotas da CVM. Histórico completo na aba “Rentabilidade mensal” de cada fundo.</div></div>`;

    const pEl = body.querySelector("#cmp-period");
    const draw = () => {
      pEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === period)));
      let i0 = period === "common" ? commonStart : CH().periodStart(+period);
      const short = series.filter((s) => s.fi != null && s.fi > i0);
      const warn = body.querySelector("#per-warn");
      warn.innerHTML = (noData.length ? `<div class="warn-note">${noData.map(esc).join(", ")}: sem cotas no Informe Diário da CVM — fora dos gráficos (N/D).</div>` : "") + (short.length ? `<div class="warn-note">${short.map((s) => esc(s.f.nome)).join(", ")} ${short.length > 1 ? "não possuem" : "não possui"} histórico desde ${fmt.date(App.axis[i0])}. ${short.length > 1 ? "Suas linhas iniciam" : "A linha inicia"} na primeira cota disponível (base 100 própria) — não compare o nível final diretamente. Use “Máx. comum” para uma comparação homogênea.</div>` : "");
      // Linhas
      const lines = series.filter((s) => s.fi != null).map((s) => {
        let st = Math.max(i0, s.fi); while (st < last && s.q[st] == null) st++;
        return { name: s.f.nome, color: s.color, data: CH().growth(s.q, st, last), st };
      });
      benches.filter((b) => App.benchAvailable(b)).forEach((b) => {
        const bs = App.benchSeries(b); let st = i0; while (st < last && bs[st] == null) st++;
        lines.push({ name: App.benchName(b), color: b === "CDI" ? App.BENCH_COLOR : "#a9b5b8", dashed: true, data: CH().growth(bs, st, last) });
      });
      CH().timeLines(body.querySelector("#ch-growth"), lines, { fmtY: (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), zoom: true });
      const nd = benches.filter((b) => !App.benchAvailable(b)).map(App.benchName);
      body.querySelector("#growth-note").textContent = `Base 100 em ${fmt.date(App.axis[i0])}; valores líquidos de taxas, brutos de IR. Benchmarks tracejados.` + (nd.length ? ` Sem série pública: ${nd.join(", ")}.` : "");
      // Drawdown
      CH().timeLines(body.querySelector("#ch-dd"), series.filter((s) => s.fi != null).map((s) => ({ name: s.f.nome, color: s.color, data: CH().drawdown(s.q, Math.max(i0, s.fi), last) })), { fmtY: (v) => CH().pct(v, 1), yMax: 0 });
      // Risco x retorno no período (mesmo cálculo do pipeline: composição e √252)
      const pts = [], miss = [];
      series.forEach((s) => {
        if (s.fi == null || s.fi > i0 || s.q[i0] == null || s.q[last] == null) { miss.push(s.f.nome); return; }
        const dr = CH().dailyReturns(s.q, i0, last).filter((x) => x != null);
        if (dr.length < 0.9 * (last - i0) || dr.length < 20) { miss.push(s.f.nome); return; }
        const m = dr.reduce((a, b) => a + b, 0) / dr.length;
        const sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / (dr.length - 1));
        const n = last - i0, r = s.q[last] / s.q[i0] - 1;
        pts.push({ id: s.f.id, name: s.f.nome, x: sd * Math.sqrt(App.meta.dias_uteis_ano), y: n >= 240 ? Math.pow(1 + r, App.meta.dias_uteis_ano / n) - 1 : r, color: s.color, label: s.f.nome });
      });
      const n = last - i0;
      const rr = CH().scatter(body.querySelector("#ch-rr"), pts, { xLabel: "Volatilidade (a.a.)", yLabel: n >= 240 ? "Rentabilidade (a.a.)" : "Rentabilidade no período", labels: true });
      rr && rr.on("click", (p) => { location.hash = "#/fundo/" + p.data.p.id; });
      body.querySelector("#rr-note").textContent = (n < 240 ? "Período inferior a 1 ano: rentabilidade não anualizada. " : "") + (miss.length ? `Fora do gráfico (histórico insuficiente no período): ${miss.join(", ")}.` : "");
      // Correlação
      const rets = series.map((s) => CH().dailyReturns(s.q, i0, last));
      const mat = rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : CH().correlation(a, b))));
      CH().corrMatrix(body.querySelector("#ch-corr"), sel.map((f) => f.nome), mat);
    };
    pEl.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; period = b.dataset.v; App.store.set("cmpPeriod", period); draw(); });
    draw();

    // Barras por janela (rentabilidade absoluta, acumulada)
    const wins = App.windows.filter((w) => w.id !== "m1");
    CH().groupedBars(body.querySelector("#ch-win"), wins.map((w) => w.label), sel.map((f) => ({ name: f.nome, color: App.colorOf(f.id), data: wins.map((w) => (f.ret[w.id] || {}).f ?? null) })));

    // Rentabilidade mês a mês (últimos 12 meses)
    const mkeys = [...new Set(sel.flatMap((f) => Object.keys(f.mensal || {})))].sort().slice(-12).reverse();
    const benchCols = benches.filter((b) => App.benchAvailable(b));
    const benchMonthly = (b, k) => { const f = sel.find((x) => x.benchmark_id === b && x.mensal && x.mensal[k] && x.mensal[k][1] != null); return f ? f.mensal[k][1] : null; };
    body.querySelector("#cmp-monthly").innerHTML = `<thead><tr><th class="l">Mês</th>${sel.map((f) => `<th><span class="legend-dot" style="background:${App.colorOf(f.id)}"></span>${esc(f.nome)}</th>`).join("")}${benchCols.map((b) => `<th style="color:var(--muted)">${esc(App.benchName(b))}</th>`).join("")}</tr></thead><tbody>` +
      mkeys.map((k) => `<tr style="cursor:default"><td class="l">${fmt.monthLabel(k)}${App.meta.data_base.slice(0, 7) === k ? "*" : ""}</td>${sel.map((f) => `<td>${f.mensal && f.mensal[k] ? App.cell(f.mensal[k][0], "pct", "") : '<span class="muted">—</span>'}</td>`).join("")}${benchCols.map((b) => { const v = benchMonthly(b, k); return `<td>${v == null ? '<span class="muted">—</span>' : App.cell(v, "pct", "", { color: false })}</td>`; }).join("")}</tr>`).join("") + "</tbody>";

    // Quadro comparativo
    const rw = App.state.riskWin;
    const rows = [
      ["Rentabilidade", null],
      ...App.windows.map((w) => [`${w.label}`, (f) => App.cell((f.ret[w.id] || {}).f, "pct", (f.ret[w.id] || {}).nd)]),
      ...App.windows.filter((w) => w.type === "months" && w.n >= 24).map((w) => [`${w.label} anualizada`, (f) => App.cell((f.ret[w.id] || {}).fa, "pct", (f.ret[w.id] || {}).nd)]),
      ["Benchmark", null],
      ["Benchmark", (f) => esc(App.benchName(f.benchmark_id))],
      ["Benchmark 12M", (f) => App.cell((f.ret["12m"] || {}).b, "pct", (f.ret["12m"] || {}).nd_b, { color: false })],
      ["Excesso 12M", (f) => App.cell((f.ret["12m"] || {}).x, "pp", (f.ret["12m"] || {}).nd || (f.ret["12m"] || {}).nd_b)],
      ["Excesso 36M a.a.", (f) => App.cell((f.ret["36m"] || {}).xa, "pp", (f.ret["36m"] || {}).nd || (f.ret["36m"] || {}).nd_b)],
      ["% do benchmark 12M", (f) => App.retValue(f, "12m", "pctb", "cum").v == null ? App.ND(App.retValue(f, "12m", "pctb", "cum").nd) : App.cell(App.retValue(f, "12m", "pctb", "cum").v, "pctb")],
      [`Risco (${App.W[rw].label})`, null],
      ["Volatilidade a.a.", (f) => App.metricCell(f, "vol:" + rw)],
      ["Sharpe", (f) => App.metricCell(f, "sharpe:" + rw)],
      ["Máximo drawdown", (f) => App.metricCell(f, "mdd:" + rw)],
      ["% meses positivos", (f) => App.metricCell(f, "mpos:" + rw)],
      ["% meses acima do bench.", (f) => App.metricCell(f, "macima:" + rw)],
      ["Objetivo (gestora)", (f) => (f.alvo ? `<span class="small">${esc(f.alvo_tipo)}: ${esc(f.alvo)}</span>` : App.ND())],
      ["Fundo", null],
      ["Categoria", (f) => esc(f.categoria)],
      ["PL", (f) => App.metricCell(f, "pl")],
      ["Captação líquida 12M", (f) => App.metricCell(f, "capt12")],
      ["Cotistas", (f) => App.metricCell(f, "cotistas")],
      ["Início", (f) => App.metricCell(f, "inicio")],
      ["Liquidez e custos", null],
      ["Aplic. / cotiz. / crédito", (f) => `<span class="num">${App.liquidityText(f)}</span>`],
      ["Taxa de administração", (f) => (f.taxa_adm == null ? App.ND() : `<span class="num">${fmt.num(f.taxa_adm, 2)}% a.a.</span>`)],
      ["Taxa de performance", (f) => (f.taxa_perf == null ? "Não há" : `<span class="num">${fmt.num(f.taxa_perf, 0)}%</span> <span class="small muted">s/ ${esc(f.taxa_perf_indice || "")}</span>`)],
      ["Público", (f) => (f.qualificado ? "Qualificado" : "Geral")],
      ["Tributação", (f) => (f.isento_ir ? "Isento (PF)" : "Tributado")],
      ["Estratégia", (f) => `<span class="small" style="white-space:normal;display:block;max-width:260px;text-align:left;color:var(--text-2)">${esc(f.descricao || "N/D")}</span>`],
    ];
    body.querySelector("#cmp-table").innerHTML = `<thead><tr><th class="l">Indicador</th>${sel.map((f) => `<th class="l"><span class="legend-dot" style="background:${App.colorOf(f.id)}"></span>${esc(f.nome)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(([label, fn]) => (fn ? `<tr style="cursor:default"><td class="l">${label}</td>${sel.map((f) => `<td class="${label === "Estratégia" ? "l" : ""}">${fn(f)}</td>`).join("")}</tr>` : `<tr><td class="group-h" colspan="${sel.length + 1}">${label}</td></tr>`)).join("") + "</tbody>";
  }

  App.views.compare = { render };
})();

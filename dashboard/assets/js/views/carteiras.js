/* Página "Carteiras": monte uma ou mais carteiras (fundos + % de alocação) e compare o retorno histórico
   (ano, 12M, 24M), risco e evolução. Fundos da prateleira, de mercado (CVM) e listados (B3).

   Metodologia: compra no fechamento do início da janela com os pesos informados (normalizados para 100%) e
   manutenção das cotas até a data-base (sem rebalanceamento, custos ou impostos):
     V(t) = Σ peso_i × Cota_i(t) / Cota_i(início)        Retorno = V(data-base) − 1
   Fundo sem cota no início da janela → a carteira fica N/D nessa janela (nunca se redistribui o peso).
   As carteiras ficam salvas neste navegador; "Copiar link" e "Exportar" levam a carteira para outro computador. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt, CH = () => App.charts;
  App.views = App.views || {};
  const st = App.store;
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#008300", "#e34948"];
  const PERIODS = [["ytd", "Ano"], ["12", "12M"], ["24", "24M"], ["36", "36M"], ["48", "48M"], ["common", "Máx. comum"]];
  let carts = st.get("carteiras", null) || [{ nome: "Carteira 1", itens: [] }];
  let active = Math.min(st.get("carteiraAtiva", 0), carts.length - 1);
  let period = st.get("cartPeriod", "12");
  let rentBase = st.get("cartRentBase", "cum");
  let riskWin = st.get("cartRiskWin", "12m");
  let rootRef = null;
  const save = () => { st.set("carteiras", carts); st.set("carteiraAtiva", active); };
  const colorOf = (i) => COLORS[i % COLORS.length];
  const cdi = App.benchSeries("CDI");
  const last = App.axis.length - 1;
  const DU = App.meta.dias_uteis_ano;
  const STAR = '<span class="best" title="Maior valor da coluna entre as carteiras">★</span>';
  const bestOf = (vals) => { const v = vals.filter((x) => x != null && isFinite(x)); return v.length >= 2 ? Math.max(...v) : null; };

  /* ---------------- Cálculo ---------------- */
  /* Janelas iguais às dos fundos (mesmas datas de início/fim usadas no pipeline). */
  const winIdx = (wid) => { const b = App.windowBounds[wid]; return b ? [App.axis.indexOf(b.start), App.axis.indexOf(b.end)] : [null, null]; };
  const firstCommon = (c) => { // 1º dia em que todos os fundos da carteira têm cota
    const fs = c.itens.filter((x) => x.peso > 0).map((x) => App.getFund(x.id)).map((f) => (f ? App.firstIdx(App.fullSeries(f)) : null));
    return fs.length && fs.every((x) => x != null) ? Math.max(...fs) : null;
  };
  const periodIdx = (p, c) => (p === "common" ? firstCommon(c) : p === "ytd" ? CH().periodStart("ytd") : CH().periodStart(+p));
  const LB = 5; // pregões aceitos para trás na cota inicial / dias sem cota
  /* Compra em i0 com os pesos informados e mantém até i1: V(t) = Σ w·Cota(t)/Cota(i0). */
  function evaluate(c, i0, i1 = last) {
    const itens = c.itens.filter((x) => x.peso > 0);
    const tot = itens.reduce((a, x) => a + x.peso, 0);
    if (!itens.length || !tot) return { nd: "Carteira sem fundos" };
    if (i0 == null || i1 == null || i0 < 0) return { nd: "Período sem histórico comum aos fundos" };
    const parts = [], faltam = [];
    for (const it of itens) {
      const f = App.getFund(it.id);
      if (!f) { faltam.push(it.nome || it.id); continue; }
      const q = App.fullSeries(f);
      let b = i0; while (b > i0 - LB && b >= 0 && q[b] == null) b--;
      if (b < 0 || q[b] == null) { faltam.push(f.nome); continue; }
      parts.push({ f, w: it.peso / tot, q, base: q[b] });
    }
    if (faltam.length) return { nd: `Sem histórico no início do período: ${faltam.join(", ")}` };
    const vals = [], lastV = parts.map((p) => p.base), age = parts.map(() => 0);
    for (let t = i0; t <= i1; t++) {
      let v = 0, ok = true;
      parts.forEach((p, k) => {
        if (p.q[t] != null) { lastV[k] = p.q[t]; age[k] = 0; } else if (t > i0) age[k]++;
        if (age[k] > LB) ok = false;
        v += (p.w * lastV[k]) / p.base;
      });
      vals.push(ok ? v : null);
    }
    const vEnd = vals[vals.length - 1];
    if (vEnd == null) return { nd: "Cotas ausentes no fim do período" };
    const n = i1 - i0, r = vEnd - 1;
    return { i0, i1, n, vals, r, ra: n >= 240 ? Math.pow(1 + r, DU / n) - 1 : null,
      parts: parts.map((p) => { const ri = lastV[parts.indexOf(p)] / p.base - 1; return { f: p.f, w: p.w, r: ri, contrib: p.w * ri }; }) };
  }
  /* Risco sobre a série V da janela (mesmas regras dos fundos: √252, cobertura ≥ 90%, meses completos). */
  function riskOf(ev) {
    if (!ev || ev.nd) return { nd: ev ? ev.nd : "—" };
    const dr = [];
    for (let k = 1; k < ev.vals.length; k++) if (ev.vals[k] != null && ev.vals[k - 1] != null) dr.push(ev.vals[k] / ev.vals[k - 1] - 1);
    const out = {};
    if (dr.length >= 0.9 * ev.n && dr.length > 20) {
      const m = dr.reduce((a, b) => a + b, 0) / dr.length;
      out.vol = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / (dr.length - 1)) * Math.sqrt(DU);
    }
    let peak = -Infinity, mdd = 0;
    ev.vals.forEach((v) => { if (v == null) return; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
    out.mdd = mdd;
    const rc = cdiRet(ev.i0, ev.i1), fa = Math.pow(1 + ev.r, DU / ev.n) - 1, ca = rc == null ? null : Math.pow(1 + rc, DU / ev.n) - 1;
    out.fa = fa; out.ca = ca;
    out.sharpe = out.vol && ca != null ? (fa - ca) / out.vol : null;
    out.x = rc == null ? null : ev.r - rc;
    const mm = monthly(ev).filter((x) => !x.parcial);
    if (mm.length) { out.meses = mm.length; out.mpos = mm.filter((x) => x.r > 0).length / mm.length; out.macima = mm.filter((x) => x.cdi != null && x.r > x.cdi).length / mm.length; }
    out.dr = dr;
    return out;
  }
  /* Rentabilidade mês a mês da série V (fim de mês a fim de mês; 1º e último mês parciais marcados). */
  function monthly(ev) {
    const out = [];
    if (!ev || ev.nd) return out;
    const idxOf = (t) => t - ev.i0;
    let prevT = ev.i0, prevK = App.axis[ev.i0].slice(0, 7);
    for (let t = ev.i0 + 1; t <= ev.i1; t++) {
      const k = App.axis[t].slice(0, 7), nextK = t < ev.i1 ? App.axis[t + 1].slice(0, 7) : null;
      if (nextK !== k) { // t = último dia útil do mês k (ou fim da janela)
        const a = ev.vals[idxOf(prevT)], b = ev.vals[idxOf(t)];
        if (a != null && b != null) out.push({ k, r: b / a - 1, cdi: cdi[prevT] && cdi[t] ? cdi[t] / cdi[prevT] - 1 : null, parcial: prevK === k });
        prevT = t; prevK = k;
      }
    }
    return out;
  }
  const cdiRet = (i0, i1 = last) => (i0 != null && cdi[i0] && cdi[i1] ? cdi[i1] / cdi[i0] - 1 : null);

  /* ---------------- Render ---------------- */
  function render(root, params) {
    rootRef = root;
    if (params && params[0]) importLink(params[0]);
    const ids = [...new Set(carts.flatMap((c) => c.itens.map((x) => x.id)))].filter((id) => !App.getFund(id));
    if (ids.length && !render._tried) {
      render._tried = true;
      root.innerHTML = `<div class="card empty"><h3>Carregando fundos das carteiras…</h3></div>`;
      App.ensureFunds(ids).then(() => render(root));
      return;
    }
    render._tried = false;
    const c = carts[active];
    root.innerHTML = `<div id="cart-root">
      <div class="page-head"><div><h2>Carteiras</h2><p>Monte carteiras com fundos da prateleira, de mercado ou listados na B3, defina o percentual de cada um e compare as carteiras com as mesmas métricas da página Comparação: rentabilidade por prazo, risco, drawdown, correlação e mês a mês.</p></div>
        <div class="toolbar no-print"><button class="btn" type="button" data-act="link" title="Link que reabre estas carteiras em qualquer computador">Copiar link</button>
          <button class="btn" type="button" data-act="export">Exportar</button><label class="btn" style="cursor:pointer">Importar<input type="file" accept=".json,application/json" id="cart-import" hidden></label>
          <button class="btn primary" type="button" data-act="print">Relatório (PDF)</button></div></div>
      <div class="card no-print"><div class="card-b">
        <div class="toolbar" id="cart-tabs">${carts.map((x, i) => `<button type="button" class="chip" data-tab="${i}" aria-pressed="${i === active}" style="display:inline-flex;align-items:center;gap:6px"><span class="legend-dot" style="background:${colorOf(i)};margin:0"></span>${esc(x.nome)}</button>`).join("")}
          <button class="btn ghost" type="button" data-act="new">+ Nova carteira</button>
          <button class="btn ghost" type="button" data-act="fromsel" title="Cria uma carteira com os fundos selecionados na Comparação, em partes iguais">+ Da seleção da Comparação (${App.state.selection.length})</button></div>
        <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
          <input class="input" id="cart-name" value="${esc(c.nome)}" aria-label="Nome da carteira" style="font-weight:600;width:240px">
          <button class="btn ghost small" type="button" data-act="dup">Duplicar</button>
          <button class="btn ghost small" type="button" data-act="del">Excluir</button>
          <span style="flex:1"></span>
          <div class="ac" id="cart-ac"><input class="input" id="cart-q" type="search" placeholder="Adicionar fundo por nome, ticker ou CNPJ…" autocomplete="off" aria-label="Adicionar fundo"><div class="ac-list hidden" id="cart-list" role="listbox"></div></div>
        </div>
        <div class="table-wrap" style="max-height:none;margin-top:10px"><table class="data" id="cart-itens"></table></div>
      </div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Rentabilidade por prazo</h3>
          <div class="seg no-print" id="cart-rentbase" role="group"><button type="button" data-v="cum" aria-pressed="${rentBase === "cum"}">Acumulada</button><button type="button" data-v="ann" aria-pressed="${rentBase === "ann"}">Anualizada (≥ 12M)</button></div></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cart-rent"></table></div>
        <div class="card-note">Em cada prazo, compra no fechamento do início do prazo com os percentuais informados, sem rebalancear, sem custos e sem impostos (mesmas datas de início/fim usadas para os fundos). ★ = maior valor da coluna. Até ${fmt.date(App.meta.data_base)}.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Quadro comparativo</h3>
          <div class="toolbar no-print"><span class="small muted">Janela de risco:</span><div class="seg" id="cart-riskwin" role="group">${App.riskWindows.map((w) => `<button type="button" data-v="${w}" aria-pressed="${riskWin === w}">${App.W[w].label}</button>`).join("")}</div></div></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cart-quadro"></table></div>
        <div class="card-note">Mesmas fórmulas da página Comparação, aplicadas ao valor diário de cada carteira: volatilidade = desvio-padrão dos retornos diários × √252; Sharpe = (retorno a.a. − CDI a.a.) ÷ volatilidade; meses completos dentro da janela.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Evolução de R$ 100</h3><div class="seg no-print" id="cart-period" role="group">${PERIODS.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${period === v}">${t}</button>`).join("")}</div></div>
        <div class="card-b"><div id="cart-warn"></div><div class="chart tall" id="cart-ch"></div></div><div class="card-note" id="cart-ch-note"></div></div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Drawdown</h3><span class="sub">Queda em relação ao pico anterior, mesmo período</span></div><div class="card-b"><div class="chart" id="cart-dd"></div></div></div>
        <div class="card"><div class="card-h"><h3>Risco × retorno</h3><span class="sub">Período selecionado</span></div><div class="card-b"><div class="chart" id="cart-rr"></div></div><div class="card-note" id="cart-rr-note"></div></div>
      </div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Rentabilidade por prazo</h3><span class="sub">Acumulada até a data-base</span></div><div class="card-b"><div class="chart" id="cart-win"></div></div></div>
        <div class="card"><div class="card-h"><h3>Correlação dos retornos diários</h3><span class="sub">Período selecionado</span></div><div class="card-b"><div class="chart" id="cart-corr"></div></div><div class="card-note">Correlação de Pearson dos retornos diários das carteiras (mínimo de 60 observações).</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Rentabilidade mês a mês</h3><span class="sub" id="cart-m-sub"></span></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cart-monthly"></table></div>
        <div class="card-note">Fim de mês a fim de mês dentro do período selecionado (compra no início do período). ★ = maior do mês entre as carteiras. * mês da data-base.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Composição e contribuição</h3><span class="sub" id="cart-contrib-sub"></span></div>
        <div class="card-b" id="cart-contrib"></div></div></div>`;
    const box = root.querySelector("#cart-root"); // eventos presos ao conteúdo da página (recriado a cada render)
    bind(box, root);
    drawItens(root);
    drawAll(root);
  }

  function drawItens(root) {
    const c = carts[active];
    const tot = c.itens.reduce((a, x) => a + (+x.peso || 0), 0);
    root.querySelector("#cart-itens").innerHTML = `<thead><tr><th class="l">Fundo</th><th class="l">Tipo</th><th>% da carteira</th><th>12M</th><th></th></tr></thead><tbody>` +
      (c.itens.length ? c.itens.map((x, i) => {
        const f = App.getFund(x.id);
        const tipo = f ? (f.listado ? f.tipo : f.mercado ? "Mercado (CVM)" : f.categoria) : "—";
        return `<tr style="cursor:default"><td class="l">${esc(f ? f.nome : x.nome || x.id)}${f ? "" : ' <span class="badge warn" title="Fundo fora da base desta data-base">fora da base</span>'}</td><td class="l small">${esc(tipo)}</td>
          <td><input class="input" data-peso="${i}" inputmode="decimal" value="${esc(fmt.num(+x.peso || 0, 1))}" style="width:80px;text-align:right" aria-label="Percentual"> %</td>
          <td>${f ? App.cell((f.ret["12m"] || {}).f, "pct", (f.ret["12m"] || {}).nd) : App.ND()}</td>
          <td><button class="btn ghost small" type="button" data-rmi="${i}" aria-label="Remover">×</button></td></tr>`;
      }).join("") + `<tr style="cursor:default"><td class="l" colspan="2"><b>Total</b>${Math.abs(tot - 100) > 0.05 ? ` <span class="warn-note" style="display:inline-block;margin:0 0 0 8px;padding:2px 8px">soma ${fmt.num(tot, 1)}% — cálculos usam os pesos proporcionais (100%). <a href="#" data-norm>Ajustar para 100%</a></span>` : ""}</td><td><b class="num">${fmt.num(tot, 1)}%</b></td><td></td><td><button class="btn ghost small" type="button" data-eq title="Mesmo percentual para todos">Igualar</button></td></tr>`
        : `<tr><td class="l" colspan="5"><div class="empty" style="padding:20px"><p>Adicione fundos com a busca acima.</p></div></td></tr>`) + "</tbody>";
  }

  function drawAll(root) {
    const Q = (s) => root.querySelector(s);
    const pctU = { sign: false, color: false };
    // 1) Rentabilidade por prazo
    const ann = rentBase === "ann";
    const wins = App.windows.filter((w) => !ann || (w.type === "months" && w.n >= 12));
    const evw = carts.map((c) => Object.fromEntries(wins.map((w) => { const [a, b] = winIdx(w.id); return [w.id, evaluate(c, a, b)]; })));
    const val = (e) => (ann ? e.ra : e.r);
    const best = Object.fromEntries(wins.map((w) => [w.id, bestOf(evw.map((e) => val(e[w.id])))]));
    const cdiW = (w) => { const [a, b] = winIdx(w.id); const r = cdiRet(a, b); return ann && r != null ? Math.pow(1 + r, DU / (b - a)) - 1 : r; };
    Q("#cart-rent").innerHTML = `<thead><tr><th class="l">Carteira</th>${wins.map((w) => `<th title="${esc(w.long)}">${esc(w.label)}${ann ? " a.a." : ""}</th>`).join("")}</tr></thead><tbody>` +
      carts.map((c, i) => `<tr data-tab="${i}" class="${i === active ? "selected" : ""}"><td class="l fund-cell"><span class="legend-dot" style="background:${colorOf(i)}"></span><b>${esc(c.nome)}</b></td>${wins.map((w) => { const e = evw[i][w.id], v = val(e); return `<td>${App.cell(v, "pct", e.nd)}${v != null && v === best[w.id] ? STAR : ""}</td>`; }).join("")}</tr>`).join("") +
      `<tr class="bench-row" style="cursor:default"><td class="l">CDI (referência)</td>${wins.map((w) => `<td>${App.cell(cdiW(w), "pct", "", { color: false })}</td>`).join("")}</tr></tbody>`;
    // 2) Quadro comparativo (janela de risco)
    const [ra, rb] = winIdx(riskWin);
    const evr = carts.map((c) => evaluate(c, ra, rb)), rk = evr.map(riskOf);
    const lbl = App.W[riskWin].label;
    const fechados = (c) => { const t = c.itens.reduce((a, x) => a + (+x.peso || 0), 0); return t ? c.itens.filter((x) => App.statusInfo(App.getFund(x.id))).reduce((a, x) => a + (+x.peso || 0), 0) / t : null; };
    const rows = [
      [`Rentabilidade ${lbl}`, (i) => App.cell(evr[i].r, "pct", evr[i].nd), (i) => evr[i].r],
      [`Rentabilidade ${lbl} a.a.`, (i) => App.cell(rk[i].fa, "pct", rk[i].nd), (i) => rk[i].fa],
      [`Excesso sobre o CDI ${lbl}`, (i) => App.cell(rk[i].x, "pp", rk[i].nd), (i) => rk[i].x],
      ["Volatilidade a.a.", (i) => App.cell(rk[i].vol, "pct", rk[i].nd || "Histórico diário insuficiente", pctU)],
      ["Sharpe (vs CDI)", (i) => App.cell(rk[i].sharpe, "ratio", rk[i].nd || "Histórico diário insuficiente"), (i) => rk[i].sharpe],
      ["Máximo drawdown", (i) => App.cell(rk[i].mdd, "pct", rk[i].nd), (i) => rk[i].mdd],
      ["% meses positivos", (i) => App.cell(rk[i].mpos, "pctb", rk[i].nd || "Sem meses completos"), (i) => rk[i].mpos],
      ["% meses acima do CDI", (i) => App.cell(rk[i].macima, "pctb", rk[i].nd || "Sem meses completos"), (i) => rk[i].macima],
      ["Nº de fundos", (i) => `<span class="num">${carts[i].itens.filter((x) => x.peso > 0).length}</span>`],
      ["% em fundos fechados p/ aplicação", (i) => { const v = fechados(carts[i]); return v ? `<span class="num neg" title="Fundos com status FECHADO, INIBIDO ou com aplicação só por calendário/Investfone">${fmt.num(v * 100, 0)}%</span>` : '<span class="num">0%</span>'; }],
    ];
    const cdiR = cdiRet(ra, rb);
    const cdiCol = [App.cell(cdiR, "pct", "", { color: false }), App.cell(cdiR == null ? null : Math.pow(1 + cdiR, DU / (rb - ra)) - 1, "pct", "", { color: false })];
    Q("#cart-quadro").innerHTML = `<thead><tr><th class="l">Indicador</th>${carts.map((c, i) => `<th class="l"><span class="legend-dot" style="background:${colorOf(i)}"></span>${esc(c.nome)}</th>`).join("")}<th class="l" style="color:var(--muted)">CDI</th></tr></thead><tbody>` +
      rows.map(([label, fn, vf], j) => { const b = vf ? bestOf(carts.map((_, i) => vf(i))) : null; return `<tr style="cursor:default"><td class="l">${label}</td>${carts.map((_, i) => `<td>${fn(i)}${b != null && vf(i) === b ? STAR : ""}</td>`).join("")}<td>${cdiCol[j] || '<span class="muted">—</span>'}</td></tr>`; }).join("") + "</tbody>";

    // 3) Período selecionado: evolução, drawdown, risco×retorno, correlação, mês a mês
    const evp = carts.map((c) => evaluate(c, periodIdx(period, c)));
    const commonI0 = period === "common" ? Math.max(...evp.filter((e) => !e.nd).map((e) => e.i0), 0) : periodIdx(period);
    // Máx. comum: todas as carteiras começam no mesmo dia (o mais tardio entre elas)
    const evP = period === "common" ? carts.map((c) => evaluate(c, commonI0)) : evp;
    const i0 = commonI0;
    const ok = evP.map((e, i) => ({ e, i })).filter((x) => !x.e.nd);
    const fora = evP.map((e, i) => (e.nd ? `${carts[i].nome} (${e.nd})` : null)).filter(Boolean);
    Q("#cart-warn").innerHTML = fora.length ? `<div class="warn-note">Fora dos gráficos neste período: ${fora.map(esc).join("; ")}.</div>` : "";
    const lines = ok.map(({ e, i }) => ({ name: carts[i].nome, color: colorOf(i), data: e.vals.map((v, k) => [App.axis[e.i0 + k], v == null ? null : 100 * v]) }));
    lines.push({ name: "CDI", color: App.BENCH_COLOR, dashed: true, data: CH().growth(cdi, i0, last) });
    CH().timeLines(Q("#cart-ch"), lines, { fmtY: (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), zoom: true });
    Q("#cart-ch-note").textContent = `Base 100 em ${fmt.date(App.axis[i0])}; compra nessa data com os percentuais informados. CDI tracejado.`;
    CH().timeLines(Q("#cart-dd"), ok.map(({ e, i }) => {
      let peak = -Infinity; return { name: carts[i].nome, color: colorOf(i), data: e.vals.map((v, k) => { if (v == null) return [App.axis[e.i0 + k], null]; peak = Math.max(peak, v); return [App.axis[e.i0 + k], v / peak - 1]; }) };
    }), { fmtY: (v) => CH().pct(v, 1), yMax: 0 });
    const rp = ok.map(({ e, i }) => ({ e, i, r: riskOf(e) }));
    const n = last - i0;
    const pts = rp.filter((x) => x.r.vol != null).map(({ e, i, r }) => ({ id: "c" + i, name: carts[i].nome, x: r.vol, y: n >= 240 ? r.fa : e.r, color: colorOf(i), label: carts[i].nome }));
    const cr = cdiRet(i0);
    if (cr != null) pts.push({ id: "cdi", name: "CDI", x: 0, y: n >= 240 ? Math.pow(1 + cr, DU / n) - 1 : cr, color: App.BENCH_COLOR, label: "CDI" });
    CH().scatter(Q("#cart-rr"), pts, { xLabel: "Volatilidade (a.a.)", yLabel: n >= 240 ? "Rentabilidade (a.a.)" : "Rentabilidade no período", labels: true });
    Q("#cart-rr-note").textContent = n < 240 ? "Período inferior a 1 ano: rentabilidade não anualizada." : "";
    const wins2 = App.windows.filter((w) => w.id !== "m1");
    const evb = carts.map((c) => wins2.map((w) => { const [a, b] = winIdx(w.id); return evaluate(c, a, b).r ?? null; }));
    CH().groupedBars(Q("#cart-win"), wins2.map((w) => w.label), carts.map((c, i) => ({ name: c.nome, color: colorOf(i), data: evb[i] })));
    const rets = ok.map(({ e }) => { const a = new Array(n + 1).fill(null); for (let k = 1; k < e.vals.length; k++) if (e.vals[k] != null && e.vals[k - 1] != null) a[e.i0 - i0 + k] = e.vals[k] / e.vals[k - 1] - 1; return a; });
    const corrEl = Q("#cart-corr"); corrEl.style.height = Math.max(300, 34 * ok.length + 120) + "px";
    CH().corrMatrix(corrEl, ok.map(({ i }) => carts[i].nome), rets.map((a, x) => rets.map((b, y) => (x === y ? 1 : CH().correlation(a, b)))));
    // Mês a mês
    const mm = ok.map(({ e, i }) => ({ i, m: Object.fromEntries(monthly(e).map((x) => [x.k, x.r])) }));
    const mkeys = [...new Set(mm.flatMap((x) => Object.keys(x.m)))].sort();
    const mcdi = Object.fromEntries((ok[0] ? monthly(ok[0].e) : []).map((x) => [x.k, x.cdi]));
    const mbest = Object.fromEntries(mkeys.map((k) => [k, bestOf(mm.map((x) => x.m[k]))]));
    Q("#cart-m-sub").textContent = `Desde ${fmt.date(App.axis[i0])}`;
    Q("#cart-monthly").innerHTML = `<thead><tr><th class="l">Carteira</th>${mkeys.map((k) => `<th>${fmt.monthLabel(k)}${App.meta.data_base.slice(0, 7) === k ? "*" : ""}</th>`).join("")}</tr></thead><tbody>` +
      mm.map(({ i, m }) => `<tr style="cursor:default"><td class="l fund-cell"><span class="legend-dot" style="background:${colorOf(i)}"></span>${esc(carts[i].nome)}</td>${mkeys.map((k) => `<td>${m[k] == null ? '<span class="muted">—</span>' : App.cell(m[k], "pct", "") + (m[k] === mbest[k] ? STAR : "")}</td>`).join("")}</tr>`).join("") +
      `<tr class="bench-row" style="cursor:default"><td class="l">CDI</td>${mkeys.map((k) => `<td>${App.cell(mcdi[k], "pct", "", { color: false })}</td>`).join("")}</tr></tbody>`;
    // Composição e contribuição (carteira ativa)
    const ea = period === "common" ? evP[active] : evp[active];
    Q("#cart-contrib-sub").textContent = `${carts[active].nome} · ${PERIODS.find((p) => p[0] === period)[1]}${ea.i0 != null ? ` (desde ${fmt.date(App.axis[ea.i0])})` : ""}`;
    Q("#cart-contrib").innerHTML = ea.parts ? `<table class="compact"><thead><tr><th>Fundo</th><th>% inicial</th><th>Retorno do fundo</th><th>Contribuição (p.p.)</th></tr></thead><tbody>${ea.parts.map((p) => `<tr><td>${esc(p.f.nome)} ${App.statusBadge(p.f)}</td><td class="num">${fmt.num(p.w * 100, 1)}%</td><td>${App.cell(p.r, "pct", "")}</td><td>${App.cell(p.contrib, "pp", "")}</td></tr>`).join("")}<tr><td><b>Carteira</b></td><td class="num">100%</td><td><b>${App.cell(ea.r, "pct", "")}</b></td><td>${App.cell(ea.r, "pp", "")}</td></tr></tbody></table><p class="small muted" style="margin-top:8px">Contribuição = % inicial × retorno do fundo no período (soma = retorno da carteira).</p>` : `<p class="small muted">${esc(ea.nd)}</p>`;
  }

  /* ---------------- Eventos ---------------- */
  function bind(box, root) {
    box.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) { active = +tab.dataset.tab; save(); render(root); return; }
      const a = e.target.closest("[data-act]");
      if (a) return act(a.dataset.act, root);
      const rm = e.target.closest("[data-rmi]");
      if (rm) { carts[active].itens.splice(+rm.dataset.rmi, 1); save(); drawItens(root); drawAll(root); return; }
      if (e.target.closest("[data-norm]")) { e.preventDefault(); normalize(carts[active]); save(); drawItens(root); drawAll(root); return; }
      if (e.target.closest("[data-eq]")) { const n = carts[active].itens.length; carts[active].itens.forEach((x) => { x.peso = +(100 / n).toFixed(2); }); save(); drawItens(root); drawAll(root); return; }
      const rb = e.target.closest("#cart-rentbase button");
      if (rb) { rentBase = rb.dataset.v; st.set("cartRentBase", rentBase); root.querySelectorAll("#cart-rentbase button").forEach((b) => b.setAttribute("aria-pressed", String(b === rb))); drawAll(root); return; }
      const wb = e.target.closest("#cart-riskwin button");
      if (wb) { riskWin = wb.dataset.v; st.set("cartRiskWin", riskWin); root.querySelectorAll("#cart-riskwin button").forEach((b) => b.setAttribute("aria-pressed", String(b === wb))); drawAll(root); return; }
      const pb = e.target.closest("#cart-period button");
      if (pb) { period = pb.dataset.v; st.set("cartPeriod", period); root.querySelectorAll("#cart-period button").forEach((b) => b.setAttribute("aria-pressed", String(b === pb))); drawAll(root); }
    });
    root.querySelector("#cart-name").addEventListener("change", (e) => { carts[active].nome = e.target.value.trim() || `Carteira ${active + 1}`; save(); render(root); });
    root.querySelector("#cart-itens").addEventListener("change", (e) => {
      const i = e.target.dataset.peso; if (i == null) return;
      const v = +String(e.target.value).replace(",", ".");
      carts[active].itens[+i].peso = isFinite(v) && v >= 0 ? v : 0; save(); drawItens(root); drawAll(root);
    });
    root.querySelector("#cart-import").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      file.text().then((t) => { const d = JSON.parse(t); addCarts(Array.isArray(d) ? d : d.carteiras); render(root); }).catch(() => App.toast("Arquivo inválido"));
    });
    bindSearch(root);
  }
  function normalize(c) { const t = c.itens.reduce((a, x) => a + (+x.peso || 0), 0); if (t) c.itens.forEach((x) => { x.peso = +((x.peso / t) * 100).toFixed(2); }); }
  function act(a, root) {
    if (a === "new") { carts.push({ nome: `Carteira ${carts.length + 1}`, itens: [] }); active = carts.length - 1; }
    else if (a === "dup") { carts.push(JSON.parse(JSON.stringify(carts[active]))); carts[carts.length - 1].nome += " (cópia)"; active = carts.length - 1; }
    else if (a === "del") { if (!confirm(`Excluir a carteira "${carts[active].nome}"?`)) return; carts.splice(active, 1); if (!carts.length) carts.push({ nome: "Carteira 1", itens: [] }); active = Math.max(0, active - 1); }
    else if (a === "fromsel") {
      const ids = App.state.selection; if (!ids.length) { App.toast("Nenhum fundo selecionado na Comparação"); return; }
      carts.push({ nome: `Carteira ${carts.length + 1}`, itens: ids.map((id) => ({ id, nome: App.fundName(id), peso: +(100 / ids.length).toFixed(2) })) }); active = carts.length - 1;
      save(); render._tried = false; render(root); return;
    }
    else if (a === "link") { App.copyLink("#/carteiras/" + encode(carts)); return; }
    else if (a === "export") {
      const blob = new Blob([JSON.stringify({ versao: 1, data_base: App.meta.data_base, carteiras: carts }, null, 2)], { type: "application/json" });
      const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `carteiras_${App.meta.data_base}.json`; document.body.appendChild(el); el.click(); el.remove(); return;
    }
    else if (a === "print") { window.print(); return; }
    save(); render(root);
  }
  /* Link: carteiras codificadas no endereço (base64 de [[nome, [[id, peso], …]], …]). */
  const encode = (cs) => btoa(unescape(encodeURIComponent(JSON.stringify(cs.map((c) => [c.nome, c.itens.map((x) => [x.id, x.peso])]))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function importLink(code) {
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/")))));
      addCarts(d.map(([nome, itens]) => ({ nome, itens: itens.map(([id, peso]) => ({ id, peso, nome: App.fundName(id) })) })));
      App.toast(`${d.length} carteira(s) importada(s) do link`);
    } catch (e) { App.toast("Link de carteira inválido"); }
    history.replaceState(null, "", "#/carteiras");
  }
  function addCarts(list) {
    const key = (c) => JSON.stringify([c.nome, c.itens.map((x) => [x.id, +x.peso])]);
    const have = new Set(carts.map(key));
    const novos = (list || []).filter((c) => c && Array.isArray(c.itens) && !have.has(key(c)));
    if (carts.length === 1 && !carts[0].itens.length) carts = [];
    carts.push(...novos.map((c) => ({ nome: String(c.nome || "Carteira"), itens: c.itens.filter((x) => x.id).map((x) => ({ id: String(x.id), nome: x.nome, peso: +x.peso || 0 })) })));
    if (!carts.length) carts = [{ nome: "Carteira 1", itens: [] }];
    active = carts.length - 1; save(); render._tried = false;
  }

  /* Busca: prateleira + listados (B3) + mercado (CVM) */
  function bindSearch(root) {
    const inp = root.querySelector("#cart-q"), list = root.querySelector("#cart-list");
    const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    let items = [], hl = 0;
    const show = () => {
      const q = norm(inp.value.trim()), qd = inp.value.replace(/\D/g, "");
      const hit = (t, c) => !q || norm(t).includes(q) || (qd.length >= 4 && String(c || "").replace(/\D/g, "").includes(qd));
      const inCart = new Set(carts[active].itens.map((x) => x.id));
      const base = App.funds.filter((f) => !inCart.has(f.id) && hit(f.nome + " " + f.categoria, f.cnpj)).slice(0, q ? 6 : 8).map((f) => ({ id: f.id, nome: f.nome, sub: f.categoria, g: "Prateleira" }));
      let ls = [], mk = [];
      if (q.length >= 2 && App.lst.index) ls = App.lst.index.fundos.filter((r) => !inCart.has(r[0]) && (norm(r[1]).startsWith(q.replace(/\s/g, "")) || hit(r[2] + " " + r[4], r[17]))).sort((a, b) => (b[13] || 0) - (a[13] || 0)).slice(0, 6).map((r) => ({ id: r[0], nome: r[2], sub: `${r[3]} · liquidez ${fmt.money(r[13]) || "N/D"}/dia`, g: "Listados (B3)" }));
      if (q.length >= 2 && App.mkt.index) mk = App.mkt.index.fundos.filter((r) => !inCart.has(r[0]) && hit(r[1] + " " + r[3], r[2])).sort((a, b) => (b[6] || 0) - (a[6] || 0)).slice(0, 6).map((r) => ({ id: r[0], nome: r[1], sub: `${r[4] || ""} · PL ${fmt.money(r[6]) || "N/D"}`, g: "Mercado (CVM)" }));
      items = base.concat(ls, mk);
      let h = "", g = null;
      items.forEach((it, i) => { if (it.g !== g) { g = it.g; h += `<div class="ac-group">${g}</div>`; } h += `<button type="button" data-i="${i}" class="${i === hl ? "hl" : ""}">${esc(it.nome)}<small>${esc(it.sub)}</small></button>`; });
      if (q.length < 2) h += `<div class="small muted" style="padding:8px 12px">Digite ao menos 2 letras para buscar também fundos listados e de mercado.</div>`;
      list.innerHTML = h || '<div class="small muted" style="padding:10px 12px">Nenhum fundo encontrado</div>';
      list.classList.remove("hidden");
    };
    const pick = (it) => {
      if (!it) return;
      const c = carts[active];
      c.itens.push({ id: it.id, nome: it.nome, peso: c.itens.length ? 0 : 100 });
      App.rememberName(it.id, it.nome);
      save(); inp.value = ""; list.classList.add("hidden");
      App.ensureFunds([it.id]).then(() => { drawItens(root); drawAll(root); root.querySelector(`[data-peso="${c.itens.length - 1}"]`)?.focus(); });
    };
    inp.addEventListener("focus", () => { show(); [App.lst, App.mkt].forEach((s) => { if (!s.index && !s.failed) s.loadIndex().then(show, show); }); });
    inp.addEventListener("input", () => { hl = 0; show(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { hl = Math.min(hl + 1, items.length - 1); show(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); show(); e.preventDefault(); }
      else if (e.key === "Enter") pick(items[hl]);
      else if (e.key === "Escape") list.classList.add("hidden");
    });
    list.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); pick(items[+b.dataset.i]); } });
    inp.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 150));
  }

  App.views.carteiras = { render, destroy() { rootRef = null; } };
})();

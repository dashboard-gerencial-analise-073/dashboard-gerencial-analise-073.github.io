/* Página "Visão geral": KPIs, PL por categoria, maiores fundos, risco x retorno e destaques por categoria. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt;
  App.views = App.views || {};
  let hlCat = null;

  function median(xs) { const a = xs.filter((x) => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  App.median = median;

  function render(root) {
    const F = App.funds;
    const withPl = F.filter((f) => f.flow && f.flow.pl != null);
    const plTotal = withPl.reduce((s, f) => s + f.flow.pl, 0);
    const with12 = F.filter((f) => f.ret["12m"] && f.ret["12m"].f != null);
    const withX = with12.filter((f) => f.ret["12m"].x != null);
    const beat = withX.filter((f) => f.ret["12m"].x > 0).length;
    const cdi12 = App.benchWindowReturn("CDI", "12m");
    const nd = F.length - with12.length;

    root.innerHTML = `
      <div class="page-head">
        <div><h2>Visão geral</h2><p>Panorama da prateleira: tamanho, composição por categoria e relação entre risco e retorno nos últimos 12 meses.</p></div>
        <div class="small muted">Dados até ${fmt.date(App.meta.data_base)}</div>
      </div>
      <div class="grid g-4">
        <div class="card kpi"><div class="label">Fundos analisados</div><div class="value num">${F.length}</div><div class="hint">${App.meta.categorias.length} categorias · ${with12.length} com histórico ≥ 12M</div></div>
        <div class="card kpi"><div class="label">Patrimônio líquido total</div><div class="value num">${fmt.money(plTotal)}</div><div class="hint">Soma de ${withPl.length} fundos com PL na data-base (CVM)</div></div>
        <div class="card kpi"><div class="label">CDI — últimos 12 meses</div><div class="value num">${fmt.pct(cdi12, 2, false) || "N/D"}</div><div class="hint">Referência para renda fixa e crédito (BCB)</div></div>
        <div class="card kpi"><div class="label">Acima do benchmark em 12M</div><div class="value num">${beat} <span style="font-size:15px;color:var(--muted);font-weight:500">de ${withX.length}</span></div><div class="hint">Fundos com benchmark de série pública (CDI, Ibovespa)</div></div>
      </div>

      <div class="grid g-main" style="margin-top:16px">
        <div class="card">
          <div class="card-h"><h3>Risco × retorno — 12 meses</h3><span class="sub">Volatilidade anualizada vs. rentabilidade acumulada</span></div>
          <div class="card-b" style="padding-bottom:0"><div class="chips" id="hl-cats" role="group" aria-label="Destacar categoria"></div></div>
          <div class="card-b"><div class="chart tall" id="ch-scatter" role="img" aria-label="Gráfico de dispersão de risco e retorno"></div></div>
          <div class="card-note">${nd} fundo(s) sem 12 meses de histórico ou sem cota na data-base não aparecem. Clique em um ponto para abrir o fundo.</div>
        </div>
        <div class="card">
          <div class="card-h"><h3>PL por categoria</h3><span class="sub">R$ na data-base</span></div>
          <div class="card-b"><div class="chart short" id="ch-cat"></div></div>
          <div class="card-h" style="padding-top:0"><h3>Maiores fundos por PL</h3></div>
          <div class="card-b"><div class="chart" id="ch-top" style="height:300px"></div></div>
        </div>
      </div>

      <h3 class="section-title">Destaques por categoria — 12 meses</h3>
      <div class="card"><div class="table-wrap" style="max-height:none"><table class="data" id="cat-table"></table></div>
      <div class="card-note">Mediana e extremos calculados apenas entre fundos com 12 meses completos de histórico. Descritivo — não constitui recomendação.</div></div>`;

    // PL por categoria
    const byCat = App.meta.categorias.map((c) => {
      const fs = F.filter((f) => f.categoria === c);
      return { label: c, value: fs.reduce((s, f) => s + ((f.flow || {}).pl || 0), 0), n: fs.length };
    }).sort((a, b) => b.value - a.value);
    App.charts.hbar(document.getElementById("ch-cat"), byCat, { fmt: fmt.money, label: "PL", labelWidth: 150,
      extra: (it) => `<div class="row"><span>Fundos</span><b>${it.n}</b></div><div class="row"><span>Participação</span><b>${fmt.pct(it.value / plTotal, 1, false)}</b></div>` });

    const top = withPl.slice().sort((a, b) => b.flow.pl - a.flow.pl).slice(0, 10).map((f) => ({ label: f.nome, value: f.flow.pl, id: f.id, cat: f.categoria }));
    const chTop = App.charts.hbar(document.getElementById("ch-top"), top, { fmt: fmt.money, label: "PL", color: "#2e5562",
      extra: (it) => `<div class="row"><span>Categoria</span><b>${esc(it.cat)}</b></div>` });
    chTop && chTop.on("click", (p) => { location.hash = "#/fundo/" + top[p.dataIndex].id; });

    // Dispersão com destaque por categoria (demais em cinza) — evita 6 cores simultâneas.
    const chips = document.getElementById("hl-cats");
    const cats = App.meta.categorias;
    function drawScatter() {
      chips.innerHTML = `<button class="chip" type="button" data-c="" aria-pressed="${!hlCat}">Todas</button>` +
        cats.map((c) => `<button class="chip" type="button" data-c="${esc(c)}" aria-pressed="${hlCat === c}">${esc(c)}</button>`).join("");
      const rw = "12m";
      const pts = F.map((f) => {
        const r = f.ret[rw] || {}, k = (f.risk || {})[rw] || {};
        if (r.f == null || k.vol == null) return null;
        const on = !hlCat || f.categoria === hlCat;
        return { id: f.id, name: f.nome, sub: f.categoria, x: k.vol, y: r.f, color: "#1c5cab", muted: !on, label: hlCat ? f.nome : "",
          extra: `<div class="row"><span>Sharpe</span><b>${fmt.num(k.sharpe, 2) || "N/D"}</b></div><div class="row"><span>${esc(App.benchName(f.benchmark_id))} 12M</span><b>${r.b == null ? "N/D" : fmt.pct(r.b)}</b></div>` };
      }).filter(Boolean);
      const cdiPts = cdi12 != null ? [{ id: null, name: "CDI (referência)", x: 0, y: cdi12, color: "#7d8f95", label: "CDI", sub: "Benchmark" }] : [];
      const ch = App.charts.scatter(document.getElementById("ch-scatter"), pts.concat(cdiPts), { xLabel: "Volatilidade 12M (a.a.)", yLabel: "Rentabilidade 12M", labels: true });
      ch && ch.off("click");
      ch && ch.on("click", (p) => { const id = p.data.p.id; if (id) location.hash = "#/fundo/" + id; });
    }
    chips.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; hlCat = b.dataset.c || null; drawScatter(); });
    drawScatter();

    // Tabela por categoria
    const rows = cats.map((c) => {
      const fs = F.filter((f) => f.categoria === c);
      const v12 = fs.filter((f) => f.ret["12m"].f != null);
      const best = v12.slice().sort((a, b) => b.ret["12m"].f - a.ret["12m"].f)[0];
      const worst = v12.slice().sort((a, b) => a.ret["12m"].f - b.ret["12m"].f)[0];
      const withx = v12.filter((f) => f.ret["12m"].x != null);
      return { c, n: fs.length, pl: fs.reduce((s, f) => s + ((f.flow || {}).pl || 0), 0), n12: v12.length,
        med: median(v12.map((f) => f.ret["12m"].f)), vol: median(v12.map((f) => (f.risk["12m"] || {}).vol)),
        best, worst, beat: withx.filter((f) => f.ret["12m"].x > 0).length, nx: withx.length };
    });
    const link = (f) => (f ? `<a href="#/fundo/${f.id}" style="color:inherit">${esc(f.nome)}</a> <span class="muted">${fmt.pct(f.ret["12m"].f)}</span>` : App.ND("Nenhum fundo com 12M"));
    document.getElementById("cat-table").innerHTML = `<thead><tr><th class="l">Categoria</th><th>Fundos</th><th>PL</th><th>Com 12M</th><th>Mediana 12M</th><th>Mediana vol. 12M</th><th>Acima do bench.</th><th class="l">Maior 12M</th><th class="l">Menor 12M</th></tr></thead><tbody>` +
      rows.map((r) => `<tr style="cursor:default"><td class="l"><b>${esc(r.c)}</b></td><td class="num">${r.n}</td><td>${App.cell(r.pl, "money")}</td><td class="num">${r.n12}</td>
        <td>${App.cell(r.med, "pct", "Sem fundos com 12M")}</td><td>${App.cell(r.vol, "pct", "Sem fundos com 12M", { sign: false })}</td>
        <td class="num">${r.nx ? `${r.beat} de ${r.nx}` : App.ND("Benchmark sem série pública")}</td><td class="l">${link(r.best)}</td><td class="l">${link(r.worst)}</td></tr>`).join("") + "</tbody>";
  }

  App.views.overview = { render };
})();

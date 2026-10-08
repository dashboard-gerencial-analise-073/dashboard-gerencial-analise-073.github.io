/* Página "Análise": rankings e resumos descritivos gerados a partir dos dados (sem recomendação). */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt;
  App.views = App.views || {};
  const st = { win: App.store.get("anWin", "12m"), cat: App.store.get("anCat", "") };

  function render(root) {
    const winOpts = App.windows.map((w) => `<option value="${w.id}" ${st.win === w.id ? "selected" : ""}>${esc(w.long)}</option>`).join("");
    const catOpts = `<option value="">Todas as categorias</option>` + App.meta.categorias.map((c) => `<option ${st.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    root.innerHTML = `
      <div class="page-head">
        <div><h2>Análise</h2><p>Leituras descritivas geradas automaticamente a partir dos dados. Não constituem recomendação de investimento nem avaliação qualitativa dos fundos.</p></div>
        <div class="toolbar">
          <label class="small muted" for="an-win">Período</label><select class="select" id="an-win">${winOpts}</select>
          <label class="small muted" for="an-cat">Categoria</label><select class="select" id="an-cat">${catOpts}</select>
        </div>
      </div>
      <div class="card"><div class="card-h"><h3>Resumo</h3></div><div class="card-b"><ul class="insight" id="insights"></ul></div></div>
      <div class="grid g-3" style="margin-top:16px" id="ranks"></div>
      <div class="disclaimer" style="margin-top:16px">Rankings ordenam valores observados no período; não indicam qualidade de gestão nem expectativa de desempenho. Fundos com indicador N/D não entram no ranking correspondente. Compare fundos com objetivos, benchmarks e níveis de risco semelhantes.</div>`;
    root.querySelector("#an-win").addEventListener("change", (e) => { st.win = e.target.value; App.store.set("anWin", st.win); draw(root); });
    root.querySelector("#an-cat").addEventListener("change", (e) => { st.cat = e.target.value; App.store.set("anCat", st.cat); draw(root); });
    draw(root);
  }

  function rank(list, get, dir, n = 5) {
    return list.map((f) => ({ f, v: get(f) })).filter((x) => x.v != null && isFinite(x.v)).sort((a, b) => (b.v - a.v) * dir).slice(0, n);
  }

  function draw(root) {
    const w = App.W[st.win];
    const rw = App.riskWindows.includes(st.win) ? st.win : "12m";
    const list = App.funds.filter((f) => !st.cat || f.categoria === st.cat);
    const ret = (f) => (f.ret[st.win] || {}).f;
    const card = (title, sub, items, kind, extra) => `<div class="card"><div class="card-h"><h3>${title}</h3><span class="sub">${sub}</span></div><div class="card-b">${
      items.length ? `<ol class="rank">${items.map(({ f, v }) => `<li><a href="#/fundo/${f.id}">${esc(f.nome)}<small>${esc(f.categoria)}${extra ? " · " + extra(f) : ""}</small></a>${App.cell(v, kind, "", kind === "pct" ? { sign: kind === "pct" && title.indexOf("Volatilidade") < 0 } : {})}</li>`).join("")}</ol>`
        : `<p class="muted small">Nenhum fundo com o indicador disponível neste recorte.</p>`}</div></div>`;
    const rl = App.W[rw].label;
    const ranks = [
      card("Maiores rentabilidades", w.long, rank(list, ret, 1), "pct", (f) => App.benchName(f.benchmark_id)),
      card("Maior excesso sobre o benchmark", w.long + " · p.p.", rank(list, (f) => (f.ret[st.win] || {}).x, 1), "pp", (f) => App.benchName(f.benchmark_id)),
      card("Menores volatilidades", `Anualizada, ${rl}`, rank(list, (f) => ((f.risk || {})[rw] || {}).vol, -1), "pct"),
      card("Maiores índices de Sharpe", `vs CDI, ${rl}`, rank(list, (f) => ((f.risk || {})[rw] || {}).sharpe, 1), "ratio"),
      card("Menores drawdowns máximos", `Queda máxima, ${rl}`, rank(list, (f) => ((f.risk || {})[rw] || {}).mdd, 1), "pct"),
      card("Maiores patrimônios", "PL na data-base", rank(list, (f) => (f.flow || {}).pl, 1), "money"),
      card("Maior captação líquida", "Últimos 12 meses", rank(list, (f) => (f.flow || {}).captacao_liquida_12m, 1), "money"),
      card("Maior resgate líquido", "Últimos 12 meses", rank(list, (f) => (f.flow || {}).captacao_liquida_12m, -1).filter((x) => x.v < 0), "money"),
      card("Maior liquidez", "Menor prazo até o crédito do resgate", rank(list, (f) => f.liq_resg, -1), "days", (f) => "cotização " + (f.cot_resg === 0 ? "D0" : "D+" + f.cot_resg)),
    ];
    root.querySelector("#ranks").innerHTML = ranks.join("");

    // Frases descritivas
    const ins = [];
    const withR = list.filter((f) => ret(f) != null);
    const scope = st.cat ? `em ${st.cat}` : "na prateleira";
    ins.push(`<b>${withR.length} de ${list.length}</b> fundos ${scope} têm rentabilidade disponível para o período <b>${esc(w.long.toLowerCase())}</b> (${fmt.date((App.windowBounds[st.win] || {}).start)} a ${fmt.date((App.windowBounds[st.win] || {}).end)}).`);
    if (withR.length) {
      const med = App.median(withR.map(ret));
      const pos = withR.filter((f) => ret(f) > 0).length;
      ins.push(`Rentabilidade mediana de <b>${fmt.pct(med)}</b>; ${pos} fundo(s) com resultado positivo e ${withR.length - pos} com resultado negativo ou nulo.`);
    }
    App.ds.benchmarks.filter((b) => b.disponivel).forEach((b) => {
      const g = list.filter((f) => f.benchmark_id === b.id && (f.ret[st.win] || {}).x != null);
      if (!g.length) return;
      const beat = g.filter((f) => f.ret[st.win].x > 0);
      const br = App.benchWindowReturn(b.id, st.win);
      ins.push(`Entre os ${g.length} fundos com benchmark <b>${esc(b.nome)}</b> (${fmt.pct(br)} no período), <b>${beat.length}</b> superaram o índice; excesso mediano de <b>${fmt.pp(App.median(g.map((f) => f.ret[st.win].x)))}</b>.`);
    });
    const ndB = list.filter((f) => !App.benchAvailable(f.benchmark_id));
    if (ndB.length) ins.push(`${ndB.length} fundo(s) têm benchmark sem série histórica pública (${[...new Set(ndB.map((f) => App.benchName(f.benchmark_id)))].join(", ")}); para eles, o excesso de retorno aparece como N/D.`);
    const vt = list.filter((f) => f.alvo_tipo === "Vol target" && ((f.risk || {})[rw] || {}).vol != null);
    const parseRange = (s) => { const m = String(s).replace(/,/g, ".").match(/([\d.]+)%\s*~\s*([\d.]+)%/); return m ? [m[1] / 100, m[2] / 100] : null; };
    const inside = vt.filter((f) => { const r = parseRange(f.alvo); const v = f.risk[rw].vol; return r && v >= r[0] && v <= r[1]; });
    const below = vt.filter((f) => { const r = parseRange(f.alvo); return r && f.risk[rw].vol < r[0]; });
    if (vt.length) ins.push(`Dos ${vt.length} fundos com <i>vol target</i> informado pela gestora, <b>${inside.length}</b> tiveram volatilidade realizada ${rl} dentro da faixa, <b>${below.length}</b> abaixo e <b>${vt.length - inside.length - below.length}</b> acima.`);
    const liq = list.filter((f) => f.liq_resg != null);
    if (liq.length) ins.push(`<b>${liq.filter((f) => f.liq_resg <= 1).length}</b> fundo(s) liquidam o resgate em até D+1; <b>${liq.filter((f) => f.liq_resg > 30).length}</b> têm prazo total acima de 30 dias.`);
    root.querySelector("#insights").innerHTML = ins.map((s) => `<li>${s}</li>`).join("");
  }

  App.views.analysis = { render };
})();

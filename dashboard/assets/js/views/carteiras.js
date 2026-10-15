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
  const WINS = [["ytd", "Ano"], ["12", "12M"], ["24", "24M"]];
  let carts = st.get("carteiras", null) || [{ nome: "Carteira 1", itens: [] }];
  let active = Math.min(st.get("carteiraAtiva", 0), carts.length - 1);
  let period = st.get("cartPeriod", "12");
  let rootRef = null;
  const save = () => { st.set("carteiras", carts); st.set("carteiraAtiva", active); };
  const colorOf = (i) => COLORS[i % COLORS.length];
  const cdi = App.benchSeries("CDI");
  const last = App.axis.length - 1;

  /* ---------------- Cálculo ---------------- */
  const startIdx = (w) => (w === "ytd" ? CH().periodStart("ytd") : CH().periodStart(+w));
  const LB = 5; // pregões aceitos para trás na cota inicial / dias sem cota
  function evaluate(c, i0) {
    const itens = c.itens.filter((x) => x.peso > 0);
    const tot = itens.reduce((a, x) => a + x.peso, 0);
    if (!itens.length || !tot) return { nd: "Carteira sem fundos" };
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
    for (let t = i0; t <= last; t++) {
      let v = 0, ok = true;
      parts.forEach((p, k) => {
        if (p.q[t] != null) { lastV[k] = p.q[t]; age[k] = 0; } else if (t > i0) age[k]++;
        if (age[k] > LB) ok = false;
        v += p.w * lastV[k] / p.base;
      });
      vals.push(ok ? v : null);
    }
    const vEnd = vals[vals.length - 1];
    if (vEnd == null) return { nd: "Cotas ausentes na data-base" };
    const dr = [];
    for (let k = 1; k < vals.length; k++) if (vals[k] != null && vals[k - 1] != null) dr.push(vals[k] / vals[k - 1] - 1);
    const n = last - i0;
    let vol = null;
    if (dr.length >= 0.9 * n && dr.length > 20) {
      const m = dr.reduce((a, b) => a + b, 0) / dr.length;
      vol = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / (dr.length - 1)) * Math.sqrt(App.meta.dias_uteis_ano);
    }
    let peak = -Infinity, mdd = 0;
    vals.forEach((v) => { if (v == null) return; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
    const r = vEnd - 1;
    return { r, ra: n >= 240 ? Math.pow(1 + r, App.meta.dias_uteis_ano / n) - 1 : null, vol, mdd, vals,
      parts: parts.map((p) => { const ri = p.q[last] / p.base - 1; return { f: p.f, w: p.w, r: ri, contrib: p.w * ri }; }) };
  }
  const cdiRet = (i0) => (cdi[i0] && cdi[last] ? cdi[last] / cdi[i0] - 1 : null);

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
      <div class="page-head"><div><h2>Carteiras</h2><p>Monte carteiras com fundos da prateleira, de mercado ou listados na B3, defina o percentual de cada um e compare o retorno histórico no ano, em 12 e em 24 meses.</p></div>
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
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Comparação das carteiras</h3><span class="sub">Até ${fmt.date(App.meta.data_base)}</span></div>
        <div class="table-wrap" style="max-height:none"><table class="data cmp-table" id="cart-cmp"></table></div>
        <div class="card-note">Compra no fechamento do início de cada período com os percentuais informados, sem rebalancear, sem custos e sem impostos. Rentabilidade de cada fundo pela cota oficial (CVM) ou retorno total na B3 (listados). ★ = maior valor da coluna. Volatilidade e queda máxima no período de 12M.</div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Evolução de R$ 100</h3><div class="seg no-print" id="cart-period" role="group">${WINS.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${period === v}">${t}</button>`).join("")}</div></div>
        <div class="card-b"><div class="chart tall" id="cart-ch"></div></div><div class="card-note" id="cart-ch-note"></div></div>
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
    const res = carts.map((c) => Object.fromEntries(WINS.map(([w]) => [w, evaluate(c, startIdx(w))])));
    const cols = [
      ...WINS.map(([w, l]) => ({ l, v: (r) => r[w].r, nd: (r) => r[w].nd, cdi: cdiRet(startIdx(w)) })),
      { l: "24M a.a.", v: (r) => r["24"].ra, nd: (r) => r["24"].nd, cdi: (() => { const c = cdiRet(startIdx("24")); const n = last - startIdx("24"); return c == null ? null : Math.pow(1 + c, App.meta.dias_uteis_ano / n) - 1; })() },
      { l: "Vol. 12M", v: (r) => r["12"].vol, nd: (r) => r["12"].nd || "Histórico diário insuficiente", risk: true },
      { l: "Queda máx. 12M", v: (r) => r["12"].mdd, nd: (r) => r["12"].nd, risk: true },
    ];
    const best = cols.map((c) => { if (c.risk) return null; const v = res.map(c.v).filter((x) => x != null); return v.length >= 2 ? Math.max(...v) : null; });
    const STAR = '<span class="best" title="Maior valor da coluna">★</span>';
    root.querySelector("#cart-cmp").innerHTML = `<thead><tr><th class="l">Carteira</th>${cols.map((c) => `<th>${c.l}</th>`).join("")}</tr></thead><tbody>` +
      carts.map((c, i) => `<tr data-tab="${i}" class="${i === active ? "selected" : ""}"><td class="l"><span class="legend-dot" style="background:${colorOf(i)}"></span><b>${esc(c.nome)}</b> <span class="small muted">${c.itens.length} fundo(s)</span></td>${cols.map((col, j) => { const v = col.v(res[i]); return `<td>${App.cell(v, "pct", col.nd(res[i]), col.risk && col.l.startsWith("Vol") ? { sign: false, color: false } : {})}${best[j] != null && v === best[j] ? STAR : ""}</td>`; }).join("")}</tr>`).join("") +
      `<tr class="bench-row" style="cursor:default"><td class="l">CDI (referência)</td>${cols.map((c) => `<td>${c.risk ? '<span class="muted">—</span>' : App.cell(c.cdi, "pct", "", { color: false })}</td>`).join("")}</tr></tbody>`;
    // Gráfico
    const i0 = startIdx(period);
    const lines = carts.map((c, i) => { const r = evaluate(c, i0); return r.vals ? { name: c.nome, color: colorOf(i), data: r.vals.map((v, k) => [App.axis[i0 + k], v == null ? null : 100 * v]) } : null; }).filter(Boolean);
    lines.push({ name: "CDI", color: App.BENCH_COLOR, dashed: true, data: CH().growth(cdi, i0, last) });
    CH().timeLines(root.querySelector("#cart-ch"), lines, { fmtY: (v) => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), zoom: true });
    const fora = carts.filter((c) => evaluate(c, i0).nd).map((c) => c.nome);
    root.querySelector("#cart-ch-note").textContent = `Base 100 em ${fmt.date(App.axis[i0])}.` + (fora.length ? ` Fora do gráfico (sem histórico de algum fundo no início do período): ${fora.join(", ")}.` : "");
    // Contribuição (carteira ativa, período do gráfico)
    const r = evaluate(carts[active], i0);
    root.querySelector("#cart-contrib-sub").textContent = `${carts[active].nome} · ${WINS.find((w) => w[0] === period)[1]} (desde ${fmt.date(App.axis[i0])})`;
    root.querySelector("#cart-contrib").innerHTML = r.parts ? `<table class="compact"><thead><tr><th>Fundo</th><th>% inicial</th><th>Retorno do fundo</th><th>Contribuição (p.p.)</th></tr></thead><tbody>${r.parts.map((p) => `<tr><td>${esc(p.f.nome)}</td><td class="num">${fmt.num(p.w * 100, 1)}%</td><td>${App.cell(p.r, "pct", "")}</td><td>${App.cell(p.contrib, "pp", "")}</td></tr>`).join("")}<tr><td><b>Carteira</b></td><td class="num">100%</td><td><b>${App.cell(r.r, "pct", "")}</b></td><td>${App.cell(r.r, "pp", "")}</td></tr></tbody></table><p class="small muted" style="margin-top:8px">Contribuição = % inicial × retorno do fundo no período (soma = retorno da carteira).</p>` : `<p class="small muted">${esc(r.nd)}</p>`;
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

/* Camada de gráficos (Apache ECharts). Estilo único para todos os gráficos:
   grade discreta, linhas de 2px, benchmark tracejado em cinza, tooltip sempre ativo. */
(function () {
  "use strict";
  const App = window.App;
  const C = (App.charts = {});
  const instances = new Map();
  const INK = "#0e2a33", TEXT2 = "#4b5f66", MUTED = "#7d8f95", GRID = "#e9ece7", AXIS = "#cfd6cf";
  const FONT = getComputedStyle(document.body).fontFamily;

  C.mount = function (el, option) {
    if (!el) return null;
    let ch = instances.get(el);
    if (ch && ch.isDisposed()) ch = null;
    if (!ch) { ch = echarts.init(el, null, { renderer: "canvas" }); instances.set(el, ch); }
    ch.setOption(Object.assign({ textStyle: { fontFamily: FONT, color: TEXT2 }, animationDuration: 350 }, option), true);
    return ch;
  };
  C.disposeIn = function (root) {
    for (const [el, ch] of instances) if (!document.body.contains(el) || (root && root.contains(el))) { ch.dispose(); instances.delete(el); }
  };
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => instances.forEach((ch) => !ch.isDisposed() && ch.resize()), 120); });

  const pct = (v, d = 1) => (v == null ? "N/D" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%");
  C.pct = pct;
  const axisCommon = {
    axisLine: { lineStyle: { color: AXIS } }, axisTick: { show: false },
    axisLabel: { color: MUTED, fontSize: 11 }, splitLine: { lineStyle: { color: GRID } },
  };
  C.axisCommon = axisCommon;
  const tooltipBase = {
    backgroundColor: "#fff", borderColor: "#e2e6e0", borderWidth: 1, padding: [8, 10],
    textStyle: { color: INK, fontSize: 12, fontFamily: FONT }, extraCssText: "box-shadow:0 6px 18px rgba(14,42,51,.12);border-radius:8px;",
  };
  C.tooltipBase = tooltipBase;
  const dot = (c, dashed) => dashed
    ? `<i style="display:inline-block;width:12px;border-top:2px dashed ${c};margin-right:6px;vertical-align:3px"></i>`
    : `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></i>`;
  C.dot = dot;

  /* Linhas temporais. series: [{name, color, data:[[iso, v]...], dashed}] ; fmtY(v) ; area opcional. */
  C.timeLines = function (el, series, o = {}) {
    const fmtY = o.fmtY || ((v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
    const legend = series.length > 1;
    return C.mount(el, {
      grid: { left: 8, right: 16, top: legend ? 40 : 16, bottom: o.zoom ? 56 : 8, containLabel: true },
      legend: legend ? { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: TEXT2, fontSize: 12 }, type: "scroll" } : undefined,
      tooltip: Object.assign({}, tooltipBase, {
        trigger: "axis", axisPointer: { type: "line", lineStyle: { color: AXIS } },
        formatter: (ps) => {
          if (!ps.length) return "";
          const d = App.fmt.date(ps[0].data[0]);
          const rows = ps.filter((p) => p.data[1] != null).sort((a, b) => b.data[1] - a.data[1])
            .map((p) => `<div class="row"><span>${dot(p.color, series[p.seriesIndex].dashed || (series[p.seriesIndex].lineType || "solid") !== "solid")}${App.esc(p.seriesName)}</span><b>${fmtY(p.data[1])}</b></div>`).join("");
          return `<div class="tt"><div class="tt-h">${d}</div>${rows}</div>`;
        },
      }),
      xAxis: Object.assign({ type: "time", boundaryGap: false }, axisCommon, { splitLine: { show: false },
        axisLabel: { color: MUTED, fontSize: 11, hideOverlap: true, formatter: { year: "{yyyy}", month: "{MMM}/{yy}", day: "{dd}/{MM}" } } }),
      yAxis: Object.assign({ type: "value", scale: true }, axisCommon, { axisLabel: { color: MUTED, fontSize: 11, formatter: fmtY }, max: o.yMax, min: o.yMin }),
      dataZoom: o.zoom ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 8, borderColor: "transparent", backgroundColor: "#f4f5f2", fillerColor: "rgba(14,42,51,.08)", handleSize: 14, showDetail: false, dataBackground: { lineStyle: { color: AXIS }, areaStyle: { color: "#eef0ec" } } }] : undefined,
      series: series.map((s) => ({
        name: s.name, type: "line", showSymbol: false, symbolSize: 8, connectNulls: false, data: s.data,
        lineStyle: { width: s.dashed ? 1.5 : 2, type: s.dashed ? "dashed" : (s.lineType || "solid"), color: s.color },
        itemStyle: { color: s.color }, emphasis: { focus: "series", lineStyle: { width: 2.5 } },
        areaStyle: s.area ? { color: s.color, opacity: 0.12 } : undefined,
        z: s.dashed ? 1 : 2,
      })),
    });
  };

  /* Barras horizontais de magnitude (um único tom). items: [{label, value, id?}] */
  C.hbar = function (el, items, o = {}) {
    const fmt = o.fmt || ((v) => v);
    return C.mount(el, {
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      tooltip: Object.assign({}, tooltipBase, { trigger: "item", formatter: (p) => `<div class="tt"><div class="tt-h">${App.esc(p.name)}</div><div class="row"><span>${o.label || ""}</span><b>${fmt(p.value)}</b></div>${o.extra ? o.extra(items[p.dataIndex]) : ""}</div>` }),
      xAxis: Object.assign({ type: "value" }, axisCommon, { axisLabel: { show: false }, splitLine: { show: false } }),
      yAxis: Object.assign({ type: "category", inverse: true, data: items.map((i) => i.label) }, axisCommon, { axisLine: { show: false }, axisLabel: { color: TEXT2, fontSize: 12, width: o.labelWidth || 170, overflow: "truncate" } }),
      series: [{ type: "bar", data: items.map((i) => ({ value: i.value, itemStyle: { color: i.color || o.color || INK } })), barMaxWidth: 16, barCategoryGap: "35%",
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: TEXT2, fontSize: 11.5, formatter: (p) => fmt(p.value) } }],
    });
  };

  /* Barras agrupadas por categoria (ex.: janelas) com uma série por fundo. */
  C.groupedBars = function (el, categories, series, o = {}) {
    const fmt = o.fmt || pct;
    return C.mount(el, {
      grid: { left: 8, right: 8, top: 40, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: TEXT2, fontSize: 12 }, type: "scroll" },
      tooltip: Object.assign({}, tooltipBase, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(14,42,51,.04)" } },
        formatter: (ps) => `<div class="tt"><div class="tt-h">${App.esc(ps[0].axisValue)}</div>${ps.map((p) => `<div class="row"><span>${dot(p.color)}${App.esc(p.seriesName)}</span><b>${p.value == null ? "N/D" : fmt(p.value)}</b></div>`).join("")}</div>` }),
      xAxis: Object.assign({ type: "category", data: categories }, axisCommon, { axisLabel: { color: TEXT2, fontSize: 12 } }),
      yAxis: Object.assign({ type: "value" }, axisCommon, { axisLabel: { color: MUTED, fontSize: 11, formatter: (v) => fmt(v) } }),
      series: series.map((s) => ({ name: s.name, type: "bar", data: s.data, barMaxWidth: 18, barGap: "12%",
        itemStyle: { color: s.color, borderRadius: 3, borderColor: "#fff", borderWidth: 1 } })),
    });
  };

  /* Dispersão risco x retorno. points: [{id, name, x, y, color, muted, label}] */
  C.scatter = function (el, points, o = {}) {
    const byColor = {};
    points.forEach((p) => { const k = p.muted ? "_muted" : p.color; (byColor[k] = byColor[k] || []).push(p); });
    const order = Object.keys(byColor).sort((a, b) => (a === "_muted" ? -1 : b === "_muted" ? 1 : 0));
    return C.mount(el, {
      grid: { left: 8, right: o.labels ? 110 : 24, top: 24, bottom: 28, containLabel: true },
      tooltip: Object.assign({}, tooltipBase, { trigger: "item",
        formatter: (p) => { const d = p.data.p; return `<div class="tt"><div class="tt-h">${App.esc(d.name)}</div>${d.sub ? `<div class="muted small" style="margin-bottom:4px">${App.esc(d.sub)}</div>` : ""}<div class="row"><span>${o.xLabel}</span><b>${pct(d.x, 2)}</b></div><div class="row"><span>${o.yLabel}</span><b>${pct(d.y, 2)}</b></div>${d.extra || ""}</div>`; } }),
      xAxis: Object.assign({ type: "value", name: o.xLabel, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: TEXT2, fontSize: 11.5 }, scale: true }, axisCommon, { axisLabel: { color: MUTED, fontSize: 11, formatter: (v) => pct(v, 0) } }),
      yAxis: Object.assign({ type: "value", name: o.yLabel, nameTextStyle: { color: TEXT2, fontSize: 11.5, align: "left" }, scale: true }, axisCommon, { axisLabel: { color: MUTED, fontSize: 11, formatter: (v) => pct(v, 0) } }),
      series: order.map((k) => ({
        type: "scatter", symbolSize: k === "_muted" ? 8 : 11, z: k === "_muted" ? 1 : 3,
        itemStyle: { color: k === "_muted" ? "#c9d1cc" : k, borderColor: "#fff", borderWidth: 2, opacity: 1 },
        emphasis: { scale: 1.4 },
        label: { show: !!o.labels && k !== "_muted", position: "right", fontSize: 11, color: TEXT2, formatter: (p) => p.data.p.label || "" },
        labelLayout: { hideOverlap: true },
        data: byColor[k].map((p) => ({ value: [p.x, p.y], p, symbol: p.symbol || "circle" })),
      })),
    });
  };

  /* Matriz de correlação (divergente azul—cinza—vermelho). */
  C.corrMatrix = function (el, names, matrix) {
    const data = [];
    matrix.forEach((row, i) => row.forEach((v, j) => data.push([j, i, v == null ? null : +v.toFixed(2)])));
    return C.mount(el, {
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      tooltip: Object.assign({}, tooltipBase, { formatter: (p) => `<div class="tt"><div class="tt-h">Correlação</div><div>${App.esc(names[p.data[1]])}<br>× ${App.esc(names[p.data[0]])}</div><div class="row"><span>ρ</span><b>${p.data[2] == null ? "N/D" : p.data[2].toLocaleString("pt-BR")}</b></div></div>` }),
      xAxis: { type: "category", data: names, axisLabel: { color: TEXT2, fontSize: 11, interval: 0, rotate: names.length > 3 ? 30 : 0, width: 110, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
      yAxis: { type: "category", data: names, inverse: true, axisLabel: { color: TEXT2, fontSize: 11, width: 130, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } },
      visualMap: { min: -1, max: 1, show: false, inRange: { color: ["#b4282c", "#e8a9a4", "#f0efec", "#9ec5f4", "#1c5cab"] } },
      series: [{ type: "heatmap", data, label: { show: true, fontSize: 11.5, color: INK, formatter: (p) => (p.data[2] == null ? "N/D" : p.data[2].toLocaleString("pt-BR", { minimumFractionDigits: 2 })) },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 } }],
    });
  };

  /* ---------- Cálculos para gráficos (a partir das cotas diárias) ---------- */
  /* Evolução de R$100 a partir de i0 até iEnd. Retorna [[iso, valor]] (null onde falta cota). */
  C.growth = function (arr, i0, iEnd) {
    const base = arr[i0];
    if (base == null) return [];
    const out = [];
    for (let i = i0; i <= iEnd; i++) out.push([App.axis[i], arr[i] == null ? null : (100 * arr[i]) / base]);
    return out;
  };
  C.drawdown = function (arr, i0, iEnd) {
    let peak = null; const out = [];
    for (let i = i0; i <= iEnd; i++) {
      const v = arr[i];
      if (v == null) { out.push([App.axis[i], null]); continue; }
      if (peak == null || v > peak) peak = v;
      out.push([App.axis[i], v / peak - 1]);
    }
    return out;
  };
  C.dailyReturns = function (arr, i0, iEnd) {
    const out = new Array(iEnd - i0 + 1).fill(null);
    for (let i = i0 + 1; i <= iEnd; i++) if (arr[i] != null && arr[i - 1] != null) out[i - i0] = arr[i] / arr[i - 1] - 1;
    return out;
  };
  C.correlation = function (a, b) {
    const xs = [], ys = [];
    for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { xs.push(a[i]); ys.push(b[i]); }
    const n = xs.length; if (n < 60) return null;
    const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  };
  /* Período padrão: índice inicial para N meses antes da data-base (ou 'max'). */
  C.periodStart = function (period) {
    const last = App.axis.length - 1;
    if (period === "max") return 0;
    if (period === "ytd") return App.idxOnOrBefore(App.axis[last].slice(0, 4) - 1 + "-12-31") ?? 0;
    return App.idxOnOrBefore(App.addMonthsISO(App.axis[last], -period)) ?? 0;
  };
})();

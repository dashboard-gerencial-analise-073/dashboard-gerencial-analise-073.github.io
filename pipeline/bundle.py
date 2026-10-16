"""Gera um HTML único e autocontido (CSS, JS, ECharts e dados embutidos) para distribuição por e-mail."""
import re

import config


def build(out_path):
    root = config.DASHBOARD_DIR
    html = (root / "index.html").read_text(encoding="utf-8")

    def css(m):
        return "<style>\n" + (root / m.group(1)).read_text(encoding="utf-8") + "\n</style>"

    def js(m):
        f = root / m.group(1)
        if not f.exists():  # arquivos opcionais (ex.: data/site.js, só existe na versão publicada)
            return ""
        code = f.read_text(encoding="utf-8").replace("</script", "<\\/script")
        return "<script>\n" + code + "\n</script>"

    # Carteiras (CDA) carregadas sob demanda no site: no arquivo único vão embutidas logo após o núcleo (core.js).
    shards = sorted((root / "data" / "carteiras").glob("*.js"))
    html = html.replace('<script src="assets/js/charts.js"></script>', '<!--CART_SHARDS--><script src="assets/js/charts.js"></script>')
    html = re.sub(r'<link rel="stylesheet" href="(assets/[^"]+)"\s*/?>', css, html)
    html = re.sub(r'<script src="((?:assets|data)/[^"]+)"></script>', js, html)
    html = html.replace("<!--CART_SHARDS-->", "".join("<script>\n" + p.read_text(encoding="utf-8").replace("</script", "<\\/script") + "\n</script>" for p in shards))
    out_path.write_text(html, encoding="utf-8")
    return out_path

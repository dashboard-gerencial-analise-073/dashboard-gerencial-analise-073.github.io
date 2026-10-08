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

    html = re.sub(r'<link rel="stylesheet" href="(assets/[^"]+)"\s*/?>', css, html)
    html = re.sub(r'<script src="((?:assets|data)/[^"]+)"></script>', js, html)
    out_path.write_text(html, encoding="utf-8")
    return out_path

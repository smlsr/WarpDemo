"""plan/CURSOR_SWIMLANE.pdf (+ page-1 PNG) from plan/schedule.json. ReportLab + DejaVu."""

from __future__ import annotations

from collections import defaultdict

from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Table, TableStyle, PageBreak
from pypdf import PdfReader, PdfWriter

FD = "/usr/share/fonts/truetype/dejavu/"
for n, f in [("DV", "DejaVuSans.ttf"), ("DVB", "DejaVuSans-Bold.ttf"), ("DVC", "DejaVuSansCondensed.ttf"), ("DVCB", "DejaVuSansCondensed-Bold.ttf")]:
    try:
        pdfmetrics.registerFont(TTFont(n, FD + f))
    except Exception:
        pass
SW = pdfmetrics.stringWidth
W, H = 1224, 792
M = 36
SURF, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
LANE_COL = {"platform": "#2a78d6", "model": "#1baf7a", "console": "#eb6834", "quality": "#4a3aa7", "release": "#e34948"}


def tint(hexc, a=0.26, base=SURF):
    r = [int(hexc[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(base[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(b[i] + (r[i] - b[i]) * a) for i in range(3))


def g(x):
    return "%g" % x


def fit(text, font, size, maxw):
    if SW(text, font, size) <= maxw:
        return text
    while text and SW(text + "…", font, size) > maxw:
        text = text[:-1]
    text = text.rstrip(" ,:/-(")
    return (text + "…") if len(text) >= 4 else ""


def render(S, out_pdf, work_prefix, pack_dir):
    TK = {t["id"]: t for t in S["tickets"]}
    N = S["numbers"]
    END = max(N["finish_h"], 1)
    rows_n = max(t["slot"] for t in S["tickets"])
    name = S["program"]

    def header(c, title, sub):
        c.setFillColor(HexColor(SURF)); c.rect(0, 0, W, H, stroke=0, fill=1)
        c.setFillColor(HexColor(INK)); c.setFont("DVB", 17); c.drawString(M, H - M - 12, title)
        c.setFillColor(HexColor(INK2)); c.setFont("DV", 9.5); c.drawString(M, H - M - 30, sub)

    def footer(c, text, page):
        c.setFillColor(HexColor(MUTED)); c.setFont("DV", 7.5); c.drawString(M, 20, text)
        c.drawRightString(W - M, 20, f"{pack_dir}/plan/CURSOR_SWIMLANE.pdf · page {page}")

    c = canvas.Canvas(work_prefix + "_a.pdf", pagesize=(W, H))
    c.setTitle(f"{name} build swimlane")
    header(c, f"{name} build swimlane — 1 orchestrator · {S['model']['slots']} agent slots · every ticket merges when green",
           f"{N['tickets']} tickets · {N['waves']} waves · {N['agent_hours']} agent-hours · finish T+{g(END)}h · peak {N['peak']} in flight · "
           f"critical chain {g(N['critical_path_h'])}h over {N['critical_tickets']} tickets")
    c.setFillColor(HexColor(INK2)); c.setFont("DV", 8.5)
    c.drawString(M, H - M - 46, "★ " + " → ".join(S["critical_chain"]))
    # legend
    x, y = M, H - M - 66
    c.setFont("DV", 8)
    for lane in S["lanes"]:
        col = LANE_COL[lane]
        c.setFillColor(HexColor(tint(col))); c.roundRect(x, y - 2, 20, 10, 2, stroke=0, fill=1)
        c.setFillColor(HexColor(col)); c.rect(x, y - 2, 3.2, 10, stroke=0, fill=1)
        c.setFillColor(HexColor(INK2)); c.drawString(x + 25, y, lane); x += 25 + SW(lane, "DV", 8) + 18
    c.setStrokeColor(HexColor(INK)); c.setLineWidth(1.5); c.setFillColor(HexColor(SURF)); c.roundRect(x, y - 2, 20, 10, 2, stroke=1, fill=1)
    c.setFillColor(HexColor(INK2)); lab = "★ critical chain"; c.drawString(x + 25, y, lab); x += 25 + SW(lab, "DV", 8) + 18
    c.setStrokeColor(HexColor(INK2)); c.setLineWidth(1); c.line(x + 4, y - 3, x + 4, y + 9)
    c.drawString(x + 11, y, "gate reached (gate blocks run in order)")
    x0, x1 = M + 50, W - M
    rowh = min(64, (H - M - 170 - 70) / max(rows_n, 1))
    y_top = H - M - 130
    y_bot = y_top - rows_n * rowh
    X = lambda h: x0 + (x1 - x0) * h / END
    step = next(s for s in (1, 2, 5, 10, 20) if (x1 - x0) * s / END >= 40)
    c.setLineWidth(0.5)
    for h in range(0, int(END) + 1, step):
        c.setStrokeColor(HexColor(GRID)); c.line(X(h), y_bot, X(h), y_top)
        c.setFillColor(HexColor(MUTED)); c.setFont("DV", 7.5); c.drawCentredString(X(h), y_bot - 11, f"T+{h}")
    for i in range(rows_n + 1):
        yy = y_top - i * rowh; c.setStrokeColor(HexColor(GRID)); c.line(x0, yy, x1, yy)
    for s in range(1, rows_n + 1):
        c.setFillColor(HexColor(INK2)); c.setFont("DV", 8); c.drawRightString(x0 - 8, y_top - (s - 0.5) * rowh - 3, f"Slot {s}")
    # gate lines with labels that never overlap
    placed = []
    for gt in sorted(S["gates"], key=lambda q: q["at"]):
        xx = X(gt["at"]); lab = f"{gt['key']} {gt['name']}"; w = SW(lab, "DVB", 7.4)
        lx = xx - w - 4 if xx - w - 4 > x0 else xx + 4
        r = 0
        while any(q["r"] == r and not (lx > q["x1"] + 6 or lx + w < q["x0"] - 6) for q in placed):
            r += 1
        placed.append({"x0": lx, "x1": lx + w, "r": r})
        ly = y_top + 6 + r * 11
        c.setStrokeColor(HexColor(INK2)); c.setLineWidth(0.9); c.line(xx, y_bot, xx, ly + 8)
        c.setFillColor(HexColor(INK)); c.setFont("DVB", 7.4); c.drawString(lx, ly, lab)
    for t in S["tickets"]:
        col = LANE_COL[t["lane"]]
        bx = X(t["start"]) + 1; bw = X(t["start"] + t["h"]) - X(t["start"]) - 2
        by = y_top - t["slot"] * rowh + 4; bh = rowh - 8
        if t["merge"] > t["start"] + t["h"] + 1e-9:  # approval wait, pale
            c.setFillColor(HexColor(tint(col, 0.1))); c.roundRect(X(t["start"] + t["h"]), by, X(t["merge"]) - X(t["start"] + t["h"]) - 1, bh, 2, stroke=0, fill=1)
        c.setFillColor(HexColor(tint(col))); c.roundRect(bx, by, bw, bh, 2.5, stroke=0, fill=1)
        c.setFillColor(HexColor(col)); c.rect(bx, by, 4.5, bh, stroke=0, fill=1)
        if t["critical"]:
            c.setStrokeColor(HexColor(INK)); c.setLineWidth(1.5); c.roundRect(bx, by, bw, bh, 2.5, stroke=1, fill=0)
        avail = bw - 11
        lab = ("★ " if t["critical"] else "") + t["id"]
        c.setFillColor(HexColor(INK)); c.setFont("DVB", 8)
        if SW(lab, "DVB", 8) > avail:
            lab = t["id"]
        c.drawString(bx + 8, by + bh - 11, lab)
        meta = f"{t['size']}·{g(t['h'])}h"
        if SW(lab, "DVB", 8) + 6 + SW(meta, "DVC", 6.8) <= avail:
            c.setFillColor(HexColor(INK2)); c.setFont("DVC", 6.8); c.drawRightString(bx + bw - 4, by + bh - 10.5, meta)
        short = fit(t["summary"], "DVC", 7, avail)
        if short and bh > 20:
            c.setFillColor(HexColor(INK2)); c.setFont("DVC", 7); c.drawString(bx + 8, by + 5, short)
    c.setFillColor(HexColor(MUTED)); c.setFont("DV", 7.5)
    c.drawString(x0, y_bot - 26, "Estimate-hours on a continuous clock. Solid = the agent works; pale = an L/XL PR waits for approval before dependents start. "
                                 "A slot is reused the moment its agent finishes.")
    footer(c, f"Slots are interchangeable — Warp gives a ready ticket the next free agent. Source: {pack_dir}/plan/schedule.json", 1)
    c.showPage(); c.save()

    ps = ParagraphStyle("c", fontName="DV", fontSize=7.6, leading=9.6, textColor=HexColor(INK))
    pb = ParagraphStyle("b", parent=ps, fontName="DVB")
    h1 = ParagraphStyle("h1", fontName="DVB", fontSize=15, leading=19, textColor=HexColor(INK), spaceAfter=3)
    sub = ParagraphStyle("sub", fontName="DV", fontSize=9, leading=12, textColor=HexColor(INK2), spaceAfter=10)
    star = lambda i: ("★ " if i in TK and TK[i]["critical"] else "") + i

    def onpage(cv, doc):
        cv.saveState(); cv.setFillColor(HexColor(SURF)); cv.rect(0, 0, W, H, stroke=0, fill=1)
        cv.setFillColor(HexColor(MUTED)); cv.setFont("DV", 7.5)
        cv.drawString(M, 20, "T+ = estimate-hours. Starts are ticket → slot. Detail per start: BUILD_PLAN.md.")
        cv.drawRightString(W - M, 20, f"{pack_dir}/plan/CURSOR_SWIMLANE.pdf · page {doc.page + 1}"); cv.restoreState()

    doc = BaseDocTemplate(work_prefix + "_b.pdf", pagesize=(W, H), leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=M + 4)
    doc.addPageTemplates(PageTemplate(id="p", frames=[Frame(M, M + 4, W - 2 * M, H - 2 * M - 4, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=onpage))
    story = [Paragraph("Step table — every merge moment", h1),
             Paragraph("One row per moment something merges: what lands, the gate it reaches, what starts on which slot.", sub)]
    rows = [[Paragraph(x, pb) for x in ("#", "At", "Merges", "Gate", "Starts (ticket → slot)", "In flight")]]
    gname = {q["key"]: q["name"] for q in S["gates"]}
    for s in S["steps"]:
        rows.append([Paragraph(str(s["n"]), ps), Paragraph(f"T+{g(s['t'])}h", pb), Paragraph(", ".join(star(i) for i in s["merges"]) or "start", ps),
                     Paragraph("<br/>".join(f"{k} {gname[k]}" for k in s["gates"]), pb),
                     Paragraph(", ".join(f"{star(i)} → {TK[i]['slot']}" for i in s["starts"]) or "—", ps), Paragraph(str(len(s["running"])), ps)])
    ts = [("LINEBELOW", (0, 0), (-1, 0), 0.8, HexColor(AXIS)), ("LINEBELOW", (0, 1), (-1, -1), 0.4, HexColor(GRID)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 3)]
    tb = Table(rows, colWidths=[30, 60, 300, 180, 520, 60], repeatRows=1)
    tb.setStyle(TableStyle(ts)); story += [tb, PageBreak()]
    story += [Paragraph("Slot sequences", h1), Paragraph("Start → merge in estimate-hours, per slot.", sub)]
    by = defaultdict(list)
    for t in S["tickets"]:
        by[t["slot"]].append(t)
    rows = [[Paragraph(x, pb) for x in ("Slot", "Tickets", "Busy", "Sequence")]]
    for sl in sorted(by):
        seq = sorted(by[sl], key=lambda t: t["start"])
        rows.append([Paragraph(f"Slot {sl}", pb), Paragraph(str(len(seq)), ps), Paragraph(f"{g(sum(t['h'] for t in seq))}h", ps),
                     Paragraph(" → ".join(f"{star(t['id'])} ({g(t['start'])}–{g(t['merge'])})" for t in seq), ps)])
    tb2 = Table(rows, colWidths=[60, 50, 50, 990], repeatRows=1)
    tb2.setStyle(TableStyle(ts)); story.append(tb2)
    doc.build(story)
    wr = PdfWriter()
    for f in (work_prefix + "_a.pdf", work_prefix + "_b.pdf"):
        for p in PdfReader(f).pages:
            wr.add_page(p)
    wr.add_metadata({"/Title": f"{name} build swimlane", "/Subject": f"Generated from {pack_dir}/plan/schedule.json"})
    wr.write(out_pdf)
    return len(PdfReader(out_pdf).pages)

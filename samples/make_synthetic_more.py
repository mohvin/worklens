"""Two more synthetic screen recordings for testing, built on make_synthetic.py's drawing helpers.

    python samples/make_synthetic_more.py            # writes both
    python samples/make_synthetic_more.py approver    # or one of: approver, expense

* synthetic-approver.mp4 (~1:50) — the APPROVER role of the invoice process, meant to be uploaded
  into the same process as synthetic-invoice.mp4 (AP clerk). Opens the clerk's approval email,
  waits for the ERP, checks the PO register again (the clerk already did), re-reads the PDF,
  types the approval reference into an approvals log (re-keying across roles), approves in the
  ERP and replies by email. Loops back to Mail and to the ERP.
* synthetic-expense.mp4 (~3:30) — a bigger single-role task: an expense claim with two receipts,
  six applications, three loops, two waits (policy check, submit), two re-keyings (receipts into
  the form, a currency conversion typed over) and a manual budget check in Sheets.

No real data. 1280x720, 5 fps, same look as the first sample.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_synthetic import FONT, FONT_B, FPS, H, PALETTE, W, base, erp_loading, pdf_viewer, sheet  # noqa: E402

PALETTE.update({"expense": (110, 60, 160), "chat": (90, 40, 120), "log": (20, 110, 50)})
HERE = Path(__file__).resolve().parent

Screen = tuple[Image.Image, float]


# ----------------------------------------------------------------- generic screens


def mail_list(title: str, rows: list[tuple[str, str]], selected: int | None, note: str = "", unread: int = 3) -> Image.Image:
    im, d = base("mail", title)
    d.rectangle([0, 56, 300, H - 40], fill=(232, 232, 232))
    d.text((20, 76), f"Inbox ({unread})", fill="black", font=FONT_B)
    d.text((20, 110), "Sent", fill="black", font=FONT)
    for i, (frm, sub) in enumerate(rows):
        y = 80 + i * 70
        if i == selected:
            d.rectangle([310, y - 8, W - 20, y + 54], fill=(220, 228, 245))
        d.text((330, y), frm, fill="black", font=FONT_B)
        d.text((330, y + 26), sub, fill=(50, 50, 50), font=FONT)
    if note:
        d.text((330, 80 + len(rows) * 70 + 20), note, fill=(20, 100, 20), font=FONT)
    return im


def mail_message(title: str, lines: list[str], attachment: str = "", reply_text: str | None = None, button: str = "Reply") -> Image.Image:
    im, d = base("mail", title)
    d.rectangle([0, 56, 300, H - 40], fill=(232, 232, 232))
    d.text((20, 76), "Inbox", fill="black", font=FONT_B)
    y = 90
    for ln in lines:
        d.text((330, y), ln, fill="black", font=FONT)
        y += 30
    if attachment:
        d.rectangle([330, y + 20, 640, y + 62], outline=(100, 100, 100), width=2)
        d.text((345, y + 30), attachment, fill="black", font=FONT)
        y += 70
    if reply_text is not None:
        d.rectangle([330, y + 30, W - 40, y + 230], outline=(100, 100, 100), width=2)
        d.text((345, y + 40), "Reply", fill="black", font=FONT_B)
        d.text((345, y + 75), reply_text, fill="black", font=FONT)
    d.rectangle([330, H - 110, 440, H - 70], fill=PALETTE["mail"])
    d.text((350, H - 100), button, fill="white", font=FONT)
    return im


def form_screen(app: str, title: str, side: str, fields: list[str], values: list[str], filled: int, typing: str = "", status: str = "", button: str = "Submit") -> Image.Image:
    im, d = base(app, title)
    d.rectangle([0, 56, 220, H - 40], fill=(225, 225, 235))
    d.text((20, 76), side, fill="black", font=FONT_B)
    for i, name in enumerate(fields):
        y = 100 + i * 58
        d.text((260, y), name, fill="black", font=FONT)
        d.rectangle([460, y - 6, 900, y + 30], fill="white", outline=(150, 150, 150))
        if i < filled:
            d.text((470, y), values[i], fill="black", font=FONT)
        elif i == filled and typing:
            d.text((470, y), typing, fill="black", font=FONT)
    d.rectangle([460, 600, 600, 642], fill=PALETTE[app])
    d.text((485, 612), button, fill="white", font=FONT)
    if status:
        d.text((640, 612), status, fill=(20, 100, 20), font=FONT_B)
    return im


def table_screen(app: str, title: str, cols: list[str], rows: list[list[str]], highlight: int | None = None, typing_cell: tuple[int, int, str] | None = None, cw: int = 250) -> Image.Image:
    im, d = base(app, title)
    x0, y0, rh = 40, 80, 36
    for j, c in enumerate(cols):
        d.rectangle([x0 + j * cw, y0, x0 + (j + 1) * cw, y0 + rh], fill=(220, 220, 220), outline=(170, 170, 170))
        d.text((x0 + j * cw + 8, y0 + 8), c, fill="black", font=FONT_B)
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            y = y0 + (i + 1) * rh
            fill = (255, 250, 200) if highlight == i else "white"
            d.rectangle([x0 + j * cw, y, x0 + (j + 1) * cw, y + rh], fill=fill, outline=(170, 170, 170))
            txt = typing_cell[2] if typing_cell and typing_cell[0] == i and typing_cell[1] == j else v
            d.text((x0 + j * cw + 8, y + 8), txt, fill="black", font=FONT)
    return im


def doc_screen(app: str, title: str, heading: str, lines: list[str], bold_last: bool = True) -> Image.Image:
    im, d = base(app, title)
    d.rectangle([240, 80, W - 240, H - 60], fill="white", outline=(180, 180, 180))
    d.text((280, 110), heading, fill="black", font=FONT_B)
    for i, ln in enumerate(lines):
        f = FONT_B if bold_last and i == len(lines) - 1 else FONT
        d.text((280, 150 + i * 30), ln, fill="black", font=f)
    return im


def loading_screen(app: str, title: str, text: str, progress: int) -> Image.Image:
    im, d = base(app, title)
    d.text((W // 2 - 110, H // 2 - 40), text, fill=(80, 80, 80), font=FONT)
    d.rectangle([W // 2 - 150, H // 2, W // 2 + 150, H // 2 + 16], outline=(120, 120, 120))
    d.rectangle([W // 2 - 150, H // 2, W // 2 - 150 + 3 * progress, H // 2 + 16], fill=PALETTE[app])
    return im


def typed(make, values: list[str], i: int, step: int = 3, per: float = 0.6, settle: float = 1.0) -> list[Screen]:
    """Type values[i] in chunks, then show the field filled."""
    out: list[Screen] = []
    v = values[i]
    for k in range(1, len(v) + 1, step):
        out.append((make(i, v[:k]), per))
    out.append((make(i + 1, ""), settle))
    return out


# ------------------------------------------------------------------- approver


def erp_invoice(status: str = "Awaiting approval", approved: bool = False) -> Image.Image:
    im, d = base("erp", "ERP - Accounts Payable - Invoice AP-000912")
    d.rectangle([0, 56, 220, H - 40], fill=(225, 235, 232))
    d.text((20, 76), "AP Invoices", fill="black", font=FONT_B)
    rows = [("Supplier", "Acme Supplies Ltd"), ("Invoice no.", "INV-20481"), ("Invoice date", "20/10/2026"), ("PO number", "PO-7731"), ("Net", "3541.67"), ("VAT", "708.33"), ("Total", "4250.00"), ("Status", status)]
    for i, (k, v) in enumerate(rows):
        y = 100 + i * 52
        d.text((260, y), k, fill="black", font=FONT)
        d.text((470, y), v, fill=(20, 100, 20) if k == "Status" and approved else "black", font=FONT_B if k == "Status" else FONT)
    d.rectangle([460, 560, 600, 602], fill=PALETTE["erp"])
    d.text((480, 572), "Approve", fill="white", font=FONT)
    d.rectangle([620, 560, 760, 602], fill=(150, 60, 60))
    d.text((650, 572), "Reject", fill="white", font=FONT)
    if approved:
        d.text((790, 572), "Approved by M. Lekshmanan", fill=(20, 100, 20), font=FONT_B)
    return im


APPROVER_MAIL = [("AP clerk", "Please approve: Invoice INV-20481 - Acme Supplies"), ("Northwind Ltd", "Statement October"), ("IT Helpdesk", "Password expiry")]
LOG_COLS = ["Date", "Invoice", "Supplier", "AP ref", "Approved by"]
LOG_ROWS = [["28/10/2026", "INV-20466", "Globex", "AP-000905", "ML"], ["29/10/2026", "INV-20470", "Initech", "AP-000908", "ML"], ["", "", "", "", ""]]


def approver_script() -> list[Screen]:
    s: list[Screen] = []
    req = ["From: ap.clerk@purplelab.example", "Subject: Please approve: Invoice INV-20481 - Acme Supplies", "", "Bill posted in the ERP as AP-000912 for PO-7731, total 4,250.00 GBP.", "Please approve for payment."]
    s.append((mail_list("Mail - Inbox", APPROVER_MAIL, None), 3))
    s.append((mail_list("Mail - Inbox", APPROVER_MAIL, 0), 2))
    s.append((mail_message("Mail - Please approve: Invoice INV-20481", req, attachment="invoice-20481.pdf  (84 KB)"), 7))
    for p in range(0, 101, 11):  # ERP load, ~10 s
        s.append((erp_loading(p), 1))
    s.append((erp_invoice(), 9))
    s.append((sheet(), 3))  # checks the PO register again, like the clerk did
    s.append((sheet(2), 6))
    s.append((erp_invoice(), 4))
    s.append((pdf_viewer(), 7))  # re-reads the supplier PDF
    s.append((erp_invoice(), 3))
    # approvals log: types the references into a spreadsheet (re-keying across roles)
    log_vals = ["30/10/2026", "INV-20481", "Acme Supplies Ltd", "AP-000912", "ML"]
    s.append((table_screen("log", "Sheets - Approvals log.xlsx", LOG_COLS, LOG_ROWS, cw=230), 3))
    for j, v in enumerate(log_vals):
        for k in range(1, len(v) + 1, 3):
            rows = [r[:] for r in LOG_ROWS]
            rows[2] = log_vals[:j] + [""] * (5 - j)
            s.append((table_screen("log", "Sheets - Approvals log.xlsx", LOG_COLS, rows, highlight=2, typing_cell=(2, j, v[:k]), cw=230), 0.6))
    rows = [r[:] for r in LOG_ROWS]
    rows[2] = log_vals
    s.append((table_screen("log", "Sheets - Approvals log.xlsx", LOG_COLS, rows, highlight=2, cw=230), 2))
    s.append((erp_invoice(), 4))
    s.append((erp_invoice("Approved", approved=True), 5))
    s.append((mail_list("Mail - Inbox", APPROVER_MAIL, 0), 2))  # back to Mail
    s.append((mail_message("Mail - Please approve: Invoice INV-20481", req, attachment="invoice-20481.pdf  (84 KB)"), 2))
    txt = "Approved. INV-20481 / AP-000912 released for payment."
    for k in range(1, len(txt) + 1, 6):
        s.append((mail_message("Mail - Please approve: Invoice INV-20481", req, attachment="invoice-20481.pdf  (84 KB)", reply_text=txt[:k], button="Send"), 0.6))
    s.append((mail_list("Mail - Inbox", APPROVER_MAIL, None, note="Replied: 'Approved. INV-20481 / AP-000912 released for payment.'"), 4))
    return s


# -------------------------------------------------------------------- expense


EXP_MAIL = [("Priya Nair", "Expense claim - Berlin client visit (2 receipts)"), ("Finance system", "Weekly digest"), ("IT Helpdesk", "Password expiry")]
EXP_FIELDS = ["Employee", "Trip", "Receipt 1 vendor", "Receipt 1 amount", "Receipt 1 date", "Receipt 2 vendor", "Receipt 2 amount (GBP)", "Receipt 2 date", "Cost centre"]
EXP_VALUES = ["Priya Nair", "Berlin client visit", "Hotel Adlon GmbH", "412.50", "14/10/2026", "Deutsche Bahn", "73.80", "15/10/2026", "CC-4410"]
BUDGET_COLS = ["Cost centre", "Owner", "Budget left", "Status"]
BUDGET_ROWS = [["CC-4400", "Sales UK", "12,400.00", "OK"], ["CC-4410", "Sales EU", "2,150.00", "OK"], ["CC-4420", "Marketing", "300.00", "Low"]]


def receipt(n: int) -> Image.Image:
    if n == 1:
        return doc_screen("pdf", "PDF Viewer - receipt-hotel.pdf", "HOTEL ADLON GMBH", ["Receipt no: 88213", "Date: 14 Oct 2026", "Guest: P. Nair", "2 nights, standard room", "Total: 412.50 GBP"])
    return doc_screen("pdf", "PDF Viewer - receipt-train.pdf", "DEUTSCHE BAHN", ["Ticket: 7Y3KQ2", "Date: 15 Oct 2026", "Berlin Hbf - Frankfurt Hbf", "Total: 84.90 EUR"])


def converter(typing: str = "", result: str = "") -> Image.Image:
    im, d = base("browser", "Browser - Currency converter")
    d.text((W // 2 - 200, 140), "Convert EUR to GBP", fill="black", font=FONT_B)
    d.rectangle([W // 2 - 200, 190, W // 2 + 200, 232], fill="white", outline=(150, 150, 150))
    d.text((W // 2 - 190, 200), typing, fill="black", font=FONT)
    if result:
        d.text((W // 2 - 200, 260), result, fill="black", font=FONT_B)
        d.text((W // 2 - 200, 290), "Rate 0.869, 30 Oct 2026", fill=(90, 90, 90), font=FONT)
    return im


def policy_page() -> Image.Image:
    return doc_screen("browser", "Browser - Travel policy", "TRAVEL & EXPENSE POLICY", ["Hotels: up to 220 GBP per night in EU capitals", "Rail: standard class, receipts required", "Claims within 30 days of travel", "Manager approval above 400 GBP"], bold_last=False)


def chat(typing: str = "", sent: bool = False) -> Image.Image:
    im, d = base("chat", "Chat - Finance team")
    d.rectangle([0, 56, 260, H - 40], fill=(235, 230, 240))
    d.text((20, 76), "Channels", fill="black", font=FONT_B)
    d.text((20, 110), "# finance-approvals", fill="black", font=FONT)
    d.text((290, 90), "Rahul: budget file updated for Q4", fill=(60, 60, 60), font=FONT)
    d.text((290, 120), "Anna: thanks", fill=(60, 60, 60), font=FONT)
    if sent:
        d.text((290, 160), "You: Expense EXP-3307 for Priya submitted, 486.30 GBP, needs your approval", fill="black", font=FONT)
    d.rectangle([290, H - 110, W - 40, H - 70], fill="white", outline=(150, 150, 150))
    d.text((300, H - 100), typing, fill="black", font=FONT)
    return im


def exp_form(filled: int, typing: str = "", status: str = "") -> Image.Image:
    return form_screen("expense", "Expenses - New claim", "Claims", EXP_FIELDS, EXP_VALUES, filled, typing, status)


def expense_script() -> list[Screen]:
    s: list[Screen] = []
    msg = ["From: priya.nair@purplelab.example", "Subject: Expense claim - Berlin client visit (2 receipts)", "", "Hi, attached the hotel and train receipts for the Berlin visit.", "Cost centre CC-4410. Thanks!"]
    def mail_msg(reply=None, button="Reply"):
        return mail_message("Mail - Expense claim - Berlin client visit", msg, attachment="receipt-hotel.pdf  receipt-train.pdf", reply_text=reply, button=button)
    s.append((mail_list("Mail - Inbox", EXP_MAIL, None, unread=5), 4))
    s.append((mail_list("Mail - Inbox", EXP_MAIL, 0, unread=5), 2))
    s.append((mail_msg(), 7))
    s.append((receipt(1), 8))
    s.append((exp_form(0), 4))
    for i in range(0, 5):  # employee, trip, receipt 1 (re-keyed from the PDF)
        s += typed(exp_form, EXP_VALUES, i)
        if i == 2:
            s.append((receipt(1), 4))  # back to the receipt to check the vendor name
            s.append((exp_form(3), 2))
    s.append((mail_msg(), 3))  # back to Mail for the second receipt
    s.append((receipt(2), 8))
    s.append((converter(), 2))  # convert EUR to GBP in the browser
    for k in range(1, 6, 2):
        s.append((converter("84.90"[:k]), 0.6))
    s.append((converter("84.90", result="84.90 EUR = 73.80 GBP"), 5))
    s.append((exp_form(5), 2))
    for i in range(5, 8):  # receipt 2, amount typed over from the converter
        s += typed(exp_form, EXP_VALUES, i)
    s.append((policy_page(), 2))
    for p in range(0, 101, 7):  # policy check loading, ~15 s
        s.append((loading_screen("browser", "Browser - Travel policy", "Checking claim against policy...", p), 1))
    s.append((policy_page(), 6))
    s.append((exp_form(8), 2))
    s += typed(exp_form, EXP_VALUES, 8)
    s.append((table_screen("sheet", "Sheets - Budget register.xlsx", BUDGET_COLS, BUDGET_ROWS), 3))  # manual budget check
    s.append((table_screen("sheet", "Sheets - Budget register.xlsx", BUDGET_COLS, BUDGET_ROWS, highlight=1), 6))
    s.append((exp_form(9), 3))
    for p in range(0, 101, 13):  # submit processing, ~8 s
        s.append((loading_screen("expense", "Expenses - New claim", "Submitting claim...", p), 1))
    s.append((exp_form(9, status="Submitted: EXP-3307 (486.30 GBP)"), 5))
    s.append((chat(), 2))
    txt = "Expense EXP-3307 for Priya submitted, 486.30 GBP, needs your approval"
    for k in range(1, len(txt) + 1, 7):
        s.append((chat(typing=txt[:k]), 0.6))
    s.append((chat(sent=True), 3))
    s.append((mail_list("Mail - Inbox", EXP_MAIL, 0, unread=5), 2))  # back to Mail to reply
    s.append((mail_msg(), 2))
    rep = "Submitted as EXP-3307 (486.30 GBP). Manager approval requested."
    for k in range(1, len(rep) + 1, 6):
        s.append((mail_msg(reply=rep[:k], button="Send"), 0.6))
    s.append((mail_list("Mail - Inbox", EXP_MAIL, None, note="Replied: 'Submitted as EXP-3307 (486.30 GBP).'", unread=4), 4))
    return s


# ---------------------------------------------------------------------- main


def render(frames: list[Screen], out: Path) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="worklens-synth-"))
    n = 0
    for im, secs in frames:
        for _ in range(max(1, round(secs * FPS))):
            im.save(tmp / f"f{n:06d}.png")
            n += 1
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(tmp / "f%06d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", str(out)], check=True)
    shutil.rmtree(tmp)
    print(f"wrote {out} ({n / FPS:.0f}s, {n} frames)")


SCRIPTS = {"approver": (approver_script, "synthetic-approver.mp4"), "expense": (expense_script, "synthetic-expense.mp4")}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCRIPTS)
    for name in names:
        fn, out = SCRIPTS[name]
        render(fn(), HERE / out)

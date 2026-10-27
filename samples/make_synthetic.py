"""Generate a synthetic screen recording of a supplier-invoice task.

Produces samples/synthetic-invoice.mp4 (about 2 minutes, 1280x720, 5 fps).
The script fakes five applications and scripts a process with one loop
(back to Mail twice) and one long wait (ERP page load), so the pipeline
has something real to find. No real data is used.

    python samples/make_synthetic.py
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 5
OUT = Path(__file__).with_name("synthetic-invoice.mp4")

try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    FONT_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
except OSError:  # pragma: no cover
    FONT = ImageFont.load_default()
    FONT_B = ImageFont.load_default()

PALETTE = {
    "mail": (60, 80, 140),
    "pdf": (120, 40, 40),
    "erp": (30, 110, 90),
    "sheet": (20, 110, 50),
    "browser": (80, 80, 80),
}


def base(app: str, title: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), (246, 246, 246))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 56], fill=PALETTE[app])
    d.text((20, 16), title, fill="white", font=FONT_B)
    # taskbar
    d.rectangle([0, H - 40, W, H], fill=(230, 230, 230))
    d.text((20, H - 30), "Mail   PDF   ERP   Sheets   Browser", fill=(60, 60, 60), font=FONT)
    return im, d


def mail_inbox(selected: bool, replied: bool = False) -> Image.Image:
    im, d = base("mail", "Mail - Inbox")
    d.rectangle([0, 56, 300, H - 40], fill=(232, 232, 232))
    d.text((20, 76), "Inbox (3)", fill="black", font=FONT_B)
    d.text((20, 110), "Sent", fill="black", font=FONT)
    rows = [
        ("Acme Supplies", "Invoice INV-20481 - 4,250.00 GBP"),
        ("Northwind Ltd", "Statement October"),
        ("IT Helpdesk", "Password expiry"),
    ]
    for i, (frm, sub) in enumerate(rows):
        y = 80 + i * 70
        if i == 0 and selected:
            d.rectangle([310, y - 8, W - 20, y + 54], fill=(220, 228, 245))
        d.text((330, y), frm, fill="black", font=FONT_B)
        d.text((330, y + 26), sub, fill=(50, 50, 50), font=FONT)
    if replied:
        d.text((330, 320), "Replied: 'Invoice INV-20481 approved for payment.'", fill=(20, 100, 20), font=FONT)
    return im


def mail_open(reply_text: str = "") -> Image.Image:
    im, d = base("mail", "Mail - Invoice INV-20481")
    d.rectangle([0, 56, 300, H - 40], fill=(232, 232, 232))
    d.text((20, 76), "Inbox (3)", fill="black", font=FONT_B)
    d.text((330, 90), "From: accounts@acme-supplies.example", fill="black", font=FONT)
    d.text((330, 120), "Subject: Invoice INV-20481 - 4,250.00 GBP", fill="black", font=FONT)
    d.text((330, 170), "Please find attached our invoice for October deliveries.", fill="black", font=FONT)
    d.rectangle([330, 220, 600, 262], outline=(100, 100, 100), width=2)
    d.text((345, 230), "invoice-20481.pdf  (84 KB)", fill="black", font=FONT)
    if reply_text:
        d.rectangle([330, 320, W - 40, 520], outline=(100, 100, 100), width=2)
        d.text((345, 330), "Reply", fill="black", font=FONT_B)
        d.text((345, 365), reply_text, fill="black", font=FONT)
    d.rectangle([330, H - 110, 440, H - 70], fill=PALETTE["mail"])
    d.text((350, H - 100), "Reply", fill="white", font=FONT)
    return im


def pdf_viewer() -> Image.Image:
    im, d = base("pdf", "PDF Viewer - invoice-20481.pdf")
    d.rectangle([240, 80, W - 240, H - 60], fill="white", outline=(180, 180, 180))
    d.text((280, 110), "ACME SUPPLIES LTD", fill="black", font=FONT_B)
    d.text((280, 150), "Invoice number: INV-20481", fill="black", font=FONT)
    d.text((280, 180), "Invoice date: 20 Oct 2026", fill="black", font=FONT)
    d.text((280, 210), "PO number: PO-7731", fill="black", font=FONT)
    d.text((280, 260), "Net: 3,541.67 GBP", fill="black", font=FONT)
    d.text((280, 290), "VAT 20%: 708.33 GBP", fill="black", font=FONT)
    d.text((280, 320), "Total: 4,250.00 GBP", fill="black", font=FONT_B)
    return im


def erp_loading(progress: int) -> Image.Image:
    im, d = base("erp", "ERP - Accounts Payable")
    d.text((W // 2 - 80, H // 2 - 40), "Loading invoice form...", fill=(80, 80, 80), font=FONT)
    d.rectangle([W // 2 - 150, H // 2, W // 2 + 150, H // 2 + 16], outline=(120, 120, 120))
    d.rectangle([W // 2 - 150, H // 2, W // 2 - 150 + 3 * progress, H // 2 + 16], fill=PALETTE["erp"])
    return im


ERP_FIELDS = ["Supplier", "Invoice no.", "Invoice date", "PO number", "Net", "VAT", "Total"]
ERP_VALUES = ["Acme Supplies Ltd", "INV-20481", "20/10/2026", "PO-7731", "3541.67", "708.33", "4250.00"]


def erp_form(filled: int, typing: str = "", submitted: bool = False) -> Image.Image:
    im, d = base("erp", "ERP - Accounts Payable - New Invoice")
    d.rectangle([0, 56, 220, H - 40], fill=(225, 235, 232))
    d.text((20, 76), "AP Invoices", fill="black", font=FONT_B)
    for i, name in enumerate(ERP_FIELDS):
        y = 100 + i * 64
        d.text((260, y), name, fill="black", font=FONT)
        d.rectangle([460, y - 6, 900, y + 30], fill="white", outline=(150, 150, 150))
        if i < filled:
            d.text((470, y), ERP_VALUES[i], fill="black", font=FONT)
        elif i == filled and typing:
            d.text((470, y), typing, fill="black", font=FONT)
    d.rectangle([460, 580, 600, 622], fill=PALETTE["erp"])
    d.text((485, 592), "Submit", fill="white", font=FONT)
    if submitted:
        d.text((640, 592), "Saved: AP-000912", fill=(20, 100, 20), font=FONT_B)
    return im


def sheet(highlight_row: int | None = None) -> Image.Image:
    im, d = base("sheet", "Sheets - PO register.xlsx")
    cols = ["PO", "Supplier", "Amount", "Status"]
    rows = [
        ["PO-7729", "Northwind Ltd", "1,200.00", "Received"],
        ["PO-7730", "Globex", "860.00", "Open"],
        ["PO-7731", "Acme Supplies Ltd", "4,250.00", "Received"],
        ["PO-7732", "Initech", "300.00", "Open"],
    ]
    x0, y0, cw, rh = 40, 80, 250, 36
    for j, c in enumerate(cols):
        d.rectangle([x0 + j * cw, y0, x0 + (j + 1) * cw, y0 + rh], fill=(220, 220, 220), outline=(170, 170, 170))
        d.text((x0 + j * cw + 8, y0 + 8), c, fill="black", font=FONT_B)
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            y = y0 + (i + 1) * rh
            fill = (255, 250, 200) if highlight_row == i else "white"
            d.rectangle([x0 + j * cw, y, x0 + (j + 1) * cw, y + rh], fill=fill, outline=(170, 170, 170))
            d.text((x0 + j * cw + 8, y + 8), v, fill="black", font=FONT)
    return im


def script() -> list[tuple[Image.Image, float]]:
    """(screen, seconds) pairs in order."""
    s: list[tuple[Image.Image, float]] = []
    s.append((mail_inbox(False), 4))
    s.append((mail_inbox(True), 2))
    s.append((mail_open(), 6))
    s.append((pdf_viewer(), 8))
    for p in range(0, 101, 5):  # long wait: ERP load, 21 frames x 1s
        s.append((erp_loading(p), 1))
    s.append((erp_form(0), 3))
    for i in range(len(ERP_FIELDS)):
        v = ERP_VALUES[i]
        for k in range(1, len(v) + 1, 3):
            s.append((erp_form(i, typing=v[:k]), 0.6))
        s.append((erp_form(i + 1), 1))
        if i == 3:  # loop back: check the PO in the spreadsheet mid-way
            s.append((sheet(), 4))
            s.append((sheet(2), 5))
            s.append((erp_form(i + 1), 2))
    s.append((erp_form(len(ERP_FIELDS), submitted=True), 4))
    s.append((mail_inbox(True), 3))  # loop back to mail
    s.append((mail_open(), 2))
    txt = "Invoice INV-20481 approved for payment. Ref AP-000912."
    for k in range(1, len(txt) + 1, 6):
        s.append((mail_open(reply_text=txt[:k]), 0.6))
    s.append((mail_inbox(False, replied=True), 4))
    return s


def main() -> None:
    frames = script()
    tmp = Path(tempfile.mkdtemp(prefix="worklens-synth-"))
    n = 0
    for im, secs in frames:
        for _ in range(max(1, round(secs * FPS))):
            im.save(tmp / f"f{n:06d}.png")
            n += 1
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(tmp / "f%06d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", str(OUT),
        ],
        check=True,
    )
    shutil.rmtree(tmp)
    print(f"wrote {OUT} ({n / FPS:.0f}s, {n} frames)")


if __name__ == "__main__":
    main()

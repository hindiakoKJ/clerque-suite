"""Synthetic PH receipts for testing the reader end to end. Fictional stores."""
from PIL import Image, ImageDraw, ImageFont
import random, os

FONT = r"C:\Windows\Fonts\consola.ttf"
FONTB = r"C:\Windows\Fonts\consolab.ttf"

def thermal(lines, name, width=576, size=22, lh=30, jitter=True, rotate=0.6):
    h = lh * (len(lines) + 4)
    img = Image.new("RGB", (width, h), (250, 247, 240))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, size); fb = ImageFont.truetype(FONTB, size)
    y = lh
    for kind, text in lines:
        if kind == "c":  # centered
            w = d.textlength(text, font=fb); d.text(((width - w) / 2, y), text, font=fb, fill=(20, 20, 20))
        elif kind == "cb":
            w = d.textlength(text, font=fb); d.text(((width - w) / 2, y), text, font=fb, fill=(20, 20, 20))
        elif kind == "lr":  # left + right
            l, r = text
            d.text((28, y), l, font=f, fill=(25, 25, 25))
            w = d.textlength(r, font=f); d.text((width - 28 - w, y), r, font=f, fill=(25, 25, 25))
        elif kind == "sep":
            d.text((28, y), "-" * 40, font=f, fill=(90, 90, 90))
        else:
            d.text((28, y), text, font=f, fill=(25, 25, 25))
        y += lh
    # a little photo realism: slight rotation, noise, jpeg
    if jitter:
        img = img.rotate(rotate, resample=Image.BICUBIC, expand=True, fillcolor=(210, 205, 195))
        px = img.load()
        for _ in range(int(img.width * img.height * 0.004)):
            x = random.randrange(img.width); yy = random.randrange(img.height)
            r, g, b = px[x, yy]; k = random.randint(-30, 30); px[x, yy] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
    img.save(name, "JPEG", quality=82)
    print("wrote", name, img.size)

# 1. Supermarket till receipt: counts, one money column, a "2 @ 89.00" line, a weighed line, a supply, VAT block.
till = [
    ("c", "BAYAN MART SUPERMARKET"), ("c", "Naga City Branch"), ("c", "VAT REG TIN 000-111-222-000"),
    ("sep", ""), ("t", "OR#: 0001-0457821        09/26/2026 10:42"), ("t", "Cashier: 03   Terminal: 2"), ("sep", ""),
    ("lr", ("MAGNOLIA FRESH MILK 1L", "")), ("lr", ("  2 @ 89.00", "178.00")),
    ("lr", ("BROWN SUGAR 1KG", "62.00")),
    ("lr", ("CHICKEN BREAST", "")), ("lr", ("  1.250 kg @ 195.00/kg", "243.75")),
    ("lr", ("EGGS MEDIUM TRAY 30S", "255.00")),
    ("lr", ("NESTLE ALL PURPOSE CREAM 250ML", "")), ("lr", ("  3 @ 58.50", "175.50")),
    ("lr", ("TISSUE INTERFOLD 150 PULLS", "48.00")),
    ("lr", ("ZONROX BLEACH 1L", "69.00")),
    ("sep", ""), ("lr", ("SUBTOTAL", "1,031.25")), ("lr", ("VATABLE SALES", "920.76")), ("lr", ("VAT 12%", "110.49")),
    ("lr", ("TOTAL", "1,031.25")), ("lr", ("CASH", "1,100.00")), ("lr", ("CHANGE", "68.75")),
    ("sep", ""), ("c", "THIS SERVES AS YOUR OFFICIAL RECEIPT"), ("c", "Thank you, come again!"),
]
thermal(till, "till_receipt.jpg")

# 2. Wet market / handwritten-style supplier receipt with per-kilo prices.
market = [
    ("c", "ALING NENA'S MEAT & POULTRY"), ("c", "Naga Public Market Stall 14"), ("sep", ""),
    ("t", "Date: 9/27/2026"), ("t", "Sold to: Cafe Carolina"), ("sep", ""),
    ("lr", ("Pork Belly  2.5 kg x 320", "800.00")),
    ("lr", ("Chicken Wings  3 kg x 210", "630.00")),
    ("lr", ("Ground Pork  1.5 kg x 290", "435.00")),
    ("lr", ("Calamansi  1 kg", "80.00")),
    ("lr", ("Delivery", "50.00")),
    ("sep", ""), ("lr", ("TOTAL", "1,995.00")), ("t", "Received by: ____________"),
]
thermal(market, "market_receipt.jpg", rotate=-1.2)

# 3. Shopee-style order screenshot (phone).
def order_screen(name):
    W, H = 720, 1180
    img = Image.new("RGB", (W, H), (245, 245, 245)); d = ImageDraw.Draw(img)
    f = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 24); fb = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 26); fs = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 20)
    d.rectangle([0, 0, W, 70], fill=(238, 77, 45)); d.text((24, 20), "Order Details", font=fb, fill="white")
    d.rectangle([0, 80, W, 130], fill="white"); d.text((24, 95), "Completed  ·  Order ID 2609271AB3F7K9", font=fs, fill=(80, 80, 80))
    d.rectangle([0, 140, W, 200], fill="white"); d.text((24, 156), "Bico Barista Supplies Official", font=fb, fill=(30, 30, 30))
    y = 210
    items = [("Torani Hazelnut Syrup 750ml", "Variation: Hazelnut", 2, 385.00), ("Torani Vanilla Syrup 750ml", "Variation: Vanilla", 1, 385.00), ("Paper Hot Cup 12oz (50pcs)", "Variation: White, 50s", 4, 145.00)]
    for n, v, q, p in items:
        d.rectangle([0, y, W, y + 130], fill="white")
        d.rectangle([24, y + 18, 118, y + 112], fill=(220, 220, 220))
        d.text((140, y + 18), n, font=f, fill=(30, 30, 30)); d.text((140, y + 52), v, font=fs, fill=(120, 120, 120))
        d.text((140, y + 88), f"x{q}", font=fs, fill=(120, 120, 120))
        pt = f"₱{p:,.2f}"; w = d.textlength(pt, font=f); d.text((W - 24 - w, y + 88), pt, font=f, fill=(238, 77, 45))
        y += 140
    y += 10; d.rectangle([0, y, W, y + 260], fill="white")
    rows = [("Merchandise Subtotal", "₱1,735.00"), ("Shipping Fee", "₱85.00"), ("Shipping Discount", "-₱40.00"), ("Shop Voucher", "-₱100.00"), ("Order Total", "₱1,680.00")]
    yy = y + 16
    for l, r in rows:
        ff = fb if l == "Order Total" else f
        d.text((24, yy), l, font=ff, fill=(60, 60, 60)); w = d.textlength(r, font=ff); d.text((W - 24 - w, yy), r, font=ff, fill=(30, 30, 30) if l != "Order Total" else (238, 77, 45)); yy += 46
    y += 270; d.rectangle([0, y, W, y + 120], fill="white")
    d.text((24, y + 14), "Payment Method: GCash", font=fs, fill=(80, 80, 80)); d.text((24, y + 48), "Order Time: 09-27-2026 14:05", font=fs, fill=(80, 80, 80)); d.text((24, y + 82), "Payment Time: 09-27-2026 14:06", font=fs, fill=(80, 80, 80))
    img.save(name, "PNG"); print("wrote", name, img.size)
order_screen("shopee_order.png")

# 4. Supplier delivery receipt with no prices.
dr = [
    ("c", "SAN MIGUEL DAIRY DISTRIBUTORS INC."), ("c", "DELIVERY RECEIPT"), ("sep", ""),
    ("t", "DR No. 44871          Date: 09/28/2026"), ("t", "Deliver to: Cafe Carolina, Naga City"), ("sep", ""),
    ("t", "QTY    UNIT     DESCRIPTION"),
    ("t", "12     ctn      Fresh Milk 1L (12s)"), ("t", "6      btl      Whipping Cream 1L"), ("t", "2      pack     Mozzarella Cheese 2kg"),
    ("sep", ""), ("t", "Received the above goods in good order."), ("t", "Received by: ____________"),
]
thermal(dr, "delivery_receipt.jpg", rotate=0.3)

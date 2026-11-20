#!/usr/bin/env python3
"""Turns the captures from capture-samples.mjs into the files Annex A uses.

  python3 tools/assemble_samples.py <capture folder>

Writes the sample PDFs into Documentation/annex-a/samples and swaps the pictures in
Item-12 (12.9) and Item-13 (the printouts). Needs PyMuPDF, Pillow and python-docx.
"""
import copy, glob, os, sys
import fitz
from PIL import Image
from docx import Document
from docx.shared import Emu, Inches
from docx.text.paragraph import Paragraph

CAP = os.path.abspath(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
ANNEX = os.path.abspath(os.path.join(HERE, '..', '..', 'Documentation', 'annex-a'))
SAMPLES = os.path.join(ANNEX, 'samples'); TMP = os.path.join(CAP, 'pages'); os.makedirs(TMP, exist_ok=True)
PAGE_ZOOM = 2094 / 842          # landscape A4 at 2094 px wide, as the earlier samples were

def trim(im, pad=30):
    g = im.convert('L').point(lambda v: 255 if v > 245 else 0, mode='1').convert('L')
    bbox = Image.eval(g, lambda v: 255 - v).getbbox()
    return im.crop((0, 0, im.width, min(im.height, (bbox[3] + pad) if bbox else im.height)))

def slice_tall(im, max_h):
    """Cut a tall capture into pages at blank rows."""
    pages, y = [], 0
    g = im.convert('L')
    while y < im.height:
        end = min(y + max_h, im.height)
        if end < im.height:
            cut = end
            for yy in range(end, end - 260, -1):
                row = g.crop((0, yy, im.width, yy + 1)).getextrema()
                if row[0] > 247: cut = yy; break
            end = cut
        pages.append(im.crop((0, y, im.width, end)).copy()); y = end
    return pages

def pdf_from(pages, out, page_w, page_h):
    sheets = []
    for p in pages:
        s = Image.new('RGB', (page_w, page_h), 'white'); s.paste(p.convert('RGB'), ((page_w - p.width) // 2, 0)); sheets.append(s)
    sheets[0].save(out, 'PDF', resolution=page_w / (842 if page_w > page_h else 595) * 72, save_all=True, append_images=sheets[1:])

new = {}                                   # sample name -> list of page image paths
# 1. screen captures: tall png -> pages -> pdf
for f in sorted(glob.glob(os.path.join(CAP, 'png', '*.png'))):
    name = os.path.basename(f)[:-4]; im = Image.open(f).convert('RGB')
    if name.startswith(('10-', '11-')): continue          # Item 10 and 11 pictures are placed as they are, below
    portrait = name.startswith('12-')
    page_w, page_h = (im.width, int(im.width * 842 / 595)) if portrait else (im.width, int(im.width * 595 / 842))
    if portrait and page_h < im.height <= page_h * 1.35:        # an invoice a little taller than A4: shrink it onto one page
        im = im.resize((int(im.width * page_h / im.height), page_h), Image.LANCZOS)
    pages = slice_tall(im, 1300 if not portrait else page_h)
    paths = []
    for i, p in enumerate(pages, 1):
        q = os.path.join(TMP, f'{name}-{i}.png'); p.save(q); paths.append(q)
    pdf_from(pages, os.path.join(SAMPLES, name + '.pdf'), page_w, page_h); new[name] = paths
# 2. the system's own PDFs: copy, and rasterise each page for the Word files
for f in sorted(glob.glob(os.path.join(CAP, 'pdf', '*.pdf'))):
    name = os.path.basename(f)[:-4]; d = fitz.open(f); paths = []
    for i, pg in enumerate(d, 1):
        pm = pg.get_pixmap(matrix=fitz.Matrix(PAGE_ZOOM, PAGE_ZOOM)); im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples)
        im = trim(im); q = os.path.join(TMP, f'{name}-{i}.png'); im.save(q); paths.append(q)
    open(os.path.join(SAMPLES, name + '.pdf'), 'wb').write(open(f, 'rb').read()); new[name] = paths
print({k: len(v) for k, v in new.items()})

def swap_images(docx_path, only=None):
    d = Document(docx_path); body = list(d.element.body.iterchildren()); done = []
    for i, el in enumerate(body):
        if not el.tag.endswith('}p'): continue
        p = Paragraph(el, d); t = p.text.strip()
        if not t.startswith('Source file: samples/'): continue
        name = t[len('Source file: samples/'):].rstrip('.').replace('.pdf', '')
        if name not in new or (only and name not in only): continue
        olds = []; j = i - 1
        while j >= 0 and body[j].tag.endswith('}p') and 'pic:pic' in body[j].xml: olds.append(Paragraph(body[j], d)); j -= 1
        olds.reverse()
        if not olds: continue
        ext = olds[0]._p.xpath('.//wp:extent')[0]; w0, h0 = int(ext.get('cx')), int(ext.get('cy'))
        maxh = Inches(5.3) if (w0 / h0) > 1.0 else Inches(7.4)
        template = copy.deepcopy(olds[0]._p)
        for r in template.xpath('./w:r'): template.remove(r)
        anchor = p._p
        for path in new[name]:
            with Image.open(path) as im: aspect = im.width / im.height
            width = min(w0, int(maxh * aspect))
            np_ = copy.deepcopy(template); anchor.addprevious(np_)
            Paragraph(np_, p._parent).add_run().add_picture(path, width=Emu(width))
        for o in olds: o._p.getparent().remove(o._p)
        done.append(name)
    d.save(docx_path); return done

print('item 13:', swap_images(os.path.join(ANNEX, 'Item-13-Reports-Generated-by-the-System.docx')))
print('item 12:', swap_images(os.path.join(ANNEX, 'Item-12-Principal-and-Supplementary-Documents.docx')))


# --- Item 10 and Item 11: single pictures, replaced in place, in the order they appear in the Word file ---
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
def replace_pics(docx_path, mapping):
    d = Document(docx_path)
    pics = [el for el in d.element.body.iterchildren() if el.tag.endswith('}p') and 'pic:pic' in el.xml]
    for idx, path in mapping:
        el = pics[idx]; part = d.part.related_parts[el.xpath('.//a:blip')[0].get(RID)]
        part._blob = open(path, 'rb').read()
        with Image.open(path) as im: w, h = im.size
        for ext in el.xpath('.//wp:extent') + el.xpath('.//a:ext'):
            ext.set('cy', str(int(int(ext.get('cx')) * h / w)))
    d.save(docx_path)

def have(n): return os.path.join(CAP, 'png', n)
if os.path.exists(have('10-02-sidebar.png')):
    # 10.4 the footer of an electronic invoice, 10.5 the header of a report: cropped from the new samples
    inv = Image.open(have('12-01-electronic-invoice-standard.png')).convert('RGB')
    foot = inv.crop((int(inv.width * .065), inv.height - 475, int(inv.width * .935), inv.height - 105)); foot.save(os.path.join(CAP, '10-04-invoice-footer.png'))
    rep = Image.open(os.path.join(TMP, '13-01-sales-and-vat-summary-monthly-1.png')).convert('RGB')
    rep.crop((0, 0, rep.width, min(rep.height, 400))).save(os.path.join(CAP, '10-05-report-header.png'))
    for src, dst in [(have('10-02-sidebar.png'), '10-02-sidebar.png'), (have('10-03-terms-about-the-service.png'), '10-03-terms-about-the-service.png'),
                     (have('11-01-online-indicator.png'), '11-01-online-indicator.png'), (have('11-02-offline-indicator.png'), '11-02-offline-indicator.png'),
                     (have('11-03-offline-banner.png'), '11-03-offline-banner.png'),
                     (os.path.join(CAP, '10-04-invoice-footer.png'), '10-04-invoice-footer.png'), (os.path.join(CAP, '10-05-report-header.png'), '10-05-report-header.png')]:
        open(os.path.join(SAMPLES, dst), 'wb').write(open(src, 'rb').read())
    replace_pics(os.path.join(ANNEX, 'Item-10-Software-Name-and-Version-Screenshots.docx'),
                 [(1, have('10-02-sidebar.png')), (2, have('10-03-terms-about-the-service.png')), (3, os.path.join(CAP, '10-04-invoice-footer.png')), (4, os.path.join(CAP, '10-05-report-header.png'))])
    replace_pics(os.path.join(ANNEX, 'Item-11-Online-Offline-Indicator-Screenshots.docx'),
                 [(0, have('11-01-online-indicator.png')), (1, have('11-02-offline-indicator.png')), (2, have('11-03-offline-banner.png'))])
    print('items 10 and 11 pictures replaced')

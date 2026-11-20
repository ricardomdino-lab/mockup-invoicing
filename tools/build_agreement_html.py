#!/usr/bin/env python3
"""Turn the Client Service Agreement (Word) into js/agreement-text.js for the mockup.

The mockup builds each client's agreement from this text. Client details go in at the
{{tokens}} below, which agreement.js fills when it generates the document.

Run it again whenever the agreement changes:
    python3 tools/build_agreement_html.py [path/to/Client-Service-Agreement-DIS.docx]
"""
import html, json, re, sys, os
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'Documentation', 'client-agreement', 'Client-Service-Agreement-DIS.docx')
OUT = os.path.join(HERE, '..', 'js', 'agreement-text.js')

# Schedule A rows: the label starts with the key, the value cell becomes the token.
SCHEDULE_A = {
    'Client name': '{{name}}', 'Taxpayer Identification Number': '{{tin}}', 'Type of taxpayer': '{{type}}',
    'Registered address': '{{address}}', 'Authorized signatory': '{{signatory}}, {{position}}',
    'Contact person': '{{contact}}', 'Address for notices': '{{notice_address}}',
    'Plan (Section': '{{plan}}', 'Average monthly': '{{usage}}', 'Safety Deposit paid': '{{deposit}}',
    'Payment service provider': '{{provider}}', 'Bank or e-wallet account': '{{settlement}}',
}

def subst(text):
    text = text.replace('[NAME OF CLIENT]', '{{name}}')
    text = text.replace('[corporation / partnership / cooperative / sole proprietorship]', '{{type_lc}}')
    return text

def fill_blanks(text, tokens):
    it = iter(tokens)
    return re.sub(r'_{5,}', lambda m: '{{' + next(it) + '}}' if True else m.group(0), text, count=len(tokens))

def runs_html(p):
    out = []
    for r in p.runs:
        t = r.text
        if not t: continue
        t = html.escape(subst(t), quote=False)
        t = t.replace('\n', '<br>').replace('\t', '&emsp;')
        if r.bold: t = '<b>' + t + '</b>'
        if r.italic: t = '<i>' + t + '</i>'
        if r.underline: t = '<u>' + t + '</u>'
        out.append(t)
    return ''.join(out)

def para(p, flags):
    raw = p.text
    xml = p._p.xml
    pb = 'w:br w:type="page"' in xml or 'pageBreakBefore' in xml
    out = ''
    if pb: out += '<div class="pb"></div>'
    txt = subst(raw).strip()
    if not txt:
        return out + ('<p class="sp">&nbsp;</p>' if not pb else '')
    if p.style.name.startswith('Heading'):
        return out + '<h2>' + html.escape(txt, quote=False) + '</h2>'
    # the party and authorization paragraphs carry blanks the client's details fill
    h = runs_html(p)
    if txt.startswith('{{name}}, a {{type_lc}}'):
        h = fill_blanks(h, ['tin', 'address', 'signatory', 'position'])
    elif txt.startswith('We, {{name}}, with TIN'):
        h = fill_blanks(h, ['tin', 'signatory', 'position'])
    align = {1: 'c', 3: 'j'}.get(p.alignment, 'l')
    m = re.match(r'^((?:\d+\.\d+)|(?:\(\w\))|(?:\d+\.)|(?:[A-C]\.))(?:\t|&emsp;)(.*)$', h, re.S)
    if m and '\t' in raw[:8]:
        lvl = 'cl2' if m.group(1).startswith('(') or re.match(r'^\d+\.$', m.group(1)) else 'cl'
        return out + f'<p class="{lvl} {align}"><span class="n">{m.group(1)}</span><span class="t">{m.group(2)}</span></p>'
    return out + f'<p class="{align}">{h}</p>'

def table(tb):
    rows = []
    first = [c.text.strip() for c in tb.rows[0].cells]
    sched_a = first[:2] == ['Item', 'Details']
    branches = first[:1] == ['Branch code']
    notary = first[:1] == ['Name'] and 'Competent Evidence of Identity' in first
    sign = len(tb.columns) == 2 and len(tb.rows) == 1 and 'CLIENT' in tb.rows[0].cells[0].text
    for ri, row in enumerate(tb.rows):
        cells = []
        texts = [subst(c.text) for c in row.cells]
        if branches and ri > 0:
            if ri == 1: rows.append('{{branch_rows}}')
            continue
        if sched_a and ri > 0:
            for k, tok in SCHEDULE_A.items():
                if texts[0].startswith(k): texts[1] = tok
        if notary and ri == 1: texts[0] = '{{signatory}}'
        if sign and '{{name}}' in texts[0]:
            texts[0] = texts[0].replace('Name: ____________________________', 'Name: {{signatory}}').replace('Position: ____________________________', 'Position: {{position}}')
        tag = 'th' if ri == 0 and not sign else 'td'
        for t in texts:
            cells.append(f'<{tag}>' + html.escape(t, quote=False).replace('\n', '<br>') + f'</{tag}>')
        rows.append('<tr>' + ''.join(cells) + '</tr>')
    return f'<table class="{"sig" if sign else "grid"}">' + ''.join(rows) + '</table>'

def main():
    d = Document(SRC)
    out = []
    for el in d.element.body.iterchildren():
        tag = el.tag.split('}')[1]
        if tag == 'p': out.append(para(Paragraph(el, d), {}))
        elif tag == 'tbl': out.append(table(Table(el, d)))
    body = '\n'.join(out)
    # tidy: collapse runs of spacer paragraphs
    body = re.sub(r'(<p class="sp">&nbsp;</p>\s*){2,}', '<p class="sp">&nbsp;</p>', body)
    version = re.search(r'version (\d+\.\d+)', ''.join(s.footer.paragraphs[0].text for s in d.sections) or '')
    payload = {'version': version.group(1) if version else '1.0', 'html': body}
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('/* Generated by tools/build_agreement_html.py from the Client Service Agreement. Do not edit by hand. */\n')
        f.write('const CSA = ' + json.dumps(payload, ensure_ascii=False) + ';\n')
    tokens = sorted(set(re.findall(r'\{\{(\w+)\}\}', body)))
    print('wrote', OUT, len(body), 'chars; version', payload['version'], '; tokens:', ', '.join(tokens))

main()

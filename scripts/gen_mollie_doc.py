from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable)

OUT = "/app/Dynotech_Business_Model_Mollie.pdf"
styles = getSampleStyleSheet()
H = ParagraphStyle('H', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=16, spaceAfter=4, textColor=colors.HexColor('#15324f'))
SUB = ParagraphStyle('SUB', parent=styles['Normal'], fontSize=9.5, textColor=colors.HexColor('#666666'), spaceAfter=10)
H2 = ParagraphStyle('H2', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=12, spaceBefore=12, spaceAfter=5, textColor=colors.HexColor('#15324f'))
P = ParagraphStyle('P', parent=styles['Normal'], fontSize=10, leading=15, spaceAfter=6)
LI = ParagraphStyle('LI', parent=P, leftIndent=12, spaceAfter=3)
KEY = ParagraphStyle('KEY', parent=P, backColor=colors.HexColor('#eef4fb'), borderPadding=6, spaceBefore=4)
CELL = ParagraphStyle('CELL', parent=styles['Normal'], fontSize=9, leading=12)

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=16*mm,
                        title="Business Model Description - Dynotech Innovations, Lda", author="Dynotech Innovations, Lda")
S = []

def para(t, s=P): S.append(Paragraph(t, s))
def gap(h=4): S.append(Spacer(1, h))

para("Business Model Description", H)
para("Dynotech Innovations, Lda &nbsp;&bull;&nbsp; Prepared for Mollie account review", SUB)
S.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor('#c9d7e6')))
gap(8)

para("1. Company and corporate structure", H2)
info = [
    ("Legal entity", "Dynotech Innovations, Lda"),
    ("Legal form", "Sociedade por Quotas (private limited liability company)"),
    ("NIF / NIPC (Portuguese VAT)", "518713130 (PT518713130)"),
    ("Registered office", "Rua Aquilino Ribeiro, 255, 1.\u00ba Esq.\u00ba, 2870-047 Montijo, Set\u00fabal, Portugal"),
    ("Commercial registry", "Conservat\u00f3ria do Registo Comercial de Set\u00fabal"),
    ("Incorporated", "April 2025"),
    ("Share capital", "\u20ac50,000"),
    ("Principal activity", "CAE 62100 \u2013 computer programming activities (software design, development, testing and maintenance; web development; database services)"),
]
rows = [[Paragraph(f"<b>{k}</b>", CELL), Paragraph(v, CELL)] for k, v in info]
t = Table(rows, colWidths=[52*mm, 118*mm])
t.setStyle(TableStyle([
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#dce5ef')),
    ('BACKGROUND', (0,0), (0,-1), colors.HexColor('#f4f8fc')),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ('TOPPADDING', (0,0), (-1,-1), 4), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
S.append(t)
gap(8)
para("Dynotech Innovations, Lda is the single legal company that owns and operates the business. "
     "It trades online through two product brands (trading names) \u2013 not separate companies:", P)

brand_rows = [
    [Paragraph("<b>Brand</b>", CELL), Paragraph("<b>Website</b>", CELL), Paragraph("<b>What it is</b>", CELL)],
    [Paragraph("<b>JujuCloud</b>", CELL), Paragraph("jujucloud.com", CELL),
     Paragraph("Dynotech's software / cloud brand \u2013 cloud software, web and application development and SaaS tools, in line with the company's registered activity (CAE 62100). This is the website currently on the Mollie profile.", CELL)],
    [Paragraph("<b>CloudIVR</b>", CELL), Paragraph("cloudivr.net", CELL),
     Paragraph("Dynotech's cloud-telephony brand: virtual numbers, IVR, calling, SMS and eSIM. Being added to the same Mollie profile so its customers can pay by card.", CELL)],
]
bt = Table(brand_rows, colWidths=[28*mm, 32*mm, 110*mm])
bt.setStyle(TableStyle([
    ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#dce5ef')),
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#eef4fb')),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ('TOPPADDING', (0,0), (-1,-1), 4), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
S.append(bt)
gap(8)
para("<b>Key point:</b> JujuCloud and CloudIVR are both brands of the same company, Dynotech Innovations, Lda. "
     "The Mollie contract, settlements and bank account all belong to Dynotech. We are adding cloudivr.net as an "
     "additional registered website / domain on the existing Dynotech (JujuCloud) profile.", KEY)

para("2. Products and services", H2)
para("\u2022 &nbsp;<b>JujuCloud</b> \u2013 cloud software, web and application development, and SaaS tools.", LI)
para("\u2022 &nbsp;<b>CloudIVR</b> \u2013 a cloud-communications (CPaaS) service: virtual phone numbers, cloud IVR / "
     "auto-attendant, SIP softphone, call forwarding, voicemail-to-text, AI receptionist and voice agents, business "
     "and bulk SMS, and eSIM / mobile data, plus add-ons (extra lines, recording, custom caller ID).", LI)
para("All services are delivered digitally online; no physical goods are shipped.", P)

para("3. How we make a profit (revenue model)", H2)
para("Dynotech earns revenue from subscriptions, direct purchases and prepaid usage:", P)
para("1. &nbsp;<b>Recurring fees</b> \u2013 monthly rental of phone numbers and tiered plan subscriptions.", LI)
para("2. &nbsp;<b>Direct purchases</b> \u2013 customers pay directly for a specific service at checkout (e.g. buying "
     "or renewing a number, upgrading a plan, buying an eSIM data bundle or an add-on).", LI)
para("3. &nbsp;<b>Prepaid usage</b> \u2013 customers can also top up a wallet balance that is then drawn down by "
     "calling, SMS and other per-minute / per-message usage.", LI)
para("Profit comes from the margin between the wholesale rates we pay our carriers / suppliers and the retail rates "
     "we charge, plus recurring subscription and rental income.", P)
para("<b>Mollie's role:</b> Mollie processes customer card / PayPal / local-method payments in two ways \u2013 "
     "(a) direct payment for a chosen service at checkout, and (b) prepaid wallet top-ups that the customer later "
     "spends. In both cases the customer receives a digital service that is provisioned immediately (a number, plan, "
     "eSIM or account credit), so there is no shipping or delivery delay and dispute / chargeback exposure is low.", P)

para("4. Target markets", H2)
para("Small and medium businesses, entrepreneurs, freelancers and remote teams, travellers / digital nomads (eSIM), "
     "and resellers \u2013 with primarily North American phone numbers and customers worldwide. Payments are accepted "
     "in EUR, USD and other Mollie-supported methods.", P)

para("5. Expected expenses", H2)
para("\u2022 &nbsp;<b>Wholesale telecom costs</b> \u2013 per-minute voice and per-message SMS fees to licensed "
     "carriers (largest variable cost).", LI)
para("\u2022 &nbsp;<b>Number inventory &amp; provisioning</b>, <b>eSIM wholesale</b>, <b>cloud / server "
     "infrastructure</b>, <b>payment-processing fees</b>, <b>third-party / AI APIs</b>, <b>staff &amp; support</b>, "
     "<b>compliance</b> (number / caller-ID registration, KYC/AML), and <b>marketing</b>.", LI)

para("6. Risk, compliance and refunds", H2)
para("KYC on accounts and number purchases; automated AI and rule-based anti-spam / anti-scam screening of outbound "
     "calls and SMS with staff review and the ability to hold or block; usage / velocity limits; immediate digital "
     "provisioning; a published refund policy on our websites (cloudivr.net / jujucloud.com); and auditable "
     "reconciliation of any dispute against order and usage records.", P)

para("7. Summary", H2)
para("Dynotech Innovations, Lda (NIF 518713130, Montijo, Portugal) is a software and communications company operating "
     "two online brands \u2013 JujuCloud (software / cloud) and CloudIVR (cloud telephony, messaging and eSIM). "
     "Revenue comes from subscriptions, direct service purchases and prepaid usage, and Mollie processes both direct "
     "payments and wallet top-ups by card. We are adding cloudivr.net as a registered domain of the existing Dynotech "
     "profile so CloudIVR customers can pay by card.", P)

gap(6)
S.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor('#c9d7e6')))
gap(6)
para("<b>Contact for this review:</b> Richard Adebayo &nbsp;&bull;&nbsp; richard@dyno.pt &nbsp;&bull;&nbsp; +351 918 251 893", P)

doc.build(S)
print("WROTE", OUT)

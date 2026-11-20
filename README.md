<<<<<<< HEAD
# Electronic Invoicing System — Mockup

Eastland Printink, Inc. (EPI). Demonstration mockup for BIR e-invoicing under
RR No. 11-2025, as amended by RR No. 26-2025. Compliance deadline **31 December 2026**.

All companies, people, TINs and addresses are fictional.

---

## Running it

Open `index.html` directly in a browser. No server, no build step, no network.
Data persists in `localStorage`.

To restore the original demo data: **user menu → Reset demo data**.
Do this after any change to `js/seed.js`, or the browser keeps the old seed.

---

## Screens

11 tabs across 5 nav sections, plus onboarding and public verification outside the
rail. Nothing is locked or phase-gated — every screen below is built.

| Section | Screen | Purpose |
|---|---|---|
| Overview | Home Dashboard | Live issuance feed, exceptions, headline figures |
| Invoicing | Invoices | Search, filter, invoice detail, structured payload, CSV export, plus a Sent to BIR tab for BIR status per invoice |
| | Bulk Import | CSV import, one row per line item, all-or-nothing per file |
| | Cancellations | Cancel an invoice, reason codes, approval queue |
| | Buyer Copies | Delivery status per invoice, retry, redirect address |
| | Connections | Connections, stores linked to a TIN, "Simulate incoming order" |
| Compliance | Reports | Sales and VAT summary, daily closing (X/Z readings), sales lists, number check |
| Configuration | Invoice Template | Document branding and layout preview |
| Administration | Account Management | Users, invitations, roles |
| | Activity Logs | Full audit trail, including break-glass access |
| | Settings | Tax profile, series, branding, connection method |

The Client Service Agreement is generated for each client from `js/agreement-text.js`, which `tools/build_agreement_html.py` builds from the Word file in `Documentation/client-agreement`. Run it again after the agreement changes.

The Annex A samples are regenerated from the running mockup, all from the current day's data. Needs the dev server on port 8765 and the Chromium that Playwright caches. `node tools/capture-samples.mjs <folder>` captures the reports, the EPI invoices and the data files (signed in as EPI's owner). `node tools/capture-rest.mjs <other folder>` replays the demonstration stories: the four statutory-discount invoices, an EPI service interruption with queued receipts and a manual invoice, the evidence, certificate and incident report, the operator screens, and the Item 10 and 11 screenshots. Copy the second folder's `png`, `pdf` and `html` into the first, then run `python3 tools/assemble_samples.py <first folder>`, which writes the PDFs to `Documentation/annex-a/samples` and swaps the pictures in items 10 to 13. Copy the data files from `<first folder>/files` and the HTML from `html` into the samples folder.

**The demo data stays current.** `app.js` rebuilds the data when the day changes, when the schema changes, or when it is more than three hours old at the moment the demo is opened (`App.MAX_AGE_HOURS`). A page left open past midnight refreshes itself. Today's documents are included up to the current hour, in Philippine time. A demo in progress is never wiped by the age rule, only by a new day.

Onboarding (10-step wizard, both lanes) and the public verification page sit outside
the rail — reached from signup and from a document's QR code respectively.

---

## Wording glossary

On-screen text is written for client staff in plain words. Full list and reasons: `Documentation/17-wording-review-plain-language.md`.

| Say | Not |
|---|---|
| Invoices (screen), invoice | Document Register, document |
| Cancellations, Cancel an invoice | Corrections, Cancel a document |
| Buyer Copies | Buyer Copy Delivery |
| Connections, Stores and TINs | Platforms and Sellers, Seller identities |
| Reports, Daily closing (Z reading), Number check | Reports & Readings, Readings, Series check |
| Sent to BIR, Waiting, Not sent, Acknowledged | Transmission, Queued, Not Ready |
| Waiting sales | Queued receipts |
| Invoice numbers, First number, Last number | Invoice series, Series start |
| Activation review, Activate account, Active | Go-live review, Approve go-live, Live |
| Confirm (the tax profile) | Attest |
| Fees taken from payments, Paid to you, next banking day | Fees deducted in real time, Settled to you, T+1 |
| Figures match | Ties |

Rules: use "invoice" for an invoice, "sent to the BIR" instead of "transmitted", no ampersands in names, no legal citations in help text (they stay in the Annex, the agreement and the invoice notice), and Enter, Select, Upload, Confirm as the verbs. BIR terms stay: Permit to Issue, Permit to Transmit, TIN, RDO, VATable, Acknowledged.

## Invoice entry — no manual path

**There is no "type in an invoice" screen anywhere in the system, by design.** Every
document originates from a system event:

- **Bulk Import** — a CSV of sales, one row per line item, grouped into documents by
  a reference the sender controls. The whole file validates before anything writes;
  rejected groups never enter the series.
- **Connections → Simulate incoming order** — stands in for what a live API or
  marketplace connector does unattended: picks a linked seller identity, builds a
  line-item invoice, allocates a real series number, and issues it with the
  connector's name recorded as `issuedBy` — never a person's name. A paused
  connection holds the order instead of issuing; a suspended or unlinked seller
  identity does the same rather than guessing a TIN.

The **Issue** permission (Owner, Supervisor, Issuer) now gates exactly those two
surfaces — committing a Bulk Import file, and the simulate-order button. An Issuer
on a tenant with no connection method configured has nothing to exercise it on.

---

## What the screens deliver

**Onboarding wizard, both lanes.** Lane routing, sign up, Form 2303 upload
with simulated verification (including a rejection path), tax profile with attestation,
branch mapping, the agreement (downloaded early, because signing in ink and notarizing take days; the signed copy is uploaded at Activation), series configuration, connection method, sandbox testing, status
tracker, activation.

Three gates block progress and are marked `GATE` in the step list:

1. **COR verification** — a person at EPI checks Form 2303. Self-declared VAT status is
   what produces wrong invoices at scale, and since the system computes VAT, that error
   would be EPI's.
2. **Tax profile attestation** — the taxpayer's authorized representative attests. This
   places responsibility for tax status with the taxpayer.
3. **Sandbox testing** — never skipped. Accreditation reviewers ask about it.

The **express lane skips branch mapping** and goes live automatically. The **enterprise
lane** adds branch mapping with per-branch RDO and a reviewed activation.

**Settings** — the registration outcome lives here, not on a separate page: captured
2303 details, attested tax profile, series ledger (one running series for the taxpayer) with issued and retired
counts, connection method, and compliance position.

**Session model** — five roles with progressive disclosure, a demo tenant switcher,
and a role switcher.

---

## Invoicing screens

**Invoices.** The full list with search, branch, type, status, transmission and date
filters, plus CSV export carrying the whole tax breakdown. Branch-scoped roles see only
their own branch, and that holds for a direct link to a document, not just the list.

**Document detail.** Our own e-invoice design (see below) alongside a lifecycle timeline
(issued → buyer copy → BIR transmission), series position, the immutability statement,
linked correction documents, the structured payload that would be transmitted, and the
audit trail. Printing renders into a hidden iframe rather than a pop-up, so no blocker
intervenes.

**Bulk Import.** CSV, one row per line item, grouped into documents by a reference the
sender controls. The whole file is validated before anything is written; accepted groups
import and rejected ones are reported with the reason. Rejected groups **never enter the
series**. The sample file carries three deliberate faults so both paths are visible. A row
whose treatment contradicts the attested tax profile is rejected by name.

---

## Cancellations, buyer copies, sending to the BIR, reports

**Cancellations.** One instrument, Cancel, never a "modify invoice" screen. The right
invoice is then issued as a new document. Credit and debit notes are not part of the
system. Every cancellation carries a mandatory reason code and free-text note. Owner and Supervisor act immediately; Issuer and Finance can only *request*, and
the request queues for someone else to decide — the roles that can approve never create
a pending one. Cancel is blocked outright once a document is marked paid. A cancellation can only be raised against a document whose
retention state is **Live** (see Retention below) — a cold-archive
document is preserved as filed, not reopened.

**Buyer Copies.** Delivery is tracked as its own lifecycle, separate from
issuance — email PDF, email body, in-app, or SMS link, with retry and a logged trail for
any redirected delivery address. A delivery failure never invalidates the invoice; it
raises an exception for follow-up. Retry and address changes are disabled once a document
leaves the Live retention state, same as Corrections.

**Sent to BIR.** Every invoice has a send-by date: the sale date plus 3 calendar days, the BIR's limit. An invoice still waiting after it is flagged "Past the limit" on the tab, in the account health check and in the operator alerts, and is counted in the service levels and the evidence report. A second tab on Invoices (not its own nav item — the two
screens overlap too much on the same document set to justify separate destinations).
Per-document BIR transmission status — queued, acknowledged, rejected, retried —
against a simulated endpoint, since electronic sales reporting itself is dormant under
RR 26-2025 pending BIR standing up a receiving system. The product stays
transmission-*ready*, which is what RR 11-2025 Sec. 3(A) requires to qualify as an
electronic invoice at all.

**Reports.** A periodic VAT/sales summary built on the shared reporting
engine, plus X/Z cash-register-style readings per branch and day with a running grand
total that never resets — the Z-sequence is its own gapless integrity proof, the same
role a series-number gap plays for invoices.

**Connections.** Connected sources (ERP/API, bulk file, marketplace connector)
tracked separately from seller identities — which TIN a given store's sales are issued
under. **Simulate incoming order** on this screen is the mockup's stand-in for an
unattended connector firing (see Invoice entry above).

---

## Retention

Every document carries a retention state, independent of whether the account is still
active: **Live** (full record, correctable) → **Cold Archive** at 5 years (still stored
in full, still retrievable, no longer correctable). Nothing is redacted, archived out or
removed automatically: records are kept until the BIR confirms in writing that migration
to its systems is complete (RMC 110-2026 VIII.4). EPI keeps that confirmation in its own files, not in the system. A
legal hold keeps records even after it.

Two BMC invoices in the seed are deliberately backdated (7 and 11 years) to make both
states reachable without waiting for real time to pass — BMC only went live on this
system in March 2026, so nothing it has genuinely issued is old enough on its own. The
seed comment says so; they are staged demo data, not real history.

---

## The invoice document

Designed for EPI. The three reference mockups were used as a starting point for what a
Philippine e-invoice needs to carry, and nothing else — no third-party layout, branding, or
company name appears anywhere.

Content follows Sec. 237 as amended by RA 11976: seller registered and trade name, TIN with
branch code, registered address, VAT status and accreditation number; buyer name, TIN and
address; document number, date and time; per-line description, SKU, quantity, unit, unit
price and amount with treatment tags; the tax summary; amount in words; the `VAT-EXEMPT
SALE` and `ZERO-RATED SALE` stamps where they apply; a verification QR and code; and the
authorized representative.

**Deliberately absent: "valid for five (5) years from the date of issuance."** Both
reference mockups carry that line. It was Authority-to-Print validity, which EOPT removed.
Invoices do not expire, and reprinting a dead rule onto a new system's output would be a
visible error at accreditation.

The accreditation number on the face is illustrative — the program has not opened. The
detail page says so in as many words rather than leaving the claim unqualified.

---

## Tax engine

Verified against 92 assertions across two harnesses covering VAT derivation, mixed
breakdowns, discount handling, SC/PWD, amount-in-words, the role matrix, and the integrity
of the seeded series.

**Inclusive-and-derive.** The Price Tag Law (Art. 81, RA 7394; DTI JAO 22-01 for digital
platforms) requires consumer prices to include VAT. RMC 77-2024 requires the invoice to
show VAT as a separate item. So prices are captured VAT-inclusive and the components
derived:

```
VATable Sales = Inclusive ÷ 1.12
VAT           = Inclusive − VATable Sales
```

Every line carries a treatment tag — **VATable**, **VAT-Exempt** (Sec. 109), or
**Zero-Rated**. Mixed invoices break down per treatment as RMC 77-2024 requires, and
exempt and zero-rated lines pass through untouched. Trade discounts reduce the VATable
base before VAT is derived.

The figures form a ladder that reconciles exactly, and every screen and the document face
render the same ladder:

```
gross − discount  = netSales = vatableSales + vat + exempt + zero
netSales − scDiscount = totalDue
```

### SC/PWD

RA 9994 and RA 10754 make a qualified sale to a senior citizen or a person with disability
**exempt from VAT**, with the 20% discount taken on the **VAT-exempt** price. Taking 20% off
the VAT-inclusive price is the common error and it overcharges the seller's output tax.

So an eligible VATable line has its VAT stripped, moves into the exempt bucket, and is then
discounted. Eligibility is **per line** — not everything a senior buys qualifies, and export
sales never do. The seeded Baguio invoice exercises all three cases at once: bond paper
(VATable, not covered), a maintenance drug (already exempt under Sec. 109, covered), and
vitamins (VATable, covered, so VAT comes off).

### Withholding tax (EWT)

Where the invoice carries an `ewtRate` — the buyer is a designated withholding agent —
EWT is computed on the sale **net of VAT** (RR 2-98 as amended):

```
ewtBase   = totalDue − vat
ewtAmount = ewtBase × ewtRate
netCollectible = totalDue − ewtAmount
```

`totalDue` — the legally required "TOTAL AMOUNT DUE" — never moves. The document face
shows the deduction and `netCollectible` in a separate block below the tax summary, with
a note that proof of remittance arrives on BIR Form 2307. Two seeded BMC invoices carry
a 1% rate to exercise it.

---

## Series rules

Format `{PREFIX}-{BRANCH}-{YYYY}-{NNNNNN}`, e.g. `BMC-000-2026-000141`.

- Scoped **per taxpayer per branch** — each branch runs an independent sequence
- Gapless, verified in the seed
- Numbers allocated **only after validation passes**, so a rejected payload consumes nothing
- Cancelled numbers **retired permanently**, never reused
- A **new series** starts under the EPI system; existing manual or CAS numbering is not continued

---

## Demo data

| Business | Purpose |
|---|---|
| **Eastland Printink, Inc. (EPI)** | The sample company the demonstration issues from. The provider is also a taxpayer: it prints for business buyers and invoices its clients for the System, so one account carries both, used by different people (President, Accounting Manager, Sales Supervisor, a Printing Sales Coordinator, a Billing Specialist who issues the System invoices, an external CPA). One branch, the Main Office in Valenzuela. It is flagged `isProvider`: no plan, deposit or agreement, no monthly bill, and it is not listed as a client in the admin console. Its monthly System invoices to clients are documents of this account (`providerBilling`, `clientId` = the client), so they appear in its register and reports. |
| **Bayanihan Mercantile Corp.** | Enterprise lane. LTS large taxpayer, 4 branches across 4 RDOs. Carries VATable, VAT-exempt and zero-rated lines, credit sales, one cancelled invoice, one delivery failure, one transmission failure, two EWT invoices (1% rate), two backdated retention-exercise invoices (7 and 11 years old, both in the cold archive with the buyer shown in full). |
| **Juana's Online Finds** | Express lane. MSME single-branch e-commerce seller, bulk-import connection. |

**EIS Certification.** The Permit to Issue card in Settings shows the date on the client's PTI and its EIS Certification: due 6 months after the PTI (RMC 98-2026 IV.15), recorded by the owner once the BIR certifies. Client Accounts shows the status, and Operations alerts when it is due within 30 days or overdue. The sandbox step in setup is EPI's own test, not the BIR's.

**EPI system administration.** The demo accounts list has a separate group for EPI's own staff (Operations, Support, Technical, Security, Compliance, Data protection). Signing in as one of them opens the operator console: all client accounts, an **Onboarding** screen (`js/ops-onboarding.js`) that tracks every application through five stages (EPI review, account setup, agreement and deposit, go-live review, live) and shows whose turn each one is, incidents, service status, BIR requests, and EPI Billing with invoices, safety deposits, real-time fees and **Provider settlement** (`js/provider-settlement.js`). EPI's own paperwork for the BIR (notices, certificate review, material changes, disclosures, continuity tests, evidence, orders) is a checklist in `Documentation/18-compliance-register.md`, not a screen. The Terms page shows the accreditation numbers and the approved hosting parties. The Provider settlement tab reconciles each payment service provider day by day: fee deducted against fee received, with matched, awaiting, short and not-received batches, and a way to record a remittance, follow up, or bill the affected clients in their monthly statement. The go-live review also confirms the client's payment provider and settlement account. EPI Billing's sales summary and BIR reporting count every invoice EPI issues, printing and System fees together.

Four further taxpayers (Sigla Health Supplies, Pilipinas Export Trading, MetroRide
Mobility, TindaHub Philippines) exist as background records for reports and monitoring
screens, without portals of their own.

**Roles** — Owner (org), Supervisor (branch), Issuer (branch), Finance (org),
Auditor (org, read-only). Branch-scoped roles cannot see other branches' invoices.

---

## Architecture

```
index.html
css/  main.css          theme, layout, shells
      components.css    cards, buttons, forms, tables, badges, modals
      invoice.css       the document face + print rules
js/   core.js           storage, status vocabulary, tax engine, retention, helpers
      local-api.js      $.ajax interceptor — routes calls to LocalAPI handlers
      for_all.js        helpers shared across every screen
      seed.js           fictional demo data + series ledger rebuild
      auth.js           session, login, tenant/role switching, branch scoping
      navigation.js     rail, routing, role visibility
      reporting.js      shared period/reporting engine + export modal
      onboarding.js     the 10-step wizard
      invoice-doc.js    the document renderer, print sheet, correction reason labels
      home.js           Home Dashboard
      invoices.js       Invoices, invoice detail, payload, CSV export
      activity.js       Activity Logs
      accounts.js       Account Management — users, invitations, roles
      settings.js       Settings — tax profile, series, branding, connection method
      import.js         Bulk Import: parse, validate, commit
      template.js       Invoice Template
      verify.js         public verification page
      reports.js        Reports
      platforms.js      Connections, incl. Simulate incoming order
      corrections.js    Cancellations: cancel, approval queue
      delivery.js       Buyer Copies
      transmission.js   Sent to BIR (second tab of Invoices)
      session.js        session control
      activate.js       invite activation
      app.js            bootstrap
```

Vanilla JS, no framework, no build. Script order in `index.html` is fixed —
`core.js` must load first, and `navigation.js` before anything that extends `Views`.

**Conventions worth keeping.**

- Status labels and badge colors are defined once in `core.js` (`STATUS`) and reused
  everywhere.
- Nav visibility is computed **per item**, never inherited from a section — sections are
  presentational only.
- `CU`/`CT` go stale after any status-changing action, so `refreshSession()` runs on every
  view switch.
- **Views are keyed by nav id.** `Nav.go(id, opts)` looks up `Views[id]` and falls through
  to the placeholder when it does not exist yet, so adding a screen is one function and one
  `built` flip in `navigation.js` — never a new branch in a switch.
- Screens that take a parameter (the document detail) read it from `opts`, so the rail stays
  highlighted on the parent item and the browser never sees a separate route.
- Forms repaint **partially** where live derivation matters — Invoice Template's live preview
  repaints just the sheet as each control is changed, so nothing steals focus mid-edit.
  Whole-page re-renders are reserved for structural changes the user triggered with a button.

---

## Known gaps

- Automated issuance is attributed to a **named integration credential**, not a person —
  the audit trail must read "Bayanihan ERP connector · credential #3", never "the API".
- EPI-side staff views (support tiers, break-glass, compliance officer) are **deferred**.
  One seeded activity entry shows a break-glass access appearing in the customer's own
  log, which is the control that matters.
- Transmission is simulated. RR 26-2025 leaves electronic sales reporting **dormant**
  pending BIR system establishment and separate regulations — the product is
  transmission-*ready*, which is what RR 11-2025 Sec. 3(A) requires.
- The structured payload's field names are placeholders. They will be replaced wholesale
  once BIR publishes a schema — which is why the payload is generated from the record at
  render time rather than stored.
- The verification QR is a deterministic pattern, not a scannable code — the public
  verification page it points at (`verify.js`) is built, but a real QR needs a scanning
  library this mockup doesn't pull in.
- Still unbuilt: the BIR monitoring module, Collection Receipt / Billing Invoice, foreign
  NRDSP onboarding, multi-currency, series year rollover.

**Invoice form.** Every invoice, client and EPI, prints on one form (`InvoiceDoc.render` in `js/invoice-doc.js`, styles under `.invform` in `css/invoice.css`), laid out as the sample in `Documentation/service-invoice-sample/` and described in `Documentation/02-invoice-specification.md`. The landing page picture is made from the real renderer with `node tools/landing-invoice.mjs img/hero-invoice.png`.
=======
# mockup-invoicing
>>>>>>> b10fd977841c4d659807f0d82446674dabe3b99d

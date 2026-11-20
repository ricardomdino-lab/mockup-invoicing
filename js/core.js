/* ============================================================
   core.js — state, storage, status vocabulary, tax engine, helpers
   Loaded first. Everything else depends on this.
   ============================================================ */

const DB_KEY = 'epi_eis_mockup_v1';

/* ---------- Storage ---------- */
const Store = {
  _cache: null,
  load(){
    if (this._cache) return this._cache;
    try{
      const raw = localStorage.getItem(DB_KEY);
      this._cache = raw ? JSON.parse(raw) : null;
    }catch(e){ this._cache = null; }
    return this._cache;
  },
  save(db){
    this._cache = db;
    try{ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch(e){ console.warn('localStorage write failed', e); }
  },
  clear(){
    this._cache = null;
    try{ localStorage.removeItem(DB_KEY); }catch(e){}
  },
  get db(){ return this.load(); }
};

/* ---------- Status vocabulary (defined ONCE, reused everywhere) ---------- */
const STATUS = {
  /* Document state */
  doc: {
    DRAFT:            { label:'Draft',            badge:'lbadge-gray'   },
    ISSUED:           { label:'Issued',           badge:'lbadge-blue'   },
    CANCELLED:        { label:'Cancelled',        badge:'lbadge-red'    }
  },
  /* Buyer delivery */
  delivery: {
    PENDING:   { label:'Pending',   badge:'lbadge-gray'  },
    DELIVERED: { label:'Delivered', badge:'lbadge-green' },
    FAILED:    { label:'Failed',    badge:'lbadge-red'   }
  },
  /* BIR transmission */
  transmission: {
    NOT_READY:   { label:'Not sent',   badge:'lbadge-gray'  },
    QUEUED:      { label:'Waiting',          badge:'lbadge-amber' },
    TRANSMITTED: { label:'Acknowledged',badge:'lbadge-green' },
    REJECTED:    { label:'Rejected',    badge:'lbadge-red'   },
    FAILED:      { label:'Failed',      badge:'lbadge-red'   }
  },
  /* User accounts. An account that has been created but not yet activated by
     its own holder is invited, not active — nobody may sign in as it. */
  user: {
    ACTIVE:   { label:'Active',   badge:'lbadge-green' },
    INVITED:  { label:'Invited',  badge:'lbadge-amber' },
    DISABLED: { label:'Disabled', badge:'lbadge-gray'  }
  },
  /* A connected source of sales — an ERP, a storefront, a marketplace.
     Paused and revoked are deliberately not the same badge: one is a decision
     you can take back this afternoon, the other is a key that no longer
     exists. */
  connection: {
    CONNECTED: { label:'Connected', badge:'lbadge-green' },
    PAUSED:    { label:'Paused',    badge:'lbadge-amber' },
    REVOKED:   { label:'Revoked',   badge:'lbadge-gray'  }
  },
  /* A seller identity as the platform knows it. Unlinked means we have been
     told about a store but not whose registration it issues under, which is
     the one state in this system where sales are held rather than issued. */
  seller: {
    LINKED:    { label:'Linked',    badge:'lbadge-green' },
    UNLINKED:  { label:'Unlinked',  badge:'lbadge-red'   },
    SUSPENDED: { label:'Suspended', badge:'lbadge-gray'  }
  },
  /* Correction requests */
  correction: {
    PENDING:  { label:'Pending Approval', badge:'lbadge-amber' },
    APPROVED: { label:'Approved',         badge:'lbadge-green' },
    REJECTED: { label:'Rejected',         badge:'lbadge-red'   }
  },
  /* Tenant onboarding */
  onboarding: {
    DRAFT:                { label:'Draft',                badge:'lbadge-gray'   },
    PENDING_VERIFICATION: { label:'Pending Verification', badge:'lbadge-amber'  },
    VERIFIED:             { label:'Verified',             badge:'lbadge-blue'   },
    REJECTED:             { label:'Rejected',             badge:'lbadge-red'    },
    SANDBOX:              { label:'Sandbox Testing',      badge:'lbadge-violet' },
    LIVE:                 { label:'Active',                 badge:'lbadge-green'  }
  },
  /* How long this account still holds the document, and what is left of it.
     Sec. 235 NIRC sets the floor; retentionState() below moves a record to the cold archive after five years.
     Nothing is redacted or removed (RMC 110-2026 VIII.4). */
  retention: {
    LIVE:     { label:'Online',         badge:'lbadge-green' },
    ARCHIVED: { label:'Cold Archive',   badge:'lbadge-gray'  }
  }
};

function badge(group, key){
  const s = (STATUS[group] || {})[key];
  if (!s) return `<span class="lbadge lbadge-gray">${key || '—'}</span>`;
  return `<span class="lbadge ${s.badge} lbadge-dot">${s.label}</span>`;
}

/* ---------- Roles ---------- */
const ROLES = {
  OWNER:      { label:'Owner / Administrator', scope:'org',    short:'Owner' },
  SUPERVISOR: { label:'Supervisor / Branch Manager', scope:'branch', short:'Supervisor' },
  ISSUER:     { label:'Issuer / Branch Operator', scope:'branch', short:'Issuer' },
  FINANCE:    { label:'Finance / Bookkeeper',  scope:'org',    short:'Finance' },
  AUDITOR:    { label:'Auditor',               scope:'org',    short:'Auditor' },
  /* Not one of a taxpayer's own people. A BIR examiner belongs to no client:
     they sign in once and select which taxpayer to examine, read-only. */
  BIR_EXAMINER: { label:'BIR Examiner',        scope:'org',    short:'BIR Examiner', external:true },
  /* EPI's own staff. They run the service for every client and see each
     account's operating figures, not its sales: the console shows counts,
     states and totals, never a buyer or a line item (RMC VIII.8). */
  EPI_OPERATOR: { label:'EPI Operations',      scope:'org',    short:'EPI operations', external:true }
};

/* `template` is the document face. It is org-wide and it is what every buyer
   sees, so it sits with the owner beside the tax profile rather than with the
   branch roles — a supervisor changing the invoice for the whole company from
   one branch is not a thing anyone asked for. */
const PERMS = {
  OWNER:      { issue:true,  correct:true, approve:true, allBranches:true,  export:true,  users:true,  taxProfile:true,  template:true,  billing:true  },
  SUPERVISOR: { issue:true,  correct:true, approve:true, allBranches:false, export:true,  users:false, taxProfile:false, template:false },
  ISSUER:     { issue:true,  correct:'request', approve:false, allBranches:false, export:false, users:false, taxProfile:false, template:false },
  FINANCE:    { issue:false, correct:'request', approve:false, allBranches:true,  export:true,  users:false, taxProfile:false, template:false, billing:true },
  AUDITOR:    { issue:false, correct:false, approve:false, allBranches:true,  export:true,  users:false, taxProfile:false, template:false, billing:true },
  BIR_EXAMINER: { issue:false, correct:false, approve:false, allBranches:true, export:true,  users:false, taxProfile:false, template:false, examine:true, billing:true },
  EPI_OPERATOR: { operate:true }
};
function isOperator(){ return CR === 'EPI_OPERATOR'; }

/* A closed or suspended account keeps everything it had and can still be read
   and exported, but nothing can be written to it. Taking the write permissions
   away here makes every screen read-only at once, instead of each one checking
   the account's status for itself. */
const WRITE_PERMS = ['issue', 'correct', 'approve', 'users', 'taxProfile', 'template'];
function accountStatus(t){ t = t || CT; return (t && t.accountStatus) || 'ACTIVE'; }
function accountReadOnly(t){ return accountStatus(t) !== 'ACTIVE'; }

function can(perm){
  const p = PERMS[CR];
  if (WRITE_PERMS.indexOf(perm) > -1 && accountReadOnly()) return false;
  return p ? !!p[perm] : false;
}
function permValue(perm){
  const p = PERMS[CR];
  if (WRITE_PERMS.indexOf(perm) > -1 && accountReadOnly()) return false;
  return p ? p[perm] : false;
}

/* ---------- Global session ---------- */
let CU = null;   // current user  { id, name, roleKey, tenantId, branchId }
let CR = null;   // current role key
let CT = null;   // current tenant object

/* CU/CT go stale after any status-changing action — always refresh on view switch */
function refreshSession(){
  if (!CU) return;
  const db = Store.db;
  if (!db) return;
  CT = db.tenants.find(t => t.id === CU.tenantId) || null;
  const u = (db.users || []).find(x => x.id === CU.id);
  if (u){
    /* An examiner has no tenant of their own; the one being examined is chosen,
       not stored on the user. */
    CU = Object.assign({}, u, u.tenantId ? {} : { tenantId: CU.tenantId });
    CR = u.roleKey;
  }
}

/* ---------- Connection methods ----------

   How sales reach us. This is a property of the account, not of the person
   signed in, so it is asked separately from can(): a role says what someone
   may do, a connection says what the account is able to do at all.

   The distinction matters most for bulk import. It is tempting to read it as
   a small-business feature and hang it off the express lane, but the two are
   independent. A four-branch retailer whose terminals can only export a
   day-end file needs it; an online seller whose storefront posts each sale
   does not. Size is not the question — whether anything can post live is.

   A tenant may hold more than one: an enterprise can post live from head
   office and upload files from branches that cannot.                        */
const CONNECTIONS = {
  BULK:      { label:'Bulk import',        needs:'upload a file of sales',
               note:'A file of sales, uploaded, typically at end of day.' },
  API:       { label:'REST API',           needs:'post each sale as it happens',
               note:'The seller\'s own system posts each sale as it happens.' },
  CONNECTOR: { label:'Platform connector', needs:'issue through a connected platform',
               note:'A prebuilt integration with a marketplace or accounting package.' }
};

/** The current account's methods, always as a list. Older records held a
    single string, so both shapes are accepted on the way in. */
function connections(){
  const c = CT && CT.connection;
  return (Array.isArray(c) ? c : c ? [c] : []).filter(k => CONNECTIONS[k]);
}

function usesConnection(method){ return connections().indexOf(method) !== -1; }

/* ---------- Coverage ----------
   What this taxpayer must do, and when, comes from the regulations, not from a
   package it buys. EPI provides issuance and sales reporting end to end (RMC
   V.A.2); coverage decides which of the two the law currently asks of an
   account. RR 11-2025 Sec. 3 sets the categories, Sec. 4 exempts micro
   taxpayers, and RR 26-2025 Sec. 3 sets the compliance date.

   Two facts live on the tenant: coverageBasis (which category it falls in) and
   issuesOn ('EPI' by default, or 'OWN_SYSTEM' when the taxpayer already issues
   on its own registered software and this account only transmits and
   reconciles). esrMode only means something under OWN_SYSTEM: whether the
   taxpayer's system calls the transmission API directly (CLIENT_CONTROLLED) or
   EPI manages sending, retries and reconciliation (ESP_MANAGED). */
const COMPLIANCE = {
  issuanceDeadline: '2026-12-31',      /* RR 26-2025 Sec. 3; the Commissioner may extend it */
  /* EPI policy, on top of RMC VII.1: EPI accepts only taxpayers required to issue
     e-invoices by the deadline. While true, sign-up and the operator's
     application check both refuse anyone whose outcome is not NOW. Set false if
     the BIR opens e-invoicing to voluntary or later-phase taxpayers. */
  acceptOnlyRequired: true,
  esrInForce: false                    /* RR 26-2025: waits for a BIR system and separate regulations */
};
const COVERAGE_BASES = {
  ECOMMERCE:     { label:'E-commerce or internet transactions',        ref:'RR 11-2025 Sec. 3(A)(1)',    when:'NOW'   },
  LTS:           { label:'Under the Large Taxpayers Service',          ref:'RR 11-2025 Sec. 3(A)(2)',    when:'NOW'   },
  LARGE:         { label:'Large taxpayer under RA 11976',              ref:'RR 11-2025 Sec. 3(A)(3)',    when:'NOW'   },
  SOFTWARE_USER: { label:'Uses CAS, CBA or other invoicing software',  ref:'RR 11-2025 Sec. 3(A)(4)',    when:'NOW'   },
  EXPORTER:      { label:'Exporter of goods or services',              ref:'RR 11-2025 Sec. 3(A)(5)(i)', when:'LATER' },
  INCENTIVES:    { label:'Registered enterprise with tax incentives',  ref:'RR 11-2025 Sec. 3(A)(5)(ii)', when:'LATER' },
  POS:           { label:'Uses a point-of-sale system',                ref:'RR 11-2025 Sec. 3(A)(5)(iii)', when:'LATER' },
  OTHER:         { label:'Required by the Commissioner',               ref:'RR 11-2025 Sec. 3(A)(5)(iv)', when:'LATER' },
  NONE:          { label:'Not in a covered category',                  ref:'',                           when:'NONE'  }
};
const ESR_MODES = {
  CLIENT_CONTROLLED: { label:'Client-controlled', note:'The taxpayer\'s own system sends invoices through EPI\'s API.' },
  ESP_MANAGED:       { label:'ESP-managed',       note:'EPI sends invoices to the BIR and checks the counts for the taxpayer.' }
};

function longDate(iso){
  return new Date(iso + 'T00:00:00+08:00').toLocaleDateString('en-PH', { day:'numeric', month:'long', year:'numeric' });
}
function complianceDeadline(){ return longDate(COMPLIANCE.issuanceDeadline); }

/** The four outcomes: NOW, LATER, VOLUNTARY (micro), NONE. */
function coverage(t){
  t = t || CT;
  const base = COVERAGE_BASES[(t && t.coverageBasis) || 'NONE'] || COVERAGE_BASES.NONE;
  const micro = !!t && t.classification === 'MICRO';
  /* Sec. 4 exempts micro taxpayers from every category except LTS and large. */
  const outcome = base.when !== 'NONE' && micro && ['ECOMMERCE','SOFTWARE_USER','EXPORTER','INCENTIVES','POS','OTHER'].indexOf(t.coverageBasis) > -1
    ? 'VOLUNTARY' : base.when;
  /* Sec. 3(B) lists e-commerce for Small, Medium and Large only. */
  const esr = outcome !== 'NONE' && !(micro && t.coverageBasis === 'ECOMMERCE');
  return { basis:base, outcome, esr, micro };
}
/** May EPI accept this taxpayer today? One rule for sign-up and the console. */
function acceptable(t){
  return !COMPLIANCE.acceptOnlyRequired || coverage(t).outcome === 'NOW';
}
/** Why not, in the taxpayer's terms. */
function refusalReason(t){
  const c = coverage(t);
  return ({
    LATER:     `${c.basis.label} (${c.basis.ref}) becomes mandatory only once the BIR has a system ready and a separate regulation sets the date.`,
    VOLUNTARY: 'This category (RR 11-2025 Sec. 4) is not yet open for EPI registration. EPI will contact you when it opens.',
    NONE:      'The categories ticked are not yet in scope for EPI registration.'
  })[c.outcome] || '';
}
function issuesOnOwnSystem(t){ t = t || CT; return !!t && t.issuesOn === 'OWN_SYSTEM'; }

/* ---------- Fees ----------
   Client Service Agreement, Article 4. RMC V.A.4: no hidden, exit or data-retrieval
   fees, and the BIR may ask for all six charge types to be disclosed. Shown before
   registration and again in Settings.

   Five tiers, one fee for each Billable Document (an invoice the System validated,
   numbered and issued). Each tier has a monthly allowance. Invoices above the allowance
   plus a 1% margin cost the tier's excess fee, which is the fee plus 25%. If a month's
   count is below the range of the client's tier, the month is charged at the tier the
   count falls in (the monthly audit). There is no subscription, no onboarding fee, no
   minimum, and nothing for branches, users or connections. A refundable safety deposit
   secures what is billed afterwards. Amounts exclude 12% VAT.

   The billing run (billing.js) and every fee table on screen read this one place. A tier
   also sets the registration path: Tier 1 is a single location and activates on its own,
   the other tiers map branches and are reviewed. */
const PLAN_ORDER = ['TIER1', 'TIER2', 'TIER3', 'TIER4', 'TIER5'];
const ALLOWANCE_MARGIN_PCT = 1;      /* percent above the allowance before the excess fee */
const EXCESS_MARKUP_PCT = 25;        /* the excess fee is the tier fee plus this */
const PLANS = {
  TIER1: { label:'Tier 1 – Basic',     short:'Tier 1', lane:'EXPRESS',    allowance:10000,  fee:7.00, deposit:5000,
           who:'Up to 10,000 invoices a month. One location, set up on your own.' },
  TIER2: { label:'Tier 2 – Standard',  short:'Tier 2', lane:'ENTERPRISE', allowance:50000,  fee:6.00, deposit:11000,
           who:'10,101 to 50,500 invoices a month. Branches mapped and a reviewed activation.' },
  TIER3: { label:'Tier 3 – Advanced',  short:'Tier 3', lane:'ENTERPRISE', allowance:100000, fee:5.00, deposit:51000,
           who:'50,501 to 101,000 invoices a month. Branches mapped and a reviewed activation.' },
  TIER4: { label:'Tier 4 – Enterprise', short:'Tier 4', lane:'ENTERPRISE', allowance:999999, fee:4.00, deposit:101000,
           who:'101,001 to 1,009,998 invoices a month. Branches mapped and a reviewed activation.' },
  TIER5: { label:'Tier 5 – High Volume', short:'Tier 5', lane:'ENTERPRISE', allowance:null,  fee:3.00, deposit:1010000,
           who:'1,009,999 invoices a month or more. No allowance and no excess fee.' }
};
PLAN_ORDER.forEach((k, i) => {
  const p = PLANS[k];
  p.key = k; p.rank = i + 1;
  p.limit = p.allowance == null ? null : Math.floor(p.allowance * (100 + ALLOWANCE_MARGIN_PCT) / 100);
  p.excessFee = p.allowance == null ? null : Math.round(p.fee * (100 + EXCESS_MARKUP_PCT)) / 100;
  p.from = i === 0 ? 1 : PLANS[PLAN_ORDER[i - 1]].limit + 1;
});
const FEES = PLANS;   /* older name, kept for readers of billing.js */
/** Stored accounts from before the tiers keep working: the old plan maps to the nearest tier. */
const LEGACY_PLAN = { STARTER:'TIER1', BUSINESS:'TIER2', ENTERPRISE:'TIER3' };
const planKey = k => PLANS[k] ? k : (LEGACY_PLAN[k] || null);

/** The tier whose range holds a monthly count of Billable Documents. */
function planForCount(n){
  n = Math.max(0, Math.floor(n || 0));
  for (let i = 0; i < PLAN_ORDER.length; i++){ const p = PLANS[PLAN_ORDER[i]]; if (p.limit == null || n <= p.limit) return p.key; }
  return 'TIER5';
}
/** What a month costs under the agreement (4.3 and 4.4), before VAT.
    Below the range of its own tier a client pays what a client on the fitting tier would pay:
    the System has already taken the fee of the client's own tier, and the difference is the
    audit adjustment. Above the allowance plus the margin, each extra invoice costs the excess fee. */
function monthFees(plan, count){
  const own = PLANS[planKey(plan)] || PLANS.TIER1, n = Math.max(0, Math.floor(count || 0));
  const fit = PLANS[planForCount(n)], below = n > 0 && fit.rank < own.rank;
  const baseQty = below || own.limit == null ? n : Math.min(n, own.limit);
  const excessQty = below ? 0 : n - baseQty;
  const adjQty = below ? n : 0, adjUnit = below ? Math.round((fit.fee - own.fee) * 100) / 100 : 0;
  const total = Math.round((baseQty * own.fee + excessQty * (own.excessFee || 0) + adjQty * adjUnit) * 100) / 100;
  return { plan:own.key, count:n, fit:fit.key, below, baseQty, baseFee:own.fee, excessQty, excessFee:own.excessFee,
           adjQty, adjUnit, total };
}
/** The range of a tier, in words. */
function planRange(k){
  const p = PLANS[k];
  return k === 'TIER1' ? `up to ${p.limit.toLocaleString('en-PH')}`
       : p.limit == null ? `${p.from.toLocaleString('en-PH')} and above`
       : `${p.from.toLocaleString('en-PH')} to ${p.limit.toLocaleString('en-PH')}`;
}

/** The tier in force on a date. The history holds each change with the day it starts;
    older accounts have none and fall back to the plan on record. */
function planAt(t, when){
  if (!t) return 'TIER1';
  const d = new Date(when || Date.now());
  let cur = null;
  (t.planHistory || []).slice().sort((a, b) => new Date(a.from) - new Date(b.from)).forEach(e => {
    if (new Date(e.from) <= d && planKey(e.plan)) cur = planKey(e.plan);
  });
  if (cur) return cur;
  if (planKey(t.plan)) return planKey(t.plan);
  return t.lane === 'ENTERPRISE' ? 'TIER2' : 'TIER1';
}
/** The tier in force today. */
function planOf(t){ return planAt(t, new Date()); }
/** Fees for a tier key, a lane name or a tenant. */
function feesFor(x){
  if (x && typeof x === 'object') return PLANS[planOf(x)];
  if (planKey(x)) return PLANS[planKey(x)];
  return PLANS[x === 'ENTERPRISE' ? 'TIER2' : 'TIER1'];
}

const peso0 = n => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: n % 1 ? 2 : 0 });

function feeRows(plan){
  const f = feesFor(plan), n0 = v => v.toLocaleString('en-PH');
  return [
    { charge:'Fee per invoice', amount:`${("₱" + f.fee.toFixed(2))} per invoice${f.limit ? `, up to ${n0(f.limit)} a month` : ''}`,
      note:'Charged for each invoice the System validates, numbers and issues, and deducted from the buyer\'s payment when it is paid through the System. Billed monthly when it is not. VAT is added. Cancelled invoices are still charged.' },
    { charge:'Excess fee', amount: f.excessFee ? `${("₱" + f.excessFee.toFixed(2))} per invoice above ${n0(f.limit)} a month` : 'None',
      note: f.excessFee ? `Allowance ${n0(f.allowance)} a month plus a ${ALLOWANCE_MARGIN_PCT}% margin. Only the invoices above that carry the excess fee. You can move up to a larger tier at any time.` : 'This tier has no allowance and no excess fee.' },
    { charge:'Monthly audit', amount:'Billed at the tier your use falls in',
      note:`EPI checks your use every month. If the count is below the range of your tier (${planRange(f.key)}), the month is charged at the fee of the tier the count falls in, and the difference is billed. You choose your tier and are responsible for choosing the right one.` },
    { charge:'Safety deposit', amount:`${peso0(f.deposit)}, refundable`,
      note:'Paid before activation. Held without interest to cover any bill left unpaid, and refunded when the agreement ends. It is not a fee or a minimum charge.' },
    { charge:'Branches, users and connections', amount:'Free',
      note:'No charge for any number of branches, users or connections.' },
    { charge:'Application',  amount:'Free',
      note:'Nothing is charged to apply, or if EPI declines the application.' },
    { charge:'Onboarding',   amount:'₱0',
      note:'No onboarding fee. Activates when the agreement is verified, the safety deposit is received and the checks are done.' },
    { charge:'Storage',      amount:'Included',
      note:'Records are kept until the BIR certifies they have moved.' },
    { charge:'Retrieval',    amount:'Free',
      note:'Export your records at any time in a machine-readable format.' },
    { charge:'Migration',    amount:'Free',
      note:'Transfer to you, the BIR or another accredited provider.' },
    { charge:'Late payment', amount:'2% a month on the unpaid amount',
      note:'1% interest and a 1% penalty, starting after the 15-day due date. Issuing and access to your records are never restricted over late payment. EPI may take legal action to collect and charge reasonable attorney\'s fees and collection costs as the court allows.' },
    { charge:'Termination',  amount:'None',
      note:'There is no exit fee, and your records stay accessible.' },
    { charge:'Charges to your buyers', amount:'None',
      note:'EPI bills these fees to your business only. They are not added to the invoices you issue to your buyers.' }
  ];
}

/** Late payment: 1% interest plus a 1% penalty for each month after the due date (CSA 4.9). */
const LATE_RATE = 0.02;

/* How a client can pay EPI. INSTANT methods go through a payment gateway and post at once
   (simulated here). PROOF methods are paid outside the system; the client sends the
   reference and EPI confirms. EPI's own account details are illustrative. */
const EPI_PAYMENT = {
  bank:    { bank:'Sample Bank (illustrative)', name:'Eastland Printink, Inc.', number:'0000-0000-00' },
  GCASH:   { label:'GCash', number:'0917 000 0000', name:'Eastland Printink, Inc.' },
  MAYA:    { label:'Maya',  number:'0918 000 0000', name:'Eastland Printink, Inc.' },
  checkTo: 'Eastland Printink, Inc.'
};
const PAY_METHODS = {
  CARD:             { label:'Credit or debit card',               mode:'INSTANT', ico:'bi-credit-card',
                      note:'Pay now through the payment gateway.' },
  GCASH:            { label:'GCash',                              mode:'INSTANT', ico:'bi-phone',
                      note:'Pay now. You approve the payment in GCash.' },
  MAYA:             { label:'Maya',                               mode:'INSTANT', ico:'bi-phone',
                      note:'Pay now. You approve the payment in Maya.' },
  ONLINE_BANKING:   { label:'Online banking',                     mode:'INSTANT', ico:'bi-bank',
                      note:'Pay now through your bank.' },
  BANK_TRANSFER:    { label:'Bank transfer (InstaPay or PESONet)', mode:'PROOF',   ico:'bi-arrow-left-right',
                      note:'Transfer to EPI, then send the reference. EPI confirms the payment.' },
  OVER_THE_COUNTER: { label:'Bank deposit over the counter',      mode:'PROOF',   ico:'bi-building',
                      note:'Deposit at any branch, then send the deposit slip reference.' },
  CHECK:            { label:'Check',                              mode:'PROOF',   ico:'bi-journal-check',
                      note:'Deliver or deposit a check payable to EPI, then send the check number.' }
};
/** First day of the month after a date, as an ISO string at 00:00 Manila time. */
function nextMonthStart(d){
  d = new Date(d || Date.now());
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(), m = (d.getMonth() + 1) % 12;
  return new Date(y + '-' + String(m + 1).padStart(2, '0') + '-01T00:00:00+08:00').toISOString();
}

/** Plain-language position on each obligation, for Settings. */
function coverageNotes(t){
  t = t || CT;
  const c = coverage(t), by = esc(c.basis.label), ref = esc(c.basis.ref);
  const own = issuesOnOwnSystem(t);
  const days = Math.ceil((new Date(COMPLIANCE.issuanceDeadline + 'T23:59:59+08:00') - new Date()) / 86400000);
  const left = days > 0 ? ` ${days} days remain.` : '';
  const issuance = {
    NOW: Callout(own ? 'info' : 'ok',
      `<strong>${own ? 'You issue invoices from your own system.' : 'Ready for the deadline.'}</strong>
       Covered as: ${by} (${ref}). The deadline is ${complianceDeadline()}.${left}
       ${own ? 'That system must itself be registered with the BIR. This account sends what it issues to the BIR.'
             : 'You are already issuing electronic invoices.'}`),
    LATER: Callout('info', `<strong>You must issue e-invoices later.</strong>
      Covered as: ${by} (${ref}). It becomes mandatory once the BIR has a system ready to
      receive the data, and a separate regulation sets the date. EPI cannot register this taxpayer until the date is set.`),
    VOLUNTARY: Callout('info', `<strong>Registration is not yet open for this category.</strong>
      Covered as: ${by} (RR 11-2025 Sec. 4). EPI will contact you when it opens.`),
    NONE: Callout('info', `<strong>Category to be confirmed.</strong> This taxpayer is not in a category
      EPI can register today. EPI will confirm what applies.`)
  }[c.outcome];
  const esr = c.esr
    ? Callout('info', `<strong>Sales reporting to the BIR has not started.</strong>
        The BIR has not set up its system or issued the rules yet. Your invoices are ready to be sent when it starts. Nothing more is needed today.`)
    : Callout('info', `<strong>Sales reporting to the BIR does not apply to you.</strong>
        Your business is outside the categories that must report.`);
  return { issuance, esr };
}

/* ---------- System identity (printed on the document face) ---------- */
const SYSTEM = {
  vendor:  'Eastland Printink, Inc.',
  product: 'Digitized Invoice System',
  version: '1.0.0',
  /* Every number and date below is illustrative. The BIR accreditation
     program has not opened yet; RMC V.A.1 allows a demonstration only if it
     says it is not production, which the login, landing page and document
     face now do. The real values replace these once issued. */
  status: 'DEMONSTRATION',
  /* EPI is itself a taxpayer: it invoices its clients (RMC VII.2). Illustrative. */
  taxpayer: { tin:'005-743-462', address:'92 R. Jacinto St., Canumay West 1443 City of Valenzuela NCR Third District, Philippines', vatStatus:'VAT',
              /* EPI's System-fee invoices run on one plain series, 0000001 to 0500000 (printed at the foot of the face). */
              series:{ digits:7, from:1, to:500000 } },
  certificates: {
    esp:    { no:'BIR-ESP-2026-0031',  issuedAt:'2026-10-01', validUntil:'2031-09-30',
              models:'End-to-end e-invoicing and electronic sales reporting' },
    system: { no:'BIR-ESPS-2026-0031-A', environment:'Production' },
    ptt:    { no:'BIR-PTT-2026-0057',  issuedAt:'2026-10-01' }
  },
  /* Hosting providers, subcontractors and processors that handle data (RMC VIII). Each was disclosed to the
     BIR and approved before it handled any data. Illustrative references and dates. */
  processors: [
    { name:'Microsoft Azure',            does:'Hosts the application, database and document storage (production, disaster recovery)', where:'Singapore (Southeast Asia), with a second Azure region as standby', approval:'BIR-DISC-2026-0004', approvedAt:'2026-09-15' },
    { name:'Brevo',                      does:'Sends buyer copies and notices by email',                                            where:'European Union',  approval:'BIR-DISC-2026-0005', approvedAt:'2026-09-15' },
    { name:'Philippine telecom SMS gateway', does:'Sends one-time codes and notices by SMS',                                         where:'Philippines',              approval:'BIR-DISC-2026-0006', approvedAt:'2026-09-15' },
    { name:'Sentral Pay Services, Inc.', does:'EPI\'s payment partner: collects the fee for clients who choose it',                 where:'Philippines',              approval:'BIR-DISC-2026-0007', approvedAt:'2026-09-22' }
  ],
  /* The audit log must be time-synchronised (RMC VII). Illustrative figures. */
  timeSync: { source:'NTP, Asia/Manila (UTC+8)', offsetMs:12, checkedMinutesAgo:4 },
  /* RMC IV.a and V.B.1d: designated officers and focal persons. */
    officers: [
    { role:'Authorized representative', name:'Rodrigo L. Evangelista', email:'r.evangelista@eastlandprintink.ph', country:'Philippines' },
    { role:'Technical focal person',   name:'Rafael D. Mendoza', email:'r.mendoza@eastlandprintink.ph', country:'Philippines' },
    { role:'Compliance officer',       name:'Teresita A. Lacson', email:'compliance@eastlandprintink.ph', country:'Philippines' },
    { role:'Data protection officer',  name:'Joaquin P. Serrano', email:'dpo@eastlandprintink.ph', country:'Philippines' },
    { role:'Security officer',         name:'Imelda C. Bautista', email:'security@eastlandprintink.ph', country:'Philippines' }
  ]
};

/** What the sidebar says about the BIR connection. The BIR's receiving system
    does not exist yet, so the link is simulated. Online/Offline follows the
    interruption log: any open interruption makes the link read Offline. */
function eisState(){
  /* EPI's staff watch the link for every account, and for EPI's own invoices. */
  const mine = (isOperator() ? Store.db.invoices : Auth.visibleInvoices())
    .filter(i => i.docStatus !== 'DRAFT');
  const waiting = mine.filter(i => ['QUEUED', 'FAILED', 'REJECTED'].indexOf(i.transmissionStatus) > -1).length;
  const last = mine.filter(i => i.transmissionStatus === 'TRANSMITTED' && i.transmittedAt)
    .sort((a, b) => new Date(b.transmittedAt) - new Date(a.transmittedAt))[0];
  const int = activeInterruption();
  return { waiting, lastAt: last ? last.transmittedAt : null, online: !int, interruption: int };
}

/* The renewal window opens 60 days before the ESP certificate lapses
   (RMC VI.5); a taxpayer's PTI stays valid only while that certificate does. */
function espCertState(){
  const c = SYSTEM.certificates.esp;
  const days = Math.ceil((new Date(c.validUntil + 'T23:59:59+08:00') - new Date()) / 86400000);
  return { days, valid: days > 0, renewalOpen: days <= 60 };
}

/* PTI: the taxpayer's own Permit to Issue. EPI may help file it, but the
   taxpayer holds it (RMC V.A.2). Live issuance waits for it. */
const PTI_STATES = {
  ISSUED:      { label:'Issued',         tone:'green' },
  APPLIED:     { label:'Filed, awaiting BIR', tone:'amber' },
  NOT_APPLIED: { label:'Not yet filed',  tone:'red' }
};
function ptiStatus(t){
  t = t || CT;
  if (!t) return 'NOT_APPLIED';
  return t.pti ? 'ISSUED' : (t.ptiAppliedAt ? 'APPLIED' : 'NOT_APPLIED');
}

/* RMC 98-2026 IV.15: the taxpayer gets its EIS Certification within 6 months of the PTI, or the PTI can be revoked.
   t.ptiIssuedAt is the date on the PTI; t.eis = { certifiedAt, ref } once the BIR has certified the system. */
const EIS_MONTHS = 6;
function eisInfo(t){
  t = t || CT;
  if (!t || !t.pti) return { key:'NA', label:'Starts when the PTI is issued', tone:'gray' };
  if (t.eis && t.eis.certifiedAt) return { key:'CERTIFIED', label:'Certified', tone:'green', at:t.eis.certifiedAt, ref:t.eis.ref || '' };
  const from = String(t.ptiIssuedAt || t.goLiveAt || '').slice(0, 10);
  const due = new Date(from + 'T00:00:00Z'); due.setUTCMonth(due.getUTCMonth() + EIS_MONTHS);
  const dueIso = due.toISOString().slice(0, 10);
  const days = Math.ceil((Date.parse(dueIso + 'T00:00:00+08:00') - Date.now()) / 864e5);
  if (days < 0) return { key:'OVERDUE', label:`Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone:'red', due:dueIso, days };
  if (days <= 30) return { key:'DUE_SOON', label:`Due in ${days} day${days === 1 ? '' : 's'}`, tone:'amber', due:dueIso, days };
  return { key:'PENDING', label:'Not yet certified', tone:'blue', due:dueIso, days };
}

/* Why this account cannot issue or transmit live documents right now, or ''. */
function issuanceBlock(){
  if (accountReadOnly())
    return `This account is ${accountStatus().toLowerCase()} and read-only. Nothing new can be issued on it.`;
  const down = activeInterruption();
  if (down && INTERRUPTION_SOURCES[down.source].blocksIssuing)
    return `${INTERRUPTION_SOURCES[down.source].label} (${down.ref}). New invoices cannot be issued until service returns.`;
  if (ptiStatus() !== 'ISSUED')
    return 'This account has no Permit to Issue yet. You can issue invoices once the BIR issues it.';
  if (!espCertState().valid)
    return "EPI's ESP accreditation certificate has lapsed, so Permits to Issue issued through it are no longer valid.";
  return '';
}
/* True while EPI's own service is down and nothing else stops this account
   from issuing. Sales entered now are queued, then issued and sent to the
   buyer when service returns (queue.js). */
function outageQueueing(){
  if (accountReadOnly() || ptiStatus() !== 'ISSUED' || !espCertState().valid) return false;
  const down = activeInterruption();
  return !!(down && INTERRUPTION_SOURCES[down.source].blocksIssuing);
}
function transmissionBlock(){
  return SYSTEM.certificates.ptt ? '' : "EPI's Permit to Transmit is not in place.";
}

/* ---------- Interruptions and transmission attempts (RMC VII.16 to VII.18, IX.3) ----------
   An interruption is a stretch when the BIR EIS, the API or EPI's own service
   was down. It is system-wide, verified by EPI, and the reference every delay
   cause points back to. Only EPI's own downtime stops new invoices being
   issued; the other two leave issuing working and only hold transmission. */
const INTERRUPTION_SOURCES = {
  EIS: { label:'BIR EIS unavailable', short:'BIR EIS',         blocksIssuing:false },
  API: { label:'API outage',          short:'API',             blocksIssuing:false },
  ESP: { label:'EPI service downtime',short:'EPI downtime',    blocksIssuing:true  }
};
/* The legal limit (RMC 110-2026 V.A.2(d)): every invoice is sent to the BIR within 3 calendar days of the sale.
   The day of the sale is day 0, so the last day is the 3rd calendar day after it. */
const TRANSMIT_LIMIT_DAYS = 3;
/* EPI's own, tighter target: an invoice that waits longer than this counts as delayed on the service levels. */
const TRANSMIT_DELAY_HOURS = 1;
/* Failed attempts before a document stops retrying by itself. */
const MAX_AUTO_ATTEMPTS = 3;

function interruptions(){ return (Store.db.interruptions || []).slice(); }
function activeInterruption(){ return interruptions().find(x => !x.endedAt) || null; }
function interruptionById(id){ return interruptions().find(x => x.id === id) || null; }

function ackNumber(){
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const taken = new Set(Store.db.invoices.map(i => i.transmissionRef));
  let r;
  do { r = `ESRS-${d}-${Math.floor(10000 + Math.random() * 89999)}`; } while (taken.has(r));
  return r;
}

/** The attempts on a document. Documents seeded before attempts were logged
    get the one acknowledgment they are known to have had. */
function transmissionAttempts(inv){
  if (inv.transmissionAttempts) return inv.transmissionAttempts;
  if (inv.transmissionStatus === 'TRANSMITTED')
    return [{ at: inv.transmittedAt || inv.recordedAt || inv.issuedAt, result:'ACKNOWLEDGED', cause:'NONE',
              ref: inv.transmissionRef, detail:'Acknowledged' }];
  return [];
}

/** One attempt to send a document to the (simulated) BIR EIS. Writes the
    attempt, moves the status and returns whether it was acknowledged. */
function attemptTransmission(live){
  const now = new Date().toISOString();
  const log = live.transmissionAttempts = (live.transmissionAttempts || []).slice();
  const int = activeInterruption();

  if (int){
    log.push({ at:now, result:'FAILED', cause:int.source, interruptionId:int.id,
               detail:`${INTERRUPTION_SOURCES[int.source].label} (${int.ref})` });
    const fails = log.filter(a => a.result === 'FAILED').length;
    live.transmissionStatus = fails >= MAX_AUTO_ATTEMPTS ? 'FAILED' : 'QUEUED';
    live.transmissionError = `${INTERRUPTION_SOURCES[int.source].label} (${int.ref})`;
    return { ok:false, why:live.transmissionError };
  }

  const out = transmissionOutcome(live);
  if (out.ok){
    const ref = ackNumber();
    log.push({ at:now, result:'ACKNOWLEDGED', cause:'NONE', ref, detail:'Acknowledged' });
    live.transmissionStatus = 'TRANSMITTED';
    live.transmissionRef = ref;
    live.transmittedAt = now;
    delete live.transmissionError;
    return { ok:true, ref };
  }
  log.push({ at:now, result:'REJECTED', cause:'TAXPAYER_DATA', detail:out.why });
  live.transmissionStatus = 'REJECTED';
  live.transmissionRef = null;
  live.transmissionError = out.why;
  return { ok:false, why:out.why };
}

/** The last day an invoice may be sent to the BIR, as yyyy-mm-dd (Manila). */
function transmitBy(inv){
  const day = new Date(inv.issuedAt).toLocaleDateString('en-CA', { timeZone:'Asia/Manila' });
  const d = new Date(day + 'T12:00:00+08:00'); d.setDate(d.getDate() + TRANSMIT_LIMIT_DAYS);
  return d.toLocaleDateString('en-CA', { timeZone:'Asia/Manila' });
}
/** Where an invoice stands against the 3-day limit.
    ONTIME and LATE: already acknowledged. OPEN, DUE_SOON and OVERDUE: not yet acknowledged. NA: never sent (cancelled first). */
function limitInfo(inv){
  const by = transmitBy(inv), end = new Date(by + 'T23:59:59+08:00'), st = inv.transmissionStatus;
  if (st === 'NOT_READY' || inv.docStatus === 'DRAFT') return { by, state:'NA', over:false };
  if (st === 'TRANSMITTED'){ const late = new Date(inv.transmittedAt || inv.issuedAt) > end; return { by, state:late ? 'LATE' : 'ONTIME', over:late }; }
  const left = (end - Date.now()) / 3600000;
  return { by, state:left < 0 ? 'OVERDUE' : left <= 24 ? 'DUE_SOON' : 'OPEN', over:left < 0, hoursLeft:left };
}

/** How long a document waited, and why. `provider` means the cause was an
    interruption EPI has verified, not something on the taxpayer's side. */
function delayInfo(inv){
  const att = transmissionAttempts(inv);
  const start = new Date(inv.recordedAt || inv.issuedAt);
  const acked = inv.transmissionStatus === 'TRANSMITTED';
  const end = acked && inv.transmittedAt ? new Date(inv.transmittedAt) : (acked ? start : new Date());
  const hours = Math.max(0, (end - start) / 3600000);
  const delayed = hours > TRANSMIT_DELAY_HOURS && inv.transmissionStatus !== 'NOT_READY';
  const hit = att.find(a => a.result === 'FAILED' && INTERRUPTION_SOURCES[a.cause]);
  const int = hit ? interruptionById(hit.interruptionId) : null;
  let cause = 'NONE', label = '';
  if (delayed){
    if (hit && int && int.verified){ cause = 'PROVIDER'; label = `${INTERRUPTION_SOURCES[hit.cause].short} (${int.ref})`; }
    else if (att.some(a => a.result === 'REJECTED') || inv.transmissionStatus === 'REJECTED'){ cause = 'DATA'; label = 'Rejected: data fault'; }
    else { cause = 'NOT_SENT'; label = 'Not sent in time'; }
  }
  return { hours, delayed, cause, label, interruption:int, attempts:att.length, acked };
}

/** Called once a new document exists: the first attempt to send it. */
function settleTransmission(inv){
  inv.transmissionStatus = 'QUEUED';
  inv.transmissionRef = null;
  attemptTransmission(inv);
}

/* Step-up confirmation before destructive actions asks for the signed-in user's
   password. Sign-in here is a role picker, so one demo password stands in for
   the whole cast. The prompt says so on its face. */
const DEMO_PASSWORD = 'demo1234';

/* ---------- Tax engine ---------- */
const VAT_RATE = 0.12;
const SCPWD_RATE = 0.20;

/* Buyers who are entitled to a statutory discount. Rates and VAT treatment come
   from secondary summaries of the rules (the BIR's own text of RR 13-2020 and
   RR 1-2023 could not be retrieved), so each should be checked against it.
   - Senior citizen and PWD: 20% of the VAT-exclusive price, sale VAT-exempt.
   - National athlete or coach: 20% of the VAT-exclusive price, VAT still
     charged, on the discounted price. Cannot be combined with SC/PWD.
   - Solo parent: 10%, sale VAT-exempt, for a child aged 6 or under.
   `flag` is the item property marking goods that qualify. One special buyer
   per invoice, which is also what keeps athletes apart from SC/PWD. */
const SPECIAL_BUYERS = {
  'Senior Citizen':         { short:'SC',           rate:0.20, vatExempt:true,  flag:'scCovered',      law:'RA 9994',
                              idLabel:'Senior citizen ID number' },
  'Person with Disability': { short:'PWD',          rate:0.20, vatExempt:true,  flag:'scCovered',      law:'RA 10754',
                              idLabel:'PWD ID number' },
  'Athlete or Coach':       { short:'Athlete/Coach', rate:0.20, vatExempt:false, flag:'athleteCovered', law:'RA 10699',
                              idLabel:'PNSTM ID number' },
  'Solo Parent':            { short:'Solo parent',  rate:0.10, vatExempt:true,  flag:'soloCovered',    law:'RA 11861',
                              idLabel:'Solo Parent ID (SPIC) number', children:true }
};
/** The computeTotals options for a special buyer type. */
function specialOpts(type){
  const c = SPECIAL_BUYERS[type];
  if (!c) return {};
  return c.vatExempt ? { scpwd:true, scRate:c.rate } : { athlete:true, athleteRate:c.rate };
}

function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Derive the VAT components from a VAT-INCLUSIVE amount.
 * Price Tag Law (Art. 81 RA 7394) requires displayed prices to include VAT;
 * RMC 77-2024 requires VAT shown as a separate item on the invoice.
 */
function deriveFromInclusive(inclusiveAmount){
  const net = round2(inclusiveAmount / (1 + VAT_RATE));
  const vat = round2(inclusiveAmount - net);
  return { net, vat };
}

const TREATMENT = {
  VATABLE: { label:'VATable',      badge:'lbadge-blue'  },
  EXEMPT:  { label:'VAT-Exempt',   badge:'lbadge-amber' },
  ZERO:    { label:'Zero-Rated',   badge:'lbadge-green' }
};

/**
 * Compute the full tax summary for a set of lines.
 * Lines carry VAT-INCLUSIVE unit prices and a treatment tag.
 * Mixed transactions get a breakdown per RMC 77-2024.
 *
 * SC/PWD (RA 9994, RA 10754). A qualified sale to a senior citizen or a person
 * with disability is exempt from VAT, and the 20% discount is taken on the
 * VAT-exempt selling price — not on the VAT-inclusive one. So an eligible
 * VATable line has its VAT stripped, moves into the exempt bucket, and is then
 * discounted. Eligibility is per line: not everything a senior buys qualifies.
 *
 * National athletes and coaches (RA 10699) get 20% off the VAT-exclusive price
 * but the sale is not VAT-exempt: VAT is worked out on what remains. It is
 * folded into `discount`, and `athleteDiscount` says how much of that it was.
 * An athlete's lines are kept out of the trade discount, as SC/PWD lines are.
 * Solo parents (RA 11861) follow the SC/PWD route at 10%.
 *
 * The returned figures form a ladder that reconciles exactly:
 *   gross − discount = netSales = vatableSales + vat + exempt + zero
 *   netSales − scDiscount = totalDue
 */
function computeTotals(lines, discount, opts){
  opts = opts || {};
  const scActive = !!opts.scpwd;
  const scRate = Number(opts.scRate) || SCPWD_RATE;
  const athleteOn = !!opts.athlete;
  const athleteRate = Number(opts.athleteRate) || 0.20;
  let athleteDisc = 0;
  const ewtRate = Number(opts.ewtRate) || 0;
  discount = round2(discount || 0);

  let gross = 0, exempt = 0, zero = 0, vatableIncl = 0, scBase = 0, athleteVatIncl = 0;

  (lines || []).forEach(l => {
    const amt = round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
    gross += amt;

    if (l.treatment === 'ZERO'){ zero += amt; return; }   // exports never qualify

    /* Athletes and coaches: the discount comes off the line, and the VAT-exempt
       or VATable treatment of the line itself is left as it was. */
    if (athleteOn && l.scEligible){
      const d = round2(amt * athleteRate);
      athleteDisc += d;
      if (l.treatment === 'EXEMPT') exempt += amt - d;
      else                          athleteVatIncl += amt - d;
      return;
    }

    if (scActive && l.scEligible){
      const base = l.treatment === 'EXEMPT' ? amt : deriveFromInclusive(amt).net;
      exempt += base;
      scBase += base;
      return;
    }

    if (l.treatment === 'EXEMPT') exempt      += amt;
    else                          vatableIncl += amt;
  });

  gross = round2(gross); exempt = round2(exempt); zero = round2(zero);
  vatableIncl = round2(vatableIncl); scBase = round2(scBase); athleteVatIncl = round2(athleteVatIncl);

  /* Trade discounts reduce the taxable base, so they come off before deriving.
     Like SC/PWD lines, a line that carries a statutory discount is out of
     reach of the trade discount: the buyer gets one discount, not two. */
  const vatableAfterDisc = round2(Math.max(0, vatableIncl - discount) + athleteVatIncl);
  const { net: vatableSales, vat } = deriveFromInclusive(vatableAfterDisc);

  const scDiscount = round2(scBase * scRate);
  athleteDisc = round2(athleteDisc);
  const netSales   = round2(vatableAfterDisc + exempt + zero);
  const totalDue   = round2(netSales - scDiscount);

  /* Expanded withholding tax. A buyer designated a withholding agent (top
     withholding agents under RR 11-2018, government money payments, a
     marketplace withholding on its sellers under RR 16-2023) withholds this
     at source and remits it, then hands the seller BIR Form 2307 as proof —
     it reduces what changes hands, never the tax due printed on the face.
     Base is the sale net of VAT, since RR 2-98 as amended computes EWT on the
     income payment exclusive of VAT. */
  const ewtBase   = ewtRate ? round2(Math.max(0, totalDue - vat)) : 0;
  const ewtAmount = ewtRate ? round2(ewtBase * ewtRate) : 0;
  const netCollectible = round2(totalDue - ewtAmount);

  return {
    gross, exempt, zero, discount: round2(discount + athleteDisc), athleteDiscount: athleteDisc,
    vatableInclusive: vatableAfterDisc,
    vatableSales, vat,
    netSales, scBase, scDiscount,
    totalDue,
    ewtRate, ewtBase, ewtAmount, netCollectible,
    hasExempt: exempt > 0,
    hasZero:   zero > 0,
    scpwdApplied: scDiscount > 0,
    hasEwt: ewtAmount > 0,
    isMixed:  [vatableIncl > 0, exempt > 0, zero > 0].filter(Boolean).length > 1
  };
}

/** The date n working days after `from`. Weekends are skipped; Philippine
    holidays are not modelled, so a due date can fall a day early. */
function addWorkingDays(from, n){
  const d = new Date(from);
  let left = n;
  while (left > 0){
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

/* ---------- Retention ----------
   RMC 110-2026 VIII.4: records are kept for the Tax Code period and then until the BIR confirms in writing that
   migration to its systems is complete. Nothing is redacted, archived out or removed before that confirmation,
   which EPI records per account (tenant.birMigration: reference, date). After five years a record moves to the
   cold archive: still stored in full, still retrievable, no longer correctable. */
const RETENTION = { LIVE_YEARS: 5 };

function retentionState(issuedAt, tenant){
  const years = (Date.now() - new Date(issuedAt).getTime()) / (365.25 * 864e5);
    if (years >= RETENTION.LIVE_YEARS)  return 'ARCHIVED';
  return 'LIVE';
}

/** The buyer block as shown on every screen. Buyer details are never removed automatically. */
function displayBuyer(inv){
  return inv.buyer || {};
}

/* ---------- Formatting ---------- */
function peso(n){
  const v = Number(n) || 0;
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function num(n, d){
  d = (d === undefined) ? 2 : d;
  return (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits:d, maximumFractionDigits:d });
}
function fmtDate(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'2-digit' });
}
function fmtDateTime(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-PH', {
    year:'numeric', month:'short', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:true
  });
}
function fmtTime(iso){
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true });
}

/* ---------- Amount in words (Philippine peso) ---------- */
const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
  'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function below1000(n){
  let s = '';
  if (n >= 100){ s += ONES[Math.floor(n/100)] + ' Hundred'; n %= 100; if (n) s += ' '; }
  if (n >= 20){ s += TENS[Math.floor(n/10)]; n %= 10; if (n) s += '-' + ONES[n]; }
  else if (n > 0){ s += ONES[n]; }
  return s;
}

function amountInWords(amount){
  const v = round2(Math.abs(Number(amount) || 0));
  let whole = Math.floor(v);
  const cents = Math.round((v - whole) * 100);

  if (whole === 0 && cents === 0) return 'Zero Pesos Only';

  const groups = [
    { div: 1e9, name: 'Billion' },
    { div: 1e6, name: 'Million' },
    { div: 1e3, name: 'Thousand' }
  ];
  let words = '';
  groups.forEach(g => {
    const q = Math.floor(whole / g.div);
    if (q > 0){
      words += (words ? ' ' : '') + below1000(q) + ' ' + g.name;
      whole %= g.div;
    }
  });
  if (whole > 0) words += (words ? ' ' : '') + below1000(whole);
  if (!words) words = 'Zero';

  let out = words + ' Peso' + (round2(v) === 1 ? '' : 's');
  if (cents > 0) out += ' and ' + below1000(cents) + ' Centavo' + (cents === 1 ? '' : 's');
  return out + ' Only';
}

/* ---------- Series ---------- */
/** Format: the prefix then seven digits, e.g. BMC0000147. One running series for the whole taxpayer, shared by
    all its branches and never restarted, so the branch code and year are not part of the number. */
function formatSeriesNumber(prefix, branchCode, year, seq){
  return `${prefix}${String(seq).padStart(7,'0')}`;
}
/** The running number at the end of an invoice number, or NaN. */
function seqOf(number){
  const m = /(\d{7})$/.exec(String(number || ''));
  return m ? Number(m[1]) : NaN;
}

/**
 * Allocate the next number in a series.
 * Called ONLY after validation passes — a rejected payload must never
 * consume a number, or the sequence develops gaps that read as deletions.
 */
function allocateNumber(db, tenantId, branchId, kind){
  const t = db.tenants.find(x => x.id === tenantId);
  const b = (db.branches || []).find(x => x.id === branchId);
  if (!t || !b) return null;

  const year = new Date().getFullYear();
  const key = `${kind}:${tenantId}`;
  db.series = db.series || {};
  if (!db.series[key]) db.series[key] = { next: 1, issued: [], retired: [] };

  const seq = db.series[key].next;
  db.series[key].next = seq + 1;

  const prefixMap = { INVOICE: t.seriesPrefix };
  const number = formatSeriesNumber(prefixMap[kind] || t.seriesPrefix, b.code, year, seq);
  db.series[key].issued.push(number);
  return number;
}

/* ---------- Misc helpers ---------- */
function uid(prefix){
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2,10);
}
function esc(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function initials(name){
  return String(name || '?').trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
}
function keycode(len){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < (len || 8); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ---------- Verification QR ---------- */
/**
 * A real, scannable QR code (kazuhikoarase/qrcode-generator, vendored at
 * lib/qrcode.js — MIT licensed, no build step). Encodes whatever URL or text
 * it is given as standard QR modules; the invoice face feeds it a link back
 * into this app's own public verification screen (see verifyUrl below), so
 * scanning it does exactly what typing the number and code would.
 */
function qrSvg(data, px){
  const size = px || 108;
  const qr = qrcode(0, 'M'); // typeNumber 0 = smallest version that fits the data
  qr.addData(String(data));
  qr.make();

  const n = qr.getModuleCount();
  const quiet = 4; // modules of blank border a QR reader expects around the code
  const cell = size / (n + quiet * 2);

  let rects = '';
  for (let r = 0; r < n; r++){
    for (let c = 0; c < n; c++){
      if (qr.isDark(r, c)){
        const x = (c + quiet) * cell, y = (r + quiet) * cell;
        rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
      }
    }
  }
  return `<svg class="qr" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect width="${size}" height="${size}" fill="#fff"/><g fill="#0f172a">${rects}</g></svg>`;
}

/** The link a scan of an invoice's QR resolves to: this app's own public
    verification screen, pre-filled with that document's number and code. */
function verifyUrl(inv){
  const base = location.origin + location.pathname;
  const params = new URLSearchParams({ verify: inv.number, code: inv.keycode });
  return base + '?' + params.toString();
}

/* ---------- Document kinds ---------- */
const DOC_KIND = {
  INVOICE:     { label:'Electronic Invoice',     short:'Invoice',     abbr:'INV', series:'INVOICE' }
};

/* ---------- Payment method grouping ----------
   paymentMethod is free text — seeded as 'Cash', 'GCash', 'Card', 'Cheque',
   and whatever a taxpayer's own Bulk Import CSV happens to spell it as. The
   dashboard groups it by keyword into a fixed, nameable set rather than
   listing every distinct string that ever showed up in a file. */
const PAYMENT_GROUP = {
  CASH:     { label:'Cash Payments',         ico:'bi-cash-stack'  },
  BANK:     { label:'Bank Transfers',        ico:'bi-bank'        },
  CARD:     { label:'Debit and credit cards',  ico:'bi-credit-card' },
  EPAYMENT: { label:'E-Payment',             ico:'bi-phone'       },
  OTHER:    { label:'Other / Unspecified',   ico:'bi-three-dots'  }
};

function paymentGroupOf(method){
  const m = String(method || '').toLowerCase();
  if (!m) return 'OTHER';
  if (/cash/.test(m)) return 'CASH';
  if (/bank|transfer|wire|deposit/.test(m)) return 'BANK';
  if (/card|credit|debit|visa|master/.test(m)) return 'CARD';
  if (/gcash|paymaya|maya|grabpay|wallet|online|qr ?ph|instapay|pesonet|through the system/.test(m)) return 'EPAYMENT';
  return 'OTHER';
}

/* ---------- Activity log ---------- */
function logActivity(db, entry){
  db.activity = db.activity || [];
  db.activity.unshift(Object.assign({
    id: uid('act'),
    at: new Date().toISOString(),
    tenantId: CU ? CU.tenantId : null,
    actorType: 'USER',
    actorName: CU ? CU.name : 'System',
    role: CR || '—',
    device: 'Windows NT 10.0',
    browser: 'Chrome 141.0',
    location: 'Quezon City, Metro Manila, Philippines',
    ip: '124.6.188.79'
  }, entry));
  if (db.activity.length > 500) db.activity.length = 500;
}

/* ---------- UI helpers ---------- */
const UI = {
  toast(msg, kind){
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = 'ltoast ' + (kind || '');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2900);
    setTimeout(() => el.remove(), 3250);
  },
  openModal(title, bodyHtml, footHtml, size){
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-foot').innerHTML = footHtml ||
      '<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>';
    const box = document.getElementById('modal-box');
    box.className = 'lmodal' + (size ? ' lmodal-' + size : '');
    document.getElementById('modal-root').classList.remove('hidden');
  },
  closeModal(){
    document.getElementById('modal-root').classList.add('hidden');
  },
  show(id){
    ['view-login','view-onboarding','view-portal','view-verify','view-activate'].forEach(v => {
      document.getElementById(v).classList.toggle('hidden', v !== id);
    });
  },

  /* Dark mode is a real second surface (see css/main.css and css/dark.css),
     not a filter — but the toggle itself is this small on purpose: one
     attribute, one storage key, no per-screen wiring. */
  isDark(){ return document.documentElement.getAttribute('data-theme') === 'dark'; },
  initTheme(){
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (icon) icon.className = this.isDark() ? 'bi bi-sun' : 'bi bi-moon-stars';
    if (label) label.textContent = this.isDark() ? 'Light mode' : 'Dark mode';
  },
  toggleTheme(){
    const dark = !this.isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try{ localStorage.setItem('epi-theme', dark ? 'dark' : 'light'); }catch(e){}
    this.initTheme();
  }
};

/* The app's one motivated cross-fade: a card grid whose contents change size
   (branch cards → payment-method cards, say) reads as a jump on a hard swap.
   Fading through the change hides that without layout tricks. Extracted from
   the dashboard's branch/payment-method drill-down so any other drill grid
   gets the same transition. */
const Drill = {
  swap($el, html, ms){
    ms = ms || 150;
    $el.css('opacity', 0);
    setTimeout(function(){
      $el.html(html);
      requestAnimationFrame(function(){ $el.css('opacity', 1); });
    }, ms);
  }
};

/* Close modal on backdrop click */
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'modal-root') UI.closeModal();
});

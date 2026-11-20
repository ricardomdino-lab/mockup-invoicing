/* ============================================================
   seed.js — fictional demo data
   All companies, people, TINs and addresses are invented.
   Recent seed dates roll with the real date (see rd() below); older ones are fixed history.
   ============================================================ */

/* The seed is one year of history ending today. Everything is dated from the system
   date, so it rolls forward by itself and app.js rebuilds it when the day changes.
   The hand-written recent activity (written around SEED_BASE) is moved forward by
   whole weeks with rd(), so weekdays stay put and it ends within a week of today.
   Go-lives and the history before them are placed from the start of the window with hd(). */
const SEED_BASE = '2026-08-14';
const SEED_TODAY = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
function addDays(d, n){ return new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10); }
const SEED_SHIFT_DAYS = Math.max(0, Math.floor((Date.parse(SEED_TODAY) - Date.parse(SEED_BASE)) / 864e5 / 7) * 7);
const SEED_START = addDays(SEED_TODAY, -364);
const ORIG_GO_LIVE = { t_epi:'2026-03-02', t_bmc:'2026-03-09', t_swt:'2026-04-06', t_mlc:'2026-05-14', t_jof:'2026-06-18' };
const GO_LIVE = { t_epi:addDays(SEED_START, 0), t_bmc:addDays(SEED_START, 2), t_swt:addDays(SEED_START, 9), t_mlc:addDays(SEED_START, 16), t_jof:addDays(SEED_START, 23) };
function rd(s){
  if (s < '2026-08-01' || !SEED_SHIFT_DAYS) return s;
  if (s.length === 10) return addDays(s, SEED_SHIFT_DAYS);
  const t = new Date(Date.parse(s) + SEED_SHIFT_DAYS * 864e5 + 8 * 36e5).toISOString();
  return t.slice(0, 19) + '+08:00';
}
/** A date from before the recent activity, moved by however far this account's go-live moved. */
function hd(s, tid){
  const t = Date.parse(s) + Math.round((Date.parse(GO_LIVE[tid]) - Date.parse(ORIG_GO_LIVE[tid])) / 864e5) * 864e5;
  return s.length === 10 ? new Date(t).toISOString().slice(0, 10) : new Date(t + 8 * 36e5).toISOString().slice(0, 19) + '+08:00';
}
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(x){ let h = 2166136261; for (let i = 0; i < x.length; i++){ h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/* Bump when the shape of the seed changes. app.js reseeds a browser holding any other version. */
const SEED_VERSION = 43;

function seedDatabase(){
  const db = {
    /* Bumped when the shape changes, so a browser holding the previous
       schema reseeds instead of running against half a database. */
    version: SEED_VERSION,
    createdAt: new Date().toISOString(),
    seededOn: SEED_TODAY,
    tenants: [], branches: [], users: [], items: [],
    invoices: [], corrections: [], activity: [], series: {},
    sessions: [], readings: [], platforms: [], sellers: [],
    onboardingApps: [], otherTaxpayers: [], dataRequests: [], interruptions: [], incidents: [], notices: [], manualInvoices: [], problemReports: []
  };

  /* ---------------------------------------------------------
     TENANT 1 — Bayanihan Mercantile Corp.
     Enterprise lane. LTS large taxpayer. 4 branches, 4 RDOs.
     Carries VATable, VAT-exempt and zero-rated lines so the
     mixed-breakdown rule (RMC 77-2024) is exercised.
     --------------------------------------------------------- */
  db.tenants.push({
    id:'t_bmc',
    name:'Bayanihan Mercantile Corp.',
    tradeName:'Bayanihan Mercantile',
    tin:'004-521-887',
    pti:'BIR-PTI-' + GO_LIVE.t_bmc.slice(0, 4) + '-01894',
    seriesPrefix:'BMC',
    vatStatus:'VAT',
    classification:'LARGE',
    lane:'ENTERPRISE', plan:'TIER2',
    jurisdictionType:'LTS',
    jurisdiction:'LT Division — Makati',
    onboardingStatus:'LIVE',
    hasExempt:true, hasZero:true, isWithholdingAgent:true, servesSCPWD:true,
    address:'12F Salcedo Corporate Centre, 128 Salcedo St., Legaspi Village, Makati City 1229',
    email:'finance@bayanihanmercantile.com.ph',
    attestedBy:'Ramon T. Villaflor',
    attestedAt:hd('2026-03-02T09:14:00+08:00', 't_bmc'),
    goLiveAt:hd('2026-03-09T08:00:00+08:00', 't_bmc'),
    connection:['API'],
    coverageBasis:'LTS'
  });

  const bmcBranches = [
    { id:'b_bmc_000', code:'000', name:'Head Office',   rdo:'RDO 049 — Makati City North', city:'Makati City',
      address:'12F Salcedo Corporate Centre, 128 Salcedo St., Legaspi Village, Makati City 1229' },
    { id:'b_bmc_001', code:'001', name:'Cebu Branch',   rdo:'RDO 080 — Mandaue City',      city:'Mandaue City',
      address:'Unit 4, Cebu Trade Hub, A.S. Fortuna St., Mandaue City 6014' },
    { id:'b_bmc_002', code:'002', name:'Davao Branch',  rdo:'RDO 113 — Davao City West',   city:'Davao City',
      address:'Ground Floor, Matina Commercial Arcade, McArthur Hwy, Davao City 8000' },
    { id:'b_bmc_003', code:'003', name:'Baguio Branch', rdo:'RDO 008 — Baguio City',       city:'Baguio City',
      address:'2F Session Prime Bldg., Session Road, Baguio City 2600' }
  ];
  bmcBranches.forEach(b => db.branches.push(Object.assign({ tenantId:'t_bmc', active:true }, b)));

  db.users.push(
    { id:'u_bmc_owner', tenantId:'t_bmc', branchId:null,        roleKey:'OWNER',
      name:'Ramon T. Villaflor',  email:'r.villaflor@bayanihanmercantile.com.ph', position:'President', active:true },
    { id:'u_bmc_fin',   tenantId:'t_bmc', branchId:null,        roleKey:'FINANCE',
      name:'Cecilia M. Ocampo',   email:'c.ocampo@bayanihanmercantile.com.ph',    position:'Finance Manager', active:true },
    { id:'u_bmc_sup',   tenantId:'t_bmc', branchId:'b_bmc_001', roleKey:'SUPERVISOR',
      name:'Dennis R. Alonzo',    email:'d.alonzo@bayanihanmercantile.com.ph',    position:'Branch Manager — Cebu', active:true },
    { id:'u_bmc_iss',   tenantId:'t_bmc', branchId:'b_bmc_000', roleKey:'ISSUER',
      name:'Marites B. Sandoval', email:'m.sandoval@bayanihanmercantile.com.ph',  position:'Billing Clerk', active:true },
    { id:'u_bmc_aud',   tenantId:'t_bmc', branchId:null,        roleKey:'AUDITOR',
      name:'Alfredo P. Lansangan', email:'alansangan@lansangan-cpa.ph',           position:'External CPA', active:true },

    /* Invited three days ago and not yet accepted — so the account screen has
       something in that state to show, and the activation flow has something
       to walk through without inviting someone first. Dated relative to now,
       unlike the rest of the seed, because an invitation that quietly ages out
       of its window would take the demonstration with it. */
    { id:'u_bmc_new',   tenantId:'t_bmc', branchId:'b_bmc_002', roleKey:'ISSUER',
      name:'Grace L. Tolentino', email:'g.tolentino@bayanihanmercantile.com.ph',
      position:'Billing Clerk — Davao', active:false,
      status:'INVITED', invitedAt:new Date(Date.now() - 3 * 864e5).toISOString(),
      invitedBy:'Ramon T. Villaflor', inviteToken:'K7QW2MHD' },

    /* And one that ran out, so the expiry path is reachable without waiting
       a week for it. */
    { id:'u_bmc_old',   tenantId:'t_bmc', branchId:'b_bmc_003', roleKey:'ISSUER',
      name:'Noel A. Bautista', email:'n.bautista@bayanihanmercantile.com.ph',
      position:'Billing Clerk — Baguio', active:false,
      status:'INVITED', invitedAt:new Date(Date.now() - 12 * 864e5).toISOString(),
      invitedBy:'Ramon T. Villaflor', inviteToken:'R4ZX8TVB' }
  );

  db.items.push(
    { id:'i_bmc_1', tenantId:'t_bmc', sku:'OFS-BND-A4',  desc:'Bond Paper A4, 80gsm (ream)',        unit:'ream', price:  285.00, treatment:'VATABLE' },
    { id:'i_bmc_2', tenantId:'t_bmc', sku:'HRD-PWR-18V', desc:'Cordless Drill 18V with battery',    unit:'unit',  price: 4480.00, treatment:'VATABLE' },
    { id:'i_bmc_3', tenantId:'t_bmc', sku:'APP-AIR-15',  desc:'Split-type Air Conditioner 1.5HP',   unit:'unit',  price:28560.00, treatment:'VATABLE' },
    { id:'i_bmc_4', tenantId:'t_bmc', sku:'AGR-RCE-25',  desc:'Well-milled Rice, 25kg sack',        unit:'sack',  price: 1650.00, treatment:'EXEMPT' },
    { id:'i_bmc_5', tenantId:'t_bmc', sku:'MED-MTF-500', desc:'Metformin 500mg (maintenance)',      unit:'box',   price:  420.00, treatment:'EXEMPT', scCovered:true },
    { id:'i_bmc_6', tenantId:'t_bmc', sku:'EXP-ABC-200', desc:'Abaca Fiber Bale (export)',          unit:'bale',  price:12750.00, treatment:'ZERO'    },
    { id:'i_bmc_7', tenantId:'t_bmc', sku:'EXP-CCO-100', desc:'Desiccated Coconut, 100kg (export)', unit:'sack',  price: 8900.00, treatment:'ZERO'    },
    /* VATable, but a medicine — so it carries the SC/PWD discount even though it
       is not one of the maintenance drugs exempted under Sec. 109. */
    { id:'i_bmc_8', tenantId:'t_bmc', sku:'MED-ASC-500', desc:'Ascorbic Acid 500mg, 100 tablets', unit:'bottle', price: 485.00, treatment:'VATABLE', scCovered:true, athleteCovered:true },
    { id:'i_bmc_9', tenantId:'t_bmc', sku:'BBY-FRM-900', desc:'Infant Formula Milk, 900g',            unit:'can',    price: 1260.00, treatment:'VATABLE', soloCovered:true },
    { id:'i_bmc_10', tenantId:'t_bmc', sku:'BBY-DPR-JMB', desc:'Sanitary Diapers, jumbo pack',        unit:'pack',   price:  640.00, treatment:'VATABLE', soloCovered:true },
    { id:'i_bmc_11', tenantId:'t_bmc', sku:'MED-AMX-250', desc:'Amoxicillin Suspension 250mg/5ml',    unit:'bottle', price:  210.00, treatment:'VATABLE', soloCovered:true, athleteCovered:true, rx:true },
    { id:'i_bmc_12', tenantId:'t_bmc', sku:'SPT-RKT-GRP', desc:'Badminton Racket, graphite',           unit:'pc',     price: 3200.00, treatment:'VATABLE', athleteCovered:true }
  );

  /* ---------------------------------------------------------
     TENANT 2 — Juana's Online Finds
     Express lane. MSME, single branch, e-commerce.
     --------------------------------------------------------- */
  db.tenants.push({
    id:'t_jof',
    name:"Juana's Online Finds",
    tradeName:"Juana's Online Finds",
    tin:'287-994-113',
    pti:'BIR-PTI-' + GO_LIVE.t_jof.slice(0, 4) + '-02207',
    seriesPrefix:'JOF',
    vatStatus:'VAT',
    classification:'SMALL',
    lane:'EXPRESS', plan:'TIER1',
    jurisdictionType:'RDO',
    jurisdiction:'RDO 039 — South Quezon City',
    onboardingStatus:'LIVE',
    hasExempt:false, hasZero:false, isWithholdingAgent:false, servesSCPWD:false,
    address:'19 Kalayaan Ave., Barangay Diliman, Quezon City 1101',
    email:'hello@juanasonlinefinds.ph',
    attestedBy:'Juana C. Ramirez',
    attestedAt:hd('2026-06-18T14:02:00+08:00', 't_jof'),
    goLiveAt:hd('2026-06-18T16:30:00+08:00', 't_jof'),
    /* Her seller centre exports the day's orders as a file; nothing on her side
       can post a sale as it happens. So bulk import is not a convenience here,
       it is the whole of how she issues. The marketplace she also sells on has
       a prebuilt connector, which is a second way in and not a replacement —
       an account can hold more than one. */
    connection:['BULK','CONNECTOR'],
    coverageBasis:'ECOMMERCE'
  });

  db.branches.push({
    id:'b_jof_000', tenantId:'t_jof', code:'000', name:'Main', rdo:'RDO 039 — South Quezon City',
    city:'Quezon City', address:'19 Kalayaan Ave., Barangay Diliman, Quezon City 1101', active:true
  });

  db.users.push(
    { id:'u_jof_owner', tenantId:'t_jof', branchId:null, roleKey:'OWNER',
      name:'Juana C. Ramirez', email:'juana@juanasonlinefinds.ph', position:'Proprietor', active:true },
    { id:'u_jof_iss',   tenantId:'t_jof', branchId:'b_jof_000', roleKey:'ISSUER',
      name:'Ellen V. Bautista', email:'ellen@juanasonlinefinds.ph', position:'Order Assistant', active:true }
  );

  db.items.push(
    { id:'i_jof_1', tenantId:'t_jof', sku:'ACC-EAR-BLK', desc:'Wireless Earbuds, Black',        unit:'pc', price: 899.00, treatment:'VATABLE' },
    { id:'i_jof_2', tenantId:'t_jof', sku:'ACC-CSE-CLR', desc:'Clear Phone Case, universal',    unit:'pc', price: 249.00, treatment:'VATABLE' },
    { id:'i_jof_3', tenantId:'t_jof', sku:'ACC-CBL-1M',  desc:'USB-C Charging Cable, 1 metre',  unit:'pc', price: 199.00, treatment:'VATABLE' },
    { id:'i_jof_4', tenantId:'t_jof', sku:'BAG-TOT-CNV', desc:'Canvas Tote Bag, natural',       unit:'pc', price: 549.00, treatment:'VATABLE' }
  );

  /* ---------------------------------------------------------
     TENANT 3 — Marikina Leather Crafters Co.
     E-Invoicing Only. Issues through this system same as anyone else —
     electronic sales reporting simply is not part of what this account
     is engaged for, so its invoices are seeded NOT_READY on the
     transmission side further down, deliberately and permanently, not
     as a stand-in for "waiting on BIR" like BMC and JOF.
     --------------------------------------------------------- */
  db.tenants.push({
    id:'t_mlc',
    name:'Marikina Leather Crafters Co.',
    tradeName:'Marikina Leather Crafters',
    tin:'331-042-556',
    pti:'BIR-PTI-' + GO_LIVE.t_mlc.slice(0, 4) + '-03165',
    seriesPrefix:'MLC',
    vatStatus:'VAT',
    classification:'SMALL',
    lane:'EXPRESS', plan:'TIER1',
    jurisdictionType:'RDO',
    jurisdiction:'RDO 045 — Marikina City',
    onboardingStatus:'LIVE',
    hasExempt:false, hasZero:false, isWithholdingAgent:false, servesSCPWD:true,
    address:'88 Shoe Avenue, Barangay Sta. Elena, Marikina City 1800',
    email:'orders@marikinaleather.ph',
    attestedBy:'Ferdinand L. Cruz',
    attestedAt:hd('2026-05-11T10:20:00+08:00', 't_mlc'),
    goLiveAt:hd('2026-05-14T08:00:00+08:00', 't_mlc'),
    connection:['BULK'],
    coverageBasis:'SOFTWARE_USER'
  });

  db.branches.push({
    id:'b_mlc_000', tenantId:'t_mlc', code:'000', name:'Main', rdo:'RDO 045 — Marikina City',
    city:'Marikina City', address:'88 Shoe Avenue, Barangay Sta. Elena, Marikina City 1800', active:true
  });

  db.users.push(
    { id:'u_mlc_owner', tenantId:'t_mlc', branchId:null,        roleKey:'OWNER',
      name:'Ferdinand L. Cruz', email:'ferdinand@marikinaleather.ph', position:'Proprietor', active:true },
    { id:'u_mlc_iss',   tenantId:'t_mlc', branchId:'b_mlc_000', roleKey:'ISSUER',
      name:'Josefina T. Ramos', email:'josefina@marikinaleather.ph', position:'Sales Clerk', active:true }
  );

  db.items.push(
    { id:'i_mlc_1', tenantId:'t_mlc', sku:'LTR-WLT-BFD', desc:'Leather Bifold Wallet',   unit:'pc', price: 650.00,  treatment:'VATABLE' },
    { id:'i_mlc_2', tenantId:'t_mlc', sku:'LTR-BLT-STD',  desc:'Leather Belt, standard',  unit:'pc', price: 480.00,  treatment:'VATABLE' },
    { id:'i_mlc_3', tenantId:'t_mlc', sku:'LTR-BAG-TOT',  desc:'Leather Tote Bag',        unit:'pc', price: 1850.00, treatment:'VATABLE' },
    { id:'i_mlc_4', tenantId:'t_mlc', sku:'LTR-SND-STD',  desc:'Leather Sandals, pair',   unit:'pair', price: 990.00, treatment:'VATABLE' }
  );

  /* ---------------------------------------------------------
     TENANT 4 — Sierra Wholesale Traders, Inc.
     ESR via API, ESP-managed. This account never issues a document — Sierra's
     own ERP does that, and holds Sierra's own PTI for it. What this account
     does is transmit and reconcile what Sierra's ERP has already issued, which
     is why it carries no bulk-import or platform-connector `connection` at
     all: neither applies to a taxpayer this system never issues for.
     --------------------------------------------------------- */
  db.tenants.push({
    id:'t_swt',
    name:'Sierra Wholesale Traders, Inc.',
    tradeName:'Sierra Wholesale Traders',
    tin:'558-771-204',
    pti:'BIR-PTI-' + GO_LIVE.t_swt.slice(0, 4) + '-04478',
    seriesPrefix:'SWT',
    vatStatus:'VAT',
    classification:'MEDIUM',
    lane:'ENTERPRISE', plan:'TIER2',
    jurisdictionType:'RDO',
    jurisdiction:'RDO 076 — Iloilo City',
    onboardingStatus:'LIVE',
    hasExempt:false, hasZero:false, isWithholdingAgent:true, servesSCPWD:false,
    address:'Sierra Distribution Center, National Highway, Mandurriao, Iloilo City 5000',
    email:'accounts@sierrawholesale.ph',
    attestedBy:'Corazon P. Villareal',
    attestedAt:hd('2026-04-02T09:00:00+08:00', 't_swt'),
    goLiveAt:hd('2026-04-06T08:00:00+08:00', 't_swt'),
    connection:[],
    coverageBasis:'SOFTWARE_USER',
    issuesOn:'OWN_SYSTEM',
    esrMode:'ESP_MANAGED'
  });

  db.branches.push({
    id:'b_swt_000', tenantId:'t_swt', code:'000', name:'Head Office', rdo:'RDO 076 — Iloilo City',
    city:'Iloilo City', address:'Sierra Distribution Center, National Highway, Mandurriao, Iloilo City 5000', active:true
  });

  db.users.push(
    { id:'u_swt_owner', tenantId:'t_swt', branchId:null, roleKey:'OWNER',
      name:'Corazon P. Villareal', email:'corazon@sierrawholesale.ph', position:'President', active:true },
    { id:'u_swt_fin',   tenantId:'t_swt', branchId:null, roleKey:'FINANCE',
      name:'Ramon T. Ibañez', email:'ramon@sierrawholesale.ph', position:'Finance Manager', active:true }
  );

  db.items.push(
    { id:'i_swt_1', tenantId:'t_swt', sku:'WHS-SRD-155', desc:'Canned Sardines 155g (case of 48)',   unit:'case', price: 1180.00, treatment:'VATABLE' },
    { id:'i_swt_2', tenantId:'t_swt', sku:'WHS-NDL-060',  desc:'Instant Noodles 60g (case of 30)',    unit:'case', price: 645.00,  treatment:'VATABLE' },
    { id:'i_swt_3', tenantId:'t_swt', sku:'WHS-WTR-500',  desc:'Bottled Water 500mL (case of 24)',    unit:'case', price: 288.00,  treatment:'VATABLE' }
  );


  /* ---------------------------------------------------------
     TENANT 0 — Eastland Printink, Inc. (EPI)
     The provider is also a taxpayer and the sample company the demonstration issues from. It prints
     for business buyers and invoices its clients for the System (RMC VII.2), so one account carries both,
     with different people doing each. It is not a client of itself: no plan, no deposit, no monthly
     bill (isProvider).
     --------------------------------------------------------- */
  db.tenants.push({
    id:'t_epi',
    name:SYSTEM.vendor,
    tradeName:'Eastland Printink',
    tin:SYSTEM.taxpayer.tin,
    pti:'BIR-PTI-' + GO_LIVE.t_epi.slice(0, 4) + '-00112',
    seriesPrefix:'EPI',
    vatStatus:'VAT',
    classification:'MEDIUM',
    lane:'ENTERPRISE', plan:'TIER5', isProvider:true,
    jurisdictionType:'RDO',
    jurisdiction:'RDO 023 — Valenzuela City',
    onboardingStatus:'LIVE',
    hasExempt:true, hasZero:true, isWithholdingAgent:true, servesSCPWD:false,
    address:SYSTEM.taxpayer.address,
    email:'accounting@eastlandprintink.ph',
    attestedBy:'Rodrigo L. Evangelista',
    attestedAt:hd('2026-02-23T09:00:00+08:00', 't_epi'),
    goLiveAt:hd('2026-03-02T08:00:00+08:00', 't_epi'),
    connection:[],
    coverageBasis:'SOFTWARE_USER'
  });

  [ { id:'b_epi_000', code:'000', name:'Main Office', rdo:'RDO 023 — Valenzuela City', city:'Valenzuela City',
      address:SYSTEM.taxpayer.address }
  ].forEach(b => db.branches.push(Object.assign({ tenantId:'t_epi', active:true }, b)));

  db.users.push(
    { id:'u_epi_owner', tenantId:'t_epi', branchId:null,        roleKey:'OWNER',
      name:'Rodrigo L. Evangelista', email:'r.evangelista@eastlandprintink.ph', position:'President', active:true },
    { id:'u_epi_fin',   tenantId:'t_epi', branchId:null,        roleKey:'FINANCE',
      name:'Lourdes P. Manansala',   email:'l.manansala@eastlandprintink.ph',   position:'Accounting Manager', active:true },
    { id:'u_epi_sup',   tenantId:'t_epi', branchId:'b_epi_000', roleKey:'SUPERVISOR',
      name:'Victor M. Salonga',      email:'v.salonga@eastlandprintink.ph',     position:'Sales Supervisor', active:true },
    { id:'u_epi_prt',   tenantId:'t_epi', branchId:'b_epi_000', roleKey:'ISSUER',
      name:'Nestor B. Calderon',     email:'n.calderon@eastlandprintink.ph',    position:'Printing Sales Coordinator', active:true },
    { id:'u_epi_bil',   tenantId:'t_epi', branchId:'b_epi_000', roleKey:'ISSUER',
      name:'Aileen S. Dumlao',       email:'a.dumlao@eastlandprintink.ph',      position:'Billing Specialist, System fees', active:true },
    { id:'u_epi_aud',   tenantId:'t_epi', branchId:null,        roleKey:'AUDITOR',
      name:'Benjamin O. Tuazon',     email:'btuazon@tuazon-cpa.ph',             position:'External CPA', active:true }
  );

  db.items.push(
    { id:'i_epi_1', tenantId:'t_epi', sku:'PRT-INV-50',  desc:'Printed Sales Invoice, 50 sets, duplicate (booklet)', unit:'booklet', price:  185.00, treatment:'VATABLE' },
    { id:'i_epi_2', tenantId:'t_epi', sku:'PRT-FLY-A5',  desc:'Flyers A5, full color, 1,000 pcs',                    unit:'lot',     price: 2650.00, treatment:'VATABLE' },
    { id:'i_epi_3', tenantId:'t_epi', sku:'PRT-BCD-500', desc:'Business Cards, 500 pcs, laminated',                  unit:'box',     price:  980.00, treatment:'VATABLE' },
    { id:'i_epi_4', tenantId:'t_epi', sku:'PRT-BRC-A4',  desc:'Brochures A4, tri-fold, 500 pcs',                     unit:'lot',     price: 5400.00, treatment:'VATABLE' },
    { id:'i_epi_5', tenantId:'t_epi', sku:'PRT-TRP-3X6', desc:'Tarpaulin 3 x 6 ft with eyelets',                     unit:'pc',      price:  720.00, treatment:'VATABLE' },
    { id:'i_epi_6', tenantId:'t_epi', sku:'PRT-FRM-CNT', desc:'Continuous Forms, 3-ply, 2,000 sets',                 unit:'carton',  price: 6800.00, treatment:'VATABLE' },
    { id:'i_epi_7', tenantId:'t_epi', sku:'PRT-BOK-200', desc:'Printed Textbook, 200 pages (books are VAT-exempt)',  unit:'copy',    price:  185.00, treatment:'EXEMPT' },
    { id:'i_epi_8', tenantId:'t_epi', sku:'PRT-EXP-BRC', desc:'Brochures A4, 500 pcs, for export',                   unit:'lot',     price: 5200.00, treatment:'ZERO' }
  );

  /* ---------------------------------------------------------
     Background taxpayers — appear in reports and monitoring
     in later phases; no portal of their own.
     --------------------------------------------------------- */
  db.otherTaxpayers = [
    { name:'Sigla Health Supplies, Inc.',  tin:'118-337-025', classification:'MEDIUM', jurisdiction:'RDO 044 — Taguig City', note:'Mixed VATable and VAT-exempt' },
    { name:'Pilipinas Export Trading Co.', tin:'602-118-449', classification:'LARGE',  jurisdiction:'LT Division — Makati',  note:'Zero-rated export sales' },
    { name:'MetroRide Mobility, Inc.',     tin:'331-806-772', classification:'LARGE',  jurisdiction:'LT Division — Makati',  note:'On-demand transport services' },
    { name:'TindaHub Philippines, Inc.',   tin:'447-229-618', classification:'LARGE',  jurisdiction:'LT Division — Makati',  note:'Marketplace platform, seller accounts' }
  ];

  /* ---------------------------------------------------------
     Invoices
     --------------------------------------------------------- */
  /* Series are scoped per taxpayer PER BRANCH — each branch runs its own
     independent sequence. Bases reflect volume since go-live in March 2026. */
  const bmcSeq = { b_bmc_000:140, b_bmc_001:88, b_bmc_002:51, b_bmc_003:22 };
  let jofSeq = 88;

  function mkInvoice(o){
    const totals = computeTotals(o.lines, o.discount || 0, { scpwd: !!o.scpwd, ewtRate: o.ewtRate });
    return Object.assign({
      id: uid('inv'),
      docType:'INVOICE',
      docStatus:'ISSUED',
      deliveryStatus:'DELIVERED',
      deliveryAttempts:1,
      transmissionStatus:'TRANSMITTED',
      transmissionRef:'ESRS-' + o.issuedAt.slice(0,10).replace(/-/g,'') + '-' + Math.floor(10000 + Math.random()*89999),
      currency:'PHP',
      keycode: keycode(8),
      discount: o.discount || 0,
      totals
    }, o);
  }

  const bmcInv = [
    /* Northgate is on BIR's top withholding agents list, so it withholds 1%
       at source on goods bought from BMC and remits it — the tax due on the
       face does not move, but what BMC actually collects on the 30-day terms
       below is net of that 1%. */
    { branchId:'b_bmc_000', issuedAt:rd('2026-08-14T09:12:00+08:00'),
      buyer:{ name:'Northgate Facilities Management Inc.', tin:'221-556-903', address:'8F Northgate Tower, Alabang, Muntinlupa City' },
      paymentStatus:'UNPAID', terms:'30 days', ewtRate:0.01,
      lines:[ { itemId:'i_bmc_1', desc:'Bond Paper A4, 80gsm (ream)', sku:'OFS-BND-A4', qty:40, unit:'ream', unitPrice:285.00, treatment:'VATABLE' },
              { itemId:'i_bmc_2', desc:'Cordless Drill 18V with battery', sku:'HRD-PWR-18V', qty:3, unit:'unit', unitPrice:4480.00, treatment:'VATABLE' } ] },

    { branchId:'b_bmc_000', issuedAt:rd('2026-08-14T11:40:00+08:00'),
      buyer:{ name:'Walk-in Customer', tin:null, address:null },
      paymentStatus:'PAID', paymentMethod:'Cash',
      lines:[ { itemId:'i_bmc_4', desc:'Well-milled Rice, 25kg sack', sku:'AGR-RCE-25', qty:2, unit:'sack', unitPrice:1650.00, treatment:'EXEMPT' },
              { itemId:'i_bmc_1', desc:'Bond Paper A4, 80gsm (ream)', sku:'OFS-BND-A4', qty:2, unit:'ream', unitPrice:285.00, treatment:'VATABLE' } ] },

    { branchId:'b_bmc_001', issuedAt:rd('2026-08-13T14:22:00+08:00'),
      buyer:{ name:'Visayas Agri Traders Corp.', tin:'318-772-004', address:'Reclamation Area, Cebu City' },
      paymentStatus:'PAID', paymentMethod:'Bank Transfer',
      lines:[ { itemId:'i_bmc_6', desc:'Abaca Fiber Bale (export)', sku:'EXP-ABC-200', qty:6, unit:'bale', unitPrice:12750.00, treatment:'ZERO' } ] },

    { branchId:'b_bmc_001', issuedAt:rd('2026-08-13T10:05:00+08:00'),
      buyer:{ name:'Mandaue Hardware Depot', tin:'447-118-330', address:'A.S. Fortuna St., Mandaue City' },
      paymentStatus:'PAID', paymentMethod:'Cheque',
      lines:[ { itemId:'i_bmc_2', desc:'Cordless Drill 18V with battery', sku:'HRD-PWR-18V', qty:8, unit:'unit', unitPrice:4480.00, treatment:'VATABLE' },
              { itemId:'i_bmc_5', desc:'Metformin 500mg (maintenance)', sku:'MED-MTF-500', qty:12, unit:'box', unitPrice:420.00, treatment:'EXEMPT' },
              { itemId:'i_bmc_7', desc:'Desiccated Coconut, 100kg (export)', sku:'EXP-CCO-100', qty:3, unit:'sack', unitPrice:8900.00, treatment:'ZERO' } ] },

    { branchId:'b_bmc_002', issuedAt:rd('2026-08-12T16:48:00+08:00'),
      buyer:{ name:'Davao Central Supplies', tin:'509-223-871', address:'Quimpo Blvd., Davao City' },
      paymentStatus:'PARTIAL', terms:'60 days',
      lines:[ { itemId:'i_bmc_3', desc:'Split-type Air Conditioner 1.5HP', sku:'APP-AIR-15', qty:4, unit:'unit', unitPrice:28560.00, treatment:'VATABLE' } ] },

    /* Senior citizen sale. The bond paper is not a covered purchase, so it stays
       VATable at full price. The medicines are covered: the maintenance drug is
       already exempt under Sec. 109, the vitamins are VATable but the sale to a
       senior is exempt — VAT comes off, then 20% off the net. */
    { branchId:'b_bmc_003', issuedAt:rd('2026-08-12T09:30:00+08:00'),
      buyer:{ name:'Rosario D. Fajardo', tin:null, address:'Session Road, Baguio City' },
      paymentStatus:'PAID', paymentMethod:'GCash',
      scpwd:{ type:'Senior Citizen', id:'SC-CAR-2019-40218', name:'Rosario D. Fajardo' },
      lines:[ { itemId:'i_bmc_1', desc:'Bond Paper A4, 80gsm (ream)', sku:'OFS-BND-A4', qty:5, unit:'ream', unitPrice:285.00, treatment:'VATABLE' },
              { itemId:'i_bmc_5', desc:'Metformin 500mg (maintenance)', sku:'MED-MTF-500', qty:4, unit:'box', unitPrice:420.00, treatment:'EXEMPT', scEligible:true },
              { itemId:'i_bmc_8', desc:'Ascorbic Acid 500mg, 100 tablets', sku:'MED-ASC-500', qty:2, unit:'bottle', unitPrice:485.00, treatment:'VATABLE', scEligible:true } ] },

    { branchId:'b_bmc_002', issuedAt:rd('2026-08-11T13:15:00+08:00'),
      buyer:{ name:'Mindanao Builders Supply', tin:'662-005-114', address:'Bajada, Davao City' },
      paymentStatus:'UNPAID', terms:'30 days',
      lines:[ { itemId:'i_bmc_2', desc:'Cordless Drill 18V with battery', sku:'HRD-PWR-18V', qty:15, unit:'unit', unitPrice:4480.00, treatment:'VATABLE' } ] },

    /* A homeowners' association is also a common top-withholding-agent
       designee — paid by bank transfer net of the same 1%, with the
       certificate to follow on Form 2307. */
    { branchId:'b_bmc_000', issuedAt:rd('2026-08-11T08:55:00+08:00'),
      buyer:{ name:'Alabang Country Homes Assn.', tin:'773-118-226', address:'Alabang, Muntinlupa City' },
      paymentStatus:'PAID', paymentMethod:'Bank Transfer', ewtRate:0.01,
      lines:[ { itemId:'i_bmc_3', desc:'Split-type Air Conditioner 1.5HP', sku:'APP-AIR-15', qty:2, unit:'unit', unitPrice:28560.00, treatment:'VATABLE' } ] }
  ];

  bmcInv.forEach(o => {
    const br = db.branches.find(b => b.id === o.branchId);
    bmcSeq[o.branchId]++;
    const inv = mkInvoice(Object.assign({ tenantId:'t_bmc' }, o));
    inv.number = formatSeriesNumber('BMC', br.code, 2026, bmcSeq[o.branchId]);
    inv.issuedBy = 'Marites B. Sandoval';
    inv.issuedVia = 'API: Bayanihan ERP connector';
    db.invoices.push(inv);
  });

  /* One delivery failure and one transmission failure on BMC */
  db.invoices[6].deliveryStatus = 'FAILED';
  db.invoices[6].deliveryAttempts = 3;
  db.invoices[6].deliverToAlt = '0917 555 0142';
  const bmc = db.tenants.find(t => t.id === 't_bmc'); if (bmc) bmc.deliveryFallback = 'SMS';
  db.invoices[4].transmissionStatus = 'FAILED';
  db.invoices[4].transmissionRef = null;
  db.invoices[4].transmissionError = 'BIR EIS unavailable (INT-2026-0001)';
  /* The failure traces to a verified outage, so the attempt log and the
     interruption log agree on what happened. */
  const failedAt = new Date(db.invoices[4].issuedAt).getTime();
  db.interruptions = [{
    id:'int_1', ref:'INT-2026-0001', source:'EIS',
    startedAt:new Date(failedAt - 20 * 60000).toISOString(),
    endedAt:new Date(failedAt + 5 * 3600000).toISOString(),
    note:'BIR EIS did not answer. Every send in the window timed out.',
    verified:true, declaredBy:'EPI network operations'
  }];
  db.invoices[4].transmissionAttempts = [1, 6, 15].map(m => ({
    at:new Date(failedAt + m * 60000).toISOString(), result:'FAILED', cause:'EIS', interruptionId:'int_1',
    detail:'BIR EIS unavailable (INT-2026-0001)' }));
  db.manualInvoices = [];
  db.problemReports = [];

  /* One cancelled invoice — number retired, never reused */
  bmcSeq.b_bmc_000++;
  const cancelled = mkInvoice({
    tenantId:'t_bmc', branchId:'b_bmc_000', issuedAt:rd('2026-08-10T15:20:00+08:00'),
    buyer:{ name:'Northgate Facilities Management Inc.', tin:'221-556-903', address:'8F Northgate Tower, Alabang, Muntinlupa City' },
    paymentStatus:'UNPAID',
    lines:[ { itemId:'i_bmc_1', desc:'Bond Paper A4, 80gsm (ream)', sku:'OFS-BND-A4', qty:40, unit:'ream', unitPrice:285.00, treatment:'VATABLE' } ]
  });
  cancelled.number = formatSeriesNumber('BMC','000',2026,bmcSeq.b_bmc_000);
  cancelled.docStatus = 'CANCELLED';
  /* Cancelled inside the period and before transmission, so there is no
     acknowledgment to show — this is the cancel side of the correction boundary. */
  cancelled.transmissionStatus = 'NOT_READY';
  cancelled.transmissionRef = null;
  cancelled.cancelledAt = rd('2026-08-10T15:44:00+08:00');
  cancelled.cancelReason = 'DUPLICATE';
  cancelled.cancelNote = 'Duplicate of BMC-000-2026-000141. Same PO, keyed twice by the ERP connector.';
  cancelled.issuedBy = 'Marites B. Sandoval';
  db.invoices.push(cancelled);

  /* One paid invoice to a hardware buyer */
  bmcSeq.b_bmc_001++;
  const credited = mkInvoice({
    tenantId:'t_bmc', branchId:'b_bmc_001', issuedAt:rd('2026-08-09T11:00:00+08:00'),
    buyer:{ name:'Mandaue Hardware Depot', tin:'447-118-330', address:'A.S. Fortuna St., Mandaue City' },
    paymentStatus:'PAID', paymentMethod:'Cheque',
    lines:[ { itemId:'i_bmc_2', desc:'Cordless Drill 18V with battery', sku:'HRD-PWR-18V', qty:10, unit:'unit', unitPrice:4480.00, treatment:'VATABLE' } ]
  });
  credited.number = formatSeriesNumber('BMC','001',2026,bmcSeq.b_bmc_001);
  credited.issuedBy = 'Dennis R. Alonzo';
  db.invoices.push(credited);

  /* Juana's Online Finds — e-commerce volume, small values */
  const jofBuyers = [
    { name:'Maria Dela Cruz',    address:'25 Sampaguita St., Quezon City 1100' },
    { name:'Angelo Bautista',    address:'7 Mabini St., Pasig City 1600' },
    { name:'Kristine Salazar',   address:'112 Rizal Ave., Caloocan City 1400' },
    { name:'Paolo Mendoza',      address:'44 Bonifacio St., Marikina City 1800' },
    { name:'Walk-in Customer',   address:null },
    { name:'Trisha Villanueva',  address:'9 Katipunan Ext., Quezon City 1108' },
    { name:'Rafael Ong',         address:'303 Banawe St., Quezon City 1114' }
  ];
  const jofBaskets = [
    [ { id:'i_jof_1', qty:1 }, { id:'i_jof_3', qty:1 } ],
    [ { id:'i_jof_2', qty:2 } ],
    [ { id:'i_jof_4', qty:1 }, { id:'i_jof_2', qty:1 } ],
    [ { id:'i_jof_1', qty:2 } ],
    [ { id:'i_jof_3', qty:3 } ],
    [ { id:'i_jof_4', qty:2 }, { id:'i_jof_1', qty:1 } ],
    [ { id:'i_jof_2', qty:1 }, { id:'i_jof_3', qty:1 } ]
  ];
  const jofTimes = [
    rd('2026-08-14T10:05:00+08:00'),rd('2026-08-14T08:41:00+08:00'),rd('2026-08-13T19:12:00+08:00'),
    rd('2026-08-13T15:33:00+08:00'),rd('2026-08-12T20:07:00+08:00'),rd('2026-08-12T12:19:00+08:00'),
    rd('2026-08-11T17:52:00+08:00')
  ];

  jofBaskets.forEach((basket, i) => {
    jofSeq++;
    const lines = basket.map(b => {
      const it = db.items.find(x => x.id === b.id);
      return { itemId:it.id, desc:it.desc, sku:it.sku, qty:b.qty, unit:it.unit, unitPrice:it.price, treatment:it.treatment };
    });
    const inv = mkInvoice({
      tenantId:'t_jof', branchId:'b_jof_000', issuedAt: jofTimes[i],
      buyer:{ name: jofBuyers[i].name, tin:null, address: jofBuyers[i].address },
      paymentStatus:'PAID', paymentMethod: i % 2 ? 'GCash' : 'Card',
      lines
    });
    inv.number = formatSeriesNumber('JOF','000',2026,jofSeq);
    inv.issuedBy = 'Ellen V. Bautista';
    inv.issuedVia = 'Bulk import: seller center orders file';
    db.invoices.push(inv);
  });

  db.invoices[db.invoices.length - 2].deliveryStatus = 'FAILED';
  db.invoices[db.invoices.length - 2].deliveryAttempts = 3;

  /* ---------------------------------------------------------
     Marikina Leather Crafters — issued normally, never transmitted.
     NOT_READY here is permanent, not a queue position: electronic sales
     reporting is not part of this account's package, so there is nothing
     further for these to wait on.
     --------------------------------------------------------- */
  let mlcSeq = 40;
  const mlcInv = [
    { issuedAt:rd('2026-08-14T10:30:00+08:00'),
      buyer:{ name:'Walk-in Customer', tin:null, address:null },
      paymentStatus:'PAID', paymentMethod:'Cash',
      lines:[ { itemId:'i_mlc_1', desc:'Leather Bifold Wallet', sku:'LTR-WLT-BFD', qty:1, unit:'pc', unitPrice:650.00, treatment:'VATABLE' },
              { itemId:'i_mlc_2', desc:'Leather Belt, standard', sku:'LTR-BLT-STD', qty:1, unit:'pc', unitPrice:480.00, treatment:'VATABLE' } ] },

    { issuedAt:rd('2026-08-13T15:10:00+08:00'),
      buyer:{ name:'Marites Ocampo', tin:null, address:'21 Riverbanks Ave., Marikina City' },
      paymentStatus:'PAID', paymentMethod:'GCash',
      lines:[ { itemId:'i_mlc_3', desc:'Leather Tote Bag', sku:'LTR-BAG-TOT', qty:1, unit:'pc', unitPrice:1850.00, treatment:'VATABLE' },
              { itemId:'i_mlc_4', desc:'Leather Sandals, pair', sku:'LTR-SND-STD', qty:1, unit:'pair', unitPrice:990.00, treatment:'VATABLE' } ] },

    { issuedAt:rd('2026-08-12T11:45:00+08:00'),
      buyer:{ name:'Riverside Boutique Reseller', tin:'405-661-882', address:'Concepcion Uno, Marikina City' },
      paymentStatus:'UNPAID', terms:'30 days',
      lines:[ { itemId:'i_mlc_1', desc:'Leather Bifold Wallet', sku:'LTR-WLT-BFD', qty:12, unit:'pc', unitPrice:650.00, treatment:'VATABLE' } ] },

    { issuedAt:rd('2026-08-11T09:20:00+08:00'),
      buyer:{ name:'Bienvenido S. Torres', tin:null, address:'Sto. Niño, Marikina City' },
      paymentStatus:'PAID', paymentMethod:'Cash',
      scpwd:{ type:'Senior Citizen', id:'SC-NCR-2016-08834', name:'Bienvenido S. Torres' },
      lines:[ { itemId:'i_mlc_4', desc:'Leather Sandals, pair', sku:'LTR-SND-STD', qty:1, unit:'pair', unitPrice:990.00, treatment:'VATABLE', scEligible:true } ] }
  ];

  mlcInv.forEach(o => {
    mlcSeq++;
    const inv = mkInvoice(Object.assign({ tenantId:'t_mlc', branchId:'b_mlc_000' }, o));
    inv.number = formatSeriesNumber('MLC','000',2026,mlcSeq);
    inv.issuedBy = 'Josefina T. Ramos';
    inv.issuedVia = 'Bulk import: end-of-day sales file';
    /* Permanent, not a queue position — see the block comment above. */
    inv.transmissionStatus = 'NOT_READY';
    inv.transmissionRef = null;
    db.invoices.push(inv);
  });

  /* ---------------------------------------------------------
     Sierra Wholesale Traders — issued on Sierra's own ERP, never on this
     system. issuedBy/issuedVia name the taxpayer's own system and staff,
     because that is who actually issued these; this account's part starts
     at transmission, which is why it shows TRANSMITTED same as anyone else.
     --------------------------------------------------------- */
  let swtSeq = 200;
  const swtInv = [
    { issuedAt:rd('2026-08-14T07:50:00+08:00'),
      buyer:{ name:'Panay Grocery Mart, Inc.', tin:'220-447-119', address:'Jalandoni St., Iloilo City' },
      paymentStatus:'PAID', paymentMethod:'Bank Transfer',
      lines:[ { itemId:'i_swt_1', desc:'Canned Sardines 155g (case of 48)', sku:'WHS-SRD-155', qty:60, unit:'case', unitPrice:1180.00, treatment:'VATABLE' },
              { itemId:'i_swt_3', desc:'Bottled Water 500mL (case of 24)',  sku:'WHS-WTR-500', qty:40, unit:'case', unitPrice:288.00,  treatment:'VATABLE' } ] },

    { issuedAt:rd('2026-08-13T13:35:00+08:00'),
      buyer:{ name:'Guimaras Island Distribution Corp.', tin:'337-902-215', address:'Jordan, Guimaras' },
      paymentStatus:'UNPAID', terms:'60 days',
      lines:[ { itemId:'i_swt_2', desc:'Instant Noodles 60g (case of 30)', sku:'WHS-NDL-060', qty:150, unit:'case', unitPrice:645.00, treatment:'VATABLE' } ] },

    /* A top-withholding-agent buyer, same 1%-at-source mechanic as BMC's
       Northgate example. */
    { issuedAt:rd('2026-08-12T16:05:00+08:00'),
      buyer:{ name:'MetroGo Convenience Retail, Inc.', tin:'119-336-540', address:'Diversion Rd., Mandurriao, Iloilo City' },
      paymentStatus:'PAID', paymentMethod:'Bank Transfer', ewtRate:0.01,
      lines:[ { itemId:'i_swt_1', desc:'Canned Sardines 155g (case of 48)', sku:'WHS-SRD-155', qty:80, unit:'case', unitPrice:1180.00, treatment:'VATABLE' } ] },

    { issuedAt:rd('2026-08-11T10:15:00+08:00'),
      buyer:{ name:'Panay Grocery Mart, Inc.', tin:'220-447-119', address:'Jalandoni St., Iloilo City' },
      paymentStatus:'PAID', paymentMethod:'Bank Transfer',
      lines:[ { itemId:'i_swt_2', desc:'Instant Noodles 60g (case of 30)', sku:'WHS-NDL-060', qty:50, unit:'case', unitPrice:645.00, treatment:'VATABLE' },
              { itemId:'i_swt_3', desc:'Bottled Water 500mL (case of 24)', sku:'WHS-WTR-500', qty:70, unit:'case', unitPrice:288.00, treatment:'VATABLE' } ] }
  ];

  swtInv.forEach(o => {
    swtSeq++;
    const inv = mkInvoice(Object.assign({ tenantId:'t_swt', branchId:'b_swt_000' }, o));
    inv.number = formatSeriesNumber('SWT','000',2026,swtSeq);
    inv.issuedBy = 'Ramon T. Ibañez';
    inv.issuedVia = "API: Sierra's own ERP (issued on the taxpayer's system, not this one)";
    db.invoices.push(inv);
  });

  /* EPI's own sample for the mixed-VAT invoice: a printed order with VATable, VAT-exempt (books) and zero-rated (export) lines. */
  const epiMixed = mkInvoice({ tenantId:'t_epi', branchId:'b_epi_000', issuedAt:addDays(SEED_TODAY, -6) + 'T10:20:00+08:00',
    buyer:{ name:'Quezon Textile Mills Corp.', tin:'556-102-774', address:'North Ave., Quezon City' },
    paymentStatus:'PAID', paymentMethod:'Bank Transfer',
    lines:[ { itemId:'i_epi_2', desc:'Flyers A5, full color, 1,000 pcs', sku:'PRT-FLY-A5', qty:3, unit:'lot', unitPrice:2650.00, treatment:'VATABLE' },
            { itemId:'i_epi_7', desc:'Printed Textbook, 200 pages (books are VAT-exempt)', sku:'PRT-BOK-200', qty:120, unit:'copy', unitPrice:185.00, treatment:'EXEMPT' },
            { itemId:'i_epi_8', desc:'Brochures A4, 500 pcs, for export', sku:'PRT-EXP-BRC', qty:2, unit:'lot', unitPrice:5200.00, treatment:'ZERO' } ] });
  epiMixed.number = 'EPI-000-2026-000000'; epiMixed.issuedBy = 'Nestor B. Calderon'; epiMixed.issuedVia = 'Web: EPI sales desk (this system)';
  db.invoices.push(epiMixed);

  /* ---------------------------------------------------------
     A year of history

     From the day after each account's go-live up to yesterday, skipping the
     branch-days that already carry hand-written documents. Each day is drawn from a generator seeded by
     the account and the date, so a given day always produces the same documents.
     Numbers are assigned afterwards, in date order, by renumberSeries().
     Volumes are modest on purpose: the whole database has to fit in the
     browser's storage with room left for what people do in the demo.
     --------------------------------------------------------- */
  const histCorr = [];
  let dupOf = null;
  (function buildHistory(){
    const dayStr = iso => new Date(new Date(iso).getTime() + 8 * 36e5).toISOString().slice(0, 10);
    const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
    const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
    const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const pad = n => String(n).padStart(2, '0');
    const stamp = (day, hh, mm, ss) => `${day}T${pad(hh)}:${pad(mm)}:${pad(ss || 0)}+08:00`;
    const line = (id, qty) => {
      const it = db.items.find(x => x.id === id);
      return { itemId:it.id, desc:it.desc, sku:it.sku, qty, unit:it.unit, unitPrice:it.price, treatment:it.treatment };
    };
    const priceOf = id => db.items.find(x => x.id === id).price;
    const some = (r, pool, n, qtyOf) => {
      const out = [], seen = new Set();
      while (out.length < n){
        const id = pick(r, pool);
        if (seen.has(id)) continue;
        seen.add(id); out.push(line(id, qtyOf(id)));
      }
      return out;
    };
    /* Busier towards year end, and growing through the year. */
    const SEASON = [1, .95, 1, 1, .98, .97, 1, 1.02, 1.05, 1.08, 1.2, 1.35];

    const bmcBuyers = [
      { name:'Northgate Facilities Management Inc.', tin:'221-556-903', address:'8F Northgate Tower, Alabang, Muntinlupa City', terms:'30 days', ewt:0.01 },
      { name:'Mandaue Hardware Depot',               tin:'447-118-330', address:'A.S. Fortuna St., Mandaue City',               terms:'30 days' },
      { name:'Cordillera Trading House',             tin:'882-441-006', address:'Km. 5, La Trinidad, Benguet',                  terms:'30 days' },
      { name:'Visayas Builders Supply Inc.',         tin:'310-772-518', address:'Mabolo, Cebu City',                            terms:'30 days' },
      { name:'Pasig Office Solutions Inc.',          tin:'205-338-947', address:'Ortigas Ave., Pasig City',                     terms:'15 days' },
      { name:'Davao Agri-Ventures Corp.',            tin:'514-209-663', address:'Bajada, Davao City',                           terms:'30 days' },
      { name:'Metro Pharma Retail, Inc.',            tin:'339-481-225', address:'Shaw Blvd., Mandaluyong City',                 terms:'30 days' },
      { name:'Subic Freight and Logistics Corp.',    tin:'487-603-119', address:'SBMA Freeport, Zambales',                      terms:'45 days' },
      { name:'Quezon Textile Mills Corp.',           tin:'556-102-774', address:'North Ave., Quezon City',                      terms:'30 days' },
      { name:'Cebu Fastener Trading',                tin:'229-887-410', address:'Colon St., Cebu City',                         terms:'15 days' },
      { name:'Benguet Export Partners',              tin:'622-915-304', address:'Naguilian Rd., Baguio City',                   terms:'30 days', exporter:true }
    ];
    const bmcPool = ['i_bmc_1','i_bmc_2','i_bmc_3','i_bmc_4','i_bmc_5','i_bmc_8','i_bmc_9','i_bmc_10','i_bmc_11','i_bmc_12'];
    const bmcCounter = ['i_bmc_1','i_bmc_4','i_bmc_5','i_bmc_8','i_bmc_9','i_bmc_10','i_bmc_11','i_bmc_12'];

    const jofNames = [
      { name:'Maria Dela Cruz',   address:'25 Sampaguita St., Quezon City 1100' },
      { name:'Angelo Bautista',   address:'7 Mabini St., Pasig City 1600' },
      { name:'Kristine Salazar',  address:'112 Rizal Ave., Caloocan City 1400' },
      { name:'Paolo Mendoza',     address:'44 Bonifacio St., Marikina City 1800' },
      { name:'Trisha Villanueva', address:'9 Katipunan Ext., Quezon City 1108' },
      { name:'Rafael Ong',        address:'303 Banawe St., Quezon City 1114' },
      { name:'Jasmine Reyes',     address:'18 Aurora Blvd., San Juan City 1500' },
      { name:'Carlo Navarro',     address:'62 Shaw Blvd., Mandaluyong City 1550' },
      { name:'Beatriz Castillo',  address:'5 Congressional Ave., Quezon City 1100' },
      { name:'Miguel Santos',     address:'71 Del Pilar St., Makati City 1200' },
      { name:'Hannah Mercado',    address:'30 Roxas Blvd., Pasay City 1300' },
      { name:'Joaquin Lim',       address:'14 Visayas Ave., Quezon City 1128' },
      { name:'Patricia Aquino',   address:'88 Ortigas Ext., Cainta, Rizal 1900' },
      { name:'Dominic Tan',       address:'2 Ayala Ave., Makati City 1226' },
      { name:'Louise Fernandez',  address:'47 Taft Ave., Manila 1004' },
      { name:'Walk-in Customer',  address:null }
    ];
    const mlcNames = [
      { name:'Marites Ocampo',     address:'21 Riverbanks Ave., Marikina City' },
      { name:'Lorna Pascual',      address:'Concepcion Dos, Marikina City' },
      { name:'Ernesto Valdez',     address:'Calumpang, Marikina City' },
      { name:'Grace Manalang',     address:'Sto. Niño, Marikina City' },
      { name:'Teodoro Ramos',      address:'Parang, Marikina City' },
      { name:'Anna Liza Gutierrez', address:'Fortune, Marikina City' },
      { name:'Rommel de Guzman',   address:'Barangka, Marikina City' }
    ];
    const mlcResellers = [
      { name:'Riverside Boutique Reseller', tin:'405-661-882', address:'Concepcion Uno, Marikina City' },
      { name:'Kalye Craft Collective',      tin:'338-170-926', address:'Cubao, Quezon City' },
      { name:'Pasalubong Corner Inc.',      tin:'612-904-337', address:'Tagaytay City, Cavite' }
    ];
    const epiBuyers = [
      { name:'Valenzuela Hardware and Industrial Corp.', tin:'318-559-004', address:'MacArthur Hwy., Karuhatan, Valenzuela City', terms:'30 days' },
      { name:'Metro Pharma Retail, Inc.',                tin:'339-481-225', address:'Shaw Blvd., Mandaluyong City',               terms:'30 days', ewt:0.02 },
      { name:'Northgate Facilities Management Inc.',     tin:'221-556-903', address:'8F Northgate Tower, Alabang, Muntinlupa City', terms:'30 days', ewt:0.02 },
      { name:'Sampaloc Learning Center, Inc.',           tin:'447-210-668', address:'Espana Blvd., Sampaloc, Manila',             terms:'15 days' },
      { name:'Pasig Office Solutions Inc.',              tin:'205-338-947', address:'Ortigas Ave., Pasig City',                   terms:'30 days' },
      { name:'Caloocan Food Ventures Corp.',             tin:'562-007-319', address:'Rizal Ave. Ext., Caloocan City',             terms:'15 days' },
      { name:'Malolos Trading and Supply',               tin:'227-884-150', address:'McArthur Hwy., Malolos, Bulacan',            terms:'30 days' },
      { name:'Quezon Textile Mills Corp.',               tin:'556-102-774', address:'North Ave., Quezon City',                    terms:'45 days', ewt:0.02 }
    ];
    const swtBuyers = [
      { name:'Panay Grocery Mart, Inc.',                tin:'220-447-119', address:'Jalandoni St., Iloilo City' },
      { name:'Guimaras Island Distribution Corp.',      tin:'337-902-215', address:'Jordan, Guimaras' },
      { name:'MetroGo Convenience Retail, Inc.',        tin:'119-336-540', address:'Diversion Rd., Mandurriao, Iloilo City', ewt:0.01 },
      { name:'Negros Provision Wholesale Co.',          tin:'448-215-770', address:'Lacson St., Bacolod City' },
      { name:'Antique Sari-Sari Supply Cooperative',    tin:'503-118-642', address:'San Jose de Buenavista, Antique' },
      { name:'Capiz Seaside Markets, Inc.',             tin:'275-390-814', address:'Roxas City, Capiz' }
    ];

    const cfg = {
      t_bmc: {
        rate:{ b_bmc_000:1.0, b_bmc_001:.55, b_bmc_002:.3, b_bmc_003:.17 }, week:[0, 1, 1, 1, 1, 1, .25], hours:[8, 17],
        by:'Marites B. Sandoval', via:'API: Bayanihan ERP connector', cancel:.007,
        make(r){
          if (r() < .26){
            const lines = [line(pick(r, bmcCounter), between(r, 1, 3))];
            if (r() < .4) lines.push(line(pick(r, bmcCounter), between(r, 1, 2)));
            return { buyer:{ name:'Walk-in Customer', tin:null, address:null }, lines, paid:true, method:pick(r, ['Cash', 'Cash', 'GCash', 'Card']) };
          }
          const b = pick(r, bmcBuyers);
          const lines = b.exporter
            ? [line(pick(r, ['i_bmc_6', 'i_bmc_7']), between(r, 2, 12))]
            : some(r, bmcPool, between(r, 1, 3), id => { const p = priceOf(id); return p < 700 ? between(r, 5, 60) : p < 5000 ? between(r, 1, 12) : between(r, 1, 4); });
          return { buyer:{ name:b.name, tin:b.tin, address:b.address }, lines, terms:b.terms, ewtRate:b.ewt, method:pick(r, ['Bank Transfer', 'Bank Transfer', 'Cheque']) };
        }
      },
      t_jof: {
        rate:{ b_jof_000:.85 }, week:[1.3, .9, .9, .9, .95, 1.1, 1.3], hours:[7, 22],
        by:'Ellen V. Bautista', via:'Bulk import: seller center orders file', cancel:.004,
        make(r){
          const who = pick(r, jofNames);
          const lines = some(r, ['i_jof_1', 'i_jof_2', 'i_jof_3', 'i_jof_4'], between(r, 1, 3), () => between(r, 1, 3));
          return { buyer:{ name:who.name, tin:null, address:who.address }, lines, paid:true, method:pick(r, ['GCash', 'GCash', 'Card', 'Cash']) };
        }
      },
      t_mlc: {
        rate:{ b_mlc_000:.5 }, week:[0, 1, 1, 1, 1, 1.1, 1.5], hours:[9, 18], notReady:true,
        by:'Josefina T. Ramos', via:'Bulk import: end-of-day sales file', cancel:.004,
        make(r){
          const pool = ['i_mlc_1', 'i_mlc_2', 'i_mlc_3', 'i_mlc_4'], x = r();
          if (x < .5) return { buyer:{ name:'Walk-in Customer', tin:null, address:null }, lines:some(r, pool, between(r, 1, 2), () => 1), paid:true, method:pick(r, ['Cash', 'Cash', 'GCash']) };
          if (x < .88){ const who = pick(r, mlcNames); return { buyer:{ name:who.name, tin:null, address:who.address }, lines:some(r, pool, between(r, 1, 2), () => 1), paid:true, method:pick(r, ['GCash', 'Cash', 'Card']) }; }
          const rs = pick(r, mlcResellers);
          return { buyer:{ name:rs.name, tin:rs.tin, address:rs.address }, lines:[line('i_mlc_1', between(r, 6, 24)), line(pick(r, ['i_mlc_2', 'i_mlc_3']), between(r, 4, 12))], terms:'30 days', method:'Bank Transfer' };
        }
      },
      t_swt: {
        rate:{ b_swt_000:.5 }, week:[0, 1, 1, 1, 1, 1, .3], hours:[7, 16],
        by:'Ramon T. Ibañez', via:"API: Sierra's own ERP (issued on the taxpayer's system, not this one)", cancel:.005,
        make(r){
          const b = pick(r, swtBuyers);
          const lines = some(r, ['i_swt_1', 'i_swt_2', 'i_swt_3'], between(r, 1, 2), () => between(r, 30, 160));
          return { buyer:{ name:b.name, tin:b.tin, address:b.address }, lines, terms:'60 days', ewtRate:b.ewt, method:'Bank Transfer' };
        }
      },
      t_epi: {
        rate:{ b_epi_000:3.8 }, week:[0, 1, 1, 1, 1, 1, .4], hours:[8, 17],
        by:'Nestor B. Calderon', via:'Web: EPI sales desk (this system)', cancel:.004,
        make(r){
          const b = pick(r, epiBuyers);
          const lines = some(r, ['i_epi_1', 'i_epi_2', 'i_epi_3', 'i_epi_4', 'i_epi_5', 'i_epi_6'], between(r, 1, 3), id =>
            id === 'i_epi_1' ? between(r, 20, 120) : id === 'i_epi_3' ? between(r, 2, 10) : id === 'i_epi_5' ? between(r, 2, 14) : between(r, 1, 6));
          return { buyer:{ name:b.name, tin:b.tin, address:b.address }, lines, terms:b.terms, ewtRate:b.ewt, method:'Bank Transfer' };
        }
      }
    };

    Object.keys(cfg).forEach(tid => {
      const c = cfg[tid], t = db.tenants.find(x => x.id === tid);
      /* Days a branch already has hand-written documents on are left alone, so the stories told there still hold. */
      const handWritten = new Set(db.invoices.filter(i => i.tenantId === tid).map(i => i.branchId + dayStr(i.issuedAt)));
      const stop = addDays(SEED_TODAY, 1);   /* includes today, up to the current hour */
      const first = addDays(dayStr(t.goLiveAt), 1);
      const span = Math.max(1, daysBetween(first, stop));
      for (let day = first, k = 0; day < stop; day = addDays(day, 1), k++){
        const r = mulberry32(hashStr(tid + day));
        const mult = c.week[dow(day)] * (.88 + .22 * k / span) * SEASON[Number(day.slice(5, 7)) - 1];
        if (!mult) continue;
        const age = daysBetween(day, SEED_TODAY);
        /* Today only has the hours that have passed, in Philippine time, so the data is current when it is opened. */
        const isToday = day === SEED_TODAY, nowH = new Date(Date.now() + 8 * 36e5).getUTCHours();
        const hi = isToday ? Math.min(c.hours[1], nowH - 1) : c.hours[1];
        if (isToday && hi < c.hours[0]) continue;
        const frac = isToday ? (hi - c.hours[0] + 1) / (c.hours[1] - c.hours[0] + 1) : 1;
        Object.keys(c.rate).forEach(branchId => {
          if (handWritten.has(branchId + day)) return;
          const x = c.rate[branchId] * mult * frac, n = Math.floor(x) + (r() < x - Math.floor(x) ? 1 : 0);
          for (let q = 0; q < n; q++){
            const issuedAt = stamp(day, between(r, c.hours[0], hi), between(r, 0, 59), between(r, 0, 59));
            const s = c.make(r);
            const o = { tenantId:tid, branchId, issuedAt, buyer:s.buyer, lines:s.lines };
            if (s.ewtRate) o.ewtRate = s.ewtRate;
            const paid = s.paid || r() < (age > 60 ? .97 : age > 35 ? .88 : age > 14 ? .7 : .5);
            if (paid){ o.paymentStatus = 'PAID'; o.paymentMethod = s.method; }
            else { o.paymentStatus = 'UNPAID'; o.terms = s.terms || '30 days'; }
            const inv = mkInvoice(o);
            inv.issuedBy = c.by; inv.issuedVia = c.via;
            if (c.notReady){ inv.transmissionStatus = 'NOT_READY'; inv.transmissionRef = null; }
            db.invoices.push(inv);

            const u = r();
            if (u < c.cancel){
              const reason = pick(r, ['DUPLICATE', 'DATA_ERROR']);
              Object.assign(inv, { docStatus:'CANCELLED', paymentStatus:'UNPAID', transmissionStatus:'NOT_READY', transmissionRef:null,
                cancelledAt:new Date(Date.parse(issuedAt) + between(r, 5, 40) * 60000).toISOString(), cancelReason:reason,
                cancelNote: reason === 'DUPLICATE' ? 'Keyed twice by the sales system.' : 'Wrong buyer details keyed. Issued again correctly.' });
              delete inv.paymentMethod; delete inv.ewtRate;
              histCorr.push({ kind:'CANCEL', inv, reason });
            }
          }
        });
      }
    });

    /* The duplicate cancelled in the recent activity needs an original to be a duplicate of. */
    const cutoff = cancelled;
    {
      const cand = db.invoices.filter(i => i.tenantId === 't_bmc' && i.branchId === 'b_bmc_000' && i.docType === 'INVOICE' &&
        i.docStatus === 'ISSUED' && i.issuedBy === 'Marites B. Sandoval' && histCorr.every(h => h.inv !== i) && new Date(i.issuedAt) < new Date(cutoff.issuedAt))
        .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
      dupOf = cand.find(i => !i.number) || null;
      if (dupOf){
        dupOf.buyer = cutoff.buyer; dupOf.lines = cutoff.lines.map(l => Object.assign({}, l));
        dupOf.totals = computeTotals(dupOf.lines, 0, {}); delete dupOf.ewtRate;
      }
    }
  })();

  /* ---------------------------------------------------------
     Retention exercise rows

     BMC only went live on this system in March 2026, so nothing it has
     genuinely issued is old enough to reach either retention boundary —
     which is the correct, unremarkable state for a five-months-old account.
     These two are backdated on purpose, the same way the invited-user rows
     above are dated relative to now rather than fixed: not real history,
     just enough age to show the cold archive, and that an old record keeps its buyer details,
     without waiting five and ten years for the demo to catch up.
     --------------------------------------------------------- */
  const agoYears = y => new Date(Date.now() - y * 365.25 * 864e5).toISOString();

  const archivedInv = mkInvoice({
    tenantId:'t_bmc', branchId:'b_bmc_000', issuedAt: agoYears(7),
    buyer:{ name:'Quezon Textile Mills Corp.', tin:'556-102-774', address:'North Ave., Quezon City' },
    paymentStatus:'PAID', paymentMethod:'Bank Transfer',
    lines:[ { itemId:'i_bmc_2', desc:'Cordless Drill 18V with battery', sku:'HRD-PWR-18V', qty:5, unit:'unit', unitPrice:4480.00, treatment:'VATABLE' } ]
  });
  archivedInv.number = formatSeriesNumber('BMC', '000', new Date(archivedInv.issuedAt).getFullYear(), 1);
  archivedInv.issuedBy = 'Marites B. Sandoval';
  archivedInv.issuedVia = 'API: Bayanihan ERP connector';
  db.invoices.push(archivedInv);

  const redactedInv = mkInvoice({
    tenantId:'t_bmc', branchId:'b_bmc_001', issuedAt: agoYears(11),
    buyer:{ name:'Cebu Fastener Trading', tin:'229-887-410', address:'Colon St., Cebu City' },
    paymentStatus:'PAID', paymentMethod:'Cash',
    lines:[ { itemId:'i_bmc_1', desc:'Bond Paper A4, 80gsm (ream)', sku:'OFS-BND-A4', qty:10, unit:'ream', unitPrice:285.00, treatment:'VATABLE' } ]
  });
  redactedInv.number = formatSeriesNumber('BMC', '001', new Date(redactedInv.issuedAt).getFullYear(), 1);
  redactedInv.issuedBy = 'Dennis R. Alonzo';
  redactedInv.issuedVia = 'API: Bayanihan ERP connector';
  db.invoices.push(redactedInv);

  /* ---------------------------------------------------------
     Who can bind each seeded account (RMC VII.1). Sierra applied
     through a representative whose authority runs out soon, so the
     console's expiry alert and "Replace representative" have a case.
     --------------------------------------------------------- */
  const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  const who = {
    t_bmc: { entity:'CORPORATION', signatory:{ name:'Ramon T. Villaflor', position:'President' } },
    t_jof: { entity:'SOLE',        signatory:{ name:'Juana C. Ramirez', position:'Proprietor' } },
    t_mlc: { entity:'SOLE',        signatory:{ name:'Ferdinand L. Cruz', position:'Proprietor' } },
    t_epi: { entity:'CORPORATION', signatory:{ name:'Rodrigo L. Evangelista', position:'President' } },
    t_swt: { entity:'CORPORATION', signatory:{ name:'Eduardo S. Villareal', position:'Chairman' },
             representative:{ name:'Corazon P. Villareal', position:'President', userId:'u_swt_owner' },
             authority:{ kind:'SEC_CERT', file:'Authority-558771204.pdf', expiresAt:soon,
                         validatedBy:'Carmela T. Rivera', validatedAt:hd('2026-03-30T10:00:00+08:00', 't_swt') } }
  };
  db.tenants.forEach(t => Object.assign(t, { representative:null, authority:null }, who[t.id] || {}));

  /* ---------------------------------------------------------
     Applications, one in each state the console works with.
     Dated from today so the three-working-day clock is live.
     --------------------------------------------------------- */
  const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString();
  const due = iso => AppReg.workingDaysAfter(iso, AppReg.TURNAROUND_DAYS);
  const nextYear = new Date().getFullYear() + 1;
  const mkApp = o => Object.assign({ checks:{ legal:null, coverage:null, authority:null }, history:[] }, o);

  db.onboardingApps.push(mkApp({
    id:'app_pending', ref:'APP-2026-0001', tenantName:'Sigla Health Supplies, Inc.', tin:'118-337-025',
    email:'compliance@siglahealth.com.ph', entity:'CORPORATION',
    applicant:{ person:'Liza M. Navarro', position:'Compliance Officer', capacity:'REPRESENTATIVE' },
    authority:{ kind:'SEC_CERT', signatory:'Antonio R. Sigla', signatoryPosition:'Corporate Secretary', expiresAt:nextYear + '-06-30' },
    documents:{ cor:'BIR-Form-2303-118337025.pdf', sec:'SEC-certificate-118337025.pdf', gis:'General-Information-Sheet-118337025.pdf',
                idApplicant:'Government-ID-of-the-applicant-118337025.pdf', authDoc:'Authority-document-118337025.pdf',
                idSignatory:'Government-ID-of-the-signatory-118337025.pdf' },
    coverage:{ picks:['LARGE'], micro:false, headOffice:true, basis:'LARGE' },
    consents:{ declarationAt:daysAgo(1), privacyAt:daysAgo(1), termsAt:daysAgo(1), by:'Liza M. Navarro' },
    status:'PENDING_VERIFICATION', submittedAt:daysAgo(1), dueAt:due(daysAgo(1)),
    history:[{ at:daysAgo(1), what:'Submitted', by:'Liza M. Navarro' }]
  }));

  db.onboardingApps.push(mkApp({
    id:'app_info', ref:'APP-2026-0002', tenantName:'Tala Bakeshop', tin:'402-118-659',
    email:'rosario@talabakeshop.ph', entity:'SOLE',
    applicant:{ person:'Rosario D. Tala', position:'Proprietor', capacity:'SIGNATORY' }, authority:null,
    documents:{ cor:'BIR-Form-2303-402118659.pdf', dti:'DTI-certificate-402118659.pdf', idApplicant:'Government-ID-of-the-applicant-402118659.pdf' },
    coverage:{ picks:['ECOMMERCE'], micro:false, headOffice:true, basis:'ECOMMERCE' },
    consents:{ declarationAt:daysAgo(4), privacyAt:daysAgo(4), termsAt:daysAgo(4), by:'Rosario D. Tala' },
    status:'NEEDS_INFO', submittedAt:daysAgo(4), dueAt:due(daysAgo(4)),
    info:{ request:'The DTI certificate you uploaded has expired. Upload the renewed certificate.', at:daysAgo(2), by:'Carmela T. Rivera' },
    history:[{ at:daysAgo(4), what:'Submitted', by:'Rosario D. Tala' }, { at:daysAgo(2), what:'More information requested', by:'Carmela T. Rivera' }]
  }));

  /* Accepted and setting up. The owner has already set a password, so it
     signs in with the demo password and lands in the setup checklist. */
  db.onboardingApps.push(mkApp({
    id:'app_setup', ref:'APP-2026-0003', tenantName:'Kalinaw Water Systems Corp.', tin:'615-203-447',
    email:'p.manalo@kalinawwater.com.ph', entity:'CORPORATION', tenantId:'t_kws',
    applicant:{ person:'Paolo G. Manalo', position:'Finance Director', capacity:'REPRESENTATIVE' },
    authority:{ kind:'SEC_CERT', signatory:'Victoria L. Ong', signatoryPosition:'Corporate Secretary', expiresAt:nextYear + '-12-31' },
    documents:{ cor:'BIR-Form-2303-615203447.pdf', sec:'SEC-certificate-615203447.pdf', gis:'General-Information-Sheet-615203447.pdf',
                idApplicant:'Government-ID-of-the-applicant-615203447.pdf', authDoc:'Authority-document-615203447.pdf',
                idSignatory:'Government-ID-of-the-signatory-615203447.pdf' },
    coverage:{ picks:['LARGE', 'SOFTWARE_USER'], micro:false, headOffice:true, basis:'LARGE' },
    consents:{ declarationAt:daysAgo(5), privacyAt:daysAgo(5), termsAt:daysAgo(5), by:'Paolo G. Manalo' },
    status:'ACCEPTED', stage:'SETUP', submittedAt:daysAgo(5), dueAt:due(daysAgo(5)), reviewedAt:daysAgo(3), reviewedBy:'Carmela T. Rivera',
    checks:{
      legal:     { ok:true, note:'SEC Certificate of Incorporation and 2026 GIS checked against Form 2303', by:'Carmela T. Rivera', at:daysAgo(3) },
      coverage:  { ok:true, basis:'LARGE', note:'Large taxpayer under RA 11976, RR 11-2025 Sec. 3(A)(3)', by:'Carmela T. Rivera', at:daysAgo(3) },
      authority: { ok:true, note:"Secretary's certificate names Paolo G. Manalo; signed by Victoria L. Ong", by:'Carmela T. Rivera', at:daysAgo(3) }
    },
    cor:{ taxType:'VAT', rdo:'RDO 050 — South Makati', address:'7F Ayala North Exchange, Ayala Ave., Makati City 1226',
          lob:'Wholesale of water treatment equipment', by:'Carmela T. Rivera', at:daysAgo(3) },
    history:[{ at:daysAgo(5), what:'Submitted', by:'Paolo G. Manalo' }, { at:daysAgo(3), what:'Accepted. Set-password link sent', by:'Carmela T. Rivera' }]
  }));
  db.users.push({ id:'u_kws_owner', tenantId:'t_kws', branchId:null, roleKey:'OWNER', name:'Paolo G. Manalo',
    email:'p.manalo@kalinawwater.com.ph', position:'Finance Director', active:true, status:'ACTIVE',
    invitedBy:'EPI Client Onboarding', invitedAt:daysAgo(3), activatedAt:daysAgo(2) });

  /* Two more accepted applications, so the Onboarding stage tracker has a client in every stage:
     one at the agreement and deposit step, one waiting for EPI's go-live review. */
  const coveredBy = who => ({ legal:{ ok:true, note:'Registration documents checked against Form 2303', by:who, at:daysAgo(10) },
    coverage:{ ok:true, basis:'ECOMMERCE', note:'E-commerce or internet transactions, RR 11-2025', by:who, at:daysAgo(10) },
    authority:{ ok:true, note:'The applicant is the signatory', by:who, at:daysAgo(10) } });
  const lfs = mkApp({
    id:'app_agree', ref:'APP-2026-0005', tenantName:'Lakan Freight Services, Inc.', tin:'246-810-337',
    email:'ramil@lakanfreight.ph', entity:'CORPORATION', tenantId:'t_lfs',
    applicant:{ person:'Ramil V. Lacson', position:'President', capacity:'SIGNATORY' }, authority:null,
    documents:{ cor:'BIR-Form-2303-246810337.pdf', sec:'SEC-certificate-246810337.pdf', gis:'General-Information-Sheet-246810337.pdf', idApplicant:'Government-ID-of-the-applicant-246810337.pdf' },
    coverage:{ picks:['ECOMMERCE'], micro:false, headOffice:true, basis:'ECOMMERCE' },
    consents:{ declarationAt:daysAgo(14), privacyAt:daysAgo(14), termsAt:daysAgo(14), by:'Ramil V. Lacson' },
    status:'ACCEPTED', stage:'SETUP', submittedAt:daysAgo(14), dueAt:due(daysAgo(14)), reviewedAt:daysAgo(10), reviewedBy:'Jerome S. Robles',
    checks:coveredBy('Jerome S. Robles'),
    cor:{ taxType:'VAT', rdo:'RDO 024 — Malabon-Navotas', address:'Block 6, Navotas Fish Port Complex, Navotas City 1485', lob:'Freight forwarding and cargo handling', by:'Jerome S. Robles', at:daysAgo(10) },
    history:[{ at:daysAgo(14), what:'Submitted', by:'Ramil V. Lacson' }, { at:daysAgo(10), what:'Accepted. Set-password link sent', by:'Jerome S. Robles' }]
  });
  lfs.setup = Object.assign(Onboarding.freshSetup(lfs), { idx:6, lane:'EXPRESS', plan:'TIER1', usage:{ avg:6400, newBusiness:false }, declared:true, attested:true, attestedBy:'Ramil V. Lacson',
    pti:{ mode:'HAVE', number:'BIR-PTI-2026-03318', issuedAt:daysAgo(12).slice(0, 10) }, sandbox:{ run:true, passed:true }, connection:'BULK', updatedAt:daysAgo(2),
    provider:{ mode:'EPI_PARTNER', name:FeeReg.EPI_PARTNER_NAME, account:{ kind:'Bank', label:'Sample Bank (illustrative), Lakan Freight Services, Inc., 3333-4444-55' }, settlement:'T+1' } });
  db.onboardingApps.push(lfs);
  db.users.push({ id:'u_lfs_owner', tenantId:'t_lfs', branchId:null, roleKey:'OWNER', name:'Ramil V. Lacson', email:'ramil@lakanfreight.ph', position:'President',
    active:true, status:'ACTIVE', invitedBy:'EPI Client Onboarding', invitedAt:daysAgo(10), activatedAt:daysAgo(9) });

  const mdw = mkApp({
    id:'app_golive', ref:'APP-2026-0006', tenantName:'Mayumi Dental Supplies', tin:'381-904-112',
    email:'mayumi@mayumidental.ph', entity:'SOLE', tenantId:'t_mds',
    applicant:{ person:'Mayumi S. Aquino', position:'Proprietor', capacity:'SIGNATORY' }, authority:null,
    documents:{ cor:'BIR-Form-2303-381904112.pdf', dti:'DTI-certificate-381904112.pdf', idApplicant:'Government-ID-of-the-applicant-381904112.pdf' },
    coverage:{ picks:['ECOMMERCE'], micro:false, headOffice:true, basis:'ECOMMERCE' },
    consents:{ declarationAt:daysAgo(11), privacyAt:daysAgo(11), termsAt:daysAgo(11), by:'Mayumi S. Aquino' },
    status:'ACCEPTED', stage:'GOLIVE_REVIEW', submittedAt:daysAgo(11), dueAt:due(daysAgo(11)), reviewedAt:daysAgo(8), reviewedBy:'Carmela T. Rivera',
    checks:coveredBy('Carmela T. Rivera'),
    cor:{ taxType:'VAT', rdo:'RDO 039 — South Quezon City', address:'27 Tomas Morato Ave., Quezon City 1103', lob:'Online retail of dental supplies', by:'Carmela T. Rivera', at:daysAgo(8) },
    goLiveRequestedAt:new Date(Date.now() - 3 * 36e5).toISOString(), goLiveDueAt:AppReg.workingDaysAfter(new Date(Date.now() - 3 * 36e5).toISOString(), AppReg.GOLIVE_DAYS),
    history:[{ at:daysAgo(11), what:'Submitted', by:'Mayumi S. Aquino' }, { at:daysAgo(8), what:'Accepted. Set-password link sent', by:'Carmela T. Rivera' }, { at:new Date(Date.now() - 3 * 36e5).toISOString(), what:'Setup complete. Sent for go-live review', by:'Mayumi S. Aquino' }]
  });
  mdw.setup = Object.assign(Onboarding.freshSetup(mdw), { idx:7, lane:'EXPRESS', plan:'TIER1', usage:{ avg:4200, newBusiness:false }, declared:true, attested:true, attestedBy:'Mayumi S. Aquino',
    pti:{ mode:'HAVE', number:'BIR-PTI-2026-03402', issuedAt:daysAgo(12).slice(0, 10) }, sandbox:{ run:true, passed:true }, connection:'BULK', ack:true, updatedAt:daysAgo(1),
    provider:{ mode:'OWN', name:'Kapitbahay Payments, Inc.', account:{ kind:'E-wallet', label:'GCash 0917 000 2222, Mayumi S. Aquino' }, settlement:'REALTIME' },
    docs:{ signedAgreement:'Client-Service-Agreement-signed-381904112.pdf', usageHistory:'Sales-history-12-months-381904112.pdf' },
    deposit:{ paid:true, method:'Card (demo)', at:daysAgo(1) } });
  db.onboardingApps.push(mdw);
  db.users.push({ id:'u_mds_owner', tenantId:'t_mds', branchId:null, roleKey:'OWNER', name:'Mayumi S. Aquino', email:'mayumi@mayumidental.ph', position:'Proprietor',
    active:true, status:'ACTIVE', invitedBy:'EPI Client Onboarding', invitedAt:daysAgo(8), activatedAt:daysAgo(7) });

  db.onboardingApps.push(mkApp({
    id:'app_declined', ref:'APP-2026-0004', tenantName:'Bituin Export Trading', tin:'377-560-912',
    email:'ops@bituinexport.ph', entity:'PARTNERSHIP',
    applicant:{ person:'Gregorio A. Bituin', position:'Managing Partner', capacity:'SIGNATORY' }, authority:null,
    documents:{ cor:'BIR-Form-2303-377560912.pdf', sec:'SEC-certificate-377560912.pdf', aop:'Articles-of-Partnership-377560912.pdf',
                idApplicant:'Government-ID-of-the-applicant-377560912.pdf' },
    coverage:{ picks:['EXPORTER'], micro:false, headOffice:true, basis:'EXPORTER' },
    consents:{ declarationAt:daysAgo(9), privacyAt:daysAgo(9), termsAt:daysAgo(9), by:'Gregorio A. Bituin' },
    status:'DECLINED', declineCode:'NOT_COVERED', declineReason:'Not required to issue e-invoices by the deadline',
    submittedAt:daysAgo(9), dueAt:due(daysAgo(9)), reviewedAt:daysAgo(8), reviewedBy:'Carmela T. Rivera',
    purgeAt:new Date(Date.now() + 22 * 864e5).toISOString(),
    history:[{ at:daysAgo(9), what:'Submitted', by:'Gregorio A. Bituin' }, { at:daysAgo(8), what:'Declined: not required by the deadline', by:'Carmela T. Rivera' }]
  }));

  /* ---------------------------------------------------------
     Numbers

     Every document is numbered here, once they all exist: each branch and kind
     of document runs its own series for each calendar year, in the order the
     documents were issued. The hand-written ones above carry placeholders.
     --------------------------------------------------------- */
  (function renumberSeries(){
    const groups = {};
    db.invoices.forEach((inv, n) => {
      const key = [inv.tenantId, inv.docType].join('|');
      (groups[key] = groups[key] || []).push({ inv, n });
    });
    Object.keys(groups).forEach(key => {
      const [tid] = key.split('|');
      const t = db.tenants.find(x => x.id === tid);
      groups[key].sort((a, z) => new Date(a.inv.issuedAt) - new Date(z.inv.issuedAt) || a.n - z.n)
        .forEach((x, q) => { x.inv.number = formatSeriesNumber(t.seriesPrefix, '', 0, q + 1); });
    });
    cancelled.cancelNote = 'Duplicate of ' + (dupOf ? dupOf.number : 'an earlier invoice') + '. Same PO, keyed twice by the ERP connector.';
  })();

  /* ---------------------------------------------------------
     Activity log
     --------------------------------------------------------- */
  const acts = [
    { tenantId:'t_bmc', actorName:'Marites B. Sandoval', role:'ISSUER',  action:'Issued invoice ' + db.invoices[1].number, at:rd('2026-08-14T11:40:00+08:00') },
    { tenantId:'t_bmc', actorType:'SYSTEM', actorName:'Bayanihan ERP connector · cred #3', role:'INTEGRATION',
      action:'Issued invoice ' + db.invoices[0].number + ' via API', at:rd('2026-08-14T09:12:00+08:00') },
    { tenantId:'t_bmc', actorName:'Cecilia M. Ocampo', role:'FINANCE', action:'Generated report (VAT Summary, ' + new Date(Date.parse(SEED_TODAY.slice(0, 7) + '-01') - 864e5).toLocaleString('en-US', { month:'long', year:'numeric', timeZone:'UTC' }) + ')', at:rd('2026-08-14T08:30:00+08:00') },
    { tenantId:'t_bmc', actorType:'EPI', actorName:'EPI Support · J. Robles', role:'SUPPORT_T2',
      action:'Emergency access granted. Reason: "Customer ticket #4471, transmission failure investigation". Expired after 4h.',
      at:rd('2026-08-12T14:02:00+08:00'), ip:'158.62.33.172', location:'Makati City, Metro Manila, Philippines' },
    { tenantId:'t_bmc', actorName:'Marites B. Sandoval', role:'ISSUER', action:'Cancelled invoice ' + cancelled.number + '. Reason: Duplicate', at:rd('2026-08-10T15:44:00+08:00') },
    { tenantId:'t_bmc', actorName:'Ramon T. Villaflor', role:'OWNER', action:'Signed in', at:rd('2026-08-14T07:58:00+08:00') },
    { tenantId:'t_jof', actorName:'Ellen V. Bautista', role:'ISSUER', action:'Issued invoice ' + (db.invoices.find(i => i.tenantId === 't_jof' && i.issuedAt === rd('2026-08-14T10:05:00+08:00')) || {}).number, at:rd('2026-08-14T10:05:00+08:00') },
    { tenantId:'t_jof', actorName:'Juana C. Ramirez', role:'OWNER', action:'Signed in', at:rd('2026-08-14T09:44:00+08:00') },
    { tenantId:'t_jof', actorName:'Juana C. Ramirez', role:'OWNER', action:'Confirmed the tax profile (VAT Registered, no exempt or zero-rated sales)', at:hd('2026-06-18T14:02:00+08:00', 't_jof') }
  ];
  db.activity = acts.map(a => Object.assign({
    id: uid('act'), actorType:'USER', device:'Windows NT 10.0', browser:'Chrome 141.0',
    location:'Quezon City, Metro Manila, Philippines', ip:'124.6.188.79'
  }, a));

  /* The rest of the year: owners signing in each Monday, and a month-end report each month. */
  const owners = { t_epi:['Rodrigo L. Evangelista', 'OWNER'], t_bmc:['Ramon T. Villaflor', 'OWNER'], t_jof:['Juana C. Ramirez', 'OWNER'], t_mlc:['Ferdinand L. Cruz', 'OWNER'], t_swt:['Corazon P. Villareal', 'OWNER'] };
  const deciders = { t_epi:['Rodrigo L. Evangelista', 'OWNER'], t_bmc:['Dennis R. Alonzo', 'SUPERVISOR'], t_jof:['Juana C. Ramirez', 'OWNER'], t_mlc:['Ferdinand L. Cruz', 'OWNER'], t_swt:['Corazon P. Villareal', 'OWNER'] };
  const reporters = { t_epi:['Lourdes P. Manansala', 'FINANCE'], t_bmc:['Cecilia M. Ocampo', 'FINANCE'], t_jof:owners.t_jof, t_mlc:owners.t_mlc, t_swt:owners.t_swt };
  const monthName = ym => new Date(ym + '-01T00:00:00Z').toLocaleString('en-US', { month:'long', year:'numeric', timeZone:'UTC' });
  const histActs = [];
  Object.keys(GO_LIVE).forEach(tid => {
    for (let d = addDays(GO_LIVE[tid], 1); d < addDays(SEED_TODAY, -7); d = addDays(d, 1)){
      const wd = new Date(d + 'T00:00:00Z').getUTCDay();
      if (wd === 1 && (tid === 't_bmc' || tid === 't_jof'))
        histActs.push({ tenantId:tid, actorName:owners[tid][0], role:owners[tid][1], action:'Signed in', at:d + 'T07:' + String(40 + hashStr(tid + d) % 15) + ':00+08:00' });
      if (d.slice(8) === '03' && d.slice(0, 7) > GO_LIVE[tid].slice(0, 7)){
        const prev = addDays(d.slice(0, 7) + '-01', -1).slice(0, 7);
        histActs.push({ tenantId:tid, actorName:reporters[tid][0], role:reporters[tid][1], action:'Generated report (VAT Summary, ' + monthName(prev) + ')', at:d + 'T08:30:00+08:00' });
      }
    }
  });
  histCorr.forEach(h => {
    histActs.push({ tenantId:h.inv.tenantId, actorName:h.inv.issuedBy, role:'ISSUER', action:'Cancelled invoice ' + h.inv.number + '. Reason: ' + (h.reason === 'DUPLICATE' ? 'Duplicate' : 'Data error'), at:h.inv.cancelledAt });
  });
  db.activity = db.activity.concat(histActs.map(a => Object.assign({
    id: uid('act'), actorType:'USER', device:'Windows NT 10.0', browser:'Chrome 141.0',
    location:'Quezon City, Metro Manila, Philippines', ip:'124.6.188.79'
  }, a)));
  db.activity.sort((a, b) => new Date(b.at) - new Date(a.at));

  /* ---------------------------------------------------------
     Where the buyer copy was sent

     Derived rather than typed, so every seeded document has one and the
     addresses stay consistent with the buyer names. A walk-in customer has
     no address at all, which is the case worth having in the data: not every
     sale has somewhere to send a copy, and the delivery screen has to say so
     rather than showing a failure.
     --------------------------------------------------------- */
  db.invoices.forEach(inv => {
    const b = inv.buyer || {};
    if (!b.name || /walk-in/i.test(b.name)){ inv.deliverTo = null; return; }
    const slug = b.name.toLowerCase()
      .replace(/[^a-z\s]/g, '').trim().split(/\s+/).slice(0, 2).join('.');
    inv.deliverTo = b.tin ? `accounts@${slug.replace(/\./g, '')}.com.ph`
                          : `${slug}@email.ph`;
    inv.deliverBy = inv.deliverBy || 'EMAIL_PDF';
  });

  /* ---------------------------------------------------------
     Connected sources, and the seller identities behind them

     Nothing here is keyed by a person. Both taxpayers issue from something
     else — an ERP for one, a seller centre and a marketplace for the other —
     so the account has to record what that something else is, who authorized
     it, and whose registration each store it reports sells under.
     --------------------------------------------------------- */
  db.platforms = [
    { id:'pf_bmc_erp', tenantId:'t_bmc', name:'Bayanihan ERP', kind:'ERP', method:'API',
      status:'CONNECTED', key:'epi_live_7x4m9q2v',
      authorizedBy:'Ramon T. Villaflor', authorizedAt:hd('2026-03-06T10:12:00+08:00', 't_bmc'),
      scope:'Issue invoices for every branch',
      lastUsedAt:rd('2026-08-14T09:12:00+08:00'), rotatedAt:null },

    /* The sandbox credential, withdrawn the morning they went live. It issued
       nothing in the register — that was the point of it — and it is still
       listed, because an authorization and its withdrawal are both part of how
       this account came to be issuing. */
    { id:'pf_bmc_sbx', tenantId:'t_bmc', name:'Bayanihan ERP (sandbox)', kind:'ERP', method:'API',
      status:'REVOKED', key:null,
      authorizedBy:'Ramon T. Villaflor', authorizedAt:hd('2026-02-11T09:40:00+08:00', 't_bmc'),
      scope:'Issue test invoices in sandbox only',
      lastUsedAt:hd('2026-03-08T17:22:00+08:00', 't_bmc'),
      revokedAt:hd('2026-03-09T08:05:00+08:00', 't_bmc'), revokedBy:'Ramon T. Villaflor' },

    { id:'pf_jof_centre', tenantId:'t_jof', name:"Juana's Seller Centre", kind:'STOREFRONT',
      method:'BULK', status:'CONNECTED', key:'epi_live_3k8bqz51',
      authorizedBy:'Juana C. Ramirez', authorizedAt:hd('2026-06-18T15:10:00+08:00', 't_jof'),
      scope:"Upload the day's orders and issue invoices for the main branch",
      lastUsedAt:rd('2026-08-14T10:05:00+08:00') },

    /* Paused rather than revoked: she stopped selling there for the month, and
       the difference between the two is the difference between a decision she
       can take back this afternoon and a key that no longer exists. */
    { id:'pf_jof_tindahub', tenantId:'t_jof', name:'TindaHub Philippines', kind:'MARKETPLACE',
      method:'CONNECTOR', status:'PAUSED', key:'epi_live_9w2ctr64',
      authorizedBy:'Juana C. Ramirez', authorizedAt:hd('2026-07-02T11:25:00+08:00', 't_jof'),
      scope:'Issue invoices for orders placed on TindaHub',
      lastUsedAt:rd('2026-08-12T20:07:00+08:00') }
  ];

  db.sellers = [
    { id:'sl_bmc_ho',  tenantId:'t_bmc', platformId:'pf_bmc_erp', externalId:'BMC-HO',
      storeName:'Head Office (ERP company 100)', tin:'004-521-887', branchId:'b_bmc_000',
      status:'LINKED', linkedBy:'Ramon T. Villaflor', linkedAt:hd('2026-03-06T10:20:00+08:00', 't_bmc') },
    { id:'sl_bmc_ceb', tenantId:'t_bmc', platformId:'pf_bmc_erp', externalId:'BMC-CEB',
      storeName:'Cebu (ERP company 200)', tin:'004-521-887', branchId:'b_bmc_001',
      status:'LINKED', linkedBy:'Ramon T. Villaflor', linkedAt:hd('2026-03-06T10:21:00+08:00', 't_bmc') },
    { id:'sl_bmc_dvo', tenantId:'t_bmc', platformId:'pf_bmc_erp', externalId:'BMC-DVO',
      storeName:'Davao (ERP company 300)', tin:'004-521-887', branchId:'b_bmc_002',
      status:'LINKED', linkedBy:'Ramon T. Villaflor', linkedAt:hd('2026-03-06T10:22:00+08:00', 't_bmc') },
    { id:'sl_bmc_bag', tenantId:'t_bmc', platformId:'pf_bmc_erp', externalId:'BMC-BAG',
      storeName:'Baguio (ERP company 400)', tin:'004-521-887', branchId:'b_bmc_003',
      status:'LINKED', linkedBy:'Ramon T. Villaflor', linkedAt:hd('2026-03-06T10:23:00+08:00', 't_bmc') },

    /* A new sales channel somebody switched on in the ERP without telling
       anyone here. Its orders are arriving and none of them can be issued,
       because nothing says which registration or which series they belong to.
       This is the state the screen exists to make visible. */
    { id:'sl_bmc_web', tenantId:'t_bmc', platformId:'pf_bmc_erp', externalId:'BMC-WEB',
      storeName:'Bayanihan Online Store', tin:null, branchId:null,
      status:'UNLINKED', heldOrders:6, firstSeenAt:rd('2026-08-12T06:40:00+08:00') },

    { id:'sl_jof_centre', tenantId:'t_jof', platformId:'pf_jof_centre', externalId:'SC-MAIN',
      storeName:"Juana's Online Finds", tin:'287-994-113', branchId:'b_jof_000',
      status:'LINKED', linkedBy:'Juana C. Ramirez', linkedAt:hd('2026-06-18T15:12:00+08:00', 't_jof') },
    { id:'sl_jof_tinda', tenantId:'t_jof', platformId:'pf_jof_tindahub', externalId:'TH-SELLER-88421',
      storeName:"Juana's Online Finds (TindaHub)", tin:'287-994-113', branchId:'b_jof_000',
      status:'LINKED', linkedBy:'Juana C. Ramirez', linkedAt:hd('2026-07-02T11:30:00+08:00', 't_jof') }
  ];

  /* Where each document came from. Recorded on the document rather than worked
     out later: the connection can be revoked tomorrow, and what issued this
     invoice does not change when it is. */
  const bmcSellerOf = {
    b_bmc_000:'sl_bmc_ho', b_bmc_001:'sl_bmc_ceb',
    b_bmc_002:'sl_bmc_dvo', b_bmc_003:'sl_bmc_bag'
  };
  db.invoices.forEach((inv, i) => {
    if (inv.tenantId === 't_bmc'){
      inv.platformId = 'pf_bmc_erp';
      inv.sellerId   = bmcSellerOf[inv.branchId] || null;
    } else if (inv.tenantId === 't_jof'){
      /* Every third order came off the marketplace rather than her own shop. */
      const viaMarket = i % 3 === 2;
      inv.platformId = viaMarket ? 'pf_jof_tindahub' : 'pf_jof_centre';
      inv.sellerId   = viaMarket ? 'sl_jof_tinda' : 'sl_jof_centre';
      if (viaMarket) inv.issuedVia = 'Platform connector: TindaHub order';
    }
  });

  /* ---------------------------------------------------------
     Z readings already on file

     Days this account has closed. Each one is a snapshot taken at the time and
     kept, so the figures here are not recomputed from the documents — which is
     the whole point of a reading, and is visible on the 10 August one, whose
     only document was cancelled.
     --------------------------------------------------------- */
  function seedReading(branchId, date, zNumber, takenBy, role){
    const branch  = db.branches.find(b => b.id === branchId);
    const rows    = db.invoices.filter(i => i.branchId === branchId && i.docStatus !== 'DRAFT');
    const before  = rows.filter(i => Reporting.dayOf(i.issuedAt) <  date);
    const day     = rows.filter(i => Reporting.dayOf(i.issuedAt) === date);
    const beginning = Reporting.summarize(before).totalDue;
    const totals    = Reporting.summarize(day);

    return {
      id: uid('rdg'), kind:'Z', tenantId: branch.tenantId,
      branchId, branchCode: branch.code, branchName: branch.name,
      date, zNumber,
      takenAt: date + 'T21:05:00+08:00', takenBy, takenByRole: role,
      beginning, ending: round2(beginning + totals.totalDue), totals,
      cancelledNumbers: day.filter(i => i.docStatus === 'CANCELLED').map(i => i.number)
    };
  }

  /* Every branch's last thirty days. The number counts the days the branch has closed
     since it went live, so it carries on from one reading to the next. */
  const closedDays = {};
  db.invoices.forEach(inv => {
    if (inv.docStatus === 'DRAFT') return;
    (closedDays[inv.branchId] = closedDays[inv.branchId] || new Set()).add(Reporting.dayOf(inv.issuedAt));
  });
  const closers = {
    b_bmc_000:['Marites B. Sandoval', 'ISSUER'], b_bmc_001:['Dennis R. Alonzo', 'SUPERVISOR'],
    b_bmc_002:['Marites B. Sandoval', 'ISSUER'], b_bmc_003:['Marites B. Sandoval', 'ISSUER'],
    b_jof_000:['Ellen V. Bautista', 'ISSUER'],   b_mlc_000:['Josefina T. Ramos', 'ISSUER'],
    b_swt_000:['Ramon T. Ibañez', 'ISSUER']
  };
  db.readings = [];
  Object.keys(closers).forEach(branchId => {
    const days = Array.from(closedDays[branchId] || []).sort();
    days.filter(d => d >= addDays(SEED_TODAY, -30) && d < SEED_TODAY).forEach(d => {
      db.readings.push(seedReading(branchId, d, days.indexOf(d) + 1, closers[branchId][0], closers[branchId][1]));
    });
  });
  db.readings.sort((a, b) => b.date.localeCompare(a.date) || a.branchId.localeCompare(b.branchId));

  /* ---------------------------------------------------------
     Corrections

     Two seeded by hand, a request nobody has decided and a refusal that
     produced nothing. The approved ones come from the year's cancellations.
     --------------------------------------------------------- */
  const unpaidInv   = db.invoices.find(i =>
    i.docType === 'INVOICE' && i.paymentStatus === 'UNPAID' && i.docStatus === 'ISSUED');

  db.corrections = [
    { id:'corr_pending', tenantId:'t_bmc', branchId:unpaidInv.branchId,
      invoiceId:unpaidInv.id, invoiceNumber:unpaidInv.number,
      kind:'CANCEL', reason:'WRONG_BUYER', amount:0,
      note:'Buyer name and TIN were keyed for the wrong branch of the customer. The right invoice will be issued after this is cancelled.',
      status:'PENDING', requestedBy:'Marites B. Sandoval', requestedByRole:'ISSUER',
      requestedAt:rd('2026-08-15T14:12:00+08:00'),
      decidedBy:null, decidedAt:null, decisionNote:null, resultNumber:null },

    { id:'corr_rejected', tenantId:'t_bmc', branchId:'b_bmc_000',
      invoiceId:cancelled.id, invoiceNumber:cancelled.number,
      kind:'CANCEL', reason:'DATA_ERROR', amount:0,
      note:'Buyer says the PO number is wrong.',
      status:'REJECTED', requestedBy:'Marites B. Sandoval', requestedByRole:'ISSUER',
      requestedAt:rd('2026-08-10T15:30:00+08:00'),
      decidedBy:'Ramon T. Villaflor', decidedAt:rd('2026-08-10T15:38:00+08:00'),
      decisionNote:'A wrong PO reference is not grounds to cancel. The sale happened. ' +
                   'This one was cancelled separately as a duplicate.',
      resultNumber:null }
  ];

  /* The year's cancellations, each with the request that led to it. */
  const minus = (iso, min) => new Date(new Date(iso).getTime() - min * 60000).toISOString();
  histCorr.forEach((h, n) => {
    const inv = h.inv, d = deciders[inv.tenantId];
    const doneAt = inv.cancelledAt;
    db.corrections.push({ id:'corr_h' + (n + 1), tenantId:inv.tenantId, branchId:inv.branchId,
      invoiceId:inv.id, invoiceNumber:inv.number, kind:'CANCEL', reason:h.reason,
      amount:0, note:inv.cancelNote,
      status:'APPROVED', requestedBy:inv.issuedBy, requestedByRole:'ISSUER', requestedAt:minus(doneAt, 40),
      decidedBy:d[0], decidedAt:minus(doneAt, 4), decisionNote:'Cancelled before it was sent.',
      resultNumber:null });
  });

  /* ---------------------------------------------------------
     Sessions

     Two of the owner's, one of them still open on a machine he is not sitting
     at — which is the whole reason the sessions panel exists. Times are
     relative so "3 hours ago" stays true whenever the demo is opened.
     --------------------------------------------------------- */
  const ago = h => new Date(Date.now() - h * 36e5).toISOString();
  db.sessions = [
    { id:'ses_seed_1', userId:'u_bmc_owner', tenantId:'t_bmc',
      startedAt:ago(31), lastSeenAt:ago(29), endedAt:null, endedBy:null,
      device:'Windows', browser:'Chrome', ip:'Not recorded',
      location:'Not recorded' },
    { id:'ses_seed_2', userId:'u_bmc_owner', tenantId:'t_bmc',
      startedAt:ago(76), lastSeenAt:ago(74), endedAt:ago(74), endedBy:'signed out',
      device:'iOS', browser:'Safari', ip:'Not recorded', location:'Not recorded' },
    { id:'ses_seed_3', userId:'u_bmc_iss', tenantId:'t_bmc',
      startedAt:ago(6), lastSeenAt:ago(5), endedAt:null, endedBy:null,
      device:'Windows', browser:'Edge', ip:'Not recorded', location:'Not recorded' }
  ];

  rebuildSeries(db);
  /* When each document was recorded. A document is recorded in number order
     whatever date its sale carries, so a later number can hold an earlier sale
     (a late entry) without the series running against the clock. */
  const bySeries = {};
  db.invoices.forEach(i => {
    const m = /^(\D*)(\d{7})$/.exec(i.number || '');
    if (m && !i.recordedAt) (bySeries[m[1]] = bySeries[m[1]] || []).push({ seq:Number(m[2]), inv:i });
  });
  Object.keys(bySeries).forEach(k => {
    let prev = 0;
    bySeries[k].sort((a, b) => a.seq - b.seq).forEach(x => {
      prev = Math.max(prev + 60000, new Date(x.inv.issuedAt).getTime());
      x.inv.recordedAt = new Date(prev).toISOString();
    });
  });

  /* Acknowledged a little after recording, by a varying margin, so the
     console's acknowledgment times are not all zero. */
  db.invoices.forEach((i, n) => {
    if (i.transmissionStatus === 'TRANSMITTED' && !i.transmittedAt && i.recordedAt)
      i.transmittedAt = new Date(new Date(i.recordedAt).getTime() + (20 + (n * 37) % 220) * 1000).toISOString();
  });

  /* A BIR examiner, and two requests already on file for Bayanihan so the
     records screen opens with something to read. The summary was answered
     within its day; the extract is still inside its three. */
  db.users.push({ id:'u_bir_1', tenantId:null, branchId:null, roleKey:'BIR_EXAMINER',
    name:'Elena V. Dizon', email:'e.dizon@bir.gov.ph',
    position:'Revenue Officer, e-Invoicing Division', active:true });

  const hoursAgo = h => new Date(Date.now() - h * 36e5);
  db.dataRequests.push(
    { id:'req_1', tenantId:'t_bmc', type:'SUMMARY', scope:'Sales summary, last 30 days',
      from:null, to:null, requestedBy:'Elena V. Dizon', requestedAt:hoursAgo(70).toISOString(),
      dueAt:addWorkingDays(hoursAgo(70), 1).toISOString(), fulfilledAt:hoursAgo(69).toISOString() },
    { id:'req_2', tenantId:'t_bmc', type:'EXTRACT', scope:'All invoices with acknowledgments, year to date',
      from:null, to:null, requestedBy:'Elena V. Dizon', requestedAt:hoursAgo(20).toISOString(),
      dueAt:addWorkingDays(hoursAgo(20), 3).toISOString(), fulfilledAt:null }
  );

  /* EPI's own staff (RMC VII.14: technical, security, compliance, privacy
     and taxpayer-support personnel). They sign in to the operator console. */
  const epi = (id, name, position, staffFunction, email) => ({ id, tenantId:null, branchId:null,
    roleKey:'EPI_OPERATOR', name, position, staffFunction, email, active:true });
  db.users.push(
    epi('u_epi_ops',  'Carmela T. Rivera',  'Client operations lead',   'SUPPORT',    'c.rivera@eastlandprintink.ph'),
    epi('u_epi_sup',  'Jerome S. Robles',   'Support engineer, tier 2', 'SUPPORT',    'j.robles@eastlandprintink.ph'),
    epi('u_epi_tech', 'Rafael D. Mendoza',  'Technical focal person',   'TECHNICAL',  'r.mendoza@eastlandprintink.ph'),
    epi('u_epi_sec',  'Imelda C. Bautista', 'Security officer',         'SECURITY',   'i.bautista@eastlandprintink.ph'),
    epi('u_epi_comp', 'Teresita A. Lacson', 'Compliance officer',       'COMPLIANCE', 't.lacson@eastlandprintink.ph'),
    epi('u_epi_dpo',  'Joaquin P. Serrano', 'Data protection officer',  'PRIVACY',    'j.serrano@eastlandprintink.ph')
  );

  /* A short API blip EPI declared and has not yet verified, and Bayanihan's
     report on the failed invoice, waiting for EPI's review. */
  db.interruptions.push({ id:'int_2', ref:'INT-2026-0002', source:'API',
    startedAt:rd('2026-08-11T15:02:00+08:00'), endedAt:rd('2026-08-11T15:14:00+08:00'),
    note:'Connector API answered with errors for twelve minutes. No invoice was held.',
    verified:false, declaredBy:'Rafael D. Mendoza' });
  const failed = db.invoices[4];
  const firstFail = new Date(failed.transmissionAttempts[0].at).getTime();
  const reporter = db.users.find(u => u.tenantId === failed.tenantId && u.roleKey === 'OWNER');
  db.problemReports.push({ id:'pr_1', ref:'PR-2026-0001', tenantId:failed.tenantId,
    reportedAt:new Date(firstFail + 3 * 36e5).toISOString(), reportedBy:reporter ? reporter.name : 'Owner',
    noticedAt:new Date(firstFail + 2 * 36e5).toISOString(), kind:'NOT_REACHING', docIds:[failed.id],
    description:'One invoice shows as failed and has no acknowledgment.',
    interruptionId:'int_1', status:'UNDER_REVIEW', assessment:null });

  /* Incidents. The August outage was reported inside both clocks and every
     client was told; the API blip was judged not critical, with the reason on
     record. The security one was found a short while ago, so the one-hour
     clock is visibly running when the console opens. */
  const allIds = db.tenants.map(t => t.id);
  const at = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
  const i1 = db.interruptions[0], i2 = db.interruptions[1];
  db.incidents = [
    { id:'inc_1', ref:'INC-2026-0001', kind:'TRANSMISSION', critical:true, title:'BIR EIS unavailable (INT-2026-0001)',
      summary:i1.note, discoveredAt:i1.startedAt, discoveredBy:'Rafael D. Mendoza', interruptionId:'int_1', tenantIds:allIds, status:'CLOSED',
      writtenReport:{ at:at(i1.startedAt, 6 * 60 + 10), channel:'EMAIL', reference:'EPI-INC-0001-R1', by:'Teresita A. Lacson',
        summary:'The BIR EIS stopped answering. Every send in the window timed out.',
        cause:'The BIR EIS, outside EPI. Not yet explained by the BIR.', impact:'Documents from all four accounts were held; one invoice reached three failed attempts.',
        actions:'Queued every send, retried on recovery, and verified the interruption.', status:'Resolved', next:'None. Problem report PR-2026-0001 covers the one failed invoice.' },
      serviceRestoredAt:i1.endedAt, closedAt:at(i1.endedAt, 90), closedBy:'Carmela T. Rivera',
      timeline:[
        { at:i1.startedAt, by:'Rafael D. Mendoza', text:'Opened when INT-2026-0001 was declared.' },
        { at:at(i1.startedAt, 38), by:'Rafael D. Mendoza', text:'BIR notified by telephone.' },
        { at:i1.endedAt, by:'Rafael D. Mendoza', text:'Service restored. Held documents were retried.' } ] },
    { id:'inc_2', ref:'INC-2026-0002', kind:'TRANSMISSION', critical:false, title:'API outage (INT-2026-0002)',
      summary:i2.note, discoveredAt:i2.startedAt, discoveredBy:'Rafael D. Mendoza', interruptionId:'int_2', tenantIds:allIds, status:'CLOSED',
      notCritical:{ reason:'Twelve minutes, and no document was held or failed.', by:'Rafael D. Mendoza', at:at(i2.endedAt, 20) },
      closedAt:at(i2.endedAt, 20), closedBy:'Rafael D. Mendoza',
      timeline:[ { at:i2.startedAt, by:'Rafael D. Mendoza', text:'Opened when INT-2026-0002 was declared.' },
                 { at:at(i2.endedAt, 20), by:'Rafael D. Mendoza', text:'Judged not critical: twelve minutes, and no document was held or failed.' } ] },
    { id:'inc_3', ref:'INC-2026-0003', kind:'SECURITY', critical:true, title:'Repeated failed sign-ins on an EPI staff account',
      summary:'Forty failed sign-in attempts in ten minutes against one staff account, from an address EPI does not use. The account locked after five.',
      discoveredAt:new Date(Date.now() - 35 * 60000).toISOString(), discoveredBy:'Imelda C. Bautista', interruptionId:null, tenantIds:[], status:'OPEN',
      timeline:[ { at:new Date(Date.now() - 35 * 60000).toISOString(), by:'Imelda C. Bautista', text:'Opened. No client account or data is known to be involved.' } ] }
  ];
  db.notices = [
    { id:'ntc_1', ref:'NTC-2026-0001', incidentId:'inc_1', interruptionId:'int_1', kind:'OPENED', title:'BIR EIS unavailable',
      body:'The BIR\'s system is not responding. Your invoices are being held.', tenantIds:allIds, at:at(i1.startedAt, 25), by:'Rafael D. Mendoza',
      contingency:'Keep issuing invoices as usual. They are held and sent to the BIR automatically when the link returns. Nothing needs doing by hand.' },
    { id:'ntc_2', ref:'NTC-2026-0002', incidentId:'inc_1', interruptionId:'int_1', kind:'RESTORED', title:'Service restored: BIR EIS unavailable',
      body:'The BIR\'s system is answering again. Invoices that were waiting have now been sent to the BIR. Check Invoices for any still waiting.',
      tenantIds:allIds, at:at(i1.endedAt, 12), by:'Rafael D. Mendoza', contingency:'' }
  ];

  /* Real-time deduction. Three clients have a payment provider. Their card and e-wallet sales were paid
     through the System, so the provider took EPI's fee from each payment. Sierra pays by bank transfer
     and has no provider, so all its fees are billed in the monthly statement. */
  const instr = t => ({ status:'ACTIVE', signedAt:t.goLiveAt, by:'Owner' });
  const conf = t => ({ by:'Jerome S. Robles', at:t.goLiveAt });
  const provs = {
    t_bmc: { mode:'EPI_PARTNER', name:FeeReg.EPI_PARTNER_NAME, account:{ kind:'Bank', label:'Sample Bank (illustrative), Bayanihan Mercantile Corp., 1111-2222-33' }, settlement:'T+1' },
    t_jof: { mode:'OWN', name:'Kapitbahay Payments, Inc.', account:{ kind:'E-wallet', label:'GCash 0917 000 1111, Juana C. Ramirez' }, settlement:'REALTIME' },
    t_mlc: { mode:'OWN', name:'Kapitbahay Payments, Inc.', account:{ kind:'Bank', label:'Sample Bank (illustrative), Marikina Leather Crafters Co., 2222-3333-44' }, settlement:'T+1' }
  };
  db.tenants.forEach(t => { if (provs[t.id]) t.provider = Object.assign({ instruction:instr(t), confirmed:conf(t) }, provs[t.id]); });
  db.invoices.forEach(inv => {
    const t = db.tenants.find(x => x.id === inv.tenantId);
    if (t && t.provider && inv.docStatus !== 'CANCELLED' && inv.paymentStatus === 'PAID' && /^(card|gcash)$/i.test(inv.paymentMethod || ''))
      FeeReg.pay(db, inv, inv.issuedAt);
  });
    SettleReg.seed(db);
    /* The date on each PTI and where each client stands on its EIS Certification (RMC 98-2026 IV.15).
       Marikina's permit was amended recently, so its certification is coming due. */
    db.tenants.forEach(t => {
      if (!t.pti) return;
      t.ptiIssuedAt = addDays(GO_LIVE[t.id], -2);
      if (t.id === 't_mlc'){ t.ptiIssuedAt = new Date(Date.now() - 165 * 864e5).toISOString().slice(0, 10); return; }
      t.eis = { certifiedAt:addDays(t.ptiIssuedAt, 60), ref:'EIS-' + t.ptiIssuedAt.slice(0, 4) + '-' + String(hashStr(t.id) % 90000 + 10000), by:'EPI Client Onboarding' };
    });
  BillingReg.seed(db);
  /* Every client paid its safety deposit before it went live, sized to the tier it started on. */
  db.tenants.forEach(t => { if (t.goLiveAt && !t.isProvider) t.deposit = DepositReg.opening(planAt(t, t.goLiveAt), 'Bank Transfer', 'EPI', t.goLiveAt); });
  /* Each client's agreement was signed in ink, notarized, uploaded and checked before it went live. */
  db.tenants.forEach(t => { if (t.goLiveAt && !t.isProvider) t.agreement = { version:CSA.version, signedFile:'Client-Service-Agreement-signed-' + String(t.tin || '').replace(/\D/g, '') + '.pdf',
    notary:{ arrange:true, date:'' }, verifiedBy:'EPI Client Onboarding', verifiedAt:t.goLiveAt, countersignedAt:t.goLiveAt }; });
  /* Two things to show: a bank transfer EPI has not confirmed yet, and a request to move to a smaller tier at renewal waiting for review. */
  const open = BillingReg.all(db).filter(i => i.clientId === 't_swt' && i.paymentStatus !== 'PAID').pop();
  if (open) open.paymentSubmitted = { method:'BANK_TRANSFER', label:'Bank transfer (InstaPay or PESONet)', reference:'IPY-20260811-004417', proof:'transfer-receipt.png', submittedAt:rd('2026-08-11T10:20:00+08:00'), by:'Finance Manager' };
  db.planChanges = [{ id:'plc_1', tenantId:'t_swt', from:'TIER2', to:'TIER1', effectiveAt:PayReg.renewalDate(db.tenants.find(t => t.id === 't_swt')), requestedBy:'Owner', requestedAt:rd('2026-08-12T09:00:00+08:00'), status:'PENDING' }];

  /* Reference numbers carry the year they were raised in. The hand-written ones say 2026. */
  const SEED_YEAR = SEED_TODAY.slice(0, 4);
  if (SEED_YEAR !== '2026'){
    const yearOf = v => {
      if (typeof v === 'string') return v.replace(/\b(INT|INC|NTC|PR|APP)-2026-/g, '$1-' + SEED_YEAR + '-');
      if (Array.isArray(v)) return v.map(yearOf);
      if (v && typeof v === 'object'){ Object.keys(v).forEach(k => { v[k] = yearOf(v[k]); }); return v; }
      return v;
    };
    yearOf(db);
  }

  return db;
}

/**
 * Rebuild db.series from the documents actually present.
 * Seeded invoices are numbered directly, so without this the counters
 * would still read 1 and the next allocation would collide.
 * Cancelled numbers are recorded as retired — never reissued.
 */
function rebuildSeries(db){
  const KIND = { INVOICE:'INVOICE' };
  db.series = {};

  db.invoices.forEach(inv => {
    if (!inv.number || inv.providerBilling) return;   // EPI's System-fee invoices run on their own plain series
    const seq = seqOf(inv.number);
    if (!Number.isFinite(seq)) return;

    const key  = `${KIND[inv.docType] || 'INVOICE'}:${inv.tenantId}`;
    if (!db.series[key]) db.series[key] = { next:1, issued:[], retired:[] };

    const s = db.series[key];
    s.issued.push(inv.number);
    if (inv.docStatus === 'CANCELLED') s.retired.push(inv.number);
    if (seq >= s.next) s.next = seq + 1;
  });
}

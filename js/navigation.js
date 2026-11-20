/* ============================================================
   navigation.js — sidebar, routing, role visibility

   Sections are presentational only. Visibility is computed per
   item, never inherited from a parent group.

   `built: false` marks a screen that exists in the menu but has
   not been converted yet. It still opens — to a placeholder that
   names what will be there — rather than being blocked, so the
   whole structure can be walked during review.

   Two different gates, deliberately kept apart. `perm` asks what
   the signed-in role may do. `conn` asks what the account is able
   to do at all: a screen that only makes sense for a particular
   way of receiving sales is hidden from accounts that receive
   them another way. An owner has every permission there is and
   still has no use for a file uploader if their system posts each
   sale as it happens.
   ============================================================ */

const NAV = [
  { section:'Overview' },
  { id:'home',         label:'Dashboard',           ico:'bi-speedometer2',            built:true  },

  { section:'Invoicing' },
  /* "Invoice Transactions" was the source portal's name for its payment screen.
     It is wrong here: nothing on it is a payment. It is a register of the
     documents we issued.                                                      */
  { id:'invoices',     label:'Invoices',    ico:'bi-receipt',                built:true  },
  { id:'issue',        label:'Issue Invoice',        ico:'bi-plus-square',            built:true,  perm:'issue', hideWhenOwnSystem:true },
  { id:'import',       label:'Bulk Import',          ico:'bi-upload',                 built:true,  perm:'issue', conn:'BULK', hideWhenOwnSystem:true },
  { id:'corrections',  label:'Cancellations',          ico:'bi-arrow-counterclockwise', built:true  },
  { id:'delivery',     label:'Buyer Copies',  ico:'bi-send',                   built:true  },
  { id:'platforms',    label:'Connections', ico:'bi-shop',                   built:true  },

  { section:'Compliance' },
  { id:'reports',      label:'Reports',   ico:'bi-file-earmark-bar-graph', built:true,  perm:'export' },
  { id:'records',      label:'Records',             ico:'bi-archive',                built:true  },

  { section:'Configuration' },
  { id:'template',     label:'Invoice Template',     ico:'bi-file-earmark-text',      built:true,  perm:'template' },

  { section:'Administration' },
  { id:'accounts',     label:'Users',               ico:'bi-people',                 built:true,  perm:'users' },
  { id:'activity',     label:'Activity Log',        ico:'bi-clock-history',          built:true  },
  { id:'notices',      label:'Service Notices',      ico:'bi-megaphone',              built:true  },
  { id:'billing',      label:'EPI Billing',         ico:'bi-receipt-cutoff',         built:true,  perm:'billing' },
  { id:'settings',     label:'Settings',             ico:'bi-gear',                   built:true  },

  /* EPI's operator console (ops.js). Only EPI's staff see these, and they see
     nothing else: they work across every account and sit inside none. */
  { section:'Oversight' },
  { id:'ops',          label:'Operations',           ico:'bi-activity',               built:true,  perm:'operate', ops:true },
  { id:'opsIncidents', label:'Incidents',            ico:'bi-exclamation-octagon',    built:true,  perm:'operate', ops:true },
  { id:'opsService',   label:'Service Status',       ico:'bi-broadcast',              built:true,  perm:'operate', ops:true },
  { id:'opsClients',   label:'Client Accounts',      ico:'bi-buildings',              built:true,  perm:'operate', ops:true },
  { id:'opsOnboarding', label:'Onboarding',          ico:'bi-person-check',           built:true,  perm:'operate', ops:true },
    { id:'opsRequests',  label:'BIR Requests',         ico:'bi-inbox',                  built:true,  perm:'operate', ops:true },
  { section:'Reporting' },
  { id:'opsReports',   label:'Reports to the BIR',   ico:'bi-file-earmark-bar-graph', built:true,  perm:'operate', ops:true },
  { id:'opsBilling',   label:'EPI Billing',          ico:'bi-receipt-cutoff',         built:true,  perm:'operate', ops:true },
  { section:'Administration' },
  { id:'opsStaff',     label:'EPI Staff',            ico:'bi-person-badge',           built:true,  perm:'operate', ops:true },
  { id:'opsAudit',     label:'Audit Log',            ico:'bi-clock-history',          built:true,  perm:'operate', ops:true }
];

const Nav = {
  current: null,
  opts: {},

  /** Both gates at once — the only place either is read, so the menu and the
      router can never disagree about what is reachable. */
  allows(item){
    if (!item || !item.id) return false;
    if (!!item.ops !== isOperator()) return false;
    if (item.id === 'billing' && CT && CT.isProvider) return false;   // EPI does not bill itself
    if (item.perm && !can(item.perm)) return false;
    if (item.conn && !usesConnection(item.conn)) return false;
    if (item.hideWhenOwnSystem && issuesOnOwnSystem()) return false;
    return true;
  },

  /** First menu item this role can actually open. Prefers a converted screen
      over a placeholder, so a session never opens on an empty page. */
  defaultView(){
    const open = n => this.allows(n);
    const item = NAV.find(n => open(n) && n.built) || NAV.find(open);
    return item ? item.id : 'invoices';
  },

  /** Narrow viewports start collapsed — the sidebar overlays content there. */
  autoCollapse(){
    const collapsed = document.getElementById('sidebar').classList.contains('collapsed');
    /* Phones: the menu is a drawer opened from the menu button, so keep it expanded. */
    if (window.innerWidth < 576){ if (collapsed) this.toggleRail(); return; }
    if (window.innerWidth < 900 && !collapsed) this.toggleRail();
  },

  /** Open or close the menu drawer on phones. */
  mobileMenu(open){
    const sb = document.getElementById('sidebar');
    const on = typeof open === 'boolean' ? open : !sb.classList.contains('m-open');
    sb.classList.toggle('m-open', on);
    const b = document.getElementById('mobile-menu');
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  },

  /** Navigate, falling back to the default view if the target is not permitted. */
  goSafe(id){
    const item = NAV.find(n => n.id === id);
    this.go(this.allows(item) ? id : this.defaultView());
  },

  build(){
    refreshSession();
    let html = '', pending = null, sectionHasItems = false;

    NAV.forEach(n => {
      if (n.section){
        if (pending && sectionHasItems) html += pending;
        pending = `<div class="sidebar_section">${esc(n.section)}</div>`;
        sectionHasItems = false;
        return;
      }
      if (!this.allows(n)) return;               // hidden entirely, not greyed out

      sectionHasItems = true;
      if (pending){ html += pending; pending = null; }

      html += `
        <div class="div_menu${this.current === n.id ? ' active' : ''}"
             data-nav="${n.id}" title="${esc(n.label)}"
             onclick="Nav.go('${n.id}')">
          <span class="icon"><i class="bi ${n.ico}"></i></span>
          <span class="label">${esc(n.label)}</span>
          ${n.built ? '' : '<span class="soon">SOON</span>'}
        </div>`;
    });

    if (pending && sectionHasItems) html += pending;
    document.getElementById('rail').innerHTML = html;
  },

  /**
   * @param id    menu item id
   * @param opts  view parameters, e.g. { docId } for a document detail.
   *              Views read them from Nav.opts as well as their argument.
   */
  go(id, opts){
    const item = NAV.find(n => n.id === id);
    if (!item) return;
    if (!this.allows(item)){
      /* Say which gate refused. "Your role does not have access" sent an owner
         hunting for a permission to grant themselves when the real answer was
         that their account does not receive sales that way. */
      const need = CONNECTIONS[item.conn];
      const have = connections().map(k => CONNECTIONS[k].label).join(' · ');
      UI.toast(item.conn && !usesConnection(item.conn)
        ? `${item.label} is only for accounts that ${need.needs}. This one receives sales by ${have || 'no configured method'}.`
        : 'Your role does not have access to that page', 'warn');
      return;
    }

    this.current = id;
    this.opts = opts || {};
    refreshSession();               // CU/CT are stale after any status change
    Auth.paintChrome();
    this.build();

    /* Whatever the screen we are leaving was polling, it is no longer on
       screen. The source portal stopped its timers in the same place. */
    if (typeof AppTraffic !== 'undefined') AppTraffic.stop();

    /* And whatever it left hanging off the body — calendars, range pickers,
       select2 dropdowns, DataTables instances — goes with it. */
    if (typeof DestroyScreenWidgets === 'function') DestroyScreenWidgets('#content');

    /* Views are keyed by menu id. Anything not yet written falls through to
       the placeholder, so adding a screen is one function, not a switch. */
    const view = Views[id];
    document.getElementById('content').innerHTML =
      typeof view === 'function' ? view(this.opts) : Views.placeholder(item);

    /* Re-arm the imported widget helpers against the markup just injected. */
    if (typeof Datepicker === 'function') Datepicker();
    if (typeof ViewingFunction === 'function') ViewingFunction();

    /* Then the screen's own wiring. The source portal separates the two the
       same way — markup, shared widgets, then a per-page function that binds
       its class hooks and asks the server for its data. Keyed by menu id like
       Views, so a screen adds a function rather than a line in a switch. */
    const screen = Screens[id];
    if (typeof screen === 'function') screen(this.opts);

    window.scrollTo(0, 0);
    this.mobileMenu(false);
    this.nameControls();
    setTimeout(() => this.nameControls(), 600);
  },

  /** Give every unlabelled control and icon-only button an accessible name. */
  nameControls(){
    const kinds = { branch:'Branch', status:'Status', state:'State', type:'Type', period:'Period', search:'Search', date:'Date range', year:'Year', channel:'Channel', role:'Role', kind:'Kind', week:'Week', region:'Branch', transmission:'Transmission', tenant:'Business' };
    const icons = { 'bi-arrow-repeat':'Refresh', 'bi-x-lg':'Remove', 'bi-x':'Close', 'bi-trash':'Delete', 'bi-pencil':'Edit', 'bi-search':'Search', 'bi-printer':'Print' };
    const root = document.body;
    root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea').forEach(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
      if (el.id && root.querySelector('label[for="' + el.id + '"]')) return;
      if (el.closest('label')) return;
      let name = el.getAttribute('placeholder') || el.getAttribute('title') || '';
      if (!name){
        const cls = Array.from(el.classList).find(c => /^(select|input)_/.test(c)) || '';
        const k = Object.keys(kinds).find(k => cls.indexOf(k) > -1);
        if (k) name = kinds[k];
      }
      if (!name && el.matches('.dataTables_length select, [name$="_length"]')) name = 'Rows per page';
      if (!name){
        /* A caption span above the field, as the forms here are written. */
        let p = el.parentElement;
        for (let i = 0; i < 3 && p && !name; i++, p = p.parentElement){
          const cap = Array.from(p.children).find(c => !c.contains(el) && /^(SPAN|LABEL|DIV|STRONG)$/.test(c.tagName) && !c.querySelector('input,select,textarea') && (c.textContent || '').trim().length > 1 && (c.textContent || '').trim().length < 60);
          if (cap) name = cap.textContent.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
        }
      }
      if (name) el.setAttribute('aria-label', name);
    });
    root.querySelectorAll('button,a[href]').forEach(b => {
      if ((b.textContent || '').trim() || b.getAttribute('aria-label')) return;
      const t = b.getAttribute('title');
      const ic = b.querySelector('i.bi');
      const key = ic && Array.from(ic.classList).find(c => icons[c]);
      const name = t || (key ? icons[key] : '');
      if (name) b.setAttribute('aria-label', name);
    });
  },

  toggleRail(){
    const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main_content').classList.toggle('collapsing', collapsed);
    const icon = document.querySelector('#sidebar-collapse i');
    if (icon) icon.className = collapsed ? 'bi bi-chevron-double-right' : 'bi bi-chevron-double-left';
    document.getElementById('sidebar-collapse').title = collapsed ? 'Expand menu' : 'Collapse menu';
    if (typeof adjustAllDataTables === 'function') setTimeout(adjustAllDataTables, 320);
  }
};

/* ============================================================
   Screens. One optional function per menu id, run after its markup is in the
   document: binds the screen's class hooks and loads its data. A screen that
   is pure markup needs no entry here.
   ============================================================ */
const Screens = {};

/* ============================================================
   Views. One function per menu id; screens register their own.
   ============================================================ */
const Views = {

  /* What each unconverted screen will hold. Shown on its placeholder so the
     structure can be reviewed before the screen exists. Empty now — every menu
     item resolves to a real screen — and kept because the next one added will
     start here again. */
  PLANNED: {},

  placeholder(item){
    const planned = (Views.PLANNED && Views.PLANNED[item.id]) || 'This screen has not been built yet.';
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">${esc(item.label)}</h1>
          <div class="screen_sub">Not yet converted to the new interface.</div>
        </div>
      </div>
      <div class="screen_placeholder">
        <div class="ph_icon"><i class="bi ${item.ico}"></i></div>
        <div class="ph_title">${esc(item.label)}</div>
        <div class="ph_text">${esc(planned)}</div>
      </div>`;
  }
};

/* Phones: a tap outside the open menu drawer closes it. */
document.addEventListener('click', function (e) {
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('m-open') && !sb.contains(e.target) && !e.target.closest('#mobile-menu')) Nav.mobileMenu(false);
});

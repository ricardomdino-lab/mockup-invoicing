/* ============================================================
   ops-onboarding.js — the Onboarding screen's stage tracker (EPI operator console)

   Every application sits in one of five stages. Each stage is somebody's turn: EPI's or the client's.
     1 EPI review            EPI checks the application (3 working days). Paused while the client replies.
     2 Account setup         The client sets up: tier, tax profile, branches, invoicing, permit, sandbox.
     3 Agreement and deposit The client signs and uploads the agreement, pays the safety deposit, names the provider.
     4 Activation review        EPI checks the signed copy and the setup (1 working day).
     5 Live                  Activated in the last 30 days. Older accounts are on Client Accounts.
   A declined application has left the pipeline and is listed at the bottom.
   The stage is worked out from the application and its saved setup; nothing extra is stored.
   ============================================================ */

const OnboardReg = {

  STAGES: [
    { key:'REVIEW',    label:'EPI review',             note:'Checks, 3 working days' },
    { key:'SETUP',     label:'Account setup',          note:'Tier, tax profile, permit, sandbox' },
    { key:'AGREEMENT', label:'Agreement and deposit',  note:'Signed copy, deposit, provider' },
    { key:'GOLIVE',    label:'Activation review',         note:'Checks, 1 working day' },
    { key:'LIVE',      label:'Active',                   note:'Last 30 days' }
  ],

  days(iso){ return iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null; },

  setupSteps(a){
    const s = a.setup || {};
    return SETUP_STEPS.filter(x => !x.final && !(x.key === 'branches' && s.lane === 'EXPRESS'));
  },

  /** What the client has done so far, as ticks. */
  checklist(a){
    const s = a.setup || {};
    return [
      ['Tier', !!s.plan], ['Tax profile', !!s.attested], ['Permit', !!(s.pti && s.pti.mode)], ['Sandbox', !!(s.sandbox && s.sandbox.passed)],
      ['Agreement', !!(s.docs && s.docs.signedAgreement)], ['Deposit', !!(s.deposit && s.deposit.paid)], ['Provider', !!s.provider]
    ];
  },

  /** Where an application is, whose turn it is and what for. Null when it has left the pipeline. */
  of(a){
    if (a.status === 'DECLINED') return null;
    if (a.status === 'PENDING_VERIFICATION')
      return { stage:'REVIEW', who:'EPI', since:a.submittedAt, detail:`Answer due ${fmtDate(a.dueAt)}`, late:AppReg.overdue(a), action:'app' };
    if (a.status === 'NEEDS_INFO')
      return { stage:'REVIEW', who:'Client', since:a.info && a.info.at || a.submittedAt, detail:`Replying to EPI. Reply by ${fmtDate(AppReg.replyBy(a))}`, note:a.info && a.info.request };
    if (a.status !== 'ACCEPTED') return null;
    if (a.activatedAt){
      if (this.days(a.activatedAt) > 30) return null;
      return { stage:'LIVE', who:'', since:a.activatedAt, detail:`Active since ${fmtDate(a.activatedAt)}` };
    }
    if (a.stage === 'GOLIVE_REVIEW')
      return { stage:'GOLIVE', who:'EPI', since:a.goLiveRequestedAt, detail:`Review due ${fmtDate(a.goLiveDueAt)}`, late:a.goLiveDueAt && new Date(a.goLiveDueAt) < new Date(), action:'golive' };
    const steps = this.setupSteps(a), idx = Math.min((a.setup && a.setup.idx) || 0, steps.length - 1);
    const agr = steps.findIndex(x => x.key === 'finish');
    const noPw = a.ownerToken && Store.db.users.some(u => u.inviteToken === a.ownerToken && u.status === 'INVITED');
    const stage = idx >= agr ? 'AGREEMENT' : 'SETUP';
    return { stage, who:'Client', since:a.setup && a.setup.updatedAt || a.reviewedAt,
      detail: noPw ? 'Has not set a password yet' : `Step ${idx + 1} of ${steps.length}: ${steps[idx].label}`, checks:this.checklist(a), returned:!!a.goLiveReturn };
  },

  /** Everything in the pipeline with its stage. */
  pipeline(db){
    return (db.onboardingApps || []).map(a => ({ a, p:this.of(a) })).filter(x => x.p)
      .sort((x, y) => new Date(x.p.since || 0) - new Date(y.p.since || 0));
  }
};

const OnboardViews = {

  card({ a, p }){
    const waiting = p.who === 'EPI' ? '<span class="lbadge lbadge-amber">EPI&rsquo;s turn</span>' : p.who === 'Client' ? '<span class="lbadge lbadge-gray">Client&rsquo;s turn</span>' : '<span class="lbadge lbadge-green">Done</span>';
    const d = OnboardReg.days(p.since);
    const prov = a.setup && a.setup.provider ? a.setup.provider.name : '';
    return `
      <div class="ob-card${p.who === 'EPI' ? ' ob-card-epi' : ''}">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="fw-semibold fs_13">${esc(a.tenantName)}</div>${waiting}
        </div>
        <div class="fs_11 text-muted mono">${esc(a.ref)} · ${esc(a.tin)}</div>
        <div class="fs_12 mt-2">${esc(p.detail)}${p.late ? ' <span class="lbadge lbadge-red">Overdue</span>' : ''}</div>
        ${p.returned ? '<div class="fs_11 text-danger">Returned by EPI for changes</div>' : ''}
        ${p.note ? `<div class="fs_11 text-muted mt-1">${esc(p.note)}</div>` : ''}
        ${p.checks ? `<div class="ob-checks mt-2">${p.checks.map(c => `<span class="ob-chip ${c[1] ? 'ob-chip-ok' : ''}" title="${esc(c[0])}: ${c[1] ? 'done' : 'not yet'}"><i class="bi ${c[1] ? 'bi-check-circle-fill' : 'bi-circle'}"></i> ${esc(c[0])}</span>`).join('')}</div>` : ''}
        ${prov && p.stage !== 'SETUP' ? `<div class="fs_11 text-muted mt-1">Provider: ${esc(prov)}</div>` : ''}
        <div class="d-flex justify-content-between align-items-center mt-2">
          <span class="fs_11 text-muted">${d == null ? '' : d === 0 ? 'Today' : d + (d === 1 ? ' day' : ' days') + (p.stage === 'LIVE' ? ' ago' : ' here')}</span>
          ${p.action === 'app' ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_app" data-id="${a.id}">Review</button>`
            : p.action === 'golive' ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_golive" data-id="${a.id}">Review activation</button>` : ''}
        </div>
      </div>`;
  },

  /** The tracker: five stages with counts, and the applications in each. */
  board(){
    const db = Store.db, all = OnboardReg.pipeline(db);
    const by = k => all.filter(x => x.p.stage === k);
    const epi = all.filter(x => x.p.who === 'EPI').length, cl = all.filter(x => x.p.who === 'Client').length;
    const declined = (db.onboardingApps || []).filter(a => a.status === 'DECLINED').length;
    const kpi = (l, v, n, cls) => `<div class="col-6 col-lg-3"><div class="lcard h-100"><div class="lcard-body"><span class="stat-label">${l}</span><div class="stat-value mono ${cls || ''}">${v}</div>${n ? `<span class="stat-note">${n}</span>` : ''}</div></div></div>`;
    return `
      <div class="row g-2 mb-3">
        ${kpi('In the pipeline', all.filter(x => x.p.stage !== 'LIVE').length, 'applications not yet active')}
        ${kpi('Waiting on EPI', epi, 'reviews to answer', epi ? 'text-warning' : '')}
        ${kpi('Waiting on clients', cl, 'replies, setup, agreement, deposit')}
        ${kpi('Declined', declined, 'left the pipeline')}
      </div>
      <div class="ob-track mb-3">
        ${OnboardReg.STAGES.map((s, i) => {
          const items = by(s.key);
          return `
          <div class="ob-col">
            <div class="ob-head"><span class="ob-num">${i + 1}</span>
              <div><div class="fw-semibold fs_13">${esc(s.label)}</div><div class="fs_11 text-muted">${esc(s.note)}</div></div>
              <span class="ob-count">${items.length}</span></div>
            <div class="ob-list">${items.length ? items.map(x => this.card(x)).join('') : '<div class="fs_11 text-muted px-1">None</div>'}</div>
          </div>`;
        }).join('')}
      </div>`;
  }
};

/* ============================================================
   session.js — sessions, idle timeout, sign-out everywhere

   A signed-in user is not the same thing as a session. The user is who they
   are; the session is one machine, in one place, holding the right to act as
   them until it is ended. Keeping the two apart is what makes the rest of this
   possible: an owner can end a session without disabling an account, a person
   can see that they are signed in somewhere they are not sitting, and a
   forgotten browser in a branch office stops being a standing invitation.

   Three behaviors, and the reasoning for each.

     - An idle session ends itself. A cashier's terminal left open at the
       counter is the ordinary case, not the exceptional one, and everything
       this system does under that session is attributed to a named person in
       a log that is meant to be evidence. So the session closes on its own,
       and it warns first — closing without warning loses whatever was on
       screen and teaches people to sign in on two tabs to avoid it.

     - Ending a session never touches what it issued. Documents are not the
       session's; they belong to the taxpayer. Ending a session removes the
       right to act, and nothing else.

     - Every open and close is written to the activity log, including the ones
       nobody performed. An automatic sign-out is a fact about the account, and
       an examiner reading a log with a gap in it deserves to know what the gap
       was.

   The clock here is real but short, because a mockup that asks you to wait
   fifteen minutes to see a feature does not get looked at. The Settings tab
   says what the number is and offers to run it against a shorter one.
   ============================================================ */

const SessionCtl = {

  /* Fifteen minutes idle, with the last minute spent warning. */
  IDLE_MS: 15 * 60 * 1000,
  WARN_MS: 60 * 1000,

  /** The session this browser is holding, or null when signed out. */
  current: null,

  _idle: null,
  _tick: null,
  _endsAt: 0,
  _idleFor: 0,

  /* ---------- Where this session is ----------

     A real deployment reads these from the request. There is no request here,
     so the browser is asked what it can answer and the rest is marked as not
     recorded rather than invented. A log that says "Quezon City" because the
     code needed a string is worse than one that admits it does not know. */
  here(){
    const ua = navigator.userAgent || '';
    const browser =
      /Edg\//.test(ua)     ? 'Edge'    :
      /Chrome\//.test(ua)  ? 'Chrome'  :
      /Safari\//.test(ua)  ? 'Safari'  :
      /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    const os =
      /Windows/.test(ua)   ? 'Windows' :
      /Mac OS X/.test(ua)  ? 'macOS'   :
      /Android/.test(ua)   ? 'Android' :
      /iPhone|iPad/.test(ua) ? 'iOS'   : 'Unknown device';
    return { device: os, browser, ip:'Not recorded', location:'Not recorded' };
  },

  /* ---------- Opening and closing ---------- */

  open(user){
    const db = Store.db;
    db.sessions = db.sessions || [];

    const s = Object.assign({
      id: uid('ses'),
      userId: user.id,
      tenantId: user.tenantId,
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      endedAt: null,
      endedBy: null,
      current: false
    }, this.here());

    db.sessions.unshift(s);
    if (db.sessions.length > 200) db.sessions.length = 200;
    Store.save(db);

    this.current = s.id;
    this.arm();
    return s;
  },

  /**
   * Close the session this browser holds.
   * @param reason  'signed out' | 'idle' | 'ended elsewhere'
   */
  close(reason){
    const db = Store.db;
    const s = (db.sessions || []).find(x => x.id === this.current);
    if (s && !s.endedAt){
      s.endedAt = new Date().toISOString();
      s.endedBy = reason || 'signed out';
      Store.save(db);
    }
    this.current = null;
    this.disarm();
    return s;
  },

  /** Still open, or has something ended it while this tab was sitting idle? */
  alive(){
    if (!this.current) return false;
    const s = (Store.db.sessions || []).find(x => x.id === this.current);
    return !!(s && !s.endedAt);
  },

  /* ---------- The idle clock ---------- */

  arm(){
    this.disarm();
    if (!this.current) return;
    this._idleFor = 0;
    this._endsAt = Date.now() + this.IDLE_MS;

    /* One second is enough resolution for a countdown and cheap enough to
       leave running; the alternative is two timers that can disagree. */
    this._tick = setInterval(() => this.check(), 1000);
  },

  disarm(){
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
    UI.closeIdleWarning && UI.closeIdleWarning();
    const el = document.getElementById('idle-warning');
    if (el) el.remove();
  },

  /** Any deliberate action pushes the deadline out again. */
  touch(){
    if (!this.current) return;
    if (document.getElementById('idle-warning')) return;  // the warning has its own buttons
    this._endsAt = Date.now() + this.IDLE_MS;

    /* lastSeenAt is what the sessions list shows, so it is written through —
       but only every half minute, because this fires on every keystroke. */
    const db = Store.db;
    const s = (db.sessions || []).find(x => x.id === this.current);
    if (s && Date.now() - new Date(s.lastSeenAt).getTime() > 30000){
      s.lastSeenAt = new Date().toISOString();
      Store.save(db);
    }
  },

  check(){
    if (!this.current) return this.disarm();

    /* Someone signed this session out from another screen. */
    if (!this.alive()){
      this.disarm();
      const held = this.current;
      this.current = null;
      Auth.forceOut('Your session was ended from another device.');
      return held;
    }

    const left = Math.ceil((this._endsAt - Date.now()) / 1000);
    if (left <= 0){ this.expire(); return; }
    if (left * 1000 <= this.WARN_MS) this.warn(left);
  },

  warn(left){
    let el = document.getElementById('idle-warning');
    if (!el){
      el = document.createElement('div');
      el.id = 'idle-warning';
      el.className = 'idle-warning';
      el.innerHTML = `
        <div class="idle-warning-card">
          <div class="idle-warning-title">Session timeout</div>
          <div class="idle-warning-body">
            You will be signed out in
            <strong class="idle-warning-count">${left}</strong> seconds due to inactivity.
            Unsaved changes will be lost.
          </div>
          <div class="idle-warning-actions">
            <button class="lbtn lbtn-sm lbtn-ghost"
                    onclick="Auth.logout()">Sign out now</button>
            <button class="lbtn lbtn-sm lbtn-primary"
                    onclick="SessionCtl.stay()">Stay signed in</button>
          </div>
        </div>`;
      document.body.appendChild(el);
    }
    const n = el.querySelector('.idle-warning-count');
    if (n) n.textContent = left;
  },

  /** The warning's own button — the only thing that dismisses it. */
  stay(){
    const el = document.getElementById('idle-warning');
    if (el) el.remove();
    this._endsAt = Date.now() + this.IDLE_MS;
    const db = Store.db;
    const s = (db.sessions || []).find(x => x.id === this.current);
    if (s){ s.lastSeenAt = new Date().toISOString(); Store.save(db); }
  },

  expire(){
    const db = Store.db;
    /* Logged before the session is torn down, so the entry carries the name of
       whoever the session belonged to rather than "System". */
    if (CU){
      logActivity(db, { action:'Signed out automatically after 15 minutes idle' });
      Store.save(db);
    }
    this.close('idle');
    Auth.forceOut('You were signed out after 15 minutes of inactivity.');
  },

  /** Demo affordance: run the same clock against twenty seconds. */
  demoTimeout(){
    if (!this.current){ UI.toast('No session to time out', 'warn'); return; }
    this._endsAt = Date.now() + 20000;
    UI.toast('Idle timer set to 20 seconds (demo).', 'ok');
  },

  /* ---------- Reading the list ---------- */

  /** Sessions for one user, newest first. Open ones first. */
  forUser(userId){
    return (Store.db.sessions || [])
      .filter(s => s.userId === userId)
      .sort((a, b) => (!!a.endedAt - !!b.endedAt) ||
                      (new Date(b.startedAt) - new Date(a.startedAt)));
  },

  /** Every session in the account. Owners only — the route checks, not this. */
  forTenant(tenantId){
    return (Store.db.sessions || [])
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => (!!a.endedAt - !!b.endedAt) ||
                      (new Date(b.startedAt) - new Date(a.startedAt)));
  },

  openCount(userId){
    return this.forUser(userId).filter(s => !s.endedAt).length;
  }
};

/* ============================================================
   Routes
   ============================================================ */

/** End one session. Your own, or anyone's in the account if you are an owner. */
LocalAPI.on("Dashboard/SessionEnd", function (p) {
  const db = Store.db;
  const s = (db.sessions || []).find(x => x.id === p.session_id);
  if (!s || s.endedAt) return { success:false, message:'That session has already ended.' };

  const mine = s.userId === CU.id;
  if (!mine && !can('users')){
    return { success:false, message:'Only an owner can end another person\'s session.' };
  }
  if (s.id === SessionCtl.current){
    return { success:false,
             message:'That is the session you are using. Use Sign out in the sidebar instead.' };
  }

  const who = (db.users || []).find(u => u.id === s.userId);
  s.endedAt = new Date().toISOString();
  s.endedBy = mine ? 'ended by the account holder' : `ended by ${CU.name}`;

  logActivity(db, {
    action: mine
      ? `Ended their own session on ${s.device} · ${s.browser}`
      : `Ended ${who ? who.name : 'a user'}'s session on ${s.device} · ${s.browser}`
  });
  Store.save(db);

  return { success:true,
           message: mine ? 'That session can no longer act as you.'
                         : `${who ? who.name : 'That user'} has been signed out on that device.` };
});

/** Everything except the one you are sitting at. */
LocalAPI.on("Dashboard/SessionEndOthers", function () {
  const db = Store.db;
  const mine = (db.sessions || [])
    .filter(s => s.userId === CU.id && !s.endedAt && s.id !== SessionCtl.current);

  if (!mine.length) return { success:false, message:'This is your only open session.' };

  mine.forEach(s => {
    s.endedAt = new Date().toISOString();
    s.endedBy = 'signed out everywhere';
  });
  logActivity(db, { action:`Signed out of ${mine.length} other session(s)` });
  Store.save(db);

  return { success:true,
           message:`${mine.length} other session(s) ended. This one is still open.` };
});

/* ============================================================
   Wiring

   Idle is the absence of deliberate action, so the events counted are the ones
   a person performs. Scroll and mousemove are not among them: a page can
   scroll under a sleeping cat.
   ============================================================ */
$(function(){
  ['click', 'keydown', 'submit'].forEach(ev =>
    document.addEventListener(ev, () => SessionCtl.touch(), true));
});

/* ============================================================
   app.js — bootstrap. Loaded last.
   ============================================================ */

const App = {

  MAX_AGE_HOURS: 3,

  /** The Philippine date now. SEED_TODAY is fixed when the page loads, so a tab left open past midnight needs this. */
  today(){ return new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10); },

  /** A page left open past midnight: say so and reload, which rebuilds the data from the clock. */
  watch(){
    const check = () => {
      const d = Store.db;
      if (!d || d.seededOn === App.today()) return;   /* only a new day, so a demo in progress is not wiped */
      try { UI.toast('A new day has started. Refreshing the demo data.', 'warn'); } catch (e) {}
      setTimeout(() => location.reload(), 1200);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 5 * 60000);
  },

  boot(){
    let db = Store.db;
    /* Rebuilt when the day has changed, the schema has changed, or the data is a few hours old, so what is on screen
       is always current when the demo is opened. */
    if (!db || db.version !== SEED_VERSION || db.seededOn !== SEED_TODAY || Date.now() - Date.parse(db.createdAt || 0) > App.MAX_AGE_HOURS * 36e5){
      db = seedDatabase();
      Store.save(db);
    }
    if (AppReg.sweep(db)) Store.save(db);
    UI.initTheme();
    App.watch();

    /* A scanned invoice QR lands here as ?verify=<number>&code=<code> (see
       verifyUrl() in core.js) — the one deep link this app honours, since
       verification has no account behind it to sign into first. */
    const params = new URLSearchParams(location.search);
    if (params.has('verify')){
      Verify.open({ number: params.get('verify'), code: params.get('code') });
    } else if (params.has('apply')){
      Onboarding.start();
    } else {
      Auth.showLogin();
    }
    /* The banner clock is driven by ClockWork() on the interval that
       for_all.js sets up — nothing to start here. */
  },

  /* Clear localStorage and reseed — needed whenever seed data changes */
  resetDemo(){
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Reset demo data?</span>
       <span class="fs_14 text-muted">This clears local storage and restores the original seed.
       Anything issued, corrected or imported during this session is lost.</span>`,
      () => {
        UI.closeModal();
        /* Before the store is replaced. The session this browser holds is about
           to stop existing, and the idle clock would otherwise notice on its
           next tick and report it as having been ended from another device. */
        SessionCtl.current = null;
        SessionCtl.disarm();
        Store.clear();
        Store.save(seedDatabase());
        CU = null; CR = null; CT = null;
        Nav.current = null;
        Auth.showLogin();
        DisplayDelaySwal('success', '', 'Demo data reset.', null, 2);
      },
      null, 'Reset');
  }
};

document.addEventListener('DOMContentLoaded', () => App.boot());

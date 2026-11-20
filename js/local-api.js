/* ============================================================================
   local-api.js — offline stand-in for the server.

   The screen code is carried over from the DORS portal essentially as-is, so it
   still talks to the server through $.ajax with absolute paths such as
   "/Portal/SPIStradcom/Dashboard/PaymentTransactionSearch". This mockup runs
   from file:// with no server behind it, so rather than rewrite every call site
   we intercept $.ajax and answer those paths from local data.

   Two rules keep this honest:
     - Only paths under API_BASE are intercepted. Anything else (a real relative
       file, say) goes through to the original $.ajax untouched.
     - An intercepted path with no handler registered fails loudly: a console
       warning naming the route, and the caller's error() branch runs. Screens
       are never silently fed empty data.

   Register handlers with:
       LocalAPI.on("Dashboard/PaymentTransactionSearch", function (data) {
           return { success: true, data: [...] };          // or a Promise
       });

   Load order: after jQuery, before for_all.js.
   ========================================================================== */

const LocalAPI = {

  /* Every server path in the carried-over code starts with this. */
  BASE: "/Portal/SPIStradcom/",

  /* Where the login page lived on the server. The shell watches for this so a
     carried-over redirect lands on our own sign-in screen instead of a 404. */
  LOGIN_PATH: "/Portal/SPIStradcom/Login",

  /* Fake round-trip time, in ms, so loading states are actually visible.
     Set to [0, 0] in tests. */
  latency: [140, 300],

  routes: {},

  /* --- registration ------------------------------------------------------ */

  on(path, handler){
    this.routes[this.key(path)] = handler;
    return this;
  },

  has(path){
    return !!this.routes[this.key(path)];
  },

  /* "/Portal/SPIStradcom/Dashboard/Logout/" -> "dashboard/logout" */
  key(url){
    if (!url) return "";
    let p = String(url).split("?")[0];
    if (p.indexOf(this.BASE) === 0) p = p.slice(this.BASE.length);
    return p.replace(/^\/+|\/+$/g, "").toLowerCase();
  },

  /* Does this URL belong to the server we are standing in for? */
  owns(url){
    return typeof url === "string" && url.indexOf(this.BASE) === 0;
  },

  /* --- dispatch ---------------------------------------------------------- */

  wait(){
    const [lo, hi] = this.latency;
    return lo <= 0 && hi <= 0 ? 0 : lo + Math.random() * (hi - lo);
  },

  /* Normalises jQuery's two call shapes into one options object. */
  normalise(url, options){
    if (url && typeof url === "object") return $.extend({}, url);
    return $.extend({}, options || {}, { url: url });
  },

  /* jQuery's ajax data may be an object, a query string, a JSON body, or
     FormData. Callers that set contentType: "application/json" hand us a JSON
     string, which must not be run through the query-string parser. */
  readData(data){
    if (!data) return {};
    if (typeof data === "string"){
      const trimmed = data.trim();
      if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "["){
        try { return JSON.parse(trimmed); } catch (e){ /* fall through */ }
      }
      const out = {};
      data.split("&").forEach(pair => {
        if (!pair) return;
        const i = pair.indexOf("=");
        const k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, " "));
        const v = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
        out[k] = v;
      });
      return out;
    }
    if (typeof FormData !== "undefined" && data instanceof FormData){
      const out = {};
      data.forEach((v, k) => { out[k] = v; });
      return out;
    }
    return data;
  },

  /* Runs a handler and hands the result to the caller's callbacks. Returns a
     jQuery promise so .done()/.then() work as well as success/error. */
  dispatch(opts){
    const dfd = $.Deferred();
    const route = this.key(opts.url);
    const handler = this.routes[route];
    const data = this.readData(opts.data);

    /* Which screen asked. A reply takes a beat to come back, and by then the
       user may have navigated — in which case the markup the success handler
       is about to paint into no longer exists, and DataTables and select2
       throw on a detached node. A real server has the same race; a browser
       just cancels the request. Recording the screen here and checking it
       below is the equivalent, and it belongs in one place rather than at the
       top of every screen's callback. */
    const askedFrom = (typeof Nav !== 'undefined') ? Nav.current : null;

    const settle = () => {
      if (!handler){
        console.warn(
          `[LocalAPI] no handler for "${route}" — the caller's error() branch will run. ` +
          `Register one with LocalAPI.on("${route}", fn).`
        );
        const xhr = { status: 501, statusText: "Not Implemented", responseText: "" };
        if (typeof opts.error === "function") opts.error(xhr, "error", "Not Implemented");
        if (typeof opts.complete === "function") opts.complete(xhr, "error");
        dfd.reject(xhr, "error", "Not Implemented");
        return;
      }

      let result;
      try {
        result = handler(data, opts);
      } catch (err){
        console.error(`[LocalAPI] handler for "${route}" threw:`, err);
        const xhr = { status: 500, statusText: "Handler Error", responseText: String(err) };
        if (typeof opts.error === "function") opts.error(xhr, "error", String(err));
        if (typeof opts.complete === "function") opts.complete(xhr, "error");
        dfd.reject(xhr, "error", String(err));
        return;
      }

      Promise.resolve(result).then(res => {
        const xhr = { status: 200, statusText: "OK", responseJSON: res };

        /* The screen that asked has gone. The handler already ran — anything it
           wrote is written — but painting a reply into a screen nobody is
           looking at is at best wasted and at worst an exception. The deferred
           still resolves, so a caller waiting on the promise is unaffected. */
        const gone = askedFrom !== null && typeof Nav !== 'undefined' &&
                     Nav.current !== askedFrom;
        if (gone){ dfd.resolve(res, "success", xhr); return; }

        if (typeof opts.success === "function") opts.success(res, "success", xhr);
        if (typeof opts.complete === "function") opts.complete(xhr, "success");
        dfd.resolve(res, "success", xhr);
      }, err => {
        console.error(`[LocalAPI] handler for "${route}" rejected:`, err);
        const xhr = { status: 500, statusText: "Handler Error", responseText: String(err) };
        if (typeof opts.error === "function") opts.error(xhr, "error", String(err));
        if (typeof opts.complete === "function") opts.complete(xhr, "error");
        dfd.reject(xhr, "error", String(err));
      });
    };

    const ms = this.wait();
    if (ms > 0) setTimeout(settle, ms); else settle();

    const promise = dfd.promise();
    promise.abort = function(){};          /* some callers keep the handle */
    return promise;
  },

  /* --- install ----------------------------------------------------------- */

  install(){
    if (typeof $ === "undefined"){
      console.error("[LocalAPI] jQuery must load before local-api.js.");
      return;
    }
    if ($.ajax._localApi) return;

    const original = $.ajax;
    const api = this;

    const patched = function(url, options){
      const opts = api.normalise(url, options);
      if (api.owns(opts.url)) return api.dispatch(opts);
      return original.apply($, arguments);
    };
    patched._localApi = true;
    patched.original = original;
    $.ajax = patched;
  }
};

/* ============================================================================
   Routes needed by for_all.js. Screen-specific routes are registered by the
   screen that owns them.
   ========================================================================== */

LocalAPI.on("Dashboard/Logout", function(){
  return true;                              /* the caller only checks truthiness */
});

LocalAPI.on("Dashboard/VerifyAccountPassword", function(data){
  /* Step-up confirmation for destructive actions. The mockup has no real
     credentials — sign-in is a role picker — so one demo password stands in. */
  return { success: String(data.password || "") === DEMO_PASSWORD };
});

LocalAPI.on("Select/SelectRegion", function(){
  /* The DORS region filter becomes a branch filter here. */
  const branches = (typeof Auth !== "undefined" && Auth.visibleBranches)
    ? Auth.visibleBranches()
    : [];
  return {
    success: true,
    data: branches.map(b => ({ value: b.id, text: `${b.code} — ${b.name}` }))
  };
});

/* Installed at load, not on ready, so nothing can slip a call through first. */
LocalAPI.install();

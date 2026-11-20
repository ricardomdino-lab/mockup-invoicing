/* ============================================================
   landing.js — marketing page only (landing.html)
   Self-contained: no dependency on core.js/auth.js/etc., since this
   page never boots the app.
   ============================================================ */
(function(){

  var nav = document.querySelector('.lp-nav');
  function onScroll(){
    if (nav) nav.classList.toggle('lp-nav-scrolled', window.scrollY > 6);
  }
  window.addEventListener('scroll', onScroll, { passive:true });
  onScroll();

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveals = document.querySelectorAll('.lp-reveal');
  if (!reduceMotion && 'IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          entry.target.classList.add('lp-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function(el){ io.observe(el); });
  } else {
    reveals.forEach(function(el){ el.classList.add('lp-visible'); });
  }

  document.querySelectorAll('.lp-faq-item').forEach(function(item){
    var q = item.querySelector('.lp-faq-q');
    if (!q) return;
    q.addEventListener('click', function(){
      var wasOpen = item.classList.contains('lp-open');
      document.querySelectorAll('.lp-faq-item.lp-open').forEach(function(other){
        if (other !== item) other.classList.remove('lp-open');
      });
      item.classList.toggle('lp-open', !wasOpen);
    });
  });

})();

/* Doodle Drop - brush engine
 * A stroke is { brush, color, size, opacity, pressure, taper, seed, points:[{x,y,p}] }.
 * Rendering is deterministic (seeded), so a stroke looks the same every time,
 * which is what makes draw-on and boil animation possible.
 */
var DD = window.DD || {};
window.DD = DD;

(function () {
  /* ---------- helpers ---------- */
  function rng(seed) {
    var a = (seed * 2654435761) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  DD.rng = rng;

  function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function noise1(x) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    var a = hash(i), b = hash(i + 1);
    return (a + (b - a) * u) * 2 - 1;
  }
  DD.noise1 = noise1;

  function dist(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy); }

  function length(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) { L += dist(pts[i - 1], pts[i]); }
    return L;
  }
  DD.length = length;

  // Portion of a polyline between arc lengths a and b.
  function sub(pts, a, b) {
    if (a <= 0 && b >= 1e15) { return pts; }
    var out = [], L = 0;
    for (var i = 0; i < pts.length; i++) {
      if (i > 0) {
        var d = dist(pts[i - 1], pts[i]);
        var L2 = L + d;
        if (L < a && L2 > a && d > 0) { out.push(lerpP(pts[i - 1], pts[i], (a - L) / d)); }
        if (L2 >= b) {
          if (d > 0 && L < b) { out.push(lerpP(pts[i - 1], pts[i], (b - L) / d)); }
          return out;
        }
        L = L2;
      }
      if (L >= a) { out.push(pts[i]); }
    }
    return out;
  }
  function lerpP(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: (a.p == null ? 1 : a.p) + (((b.p == null ? 1 : b.p) - (a.p == null ? 1 : a.p)) * t) };
  }

  // Wobble points along their arc length (the "boil" look).
  function jitter(pts, amt, seed) {
    if (!amt) { return pts; }
    var out = [], L = 0, sx = seed * 17.13, sy = seed * 31.7 + 500;
    for (var i = 0; i < pts.length; i++) {
      if (i > 0) { L += dist(pts[i - 1], pts[i]); }
      var f = L * 0.012;
      out.push({ x: pts[i].x + noise1(f + sx) * amt, y: pts[i].y + noise1(f + sy) * amt, p: pts[i].p });
    }
    return out;
  }
  DD.jitter = jitter;

  // Evenly spaced samples along the line.
  function resample(pts, step) {
    var out = [];
    if (!pts.length) { return out; }
    out.push(pts[0]);
    var carry = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], d = dist(a, b);
      var t = step - carry;
      while (t <= d) { out.push(lerpP(a, b, t / d)); t += step; }
      carry = d - (t - step);
    }
    return out;
  }

  function widthAt(st, pts, i, base) {
    var p = pts[i].p == null ? 1 : pts[i].p;
    var w = base * (st.pressure ? (0.2 + 0.8 * p) : 1);
    if (st.taper) {
      var n = pts.length, k = Math.min(i, n - 1 - i);
      var t = Math.min(1, k / 8);
      w *= 0.3 + 0.7 * t;
    }
    return Math.max(0.5, w);
  }

  /* ---------- scratch canvas for strokes that need flat alpha ---------- */
  var scratch = document.createElement("canvas");
  var sctx = scratch.getContext("2d");
  function getScratch(w, h) {
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    else { sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, w, h); }
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.shadowBlur = 0;
    return sctx;
  }

  /* ---------- line drawing primitives ---------- */
  function smoothLine(ctx, st, pts, base) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, widthAt(st, pts, 0, base) / 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    var prev = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var mid = i < pts.length - 1 ? { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 } : pts[i];
      ctx.beginPath();
      ctx.lineWidth = widthAt(st, pts, i, base);
      ctx.moveTo(prev.x, prev.y);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
      ctx.stroke();
      prev = mid;
    }
  }

  function constLine(ctx, pts, w) {
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) { ctx.lineTo(pts[0].x + 0.01, pts[0].y); }
    for (var i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    if (pts.length > 1) { ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); }
    ctx.stroke();
  }

  /* ---------- brushes ---------- */
  var B = {};

  B.smooth = function (ctx, st, pts) {
    ctx.strokeStyle = ctx.fillStyle = st.color;
    smoothLine(ctx, st, pts, st.size);
  };

  B.marker = function (ctx, st, pts) {
    ctx.strokeStyle = st.color;
    constLine(ctx, pts, st.size * 1.4);
  };
  B.marker.alpha = 0.82;

  B.pencil = function (ctx, st, pts, r) {
    ctx.strokeStyle = ctx.fillStyle = st.color;
    ctx.globalAlpha = 0.8;
    smoothLine(ctx, st, pts, Math.max(1, st.size * 0.35));
    var s = resample(pts, 1.5);
    ctx.globalAlpha = 1;
    for (var i = 0; i < s.length; i++) {
      var w = st.size * 0.45;
      for (var k = 0; k < 2; k++) {
        ctx.globalAlpha = 0.15 + r() * 0.45;
        ctx.fillRect(s[i].x + (r() - 0.5) * w, s[i].y + (r() - 0.5) * w, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  };

  B.chalk = function (ctx, st, pts, r) {
    ctx.fillStyle = st.color;
    var size = st.size;
    var s = resample(pts, Math.max(1, size * 0.12));
    var L = 0;
    for (var i = 0; i < s.length; i++) {
      if (i) { L += dist(s[i - 1], s[i]); }
      var p = s[i].p == null ? 1 : s[i].p;
      var rad = size * 0.55 * (st.pressure ? 0.4 + 0.6 * p : 1);
      // dry streaks: density drops in patches along the stroke
      var dry = 0.55 + 0.45 * noise1(L * 0.03 + st.seed);
      var count = Math.round(size * 0.9 * dry) + 2;
      for (var k = 0; k < count; k++) {
        var ang = r() * Math.PI * 2, rr = rad * Math.sqrt(r());
        if (r() < 0.22) { continue; }
        var ds = 0.6 + r() * Math.max(1, size * 0.13);
        ctx.globalAlpha = 0.3 + r() * 0.7;
        ctx.fillRect(s[i].x + Math.cos(ang) * rr, s[i].y + Math.sin(ang) * rr * 0.75, ds, ds);
      }
    }
    ctx.globalAlpha = 1;
  };

  B.crayon = function (ctx, st, pts, r, w, h) {
    // waxy base with paper-grain gaps punched out
    var c = getScratch(w, h);
    c.strokeStyle = c.fillStyle = st.color;
    c.globalAlpha = 0.9;
    smoothLine(c, st, pts, st.size);
    c.globalAlpha = 1;
    var s = resample(pts, Math.max(1, st.size * 0.2));
    c.globalCompositeOperation = "destination-out";
    for (var i = 0; i < s.length; i++) {
      var n = Math.round(st.size * 0.8);
      for (var k = 0; k < n; k++) {
        var ang = r() * Math.PI * 2, rr = st.size * 0.6 * Math.sqrt(r());
        var ds = 0.7 + r() * 1.8;
        c.globalAlpha = 0.4 + r() * 0.6;
        c.fillRect(s[i].x + Math.cos(ang) * rr, s[i].y + Math.sin(ang) * rr, ds, ds);
      }
    }
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0);
  };
  B.crayon.direct = true;

  B.neon = function (ctx, st, pts) {
    ctx.save();
    ctx.shadowColor = st.color;
    ctx.shadowBlur = st.size * 2.2;
    ctx.strokeStyle = st.color;
    constLine(ctx, pts, st.size);
    ctx.shadowBlur = st.size * 0.8;
    constLine(ctx, pts, st.size);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    constLine(ctx, pts, Math.max(1, st.size * 0.35));
    ctx.restore();
  };

  B.spray = function (ctx, st, pts, r) {
    ctx.fillStyle = st.color;
    var s = resample(pts, Math.max(1, st.size * 0.35));
    for (var i = 0; i < s.length; i++) {
      var n = Math.round(st.size * 1.6);
      for (var k = 0; k < n; k++) {
        // roughly gaussian spread
        var g = (r() + r() + r()) / 3 - 0.5;
        var ang = r() * Math.PI * 2, rr = Math.abs(g) * st.size * 2.6;
        ctx.globalAlpha = 0.5 + r() * 0.5;
        var ds = 0.8 + r() * 1.2;
        ctx.fillRect(s[i].x + Math.cos(ang) * rr, s[i].y + Math.sin(ang) * rr, ds, ds);
      }
    }
    ctx.globalAlpha = 1;
  };

  B.rough = function (ctx, st, pts) {
    // sketchy double line, like a quick pen scribble
    ctx.strokeStyle = ctx.fillStyle = st.color;
    var a = jitter(pts, st.size * 0.55, st.seed + 11);
    var b = jitter(pts, st.size * 0.55, st.seed + 23);
    ctx.globalAlpha = 0.95;
    smoothLine(ctx, st, a, st.size * 0.55);
    ctx.globalAlpha = 0.7;
    smoothLine(ctx, st, b, st.size * 0.4);
    ctx.globalAlpha = 1;
  };

  B.eraser = function (ctx, st, pts) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = ctx.fillStyle = "#000";
    constLine(ctx, pts, st.size * 2);
    ctx.restore();
  };
  B.eraser.direct = true;

  DD.brushes = B;
  DD.brushList = [
    ["smooth", "Smooth"], ["marker", "Marker"], ["pencil", "Pencil"], ["chalk", "Chalk"],
    ["crayon", "Crayon"], ["neon", "Neon"], ["spray", "Spray"], ["rough", "Sketchy"]
  ];

  /* ---------- stroke + drawing rendering ---------- */
  // opt: { a, b (arc-length window), boilAmt, boilSeed }
  DD.renderStroke = function (ctx, st, opt) {
    opt = opt || {};
    var pts = st.points;
    if (!pts || !pts.length) { return; }
    if (opt.boilAmt) { pts = jitter(pts, opt.boilAmt, (opt.boilSeed || 0) * 7 + st.seed); }
    if (opt.a != null || opt.b != null) {
      pts = sub(pts, opt.a || 0, opt.b == null ? 1e16 : opt.b);
      if (!pts.length) { return; }
    }
    var brush = B[st.brush] || B.smooth;
    var r = rng(st.seed + (opt.boilAmt ? (opt.boilSeed || 0) * 977 : 0));
    var w = ctx.canvas.width, h = ctx.canvas.height;
    var alpha = (st.opacity == null ? 1 : st.opacity) * (brush.alpha || 1);
    if (brush.direct || st.brush === "eraser") {
      ctx.save(); ctx.globalAlpha = alpha; brush(ctx, st, pts, r, w, h); ctx.restore();
      return;
    }
    if (alpha >= 0.999) {
      ctx.save(); brush(ctx, st, pts, r, w, h); ctx.restore();
      return;
    }
    var c = getScratch(w, h);
    brush(c, st, pts, r, w, h);
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(scratch, 0, 0); ctx.restore();
  };

  // Draw a whole drawing. progress window [from, to] in 0..1 of total ink length.
  DD.renderDrawing = function (ctx, strokes, opt) {
    opt = opt || {};
    var from = opt.from == null ? 0 : opt.from, to = opt.to == null ? 1 : opt.to;
    if (from <= 0 && to >= 1) {
      for (var i = 0; i < strokes.length; i++) {
        DD.renderStroke(ctx, strokes[i], { boilAmt: opt.boilAmt, boilSeed: opt.boilSeed });
      }
      return;
    }
    var lens = [], total = 0;
    for (var j = 0; j < strokes.length; j++) {
      var l = Math.max(1, length(strokes[j].points));
      lens.push(l); total += l;
    }
    var A = from * total, Bv = to * total, acc = 0;
    for (var k = 0; k < strokes.length; k++) {
      var s0 = acc, s1 = acc + lens[k];
      acc = s1;
      if (s1 <= A || s0 >= Bv) { continue; }
      var a = Math.max(0, A - s0), b = Math.min(lens[k], Bv - s0);
      DD.renderStroke(ctx, strokes[k], {
        a: a <= 0 ? null : a, b: b >= lens[k] ? null : b,
        boilAmt: opt.boilAmt, boilSeed: opt.boilSeed
      });
    }
  };

  /* ---------- finishing effects on a whole frame ---------- */
  var fxA = document.createElement("canvas"), fxB = document.createElement("canvas");
  // fx: { border:{on,color,width}, shadow:{on}, glow:{on,color,size} }
  DD.applyFx = function (src, fx) {
    var w = src.width, h = src.height;
    if (!fx || (!fx.border.on && !fx.shadow.on && !fx.glow.on)) { return src; }
    fxA.width = w; fxA.height = h;
    var a = fxA.getContext("2d");
    a.clearRect(0, 0, w, h);
    if (fx.border.on && fx.border.width > 0) {
      // sticker outline: stamp a coloured silhouette around in a ring
      fxB.width = w; fxB.height = h;
      var b = fxB.getContext("2d");
      b.clearRect(0, 0, w, h);
      b.drawImage(src, 0, 0);
      b.globalCompositeOperation = "source-in";
      b.fillStyle = fx.border.color;
      b.fillRect(0, 0, w, h);
      b.globalCompositeOperation = "source-over";
      var bw = fx.border.width, steps = Math.max(12, Math.round(bw * 2.5));
      for (var i = 0; i < steps; i++) {
        var ang = (i / steps) * Math.PI * 2;
        a.drawImage(fxB, Math.cos(ang) * bw, Math.sin(ang) * bw);
      }
    }
    a.drawImage(src, 0, 0);
    if (!fx.shadow.on && !fx.glow.on) { return fxA; }
    fxB.width = w; fxB.height = h;
    var c = fxB.getContext("2d");
    c.clearRect(0, 0, w, h);
    c.save();
    if (fx.glow.on) {
      c.shadowColor = fx.glow.color; c.shadowBlur = fx.glow.size;
      c.drawImage(fxA, 0, 0);
      c.drawImage(fxA, 0, 0);
    }
    if (fx.shadow.on) {
      c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = Math.round(w / 300);
      c.shadowOffsetX = Math.round(w / 400); c.shadowOffsetY = Math.round(w / 280);
      c.drawImage(fxA, 0, 0);
    }
    c.restore();
    c.drawImage(fxA, 0, 0);
    return fxB;
  };
})();

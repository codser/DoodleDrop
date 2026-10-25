/* Doodle Drop - stamps, scribble fill and auto outline (edge tracing) */
(function () {
  var DD = window.DD;
  var TAU = Math.PI * 2;

  function P(u, v) { return { u: u, v: v }; }
  function curve(fn, n, a, b) {
    var out = [];
    for (var i = 0; i <= n; i++) { out.push(fn(a + (b - a) * i / n)); }
    return out;
  }

  /* Stamps are drawn in a unit box (u,v in 0..1) and mapped to the dragged box.
     Each returns a list of strokes (lists of points). Slight wobble keeps them hand-made. */
  var S = {};
  S.circle = function (r) {
    var a0 = -2.2 + r() * 0.4;
    return [curve(function (t) {
      var rr = 1 + 0.035 * Math.sin(t * 3 + 1) + (t - a0) * 0.012;
      return P(0.5 + 0.5 * rr * Math.cos(t), 0.5 + 0.5 * rr * Math.sin(t));
    }, 90, a0, a0 + TAU * 1.12)];
  };
  S.underline = function () {
    return [curve(function (t) { return P(t, 0.55 - t * 0.12 + 0.05 * Math.sin(t * 5)); }, 40, 0, 1)];
  };
  S.double = function () {
    return [
      curve(function (t) { return P(t, 0.35 - t * 0.08 + 0.04 * Math.sin(t * 5)); }, 40, 0, 1),
      curve(function (t) { return P(0.08 + t * 0.85, 0.75 - t * 0.08 + 0.04 * Math.sin(t * 4 + 1)); }, 40, 0, 1)
    ];
  };
  S.arrow = function () {
    var shaft = curve(function (t) {
      var u = t, v = 1 - t;
      return P(u + 0.18 * Math.sin(t * Math.PI), v + 0.06 * Math.sin(t * Math.PI));
    }, 40, 0, 1);
    var e = shaft[shaft.length - 1], d = shaft[shaft.length - 4];
    var ang = Math.atan2(e.v - d.v, e.u - d.u), L = 0.28;
    return [shaft,
      [P(e.u - Math.cos(ang - 0.5) * L, e.v - Math.sin(ang - 0.5) * L), e,
       P(e.u - Math.cos(ang + 0.5) * L, e.v - Math.sin(ang + 0.5) * L)]];
  };
  S.star = function () {
    var pts = [];
    for (var i = 0; i <= 10; i++) {
      var a = -Math.PI / 2 + i * TAU / 10, r = i % 2 ? 0.2 : 0.5;
      pts.push(P(0.5 + r * Math.cos(a), 0.52 + r * Math.sin(a)));
    }
    return [pts];
  };
  S.heart = function () {
    return [curve(function (t) {
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return P(0.5 + x / 34, 0.45 - y / 34);
    }, 80, 0, TAU)];
  };
  S.sparkle = function () {
    function sp(cx, cy, r) {
      var pts = [];
      for (var i = 0; i <= 8; i++) {
        var a = -Math.PI / 2 + i * TAU / 8, rr = i % 2 ? r * 0.18 : r;
        pts.push(P(cx + rr * Math.cos(a), cy + rr * Math.sin(a)));
      }
      return pts;
    }
    return [sp(0.42, 0.55, 0.42), sp(0.85, 0.15, 0.14)];
  };
  S.burst = function () {
    var out = [];
    for (var i = 0; i < 9; i++) {
      var a = i * TAU / 9 - Math.PI / 2;
      out.push([P(0.5 + 0.28 * Math.cos(a), 0.5 + 0.28 * Math.sin(a)), P(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a))]);
    }
    return out;
  };
  S.check = function () { return [[P(0, 0.55), P(0.35, 0.95), P(1, 0.05)]]; };
  S.cross = function () { return [[P(0.05, 0.05), P(0.95, 0.95)], [P(0.95, 0.08), P(0.08, 0.92)]]; };
  S.spiral = function () {
    return [curve(function (t) { var r = 0.03 + t / (TAU * 3) * 0.47; return P(0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)); }, 160, 0, TAU * 3)];
  };
  S.scribble = function () {
    return [curve(function (t) {
      return P(0.5 + 0.36 * Math.cos(t) + 0.12 * Math.cos(t * 7.3), 0.5 + 0.3 * Math.sin(t * 1.02) + 0.12 * Math.sin(t * 7.3));
    }, 260, 0, TAU * 2.2)];
  };
  S.loops = function () {
    return [curve(function (t) { return P(t + 0.06 * Math.cos(t * 30), 0.5 + 0.3 * Math.sin(t * 30)); }, 220, 0, 1)];
  };
  S.crown = function () {
    return [[P(0.05, 0.9), P(0.05, 0.25), P(0.28, 0.55), P(0.5, 0.1), P(0.72, 0.55), P(0.95, 0.25), P(0.95, 0.9), P(0.05, 0.9)]];
  };
  S.bracket = function () {
    return [
      curve(function (t) { return P(0.18 + 0.15 * Math.abs(t - 0.5) * 2, t); }, 30, 0, 1),
      curve(function (t) { return P(0.82 - 0.15 * Math.abs(t - 0.5) * 2, t); }, 30, 0, 1)
    ];
  };
  S.speech = function () {
    var body = curve(function (t) { return P(0.5 + 0.48 * Math.cos(t), 0.42 + 0.38 * Math.sin(t)); }, 80, 2.2, 2.2 + TAU * 0.93);
    var e = body[body.length - 1];
    body.push(P(0.18, 0.98)); body.push(P(0.33, 0.77));
    return [body];
  };

  DD.stampList = [
    ["circle", "Circle"], ["underline", "Underline"], ["double", "Double line"], ["arrow", "Arrow"],
    ["star", "Star"], ["heart", "Heart"], ["sparkle", "Sparkle"], ["burst", "Burst"],
    ["check", "Tick"], ["cross", "Cross"], ["spiral", "Spiral"], ["scribble", "Scribble"],
    ["loops", "Loops"], ["crown", "Crown"], ["bracket", "Brackets"], ["speech", "Speech"]
  ];

  // Densify straight segments so draw-on and boil look natural.
  function densify(pts, step) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var d = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
      var n = Math.max(1, Math.ceil(d / step));
      for (var k = 1; k <= n; k++) { out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, p: 1 }); }
    }
    return out;
  }
  DD.densify = densify;

  DD.makeStamp = function (name, x0, y0, x1, y1, seed) {
    var r = DD.rng(seed);
    var lists = (S[name] || S.circle)(r);
    var out = [];
    for (var i = 0; i < lists.length; i++) {
      var pts = [];
      for (var k = 0; k < lists[i].length; k++) {
        var q = lists[i][k];
        pts.push({ x: x0 + q.u * (x1 - x0), y: y0 + q.v * (y1 - y0), p: 1 });
      }
      out.push(densify(pts, 4));
    }
    return out;
  };

  /* Scribble fill: zig-zag hatch inside a drawn loop, as one continuous stroke. */
  DD.scribbleFill = function (loop, spacing, angleDeg, seed) {
    if (loop.length < 3) { return null; }
    var r = DD.rng(seed);
    var a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var rot = loop.map(function (p) { return { x: p.x * ca + p.y * sa, y: -p.x * sa + p.y * ca }; });
    var minY = Infinity, maxY = -Infinity;
    rot.forEach(function (p) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    var out = [], dir = 0;
    for (var y = minY + spacing * 0.5; y < maxY; y += spacing) {
      var xs = [];
      for (var i = 0; i < rot.length; i++) {
        var p = rot[i], q = rot[(i + 1) % rot.length];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) {
          xs.push(p.x + (y - p.y) / (q.y - p.y) * (q.x - p.x));
        }
      }
      if (xs.length < 2) { continue; }
      var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
      var j1 = (r() - 0.5) * spacing * 0.8, j2 = (r() - 0.5) * spacing * 0.8;
      var yy = y + (r() - 0.5) * spacing * 0.3;
      if (dir === 0) { out.push({ x: lo + j1, y: yy }); out.push({ x: hi + j2, y: yy + spacing * 0.15 }); }
      else { out.push({ x: hi + j2, y: yy }); out.push({ x: lo + j1, y: yy + spacing * 0.15 }); }
      dir = 1 - dir;
    }
    if (out.length < 2) { return null; }
    var back = out.map(function (p) { return { x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca, p: 1 }; });
    return densify(back, 4);
  };

  /* ---------- Auto outline: trace strong edges into hand-drawn lines ---------- */
  var work = document.createElement("canvas");

  function rdp(pts, eps) {
    if (pts.length < 3) { return pts; }
    var a = pts[0], b = pts[pts.length - 1], idx = -1, dmax = 0;
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    for (var i = 1; i < pts.length - 1; i++) {
      var d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      var l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
      return l.slice(0, -1).concat(r);
    }
    return [a, b];
  }
  function chaikin(pts) {
    if (pts.length < 3) { return pts; }
    var out = [pts[0]];
    for (var i = 0; i < pts.length - 1; i++) {
      var p = pts[i], q = pts[i + 1];
      out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function inPoly(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) { c = !c; }
    }
    return c;
  }
  DD.inPoly = inPoly;

  function boxBlur(src, w, h, r) {
    if (r < 1) { return src; }
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      var acc = 0, n = 0;
      for (var x = -r; x < w; x++) {
        if (x + r < w) { acc += src[y * w + x + r]; n++; }
        if (x - r - 1 >= 0) { acc -= src[y * w + x - r - 1]; n--; }
        if (x >= 0) { tmp[y * w + x] = acc / n; }
      }
    }
    for (var x2 = 0; x2 < w; x2++) {
      var acc2 = 0, n2 = 0;
      for (var y2 = -r; y2 < h; y2++) {
        if (y2 + r < h) { acc2 += tmp[(y2 + r) * w + x2]; n2++; }
        if (y2 - r - 1 >= 0) { acc2 -= tmp[(y2 - r - 1) * w + x2]; n2--; }
        if (y2 >= 0) { out[y2 * w + x2] = acc2 / n2; }
      }
    }
    return out;
  }

  /* img: an Image/canvas of the frame. opts: detail 0..100, simplify 0..6, minLen px, area polygons
     Returns polylines in full-frame coordinates. */
  DD.traceEdges = function (img, W, H, opts) {
    var sw = Math.min(640, W), sc = sw / W, sh = Math.max(1, Math.round(H * sc));
    work.width = sw; work.height = sh;
    var c = work.getContext("2d");
    c.drawImage(img, 0, 0, sw, sh);
    var d = c.getImageData(0, 0, sw, sh).data;
    var g = new Float32Array(sw * sh);
    for (var i = 0; i < sw * sh; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; }
    var r = Math.round(opts.simplify || 0);
    g = boxBlur(boxBlur(g, sw, sh, r), sw, sh, r);

    var mag = new Float32Array(sw * sh), dirA = new Uint8Array(sw * sh), mx = 0;
    for (var y = 1; y < sh - 1; y++) {
      for (var x = 1; x < sw - 1; x++) {
        var k = y * sw + x;
        var gx = -g[k - sw - 1] - 2 * g[k - 1] - g[k + sw - 1] + g[k - sw + 1] + 2 * g[k + 1] + g[k + sw + 1];
        var gy = -g[k - sw - 1] - 2 * g[k - sw] - g[k - sw + 1] + g[k + sw - 1] + 2 * g[k + sw] + g[k + sw + 1];
        var m = Math.sqrt(gx * gx + gy * gy);
        mag[k] = m; if (m > mx) { mx = m; }
        var ang = Math.atan2(gy, gx) * 180 / Math.PI; if (ang < 0) { ang += 180; }
        dirA[k] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
      }
    }
    var detail = opts.detail == null ? 50 : opts.detail;
    var hi = mx * Math.max(0.04, 0.5 - detail * 0.0045), lo = hi * 0.45;
    var e = new Uint8Array(sw * sh);
    var offs = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (var y3 = 1; y3 < sh - 1; y3++) {
      for (var x3 = 1; x3 < sw - 1; x3++) {
        var k3 = y3 * sw + x3, m3 = mag[k3];
        if (m3 < lo) { continue; }
        var o = offs[dirA[k3]], n1 = mag[k3 + o[1] * sw + o[0]], n2 = mag[k3 - o[1] * sw - o[0]];
        if (m3 < n1 || m3 < n2) { continue; }
        e[k3] = m3 >= hi ? 2 : 1;
      }
    }
    // hysteresis
    var stack = [];
    for (var s = 0; s < e.length; s++) { if (e[s] === 2) { stack.push(s); } }
    var N8 = [-sw - 1, -sw, -sw + 1, -1, 1, sw - 1, sw, sw + 1];
    while (stack.length) {
      var t = stack.pop();
      for (var q = 0; q < 8; q++) {
        var nb = t + N8[q];
        if (e[nb] === 1) { e[nb] = 2; stack.push(nb); }
      }
    }
    // chain tracing
    var seen = new Uint8Array(sw * sh), chains = [];
    function nextOf(p) {
      for (var q2 = 0; q2 < 8; q2++) {
        var nb2 = p + N8[q2];
        if (nb2 > 0 && nb2 < e.length && e[nb2] === 2 && !seen[nb2]) { return nb2; }
      }
      return -1;
    }
    var minLen = Math.max(4, (opts.minLen || 20) * sc);
    for (var st = 0; st < e.length; st++) {
      if (e[st] !== 2 || seen[st]) { continue; }
      seen[st] = 1;
      var fwd = [st], p2 = st, nx;
      while ((nx = nextOf(p2)) !== -1) { seen[nx] = 1; fwd.push(nx); p2 = nx; }
      var back = []; p2 = st;
      while ((nx = nextOf(p2)) !== -1) { seen[nx] = 1; back.push(nx); p2 = nx; }
      var all = back.reverse().concat(fwd);
      if (all.length < minLen) { continue; }
      var pts = all.map(function (ix) { return { x: (ix % sw) / sc, y: Math.floor(ix / sw) / sc }; });
      if (opts.area && opts.area.length) {
        var keep = [], cur = [];
        for (var z = 0; z < pts.length; z++) {
          var inside = false;
          for (var aa = 0; aa < opts.area.length; aa++) { if (inPoly(pts[z].x, pts[z].y, opts.area[aa])) { inside = true; break; } }
          if (inside) { cur.push(pts[z]); } else if (cur.length) { keep.push(cur); cur = []; }
        }
        if (cur.length) { keep.push(cur); }
        keep.forEach(function (kp) { if (kp.length * sc >= minLen) { chains.push(kp); } });
      } else {
        chains.push(pts);
      }
    }
    return chains.map(function (ch) {
      var simp = chaikin(chaikin(rdp(ch, 1.2 / sc)));
      return densify(simp.map(function (p) { return { x: p.x, y: p.y, p: 1 }; }), 4);
    });
  };
})();

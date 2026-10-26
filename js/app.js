/* Doodle Drop - panel logic */
(function () {
  var DD = window.DD;
  var $ = function (id) { return document.getElementById(id); };
  var cep = window.__adobe_cep__;
  var cfs = window.cep && window.cep.fs;
  var enc = window.cep && window.cep.encoding;
  var TICKS = 254016000000;

  var S = {
    W: 1920, H: 1080, tpf: 10584000000, fps: 24, dir: "", seq: "",
    mode: "animate", tool: "draw", brush: "smooth", color: "#ffffff", stamp: "circle",
    frames: { 0: [] }, idx: 0, startTicks: 0, bg: null, bgCache: {}, area: [],
    outlinePreview: null, undo: [], redo: [], busy: false, playing: false
  };

  var COLORS = ["#ffffff", "#111111", "#ff5c8a", "#ffd400", "#2ee6a6", "#36c5ff", "#ff7a1a", "#a96bff", "#ff2d2d"];

  /* ---------------- Premiere bridge ---------------- */
  function ev(script) {
    return new Promise(function (res) {
      if (!cep) { res("ERR|Open this panel inside Premiere Pro."); return; }
      cep.evalScript(script, function (r) { res(r); });
    });
  }
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function parse(r) {
    if (!r || r === "EvalScript error.") { return { ok: false, msg: "Script error. Close and reopen the panel." }; }
    var i = r.indexOf("|");
    return { ok: r.slice(0, i) === "OK", msg: r.slice(i + 1), parts: r.slice(i + 1).split("|") };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function status(msg, kind) { var s = $("status"); s.textContent = msg; s.className = kind || ""; }
  function progress(f) { $("progress").firstElementChild.style.width = Math.round(f * 100) + "%"; }

  async function loadJsx() {
    if (!cep) { return false; }
    var ext = cep.getSystemPath("extension");
    ext = decodeURIComponent(ext.replace(/^file:\/{2,3}/, ""));
    var path = (ext + "/jsx/host.jsx").replace(/\\/g, "/");
    var r = await ev("$.evalFile(" + q(path) + "); ddPing();");
    return r === "pong";
  }

  function ensureDir(p) { try { if (cfs) { cfs.makedir(p); } } catch (e) {} }

  async function waitFile(paths) {
    var last = -1;
    for (var t = 0; t < 70; t++) {
      for (var i = 0; i < paths.length; i++) {
        var r = cfs.readFile(paths[i], enc.Base64);
        if (r.err === 0 && r.data && r.data.length > 200) {
          if (r.data.length === last) {
            try { cfs.deleteFile(paths[i]); } catch (e) {}
            return r.data;
          }
          last = r.data.length;
        }
      }
      await sleep(120);
    }
    throw "Premiere didn't export the frame. Check the sequence isn't empty at the playhead.";
  }

  function loadImg(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej("Couldn't read the frame image."); };
      im.src = src;
    });
  }

  // Grab the frame at `ticks` (or at the playhead when null). Cached by time.
  async function grab(ticks) {
    if (ticks != null && S.bgCache[ticks]) { return { img: S.bgCache[ticks], ticks: ticks }; }
    var dir = S.dir + "/Doodles";
    ensureDir(dir); ensureDir(dir + "/_frames");
    var path = dir + "/_frames/grab_" + Date.now() + "_" + Math.floor(Math.random() * 1e4) + ".png";
    var r = parse(await ev("ddGrab(" + (ticks == null ? '""' : q(String(ticks))) + "," + q(path) + ")"));
    if (!r.ok) { throw r.msg; }
    var b64 = await waitFile([path, path + ".png"]);
    var img = await loadImg("data:image/png;base64," + b64);
    var t = ticks == null ? parseFloat(r.msg) : ticks;
    S.bgCache[t] = img;
    return { img: img, ticks: t };
  }

  /* ---------------- canvases ---------------- */
  var cv = { bg: $("bg"), onion: $("onion"), ink: $("ink"), live: $("live") };
  var cx = {};
  Object.keys(cv).forEach(function (k) { cx[k] = cv[k].getContext("2d"); });
  var off = document.createElement("canvas"), offx = off.getContext("2d");
  var tmp = document.createElement("canvas"), tmpx = tmp.getContext("2d");

  function setSize(w, h) {
    S.W = w; S.H = h;
    [cv.bg, cv.onion, cv.ink, cv.live, off, tmp].forEach(function (c) { c.width = w; c.height = h; });
    fit();
  }
  /* ---------------- view: zoom & pan ---------------- */
  // V.z is zoom relative to "fit"; V.x / V.y = stage top-left inside #stageWrap (px)
  var V = { z: 1, x: 0, y: 0 };
  var wrapEl = $("stageWrap");
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function baseScale() {
    return Math.max(0.01, Math.min((wrapEl.clientWidth - 24) / S.W, (wrapEl.clientHeight - 24) / S.H));
  }
  function clampPan() {
    var sc = baseScale() * V.z, w = S.W * sc, h = S.H * sc, keep = 60;
    V.x = clamp(V.x, keep - w, wrapEl.clientWidth - keep);
    V.y = clamp(V.y, keep - h, wrapEl.clientHeight - keep);
  }
  function applyView() {
    var sc = baseScale() * V.z, st = $("stage");
    st.style.width = (S.W * sc) + "px";
    st.style.height = (S.H * sc) + "px";
    st.style.left = V.x + "px";
    st.style.top = V.y + "px";
    $("zoomV").textContent = Math.round(sc * 100) + "%";
  }
  function fit() {
    var sc = baseScale();
    V.z = 1;
    V.x = (wrapEl.clientWidth - S.W * sc) / 2;
    V.y = (wrapEl.clientHeight - S.H * sc) / 2;
    applyView();
  }
  // zoom to z, keeping the frame point under (cx, cy) (wrap px) fixed
  function zoomAt(z, cx, cy) {
    z = clamp(z, 0.25, 40);
    var sc0 = baseScale();
    var fx0 = (cx - V.x) / (sc0 * V.z), fy0 = (cy - V.y) / (sc0 * V.z);
    V.z = z;
    V.x = cx - fx0 * sc0 * z;
    V.y = cy - fy0 * sc0 * z;
    clampPan(); applyView();
  }
  function zoomCenter(z) { zoomAt(z, wrapEl.clientWidth / 2, wrapEl.clientHeight / 2); }
  function panBy(dx, dy) { V.x += dx; V.y += dy; clampPan(); applyView(); }
  window.addEventListener("resize", function () { if (V.z === 1) { fit(); } else { clampPan(); applyView(); } });

  function cur() { if (!S.frames[S.idx]) { S.frames[S.idx] = []; } return S.frames[S.idx]; }
  function k() { return S.H / 1080; } // scale UI pixel sizes to the frame

  function fx() {
    return {
      border: { on: $("fxBorder").checked, color: $("fxBorderC").value, width: +$("fxBorderW").value * k() },
      glow: { on: $("fxGlow").checked, color: $("fxGlowC").value, size: +$("fxGlowS").value * k() },
      shadow: { on: $("fxShadow").checked }
    };
  }

  function renderBg() {
    var c = cx.bg;
    c.clearRect(0, 0, S.W, S.H);
    if (S.bg) { c.globalAlpha = +$("bgDim").value / 100; c.drawImage(S.bg, 0, 0, S.W, S.H); c.globalAlpha = 1; }
  }

  function drawFrameTo(ctx, strokes, extra) {
    offx.clearRect(0, 0, S.W, S.H);
    if (extra) { DD.renderDrawing(offx, extra); }
    DD.renderDrawing(offx, strokes);
    ctx.drawImage(DD.applyFx(off, fx()), 0, 0);
  }

  function renderInk() {
    var c = cx.ink;
    c.clearRect(0, 0, S.W, S.H);
    var extra = S.mode === "outline" && S.outlinePreview ? S.outlinePreview : null;
    drawFrameTo(c, cur(), extra);
  }

  var ONION = ["#ff4d6d", "#4dabff", "#9b7bff"];
  function renderOnion() {
    var c = cx.onion;
    c.clearRect(0, 0, S.W, S.H);
    if (S.mode === "fbf" && $("onionOn").checked) {
      var n = +$("onionN").value;
      for (var j = n; j >= 1; j--) {
        var st = S.frames[S.idx - j];
        if (!st || !st.length) { continue; }
        tmpx.clearRect(0, 0, S.W, S.H);
        DD.renderDrawing(tmpx, st);
        tmpx.globalCompositeOperation = "source-in";
        tmpx.fillStyle = ONION[j - 1];
        tmpx.fillRect(0, 0, S.W, S.H);
        tmpx.globalCompositeOperation = "source-over";
        c.globalAlpha = 0.45 / j;
        c.drawImage(tmp, 0, 0);
        c.globalAlpha = 1;
      }
    }
    if (S.mode === "outline" && S.area.length) {
      c.save();
      c.strokeStyle = "#36c5ff"; c.lineWidth = 2 * k(); c.setLineDash([10 * k(), 8 * k()]);
      c.fillStyle = "rgba(54,197,255,0.08)";
      S.area.forEach(function (poly) {
        c.beginPath(); c.moveTo(poly[0].x, poly[0].y);
        for (var i = 1; i < poly.length; i++) { c.lineTo(poly[i].x, poly[i].y); }
        c.closePath(); c.fill(); c.stroke();
      });
      c.restore();
    }
  }

  function renderAll() { renderBg(); renderOnion(); renderInk(); tag(); }

  function tag() {
    var t = "";
    if (S.mode === "fbf") {
      var step = +$("fStep").value;
      t = "Drawing " + (S.idx + 1) + "  ·  frame " + (S.idx * step + 1) + "  ·  on " + step + "s";
    } else if (S.mode === "animate") {
      t = "Start frame  ·  " + cur().length + " stroke" + (cur().length === 1 ? "" : "s");
    } else {
      t = S.outlinePreview ? "Outline preview  ·  " + S.outlinePreview.length + " lines" : "Press Preview this frame";
    }
    $("frameTag").textContent = t;
  }

  /* ---------------- undo ---------------- */
  function snap() { return { idx: S.idx, strokes: cur().slice(), area: S.area.slice() }; }
  function pushUndo() { S.undo.push(snap()); if (S.undo.length > 200) { S.undo.shift(); } S.redo = []; }
  function snapAll() {
    var f = {};
    Object.keys(S.frames).forEach(function (n) { f[n] = (S.frames[n] || []).slice(); });
    return { all: f, idx: S.idx, area: S.area.slice() };
  }
  function nowFor(sn) { return sn.all ? snapAll() : { idx: sn.idx, strokes: (S.frames[sn.idx] || []).slice(), area: S.area.slice() }; }
  function bgFor(idx) {
    var t = S.mode === "fbf" ? S.startTicks + idx * (+$("fStep").value) * S.tpf : S.startTicks;
    if (S.bgCache[t]) { S.bg = S.bgCache[t]; }
  }
  function restore(sn) {
    if (sn.all) {
      S.frames = sn.all; S.area = sn.area;
      if (S.idx !== sn.idx) { S.idx = sn.idx; bgFor(S.idx); }
      return;
    }
    S.frames[sn.idx] = sn.strokes; S.area = sn.area;
  }
  function undo() {
    var sn = S.undo.pop(); if (!sn) { return; }
    S.redo.push(nowFor(sn)); restore(sn); renderAll();
  }
  function redo() {
    var sn = S.redo.pop(); if (!sn) { return; }
    S.undo.push(nowFor(sn)); restore(sn); renderAll();
  }
  // wipe every drawing on every frame in one go (undoable)
  function clearAll(quiet) {
    var any = S.area.length || S.outlinePreview || Object.keys(S.frames).some(function (n) { return S.frames[n] && S.frames[n].length; });
    if (!any) { if (!quiet) { status("Nothing to clear."); } return false; }
    S.undo.push(snapAll()); if (S.undo.length > 200) { S.undo.shift(); } S.redo = [];
    S.frames = { 0: [] }; S.area = []; S.outlinePreview = null;
    if (S.idx !== 0) { S.idx = 0; bgFor(0); }
    renderAll();
    if (!quiet) { status("Cleared all drawings. Ctrl+Z brings them back.", "ok"); }
    return true;
  }

  /* ---------------- drawing input ---------------- */
  var stroke = null, lazy = null, drag = null, rafPending = false;

  function pt(e) {
    var r = cv.live.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * S.W / r.width,
      y: (e.clientY - r.top) * S.H / r.height,
      p: e.pointerType === "pen" ? (e.pressure || 0.5) : 1
    };
  }
  function newStroke() {
    return {
      brush: S.tool === "eraser" ? "eraser" : S.brush,
      color: S.color,
      size: +$("size").value * k(),
      opacity: +$("opacity").value / 100,
      pressure: $("pressure").checked,
      taper: $("taper").checked,
      seed: Math.floor(Math.random() * 1e6),
      points: []
    };
  }

  function renderLive() {
    rafPending = false;
    var c = cx.live;
    c.clearRect(0, 0, S.W, S.H);
    if (drag) {
      var lists = DD.makeStamp(S.stamp, drag.a.x, drag.a.y, drag.b.x, drag.b.y, 7);
      var st = newStroke();
      lists.forEach(function (pts) { st.points = pts; DD.renderStroke(c, st); });
      return;
    }
    if (!stroke) { return; }
    if (S.tool === "fill" || S.tool === "area") {
      c.save();
      c.strokeStyle = S.tool === "area" ? "#36c5ff" : S.color;
      c.lineWidth = 2 * k(); c.setLineDash([8 * k(), 6 * k()]);
      c.beginPath();
      stroke.points.forEach(function (p, i) { if (i) { c.lineTo(p.x, p.y); } else { c.moveTo(p.x, p.y); } });
      c.closePath(); c.stroke(); c.restore();
      return;
    }
    DD.renderStroke(c, stroke);
  }
  function queueLive() { if (!rafPending) { rafPending = true; requestAnimationFrame(renderLive); } }

  cv.live.addEventListener("pointerdown", function (e) {
    if (S.busy || S.playing || e.button === 2) { return; }
    cv.live.setPointerCapture(e.pointerId);
    var p = pt(e);
    if (S.tool === "stamp") { drag = { a: p, b: p }; queueLive(); return; }
    stroke = newStroke();
    stroke.points.push(p);
    lazy = { x: p.x, y: p.y };
    queueLive();
  });
  cv.live.addEventListener("pointermove", function (e) {
    if (drag) { drag.b = pt(e); queueLive(); return; }
    if (!stroke) { return; }
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!evs.length) { evs = [e]; }
    var f = 1 - (+$("stab").value / 100);
    for (var i = 0; i < evs.length; i++) {
      var p = pt(evs[i]);
      lazy.x += (p.x - lazy.x) * f;
      lazy.y += (p.y - lazy.y) * f;
      var last = stroke.points[stroke.points.length - 1];
      var dx = lazy.x - last.x, dy = lazy.y - last.y;
      if (dx * dx + dy * dy >= 2.25 * k() * k()) { stroke.points.push({ x: lazy.x, y: lazy.y, p: p.p }); }
    }
    queueLive();
  });
  function endStroke(e) {
    if (drag) {
      var a = drag.a, b = drag.b; drag = null;
      if (Math.abs(b.x - a.x) < 8 && Math.abs(b.y - a.y) < 8) {
        var h = 140 * k();
        a = { x: a.x - h, y: a.y - h }; b = { x: a.x + 2 * h, y: a.y + 2 * h };
      }
      pushUndo();
      var seed = Math.floor(Math.random() * 1e6);
      DD.makeStamp(S.stamp, a.x, a.y, b.x, b.y, seed).forEach(function (pts, i) {
        var st = newStroke(); st.points = pts; st.seed += i; cur().push(st);
      });
      cx.live.clearRect(0, 0, S.W, S.H);
      renderInk(); tag();
      return;
    }
    if (!stroke) { return; }
    var s = stroke; stroke = null;
    cx.live.clearRect(0, 0, S.W, S.H);
    if (S.tool === "area") {
      if (s.points.length > 2) { pushUndo(); S.area.push(s.points.map(function (p) { return { x: p.x, y: p.y }; })); }
      renderOnion();
      return;
    }
    if (S.tool === "fill") {
      // keep visible gaps between the zig-zags whatever the brush width
      var inkW = s.size * ({ marker: 1.4, neon: 1.6, spray: 2.4, chalk: 1.1 }[S.brush] || 1);
      var gap = Math.max(+$("fillGap").value * k(), inkW * 1.6);
      var pts = DD.scribbleFill(s.points, gap, +$("fillAng").value, s.seed);
      if (!pts) { return; }
      s.points = pts;
      s.brush = S.brush;
    } else {
      // keep the very end of the line where the pen actually lifted
      if (e && stroke !== s && s.points.length > 1) {
        var p = pt(e), last = s.points[s.points.length - 1];
        if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) > 1) { s.points.push({ x: p.x, y: p.y, p: last.p }); }
      }
    }
    pushUndo();
    cur().push(s);
    renderInk(); tag();
  }
  cv.live.addEventListener("pointerup", endStroke);
  cv.live.addEventListener("pointercancel", function () { stroke = null; drag = null; cx.live.clearRect(0, 0, S.W, S.H); });

  /* ---------------- zoom & pan input ---------------- */
  // keyTool = tool held down with a key (hold Z / H), so you can zoom without leaving your brush
  var keyTool = null, spring = null, nav = null;
  function activeNav() { var t = keyTool || S.tool; return t === "zoom" || t === "hand" ? t : ""; }
  function updateCursor() { wrapEl.dataset.nav = activeNav(); }
  function wrapPt(e) { var r = wrapEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  // capture phase: runs before the drawing canvas, so a zoom/pan press never draws
  wrapEl.addEventListener("pointerdown", function (e) {
    if (e.target.closest && e.target.closest("#zoomBar")) { return; }
    var m = null;
    if (e.button === 1 || e.button === 2) { m = "pan"; }           // middle mouse / pen side button
    else if (activeNav() === "hand") { m = "pan"; }
    else if (activeNav() === "zoom") { m = e.shiftKey ? "pan" : "zoom"; }
    if (!m) { return; }
    e.preventDefault(); e.stopPropagation();
    if (stroke || drag) { return; }
    try { wrapEl.setPointerCapture(e.pointerId); } catch (er) {}
    var a = wrapPt(e);
    nav = { m: m, id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, z0: V.z, ax: a.x, ay: a.y, moved: false, alt: e.altKey };
    if (spring) { spring.used = true; }
    if (m === "pan") { wrapEl.classList.add("panning"); }
  }, true);
  wrapEl.addEventListener("pointermove", function (e) {
    if (!nav || e.pointerId !== nav.id) { return; }
    var dx = e.clientX - nav.sx, dy = e.clientY - nav.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) { nav.moved = true; }
    if (nav.m === "pan") { panBy(e.clientX - nav.lx, e.clientY - nav.ly); }
    else if (nav.moved) {
      // drag right / up = zoom in, left / down = zoom out, around the point you pressed
      zoomAt(nav.z0 * Math.pow(2, (dx - dy) / 160), nav.ax, nav.ay);
    }
    nav.lx = e.clientX; nav.ly = e.clientY;
  });
  function endNav(e) {
    if (!nav || (e && e.pointerId !== nav.id)) { return; }
    if (e && e.type === "pointerup" && nav.m === "zoom" && !nav.moved) {
      zoomAt(V.z * (nav.alt ? 0.5 : 2), nav.ax, nav.ay);              // tap = 2x in, Alt+tap = out
    }
    nav = null; wrapEl.classList.remove("panning");
  }
  wrapEl.addEventListener("pointerup", endNav);
  wrapEl.addEventListener("pointercancel", endNav);
  wrapEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  wrapEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    var a = wrapPt(e);
    if (e.shiftKey) { panBy(-e.deltaY, -e.deltaX); return; }
    zoomAt(V.z * Math.pow(2, -e.deltaY / 400), a.x, a.y);           // wheel / pinch zooms at the cursor
  }, { passive: false });
  wrapEl.addEventListener("dblclick", function (e) { if (activeNav() === "zoom" && e.altKey) { fit(); } });

  $("zIn").addEventListener("click", function () { zoomCenter(V.z * 1.5); });
  $("zOut").addEventListener("click", function () { zoomCenter(V.z / 1.5); });
  $("zFit").addEventListener("click", fit);
  document.querySelector('#tools [data-tool="zoom"]').addEventListener("dblclick", fit);

  function springDown(t) {
    if (spring || S.tool === t) { return; }
    spring = { t: t, at: Date.now(), used: false };
    keyTool = t; updateCursor();
  }
  function springUp(t) {
    if (!spring || spring.t !== t) { return; }
    var quickTap = !spring.used && Date.now() - spring.at < 300;
    spring = null; keyTool = null;
    if (quickTap) { setTool(t); } else { updateCursor(); }      // quick tap = switch tool, hold = temporary
  }
  document.addEventListener("keyup", function (e) {
    var key = (e.key || "").toLowerCase();
    if (key === "z") { springUp("zoom"); } else if (key === "h") { springUp("hand"); }
    if (key === "alt") { wrapEl.classList.remove("alt"); }
  });
  window.addEventListener("blur", function () { spring = null; keyTool = null; updateCursor(); wrapEl.classList.remove("alt"); });

  /* ---------------- tools & UI ---------------- */
  function sampleLine(c, w, h) {
    var pts = [];
    for (var i = 0; i <= 40; i++) { var t = i / 40; pts.push({ x: 8 + t * (w - 16), y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.25, p: 0.4 + 0.6 * Math.sin(t * Math.PI) }); }
    return pts;
  }
  function buildBrushes() {
    var box = $("brushBtns");
    DD.brushList.forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = "tool"; btn.dataset.brush = b[0]; btn.title = b[1];
      var c = document.createElement("canvas"); c.width = 112; c.height = 36;
      btn.appendChild(c);
      var lab = document.createElement("span"); lab.textContent = b[1]; btn.appendChild(lab);
      box.appendChild(btn);
      DD.renderStroke(c.getContext("2d"), { brush: b[0], color: "#eeeeee", size: 7, opacity: 1, pressure: true, taper: true, seed: 5, points: sampleLine(c, 112, 36) });
      btn.addEventListener("click", function () { S.brush = b[0]; setTool("draw"); });
    });
  }
  function buildStamps() {
    var box = $("stamps");
    DD.stampList.forEach(function (s) {
      var btn = document.createElement("button");
      btn.dataset.stamp = s[0]; btn.title = s[1];
      var c = document.createElement("canvas"); c.width = 96; c.height = 64;
      btn.appendChild(c);
      btn.appendChild(document.createTextNode(s[1]));
      box.appendChild(btn);
      var cc = c.getContext("2d");
      DD.makeStamp(s[0], 26, 10, 70, 54, 3).forEach(function (pts) {
        DD.renderStroke(cc, { brush: "smooth", color: "#dddddd", size: 2.5, opacity: 1, pressure: false, taper: false, seed: 1, points: pts });
      });
      btn.addEventListener("click", function () { S.stamp = s[0]; refreshTools(); });
    });
  }
  function buildSwatches() {
    var box = $("swatches");
    COLORS.forEach(function (col) {
      var d = document.createElement("div");
      d.className = "sw"; d.style.background = col; d.dataset.color = col;
      d.addEventListener("click", function () { setColor(col); });
      box.appendChild(d);
    });
    $("colorPick").addEventListener("input", function () { setColor($("colorPick").value); });
  }
  function setColor(c) {
    S.color = c;
    $("colorPick").value = c;
    Array.prototype.forEach.call(document.querySelectorAll(".sw"), function (el) { el.classList.toggle("on", el.dataset.color === c); });
    save();
  }
  function setTool(t) {
    if (t === "area" && S.mode !== "outline") { t = "draw"; }
    S.tool = t; refreshTools(); save();
  }
  function refreshTools() {
    Array.prototype.forEach.call(document.querySelectorAll("#brushBtns .tool"), function (el) {
      el.classList.toggle("on", S.tool === "draw" && el.dataset.brush === S.brush);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tools [data-tool]"), function (el) {
      el.classList.toggle("on", el.dataset.tool === S.tool);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#stamps button"), function (el) {
      el.classList.toggle("on", el.dataset.stamp === S.stamp);
    });
    updateCursor();
    $("stampGroup").classList.toggle("hidden", S.tool !== "stamp");
    $("fillGroup").classList.toggle("hidden", S.tool !== "fill");
  }
  Array.prototype.forEach.call(document.querySelectorAll("#tools [data-tool]"), function (el) {
    el.addEventListener("click", function () { setTool(el.dataset.tool); });
  });

  function setMode(m) {
    stopPlay();
    S.mode = m;
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b.dataset.mode === m); });
    Array.prototype.forEach.call(document.querySelectorAll(".mode"), function (g) { g.classList.toggle("hidden", g.dataset.mode !== m); });
    Array.prototype.forEach.call(document.querySelectorAll(".outlineOnly"), function (g) { g.classList.toggle("hidden", m !== "outline"); });
    $("clear").textContent = m === "fbf" ? "Clear frame" : "Clear";
    $("lenGroup").classList.toggle("hidden", m === "outline");
    lenInfo();
    if (S.tool === "area" && m !== "outline") { S.tool = "draw"; }
    if (m !== "fbf" && S.idx !== 0) {
      S.idx = 0;
      if (S.bgCache[S.startTicks]) { S.bg = S.bgCache[S.startTicks]; }
    }
    $("oLenRow").classList.toggle("hidden", $("oSel").checked);
    refreshTools(); renderAll(); save();
  }
  Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); });
  });

  // slider value readouts
  ["size", "opacity", "stab", "fillGap", "fillAng", "boil", "fBoil", "oDetail", "oSimp", "oMin", "oBoil", "bgDim"].forEach(function (id) {
    var v = $(id + "V");
    var upd = function () { if (v) { v.textContent = $(id).value; } };
    $(id).addEventListener("input", upd); upd();
  });
  $("bgDim").addEventListener("input", renderBg);
  ["fxBorder", "fxBorderC", "fxBorderW", "fxGlow", "fxGlowC", "fxGlowS", "fxShadow"].forEach(function (id) {
    $(id).addEventListener("input", function () { renderInk(); save(); });
    $(id).addEventListener("change", function () { renderInk(); save(); });
  });
  ["onionOn", "onionN"].forEach(function (id) { $(id).addEventListener("change", renderOnion); });
  $("fStep").addEventListener("change", function () { tag(); });
  $("oSel").addEventListener("change", function () { $("oLenRow").classList.toggle("hidden", $("oSel").checked); });

  /* ---------------- settings memory ---------------- */
  var SAVE_IDS = ["size", "opacity", "stab", "pressure", "taper", "fillGap", "fillAng", "aOn", "aHold", "aOff", "aEase", "boil", "boilEvery",
    "fStep", "onionOn", "onionN", "fBoil", "oSel", "oLen", "oStep", "oDetail", "oSimp", "oMin", "oBoil", "oSketch", "oKeep",
    "fxBorder", "fxBorderC", "fxBorderW", "fxGlow", "fxGlowC", "fxGlowS", "fxShadow", "bgDim", "autoClear", "lHold", "lLoop", "lMatch"];
  function save() {
    try {
      var o = { brush: S.brush, color: S.color, stamp: S.stamp, tool: /^(area|zoom|hand)$/.test(S.tool) ? "draw" : S.tool, mode: S.mode };
      SAVE_IDS.forEach(function (id) { var el = $(id); o[id] = el.type === "checkbox" ? el.checked : el.value; });
      localStorage.setItem("doodledrop", JSON.stringify(o));
    } catch (e) {}
  }
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem("doodledrop") || "null");
      if (!o) { return null; }
      SAVE_IDS.forEach(function (id) { if (o[id] == null) { return; } var el = $(id); if (el.type === "checkbox") { el.checked = o[id]; } else { el.value = o[id]; } el.dispatchEvent(new Event("input")); });
      if (o.brush && DD.brushes[o.brush]) { S.brush = o.brush; }
      if (o.stamp) { S.stamp = o.stamp; }
      if (o.tool) { S.tool = o.tool; }
      return o;
    } catch (e) { return null; }
  }
  SAVE_IDS.forEach(function (id) { $(id).addEventListener("change", save); });

  /* ---------------- frame by frame ---------------- */
  async function goIdx(n) {
    if (n < 0 || S.busy) { return; }
    S.idx = n;
    cur();
    var step = +$("fStep").value;
    var t = S.startTicks + n * step * S.tpf;
    renderOnion(); renderInk(); tag();
    try {
      S.busy = true; status("Grabbing frame…");
      var g = await grab(t);
      S.bg = g.img; renderBg(); status("Drawing " + (n + 1), "");
    } catch (e) { status(String(e), "err"); }
    S.busy = false;
  }
  $("fPrev").addEventListener("click", function () { goIdx(S.idx - 1); });
  $("fNext").addEventListener("click", function () { goIdx(S.idx + 1); });
  $("fCopy").addEventListener("click", function () {
    var prev = S.frames[S.idx - 1];
    if (!prev || !prev.length) { status("Nothing on the previous drawing to copy.", "err"); return; }
    pushUndo();
    S.frames[S.idx] = cur().concat(prev.map(function (s) { var c = Object.assign({}, s); c.seed = Math.floor(Math.random() * 1e6); return c; }));
    renderInk(); tag();
  });
  $("fRestart").addEventListener("click", async function () {
    if (S.busy) { return; }
    await grabAtPlayhead();
    S.idx = 0; renderAll();
    status("Frame-by-frame now starts at the playhead.", "ok");
  });

  async function grabAtPlayhead() {
    try {
      S.busy = true; status("Grabbing frame…");
      var r = parse(await ev("ddPlayhead()"));
      var t = r.ok ? parseFloat(r.msg) : null;
      if (t != null) { delete S.bgCache[t]; }
      var g = await grab(t);
      S.bg = g.img; S.startTicks = g.ticks;
      renderAll(); status("Ready. Draw on the frame.", "ok");
    } catch (e) { status(String(e), "err"); }
    S.busy = false;
  }
  $("grab").addEventListener("click", async function () {
    if (S.busy) { return; }
    if (S.mode === "fbf" && S.idx > 0) {
      // refresh the frame for the current drawing
      var step = +$("fStep").value, t = S.startTicks + S.idx * step * S.tpf;
      delete S.bgCache[t];
      return goIdx(S.idx);
    }
    S.idx = 0;
    await grabAtPlayhead();
  });

  /* ---------------- auto outline ---------------- */
  function outlineStrokes(img) {
    var chains = DD.traceEdges(img, S.W, S.H, {
      detail: +$("oDetail").value, simplify: +$("oSimp").value,
      minLen: +$("oMin").value * k(), area: S.area
    });
    var base = newStroke(), out = [];
    base.brush = S.brush; base.pressure = false;
    chains.forEach(function (pts, i) {
      var s = Object.assign({}, base, { seed: i * 31 + 7, points: pts });
      out.push(s);
      if ($("oSketch").checked) {
        out.push(Object.assign({}, base, {
          seed: i * 31 + 1007, size: base.size * 0.6, opacity: base.opacity * 0.75,
          points: DD.jitter(pts, base.size * 0.7 + 2 * k(), i + 99)
        }));
      }
    });
    return out;
  }
  $("oPreview").addEventListener("click", function () {
    if (!S.bg) { status("Grab a frame first.", "err"); return; }
    status("Tracing…");
    setTimeout(function () {
      S.outlinePreview = outlineStrokes(S.bg);
      renderInk(); tag();
      status("Outline preview: " + S.outlinePreview.length + " lines. Tweak Detail / Min line, or Render & place.", "ok");
    }, 20);
  });
  ["oDetail", "oSimp", "oMin", "oSketch"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (S.outlinePreview && S.bg) { S.outlinePreview = outlineStrokes(S.bg); renderInk(); tag(); } });
  });

  /* ---------------- length: hold / repeat / match clip ---------------- */
  function lenOpts() {
    return {
      hold: Math.max(0, parseInt($("lHold").value, 10) || 0),
      reps: Math.max(1, parseInt($("lLoop").value, 10) || 1),
      match: $("lMatch").checked
    };
  }
  // frames from `start` to the end of the selected timeline clip
  async function matchFrames(start) {
    var r = parse(await ev("ddSelRange()"));
    if (!r.ok) { throw r.msg + " (Match selected clip length is on.)"; }
    var total = Math.round((parseFloat(r.parts[1]) - start) / S.tpf);
    if (total < 1) { throw "The selected clip ends before the doodle's start frame. Select a clip that runs past the playhead."; }
    return total;
  }
  function lenInfo() {
    var L = lenOpts(), el = $("lInfo"), t;
    if (S.mode === "animate") {
      t = L.match ? (L.reps > 1 ? "Loops the whole animation until the selected clip ends." : "Stretches the Hold so draw-off finishes where the selected clip ends.")
        : (L.hold ? "Hold at end is added to the Hold before draw-off." : "");
    } else {
      t = L.match ? (L.reps > 1 ? "Loops the drawings until the selected clip ends." : "Holds the last drawing (still boiling) until the selected clip ends.")
        : (L.hold ? "The last drawing stays on screen" + (+$("fBoil").value ? ", still boiling." : ". Turn up Boil to keep it wiggling.") : "");
    }
    el.textContent = t;
    el.classList.toggle("hidden", !t);
  }
  ["lHold", "lLoop", "lMatch", "fBoil"].forEach(function (id) { $(id).addEventListener("input", lenInfo); $(id).addEventListener("change", lenInfo); });

  /* ---------------- animation plans ---------------- */
  function ease(t, kind) {
    t = Math.max(0, Math.min(1, t));
    if (kind === "lin") { return t; }
    if (kind === "inout") { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    return 1 - Math.pow(1 - t, 3);
  }

  async function buildPlan(forPreview) {
    var strokes = S.frames[0] || [];
    if (S.mode === "animate") {
      if (!strokes.length) { throw "Draw something first."; }
      var on = Math.max(0, parseInt($("aOn").value, 10) || 0);
      var hold = Math.max(0, parseInt($("aHold").value, 10) || 0);
      var offF = Math.max(0, parseInt($("aOff").value, 10) || 0);
      if (on + hold + offF === 0) { hold = 1; }
      var every = +$("boilEvery").value, amt = +$("boil").value * k(), ek = $("aEase").value;
      var L = lenOpts(), cycle = on + hold + offF, reps = L.reps, lastHold = hold + L.hold, loopAll = false, count;
      if (L.match) {
        count = await matchFrames(S.startTicks);
        if (reps > 1) { loopAll = true; }                      // loop until the clip ends
        else { lastHold = Math.max(0, count - on - offF); }    // stretch the hold to fit
      } else {
        count = cycle * (reps - 1) + on + lastHold + offF;
      }
      // where frame i sits: phase (on / hold / off) and its position in that phase
      var at = function (i) {
        var c = Math.floor(i / cycle), j, h = hold;
        if (loopAll) { j = i % cycle; }
        else if (c >= reps - 1) { j = i - (reps - 1) * cycle; h = lastHold; }
        else { j = i % cycle; }
        if (j < on) { return { ph: "on", t: ease((j + 1) / on, ek) }; }
        if (j < on + h) { return { ph: "h" }; }
        return { ph: "off", t: ease((j - on - h + 1) / offF, ek) };
      };
      return {
        count: count, start: S.startTicks,
        key: function (i) {
          var a = at(i);
          if (a.ph === "h") { return "h" + (amt ? Math.floor(i / every) : 0); }
          return a.ph + i;
        },
        draw: function (i, ctx) {
          var a = at(i), o = { boilAmt: amt, boilSeed: Math.floor(i / every) };
          if (a.ph === "on") { o.from = 0; o.to = a.t; }
          else if (a.ph === "off") { o.from = a.t; o.to = 1; }
          DD.renderDrawing(ctx, strokes, o);
        }
      };
    }
    if (S.mode === "fbf") {
      var step = +$("fStep").value, maxIdx = -1;
      Object.keys(S.frames).forEach(function (n) { if (S.frames[n] && S.frames[n].length) { maxIdx = Math.max(maxIdx, +n); } });
      if (maxIdx < 0) { throw "Draw something first."; }
      var fb = +$("fBoil").value * k();
      var L = lenOpts(), base = (maxIdx + 1) * step, reps = L.reps, loopAll = false, fcount;
      if (L.match) { fcount = await matchFrames(S.startTicks); loopAll = reps > 1; }
      else { fcount = base * reps + L.hold; }
      // which drawing frame i shows, and its boil seed (keeps changing while held)
      var fat = function (i) {
        if (loopAll || i < base * reps) { var n = Math.floor((i % base) / step); return { n: n, seed: n }; }
        return { n: maxIdx, seed: maxIdx + 1 + Math.floor((i - base * reps) / step) };
      };
      return {
        count: fcount, start: S.startTicks, step: step,
        idx: function (i) { return fat(i).n; },
        key: function (i) { var a = fat(i); return "d" + a.n + "s" + (fb ? a.seed : 0); },
        draw: function (i, ctx) {
          var a = fat(i);
          DD.renderDrawing(ctx, S.frames[a.n] || [], { boilAmt: fb, boilSeed: a.seed });
        }
      };
    }
    // outline
    var start = S.startTicks, count;
    if ($("oSel").checked && !forPreview) {
      var r = parse(await ev("ddSelRange()"));
      if (!r.ok) { throw r.msg; }
      start = parseFloat(r.parts[0]);
      count = Math.max(1, Math.round((parseFloat(r.parts[1]) - start) / S.tpf));
    } else {
      count = Math.max(1, parseInt($("oLen").value, 10) || 1);
    }
    var ostep = +$("oStep").value, ob = +$("oBoil").value * k(), keep = $("oKeep").checked;
    var cache = {};
    return {
      count: count, start: start, async: true,
      key: function (i) { return "o" + Math.floor(i / ostep); },
      draw: async function (i, ctx) {
        var blk = Math.floor(i / ostep), lines;
        if (forPreview) { lines = S.outlinePreview || []; }
        else {
          if (!cache[blk]) {
            var g = await grab(start + blk * ostep * S.tpf);
            cache = {}; cache[blk] = outlineStrokes(g.img);
          }
          lines = cache[blk];
        }
        DD.renderDrawing(ctx, lines, { boilAmt: ob, boilSeed: blk });
        if (keep) { DD.renderDrawing(ctx, strokes, { boilAmt: ob, boilSeed: blk }); }
      }
    };
  }

  /* ---------------- preview playback ---------------- */
  var playTimer = null;
  async function play() {
    if (S.playing) { stopPlay(); return; }
    var plan;
    try {
      if (S.mode === "outline" && !S.outlinePreview) { throw "Press Preview this frame first."; }
      plan = await buildPlan(true);
    } catch (e) { status(String(e), "err"); return; }
    S.playing = true;
    $("play").textContent = "■ Stop";
    cv.ink.style.visibility = "hidden";
    var i = 0, lastN = -1;
    var tick = async function () {
      if (!S.playing) { return; }
      offx.clearRect(0, 0, S.W, S.H);
      await plan.draw(i, offx);
      if (S.mode === "fbf") {
        var n = plan.idx ? plan.idx(i) : Math.floor(i / plan.step);
        var t = S.startTicks + n * plan.step * S.tpf;
        if (n !== lastN && S.bgCache[t]) { S.bg = S.bgCache[t]; renderBg(); lastN = n; }
      }
      cx.live.clearRect(0, 0, S.W, S.H);
      cx.live.drawImage(DD.applyFx(off, fx()), 0, 0);
      progress((i + 1) / plan.count);
      i = (i + 1) % plan.count;
      playTimer = setTimeout(tick, 1000 / S.fps);
    };
    tick();
  }
  function stopPlay() {
    if (!S.playing) { return; }
    S.playing = false; clearTimeout(playTimer);
    $("play").textContent = "▶ Preview";
    cv.ink.style.visibility = "";
    cx.live.clearRect(0, 0, S.W, S.H);
    progress(0);
    if (S.mode === "fbf" && S.bgCache[S.startTicks + S.idx * (+$("fStep").value) * S.tpf]) {
      S.bg = S.bgCache[S.startTicks + S.idx * (+$("fStep").value) * S.tpf]; renderBg();
    }
  }
  $("play").addEventListener("click", play);

  /* ---------------- render & place ---------------- */
  function pad(n) { return ("0000" + n).slice(-4); }
  function stampName() {
    var d = new Date();
    return d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + "_" +
      ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2);
  }

  $("render").addEventListener("click", async function () {
    if (S.busy) { return; }
    stopPlay();
    if (!cfs) { status("Open this panel inside Premiere Pro.", "err"); return; }
    var plan;
    try { plan = await buildPlan(false); } catch (e) { status(String(e), "err"); return; }
    S.busy = true;
    $("render").disabled = true;
    var label = { animate: "Doodle", fbf: "DoodleFBF", outline: "Outline" }[S.mode];
    var name = label + "_" + stampName();
    var folder = S.dir + "/Doodles/" + name;
    ensureDir(S.dir + "/Doodles"); ensureDir(folder);
    var frame = document.createElement("canvas"); frame.width = S.W; frame.height = S.H;
    var fctx = frame.getContext("2d");
    var lastKey = null, lastB64 = null;
    try {
      for (var i = 0; i < plan.count; i++) {
        var key = plan.key(i), b64;
        if (key === lastKey && lastB64) { b64 = lastB64; }
        else {
          fctx.clearRect(0, 0, S.W, S.H);
          offx.clearRect(0, 0, S.W, S.H);
          await plan.draw(i, offx);
          fctx.drawImage(DD.applyFx(off, fx()), 0, 0);
          b64 = frame.toDataURL("image/png").split(",")[1];
        }
        var w = cfs.writeFile(folder + "/" + name + "_" + pad(i) + ".png", b64, enc.Base64);
        if (w.err) { throw "Couldn't write the PNG files (error " + w.err + ")."; }
        lastKey = key; lastB64 = b64;
        progress((i + 1) / plan.count);
        status("Rendering " + (i + 1) + " / " + plan.count + "…");
        if (i % 4 === 3) { await sleep(0); }
      }
      if (S.mode === "outline") { await ev("ddSetPlayhead(" + q(String(plan.start)) + ")"); }
      status("Placing on the timeline…");
      var r = parse(await ev("ddPlace(" + q(folder + "/" + name + "_0000.png") + "," + q(String(plan.start)) + "," + plan.count + "," + q(name) + ")"));
      if (!r.ok) { throw r.msg; }
      var cleared = $("autoClear").checked && clearAll(true);
      status("Placed " + plan.count + " frames on " + r.msg + " (" + name + ")." + (cleared ? " Drawings cleared for the next one." : ""), "ok");
    } catch (e) {
      status(String(e), "err");
    }
    progress(0);
    $("render").disabled = false;
    S.busy = false;
  });

  /* ---------------- misc buttons & keys ---------------- */
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("clear").addEventListener("click", function () {
    pushUndo();
    S.frames[S.idx] = [];
    if (S.mode === "outline") { S.area = []; S.outlinePreview = null; }
    renderAll();
  });
  $("clearAll").addEventListener("click", function () { if (!S.busy) { stopPlay(); clearAll(false); } });

  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) { return; }
    var key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } return; }
    if ((e.ctrlKey || e.metaKey) && key === "y") { e.preventDefault(); redo(); return; }
    if (key === "alt") { wrapEl.classList.add("alt"); return; }
    if (key === "z") { if (!e.repeat) { springDown("zoom"); } return; }
    if (key === "h") { if (!e.repeat) { springDown("hand"); } return; }
    if (key === "0") { fit(); return; }
    if (key === "1") { zoomCenter(1 / baseScale()); return; }
    if (key === "=" || key === "+") { zoomCenter(V.z * 1.5); return; }
    if (key === "-" || key === "_") { zoomCenter(V.z / 1.5); return; }
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      if (e.shiftKey) { $("clearAll").click(); } else { $("clear").click(); }
      return;
    }
    if (key === "e") { setTool("eraser"); }
    else if (key === "b") { setTool("draw"); }
    else if (key === "f") { setTool("fill"); }
    else if (key === "s") { setTool("stamp"); }
    else if (key === "[") { $("size").value = Math.max(1, +$("size").value - 2); $("size").dispatchEvent(new Event("input")); }
    else if (key === "]") { $("size").value = Math.min(80, +$("size").value + 2); $("size").dispatchEvent(new Event("input")); }
    else if (key === "," && S.mode === "fbf") { goIdx(S.idx - 1); }
    else if (key === "." && S.mode === "fbf") { goIdx(S.idx + 1); }
    else if (key === " ") { e.preventDefault(); play(); }
  });

  /* ---------------- start ---------------- */
  async function init() {
    buildBrushes(); buildStamps(); buildSwatches();
    var o = load();
    setColor(o && o.color ? o.color : "#ffffff");
    setMode(o && o.mode ? o.mode : "animate");
    setSize(1920, 1080);
    if (!cep) { status("Open this panel inside Premiere Pro.", "err"); return; }
    var okJsx = await loadJsx();
    if (!okJsx) { status("Couldn't load the Premiere script. Reopen the panel.", "err"); return; }
    var r = parse(await ev("ddInfo()"));
    if (!r.ok) { status(r.msg + " Then press Grab frame.", "err"); return; }
    var p = r.parts;
    S.tpf = parseFloat(p[2]); S.fps = TICKS / S.tpf;
    S.startTicks = parseFloat(p[3]);
    S.dir = p[4]; S.seq = p.slice(5).join("|");
    setSize(+p[0], +p[1]);
    await grabAtPlayhead();
  }
  // re-read the sequence when the panel regains focus (sequence may have changed)
  window.addEventListener("focus", async function () {
    if (!cep || S.busy) { return; }
    var r = parse(await ev("ddInfo()"));
    if (r.ok) {
      var p = r.parts;
      S.tpf = parseFloat(p[2]); S.fps = TICKS / S.tpf; S.dir = p[4];
      if (+p[0] !== S.W || +p[1] !== S.H) { setSize(+p[0], +p[1]); renderAll(); }
    }
  });
  window.DDApp = { S: S, fit: fit, zoomAt: zoomAt, clearAll: clearAll, renderAll: renderAll, buildPlan: buildPlan, outlineStrokes: outlineStrokes, setMode: setMode, setTool: setTool };
  init();
})();

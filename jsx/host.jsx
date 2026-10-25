/*
 * Doodle Drop - host script (ExtendScript, runs inside Premiere Pro)
 * Grabs frames from the active sequence, and imports finished doodle
 * PNG sequences back onto the first free video track.
 */

var DD_TICKS = 254016000000;
var DD_BIN = "Doodles";

function ddRes(ok, msg) { return (ok ? "OK|" : "ERR|") + msg; }
function ddPing() { return "pong"; }

function ddInfo() {
    try {
        if (!app.project) { return ddRes(false, "No project open."); }
        var seq = app.project.activeSequence;
        if (!seq) { return ddRes(false, "Open a sequence first."); }
        var dir = "";
        try {
            if (app.project.path && app.project.path !== "") {
                dir = new File(app.project.path).parent.fsName;
            }
        } catch (e) {}
        if (!dir) { dir = Folder.myDocuments.fsName; }
        dir = dir.replace(/\\/g, "/");
        return ddRes(true, [seq.frameSizeHorizontal, seq.frameSizeVertical, seq.timebase,
            seq.getPlayerPosition().ticks, dir, seq.name].join("|"));
    } catch (err) {
        return ddRes(false, "Error: " + err.toString());
    }
}

function ddPlayhead() {
    var seq = app.project.activeSequence;
    if (!seq) { return ddRes(false, "Open a sequence first."); }
    return ddRes(true, seq.getPlayerPosition().ticks);
}

// Move the playhead (optional, pass "" to stay) and export that frame as PNG.
function ddGrab(ticks, path) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) { return ddRes(false, "Open a sequence first."); }
        if (ticks !== "" && ticks !== null) { seq.setPlayerPosition(String(ticks)); }
        app.enableQE();
        var q = qe.project.getActiveSequence();
        if (!q) { return ddRes(false, "No active sequence."); }
        var f = new File(path);
        if (f.exists) { f.remove(); }
        q.exportFramePNG(q.CTI.timecode, f.fsName);
        return ddRes(true, seq.getPlayerPosition().ticks);
    } catch (err) {
        return ddRes(false, "Frame grab failed: " + err.toString());
    }
}

function ddSetPlayhead(ticks) {
    try {
        var seq = app.project.activeSequence;
        seq.setPlayerPosition(String(ticks));
        return ddRes(true, "");
    } catch (err) {
        return ddRes(false, err.toString());
    }
}

// Start/end of the selected clips, in ticks.
function ddSelRange() {
    var seq = app.project.activeSequence;
    if (!seq) { return ddRes(false, "Open a sequence first."); }
    var sel = seq.getSelection();
    if (!sel || sel.length === 0) { return ddRes(false, "Select a clip on the timeline first."); }
    var s = null, e = null;
    for (var i = 0; i < sel.length; i++) {
        var a = parseFloat(sel[i].start.ticks), b = parseFloat(sel[i].end.ticks);
        if (s === null || a < s) { s = a; }
        if (e === null || b > e) { e = b; }
    }
    return ddRes(true, s + "|" + e);
}

function ddTime(ticks) {
    var t = new Time();
    t.ticks = String(Math.round(ticks));
    return t;
}

function ddFindBin(parent, name) {
    for (var i = 0; i < parent.children.numItems; i++) {
        var c = parent.children[i];
        if (c.type === ProjectItemType.BIN && c.name === name) { return c; }
    }
    return null;
}

function ddTrackFree(track, s, e) {
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        var cs = parseFloat(c.start.ticks), ce = parseFloat(c.end.ticks);
        if (cs < e - 1 && ce > s + 1) { return false; }
    }
    return true;
}

// Import a numbered PNG sequence and lay it on the first free video track
// above everything at that time.
function ddPlace(firstPath, startTicks, nFrames, name) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) { return ddRes(false, "Open a sequence first."); }
        var root = app.project.rootItem;
        var bin = ddFindBin(root, DD_BIN) || root.createBin(DD_BIN);

        var before = {};
        for (var i = 0; i < bin.children.numItems; i++) { before[bin.children[i].nodeId] = 1; }

        var file = new File(firstPath);
        if (!file.exists) { return ddRes(false, "Rendered file not found: " + firstPath); }
        app.project.importFiles([file.fsName], true, bin, true);

        var item = null;
        for (var j = 0; j < bin.children.numItems; j++) {
            if (!before[bin.children[j].nodeId]) { item = bin.children[j]; }
        }
        if (!item) { return ddRes(false, "Import failed."); }

        var tpf = parseFloat(seq.timebase);
        var fps = DD_TICKS / tpf;
        try { item.setOverrideFrameRate(fps); } catch (e1) {}
        try { item.name = name; } catch (e2) {}

        var s = parseFloat(startTicks);
        var e = s + nFrames * tpf;

        var top = -1;
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            if (!ddTrackFree(seq.videoTracks[v], s, e)) { top = v; }
        }
        var target = -1;
        for (var w = top + 1; w < seq.videoTracks.numTracks; w++) {
            if (ddTrackFree(seq.videoTracks[w], s, e)) { target = w; break; }
        }
        if (target === -1) {
            var n0 = seq.videoTracks.numTracks;
            try {
                app.enableQE();
                qe.project.getActiveSequence().addTracks(1, n0, 0);
            } catch (e3) {}
            if (seq.videoTracks.numTracks > n0) { target = seq.videoTracks.numTracks - 1; }
        }
        if (target === -1) { return ddRes(false, "No free video track. Add one and press Place again."); }

        var track = seq.videoTracks[target];
        track.overwriteClip(item, ddTime(s));
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            if (Math.abs(parseFloat(clip.start.ticks) - s) < tpf / 2) {
                try { clip.end = ddTime(e); } catch (e4) {}
                break;
            }
        }
        return ddRes(true, "V" + (target + 1));
    } catch (err) {
        return ddRes(false, "Place failed: " + err.toString());
    }
}

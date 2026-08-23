/*
 * Behavioural checks for playdesigner/index.html.
 *
 * The app is a single HTML file with an inline script and no build step, so this
 * boots it in jsdom, swaps in a real node-canvas 2D context, and drives the same
 * globals the UI drives. Run with: npm test
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { JSDOM } = require(path.join(ROOT, "node_modules/jsdom"));
const { createCanvas } = require(path.join(ROOT, "node_modules/canvas"));

const html = fs.readFileSync(path.join(ROOT, "playdesigner/index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;

// pretend we are on a retina display so the DPR path is exercised
w.devicePixelRatio = 2;
// the inline script captured `ctx` at parse time, so replace the binding itself
w.ctx = createCanvas(1640, 1080).getContext("2d");
// the export path builds offscreen canvases; jsdom has none, so hand it real ones
const realCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (t) {
  if (String(t).toLowerCase() === "canvas") {
    const c = createCanvas(10, 10);
    c.style = {}; c.setAttribute = function () {};
    c.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    return c;
  }
  return realCreate(t);
};
// back the canvas element with a real one so thumbnails and blits are exercised
const realCv = createCanvas(820, 540);
realCv.getBoundingClientRect = function () { return { left: 0, top: 0, width: 820, height: 540 }; };
realCv.addEventListener = function () {}; realCv.setAttribute = function () {};
realCv.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
realCv.style = {}; realCv.focus = function () {};
w.C = realCv;
w.ctx = realCv.getContext("2d");
Object.defineProperty(w.document.getElementById("wrap"), "clientWidth", { value: 820 });

let fails = 0;
const chk = (name, cond, extra) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? "  [" + extra + "]" : ""));
  if (!cond) fails++;
};

w.setSize();
w.players = []; // drop the zero-width defenders jsdom built before the container had a width
w.loadForm("gun_2x2");

/* ---- hi-DPI backing store ---- */
const cv = w.document.getElementById("c");
chk("DPR applied to backing store",
    w.C.width === 1640 && w.C.height === 1080, w.C.width + "x" + w.C.height);
chk("logical W/H stay in CSS px", w.W === 820 && w.H === 540, w.W + "x" + w.H);

/* ---- undo correctness: the snapshot must predate the mutation ---- */
const hStart = w.hist.length;
const qb = w.players.find(p => p.label === "QB");
const ox = qb.x, oy = qb.y, idx = w.players.indexOf(qb);
w.onDown({ x: qb.x, y: qb.y });
chk("drag grabbed the player", w.dragIdx === idx, "dragIdx=" + w.dragIdx);
w.onMove({ x: ox + 60, y: oy + 25 });
w.onUp({ x: ox + 60, y: oy + 25 });
chk("player actually moved", Math.abs(qb.x - (ox + 60)) < 2, qb.x + " vs " + (ox + 60));
chk("drag adds exactly one history entry", w.hist.length === hStart + 1, hStart + " -> " + w.hist.length);
w.document.getElementById("btn-undo").click();
const after = w.players.find(p => p.label === "QB");
chk("UNDO restores pre-drag position", Math.abs(after.x - ox) < 0.5 && Math.abs(after.y - oy) < 0.5, after.x + "," + after.y);
w.document.getElementById("btn-redo").click();
chk("REDO reapplies the drag", Math.abs(w.players.find(p => p.label === "QB").x - (ox + 60)) < 2);

const h0 = w.hist.length;
const still = w.players.find(p => p.label === "QB");
w.onDown({ x: still.x, y: still.y });
w.onUp({ x: still.x, y: still.y });
chk("click without movement adds no history", w.hist.length === h0, h0 + " -> " + w.hist.length);

/* ---- snap to grid ---- */
w.document.getElementById("btn-snap").click();
chk("snap toggles on", w.snapOn === true);
const sp = w.players.find(p => p.label === "QB");
w.onDown({ x: sp.x, y: sp.y });
w.onMove({ x: sp.x + 37.3, y: sp.y + 11.7 });
w.onUp({ x: sp.x + 37.3, y: sp.y + 11.7 });
const gx = w.YD / 2, residual = Math.abs(sp.x / gx - Math.round(sp.x / gx));
chk("snapped x lands on the half-yard grid", residual < 0.001, "residual=" + residual.toFixed(6));
w.document.getElementById("btn-snap").click();

/* ---- pointer handling ---- */
chk("window owns mouseup (drag survives leaving canvas)", /window\.addEventListener\('mouseup'/.test(html));
chk("idle mousemove short-circuits before layout read", /pointerBusy\(\)\)return;onMove/.test(html));

/* ---- view toggles are not clobbered by tool switching ---- */
w.boxView = true; w.flip = true; w.syncToggles();
w.setTool("route");
chk("Box View keeps .act after tool switch", w.document.getElementById("btn-boxview").classList.contains("act"));
chk("Flip keeps .act after tool switch", w.document.getElementById("btn-flip").classList.contains("act"));
chk("route tool became active", w.document.getElementById("t-route").classList.contains("act"));
w.boxView = false; w.flip = false; w.syncToggles(); w.setTool("assign");

/* ---- front alignment: Over must be DE / 1-tech weak / 3-tech strong / DE ---- */
w.players = [];
w.loadForm("gun_3x1");
w.applyFront("over");
const dl = w.players.filter(p => w.isDL(p)).sort((a, b) => a.x - b.x);
const techs = dl.map(p => p.label).join(",");
chk("Over front aligns DE,1,3,DE", techs === "DE,1,3,DE", techs);
const dts = dl.filter(p => p.dt);
chk("interior tackles sit on opposite sides of the ball",
  dts.length === 2 && (dts[0].x - w.ballX) * (dts[1].x - w.ballX) < 0);

/* ---- save / load round-trip carries the call ---- */
w.curForm = "gun_3x1"; w.curCov = "3"; w.curFront = "over"; w.play = "run";
w.document.getElementById("sel-hash").value = "lh";
w.submitForm("new", null, "Verify Play", "Unfiled", "");
w.curForm = ""; w.curCov = ""; w.curFront = ""; w.play = "pass";
const saved = w.getPlays().find(p => p.name === "Verify Play");
chk("play persisted", !!saved);
chk("record is schema v2", saved.v === 2, saved.v);
chk("record stores formation", saved.form === "gun_3x1", saved.form);
chk("record stores coverage", saved.cov === "3", saved.cov);
chk("record stores run/pass", saved.play === "run", saved.play);
w.loadPlay(saved);
chk("load restores formation", w.curForm === "gun_3x1", w.curForm);
chk("load restores coverage", w.curCov === "3", w.curCov);
chk("load restores run/pass", w.play === "run", w.play);
chk("load syncs the formation dropdown", w.document.getElementById("sel-form").value === "gun_3x1");
chk("load syncs the hash dropdown", w.document.getElementById("sel-hash").value === "lh");

/* ---- duplicate + read cache ---- */
w.duplicatePlay(saved);
const copy = w.getPlays().find(p => p.name === "Verify Play (copy)");
chk("duplicate created", !!copy);
chk("duplicate is a deep copy", !!copy && copy.players !== saved.players && copy.players.length === saved.players.length);
chk("getPlays serves a cache", w.getPlays() === w.getPlays());

/* ---- render smoke test ---- */
let threw = null;
try { w.applyCoverage("3"); w.applyTeamStunt("tex_strong"); w.render(); } catch (e) { threw = e.message; }
chk("full render with coverage + stunt does not throw", threw === null, threw || "");


/* ---- formations, personnel groupings, motion, defensive packages ---- */
[["gun_2x2","10"],["i_form","21"],["pro_form","12"],["flexbone","30"],
 ["wing_t","31"],["goal_line","23"],["jumbo","23"]].forEach(function(c){
  w.players=[]; w.loadForm(c[0]);
  chk("personnel " + c[0], w.personnel()===c[1], w.personnel()+" want "+c[1]);
});

["wing_t","flexbone","double_wing","wildcat","jumbo","goal_line",
 "gun_bunch","gun_stack","unbalanced","power_i"].forEach(function(f){
  w.players=[];
  var t=null; try{ w.loadForm(f); }catch(e){ t=e.message; }
  var off=w.players.filter(function(p){return p.color!==w.D;}).length;
  chk("formation "+f+" fields 11 on offense", t===null && off===11, t||off);
});

["nickel","base43","okie34","dime","goalline"].forEach(function(k){
  w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers(k);
  chk("defensive package "+k+" fields 11",
      w.players.filter(function(p){return p.color===w.D;}).length===11);
});
w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("okie34");
chk("3-4 has a nose and two edge players",
    w.players.some(function(p){return p.label==="NT";}) &&
    w.players.filter(function(p){return /JACK|RUSH/.test(p.label);}).length===2);
w.applyDefPers("base43");
chk("4-3 has a Sam linebacker", w.players.some(function(p){return p.label==="SAM";}));
w.applyDefPers("dime");
chk("dime fields six defensive backs",
    w.players.filter(function(p){return /CB|FS|SS|NICK|DIME/.test(p.label);}).length===6);
w.applyDefPers("nickel");

w.players=[]; w.loadForm("gun_3x1");
var zr=w.players.find(function(p){return p.label==="Z";});
w.addMotion(w.players.indexOf(zr),"Jet");
var mo=w.assigns.find(function(a){return a.kind==="motion";});
chk("jet motion builds a path", !!mo && mo.path.length>=3, mo && mo.role);

w.applyFront("over"); w.applyCoverage("3"); w.render();
var strip=w.document.getElementById("call-strip").textContent;
chk("call strip reports personnel, front and coverage",
    /pers/.test(strip) && /Over/.test(strip) && /Cover 3/.test(strip), strip);

/* ---- run game ---- */
w.players=[]; w.loadForm("i_form"); w.applyFront("over");
function runRoles(){
  return w.assigns.filter(function(a){return a.phase==="run";})
    .map(function(a){return w.playerById(a.pid).label+":"+a.role;});
}
w.runDir=1; w.applyRunPlay("power");
var P=runRoles();
chk("power pulls the backside guard", P.some(function(r){return /^LG:Pull . wrap/.test(r);}), P.join(" "));
chk("power blocks down playside", P.filter(function(r){return /:Down$/.test(r);}).length>=2);
chk("power kicks the end out", P.some(function(r){return /Kick out/.test(r);}));
chk("power tracks the B gap", P.some(function(r){return /Track . B/.test(r);}));

w.applyRunPlay("inside_zone");
var Z2=runRoles();
chk("zone has no pullers", !Z2.some(function(r){return /Pull/.test(r);}));
chk("zone cuts off backside", Z2.some(function(r){return /Cut off/.test(r);}));

w.applyRunPlay("zone_read");
var rk=w.assigns.find(function(a){return a.kind==="read";});
chk("zone read marks a read key", !!rk && w.playerById(rk.pid).label==="DE");
chk("the read key is left unblocked",
    !w.assigns.some(function(a){return a.targetPid===rk.pid;}));

w.runDir=-1; w.applyRunPlay("power");
chk("flipping run direction pulls the other guard",
    runRoles().some(function(r){return /^RG:Pull . wrap/.test(r);}));
w.runDir=1; w.applyRunPlay("counter_gt");
chk("counter pulls two men",
    runRoles().filter(function(r){return /Pull/.test(r);}).length===2);


/* ---- pass concepts, progressions, protection ---- */
w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over"); w.applyCoverage("3");
Object.keys(w.PASSPLAY).forEach(function(k){
  var t=null; try{ w.applyPassPlay(k); }catch(e){ t=e.message; }
  var R2=w.routes.filter(function(r){return r.type==="tree";});
  var prog=w.assigns.filter(function(a){return a.kind==="progression";});
  var hot=w.assigns.filter(function(a){return a.kind==="hot";});
  var prot=w.assigns.filter(function(a){return a.kind==="block"&&a.phase==="pass"&&w.isOL(w.playerById(a.pid));});
  chk("concept "+k+" builds routes", t===null && R2.length>=3, t||R2.length);
  chk("concept "+k+" numbers a progression", prog.length>=2);
  chk("concept "+k+" marks one hot", hot.length===1);
  chk("concept "+k+" protects with five linemen", prot.length===5, prot.length);
});
w.applyPassPlay("four_verts");
chk("four verts sends four vertical",
    w.routes.filter(function(r){return r.type==="tree"&&/Go|Seam/.test(r.concept);}).length>=4);
w.applyPassPlay("mesh");
chk("mesh has two crossers", w.routes.filter(function(r){return r.concept==="Drag";}).length===2);
w.applyRunPlay("power");
chk("a run call clears the pass picture",
    w.routes.filter(function(r){return r.type==="tree";}).length===0 &&
    w.assigns.filter(function(a){return a.kind==="progression";}).length===0);
w.applyPassPlay("smash");
chk("a pass call clears the run picture",
    w.assigns.filter(function(a){return a.kind==="carry";}).length===0);


/* ---- animation and player view ---- */
w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over"); w.applyCoverage("1");
w.applyPassPlay("four_verts");
var xw=w.players.find(function(p){return p.label==="X";});
var xs={x:xw.x,y:xw.y};
w.setAnim(0);
chk("at the snap everyone is at their alignment",
    Math.abs(w.px(xw)-xs.x)<1 && Math.abs(w.py(xw)-xs.y)<1);
w.setAnim(1);
chk("the receiver travels downfield", xs.y-w.py(xw) > 5*w.YD_V,
    Math.round((xs.y-w.py(xw))/w.YD_V)+" yds");
var cbw=w.players.filter(function(p){return p.label==="CB";})
  .sort(function(a,b){return Math.abs(a.x-xw.x)-Math.abs(b.x-xw.x);})[0];
var cy=cbw.y; w.setAnim(1);
chk("the man corner runs with his receiver", Math.abs(w.py(cbw)-cy) > 3*w.YD_V);
w.resetAnim();
chk("reset restores the still picture", w.animT===null && Math.abs(w.px(xw)-xs.x)<1);

w.applyRunPlay("power");
var rbw=w.players.find(function(p){return p.label==="RB";});
var ry=rbw.y; w.setAnim(1);
chk("the ball carrier runs his track", ry-w.py(rbw) > 3*w.YD_V);
var lgw=w.players.find(function(p){return p.label==="LG";});
chk("the puller travels his path", Math.abs(w.px(lgw)-lgw.x) > w.YD);
w.resetAnim();

w.applyPassPlay("smash");
w.focusId=w.players.find(function(p){return p.label==="Y";}).id; w.render();
var card=w.document.getElementById("assign-card").textContent;
chk("assignment card states alignment, route and read",
    /ALIGN/.test(card) && /ROUTE/.test(card) && /READ/.test(card), card.slice(0,50));
w.focusId=w.players.find(function(p){return p.label==="MIKE";}).id; w.render();
var dcard=w.document.getElementById("assign-card").textContent;
chk("defender card gives a coverage and a key",
    /KEY/.test(dcard) && /COVER|FIT|RUSH/.test(dcard));
w.quizOn=true; w.render();
chk("quiz hides the answer", /Show me/.test(w.document.getElementById("assign-card").textContent));
w.quizOn=false; w.focusId=null; w.render();
chk("the view picker lists all 22",
    w.document.getElementById("sel-player").querySelectorAll("option").length===23);


/* ---- export, ids, PDF, platform ---- */
w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over"); w.applyCoverage("3");
w.applyPassPlay("mesh");
w.submitForm("new",null,"Mesh Right","Openers","","3rd, 6","Central");
w.applyRunPlay("power");
w.submitForm("new",null,"Power Right","Openers","","1st, 10","Central");
var pl=w.getPlays();
var mesh=pl.filter(function(p){return p.name==="Mesh Right";})[0];
chk("saved plays get stable ids",
    pl.every(function(p){return !!p.id;}) &&
    new Set(pl.map(function(p){return p.id;})).size===pl.length);
chk("down, distance and opponent are stored",
    !!mesh && mesh.down==="3rd" && mesh.dist==="6" && mesh.opponent==="Central",
    mesh && [mesh.down,mesh.dist,mesh.opponent].join("/"));

var dupRec=JSON.parse(JSON.stringify(pl[0])); dupRec.id=w.newId();
w.setPlays(pl.concat([dupRec]));
var before=w.getPlays().length;
// the app uses its own dialog now, so accept it the way a person would
function acceptDialog(){
  var b=w.document.querySelector("#modal .form .actions button.primary");
  chk("a confirm dialog was raised", !!b);
  if(b)b.click();
}
w.deletePlay(w.getPlays()[0]);
acceptDialog();
chk("deleting by id removes exactly one record", w.getPlays().length===before-1,
    before+" -> "+w.getPlays().length);
chk("no native dialogs remain", !/prompt\(|[^s]confirm\(|[^t]alert\(/.test(html));

w.applyPassPlay("smash");
var tg=w.autoTags();
chk("auto-tags describe the call",
    tg.some(function(t){return /pers/.test(t);}) && tg.indexOf("Smash")>=0 && tg.indexOf("pass")>=0, tg.join("|"));

var blobbed=null;
w.URL={createObjectURL:function(){return "blob:x";},revokeObjectURL:function(){}};
w.Blob=function(parts,opts){this.parts=parts;this.type=opts&&opts.type;blobbed=this;};
w.exportPlaybook();
var payload=JSON.parse(blobbed.parts[0]);
chk("export is versioned and carries every play",
    payload.version===2 && payload.format==="coachs-play-designer" && payload.plays.length===w.getPlays().length);

var mineBefore=w.getPlays().length;
w.alert=function(){};
w.FileReader=function(){this.readAsText=function(f){this.result=f._text;this.onload();}.bind(this);};
w.importPlaybook({_text:JSON.stringify(payload)});
chk("re-importing the same file is a no-op", w.getPlays().length===mineBefore);
w.importPlaybook({_text:JSON.stringify({format:"coachs-play-designer",version:2,
  plays:[Object.assign({},payload.plays[0],{id:"other-1"})]})});
chk("a clashing name is renamed rather than overwritten",
    w.getPlays().length===mineBefore+1 && w.getPlays().some(function(p){return /\(2\)$/.test(p.name);}));

var pdf=w.buildPDF([{data:new Uint8Array([0xFF,0xD8,0xFF,0xD9]),w:100,h:80}],792,612);
var pdfs=String.fromCharCode.apply(null,pdf.parts[0]);
chk("PDF has header, catalog, page, image and trailer",
    pdfs.indexOf("%PDF-1.4")===0 && /\/Type \/Catalog/.test(pdfs) &&
    /DCTDecode/.test(pdfs) && /startxref/.test(pdfs) && /%%EOF/.test(pdfs));
var sxp=pdfs.lastIndexOf("startxref");
var xp=parseInt(pdfs.slice(sxp+9).trim(),10);
chk("PDF xref offset lands on the xref table", pdfs.slice(xp,xp+4)==="xref");
var xl=pdfs.slice(xp).split("\n"), xc=parseInt(xl[1].split(" ")[1],10), badOff=[];
for(var xi=1;xi<xc;xi++){
  var oo=parseInt(xl[2+xi].slice(0,10),10);
  if(!new RegExp("^"+xi+" 0 obj").test(pdfs.slice(oo,oo+12)))badOff.push(xi);
}
chk("every PDF xref offset resolves to its object", badOff.length===0, badOff.join(","));

var liveCount=w.players.length, liveBall=w.ballX;
w.withPlay(w.getPlays()[0],function(){ w.players=[]; });
chk("previewing a saved play does not corrupt the live document",
    w.players.length===liveCount && w.ballX===liveBall);

chk("canvas allows vertical panning by default", /touch-action:pan-y/.test(html));
chk("touchmove ignores non-manipulating gestures", /touchmove[\s\S]{0,400}pointerBusy\(\)\)return/.test(html));
chk("canvas is keyboard focusable", /id="c" tabindex="0"/.test(html));
chk("service worker and manifest are wired", /register\(.sw\.js.\)/.test(html) && /rel="manifest"/.test(html));
chk("offline shell files exist",
    fs.existsSync(path.join(ROOT,"playdesigner/sw.js")) &&
    fs.existsSync(path.join(ROOT,"playdesigner/manifest.webmanifest")));
chk("print stylesheet present", /@media print/.test(html));


/* ---- final cleanup wave ---- */
chk("history covers the ball spot and the call, not just the diagram", (function(){
  w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over");
  var b0=w.ballX, f0=w.curFront;
  w.saveH(); w.ballX=b0+40; w.curFront="bear";
  w.document.getElementById("btn-undo").click();
  return w.ballX===b0 && w.curFront===f0;
})());
chk("loading a play starts a fresh history", (function(){
  w.saveH(); w.saveH();
  var rec=w.getPlays()[0]; if(!rec)return true;
  w.loadPlay(rec);
  return w.hist.length===0 && w.redoStack.length===0;
})());
chk("the field is cached between repaints", /_fieldCache/.test(html) && /_fieldKey/.test(html));
chk("neighbour distances are computed once per frame", /buildNeighbours\(\)/.test(html));
chk("canvas palette reads the CSS tokens", /tok\(.--c-off./.test(html) && /--c-off:/.test(html));
chk("pinch and wheel zoom are wired", /zoomAt\(/.test(html) && /_pinch/.test(html));
chk("zoom stays within bounds", (function(){
  w.viewScale=1; w.zoomAt(100,100,10);
  var hi=w.viewScale<=4;
  w.zoomAt(100,100,0.001);
  return hi && w.viewScale===1 && w.viewX===0 && w.viewY===0;
})(), "scale="+w.viewScale);
chk("pointer mapping survives a zoom", (function(){
  w.resetView(); w.viewScale=2; w.viewX=-100; w.viewY=-50;
  var r={left:0,top:0,width:820,height:540};
  var fake={clientX:300,clientY:200,touches:null};
  var saveGBCR=w.C.getBoundingClientRect;
  w.C.getBoundingClientRect=function(){return r;};
  var p=w.gp(fake);
  w.C.getBoundingClientRect=saveGBCR;
  w.resetView();
  return Math.abs(p.x-((300-(-100))/2))<0.01;
})());
chk("the app shell has a brand bar, a nav rail and four section panels",
    /id="appbar"/.test(html) &&
    (html.match(/class="navbtn/g) || []).length === 4 &&
    ["design","playbook","scout","teach"].every(function (t) {
      return html.indexOf('id="panel-' + t + '"') >= 0;
    }));
chk("controls are grouped into titled cards",
    (html.match(/class="card-hd"/g) || []).length >= 4);


/* ---- coverage check, zone reaction, conflict defenders ---- */
w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over"); w.applyCoverage("3");
w.applyPassPlay("four_verts");
var beforeD=JSON.stringify(w.assigns.map(function(a){return a.pid+a.role;}));
w.coverageCheck();
var ck=w.document.getElementById("assign-card").textContent;
chk("check reports every coverage shell",
    ["Cover 0","Cover 1","Tampa 2","Cover 3","Cover 4","Palms","Cover 6","2-Man","Rip/Liz"]
      .every(function(k){return ck.indexOf(k)>=0;}));
chk("check names a best matchup with separation", /\d+\.\d yd/.test(ck));
chk("check restores the defence it started from",
    JSON.stringify(w.assigns.map(function(a){return a.pid+a.role;}))===beforeD);
chk("check leaves the coverage call intact", w.curCov==="3");
var seps=w.separationTable();
chk("separation is reported per route in yards",
    seps.length>=4 && seps.every(function(r){return r.sep>=0 && r.sep<60;}));

w.applyRunPlay("zone_read"); w.applyCoverage("3");
w.players.filter(function(p){return /MIKE|WILL/.test(p.label);}).forEach(function(p){
  w.chooseAssign(w.players.indexOf(p),"B gap","run");
});
var cfd=w.conflictDefenders().map(function(p){return p.label;});
chk("only defenders with a fit and a drop are flagged as conflicted",
    cfd.length>0 && cfd.every(function(l){return /MIKE|WILL|SAM|NICK/.test(l);}), cfd.join(","));

w.players=[]; w.loadForm("gun_2x2"); w.applyFront("over"); w.applyCoverage("3");
w.applyPassPlay("curl_flat");
var hk=w.players.find(function(p){return p.label==="MIKE";});
var hy=hk.y;
w.setAnim(0.5); var drop={x:w.px(hk),y:w.py(hk)};
w.setAnim(1.0); var brk={x:w.px(hk),y:w.py(hk)};
chk("zone defender sinks to his landmark", Math.abs(drop.y-hy)>2);
chk("zone defender then breaks on a threat in his area",
    Math.hypot(brk.x-drop.x,brk.y-drop.y)>2);
w.resetAnim();


/* ---- simulation brain: match coverage and linebacker run fits ---- */
function simPos(p,t){ w.setAnim(t); return {x:w.px(p),y:w.py(p)}; }
function simDist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y)/w.YD; }
function simSetup(form,cov,concept){
  w.players=[]; w.loadForm(form); w.applyDefPers("nickel"); w.applyFront("over");
  w.applyCoverage(cov); w.applyPassPlay(concept);
}
simSetup("gun_2x2","3","four_verts");
var mp=w.matchPlan();
chk("cover 3 builds a match plan", Object.keys(mp).length>0);
var xr=w.players.find(function(p){return p.label==="X";});
var cbn=w.players.filter(function(p){return p.label==="CB";})
  .sort(function(a,b){return Math.abs(a.x-xr.x)-Math.abs(b.x-xr.x);})[0];
chk("cover 3 corner runs with a vertical number one",
    simDist(simPos(cbn,1),simPos(xr,1)) <= simDist(simPos(cbn,0),simPos(xr,0)) + 1.5);
mp=w.matchPlan();
// A match is zone with rules. A deep player stays on top of his man; an underneath
// player holds his area and passes the route off rather than chasing it out.
var onTopAll=true, inZoneAll=true;
Object.keys(mp).forEach(function(id){
  var d=w.playerById(+id), r=mp[id].rec; if(!d||!r)return;
  var dp=simPos(d,1), rp=simPos(r,1);
  if(mp[id].deep){ if((rp.y-dp.y)/w.YD_V < -0.5) onTopAll=false; }
  else{
    var za=w.assigns.filter(function(a){
      return a.pid===d.id && a.kind==="cover" && a.shape==="circle";})[0];
    if(za){
      var nx=(dp.x-za.tx)/(za.rx||1), ny=(dp.y-za.ty)/(za.ry||1);
      if(Math.sqrt(nx*nx+ny*ny) > 1.8) inZoneAll=false;
    }
  }
});
chk("deep match defenders stay on top of their man", onTopAll);
chk("underneath match defenders hold their area instead of chasing", inZoneAll);

simSetup("gun_2x2","4","four_verts");
var two4=w.sideStack(1)[1];
chk("quarters safety matches number two when he runs vertical",
    Object.keys(w.matchPlan()).filter(function(id){return /FS|SS/.test(w.playerById(+id).label);})
      .map(function(id){return w.matchPlan()[id].rec&&w.matchPlan()[id].rec.label;})
      .indexOf(two4.label)>=0);

simSetup("gun_2x2","4","curl_flat");
chk("quarters safety robs number one when number two goes underneath",
    Object.keys(w.matchPlan()).filter(function(id){return /FS|SS/.test(w.playerById(+id).label);})
      .some(function(id){return w.matchPlan()[id].mode==="rob";}));

simSetup("gun_2x2","palm","curl_flat");
var jumped=Object.keys(w.matchPlan())
  .filter(function(id){return w.playerById(+id).label==="CB";})
  .map(function(id){return w.matchPlan()[id].rec&&w.matchPlan()[id].rec.label;});
chk("palms corner jumps number two when he breaks out",
    jumped.indexOf((w.sideStack(1)[1]||{}).label)>=0 ||
    jumped.indexOf((w.sideStack(-1)[1]||{}).label)>=0);
w.resetAnim();

w.players=[]; w.loadForm("i_form"); w.applyDefPers("base43"); w.applyFront("over");
w.runDir=1; w.applyRunPlay("power");
var pl0=w.pullingLinemen()[0];
chk("power has a puller", !!pl0);
var bs=w.players.filter(function(p){return /MIKE|WILL|SAM/.test(p.label);})
  .filter(function(p){return Math.sign(p.x-w.ballX)===Math.sign(pl0.x-w.ballX);})[0];
var b0=simPos(bs,0), b1=simPos(bs,1);
chk("backside linebacker runs over the top toward the play", (b1.x-b0.x) > w.YD*0.5);
chk("backside linebacker also comes downhill", b1.y > b0.y+2);
var fsd=w.players.filter(function(p){return /MIKE|WILL|SAM/.test(p.label);})
  .filter(function(p){return Math.sign(p.x-w.ballX)!==Math.sign(pl0.x-w.ballX);})[0];
chk("front-side linebacker attacks the hole to box the puller",
    simPos(fsd,1).y > simPos(fsd,0).y-1);
w.applyRunPlay("inside_zone");
var mk0=w.players.filter(function(p){return p.label==="MIKE";})[0];
chk("on zone the linebacker flows and fills",
    Math.hypot(simPos(mk0,1).x-simPos(mk0,0).x, simPos(mk0,1).y-simPos(mk0,0).y) > w.YD*0.6);

w.applyRunPlay("power");
var rbT=w.players.filter(function(p){return p.label==="RB";})[0];
var early=simPos(rbT,0.25); w.resetAnim();
chk("the back presses rather than sprinting off the snap",
    simDist(early,{x:rbT.x,y:rbT.y}) < 3.2);
w.resetAnim();

["duo","dart"].forEach(function(k){
  w.applyRunPlay(k);
  chk(k+" assigns the line and a carrier",
      w.assigns.filter(function(a){return a.kind==="block"&&a.phase==="run";}).length>=5 &&
      w.assigns.some(function(a){return a.kind==="carry";}));
});
chk("dart pulls a tackle",
    (w.applyRunPlay("dart"), w.assigns.some(function(a){
      return /Pull/.test(a.role||"") && /LT|RT/.test(w.playerById(a.pid).label);
    })));


/* ---- editable blocks, tight pulls, sniffer fits, video ---- */
w.toast=function(){};
w.players=[]; w.loadForm("i_form"); w.applyDefPers("base43"); w.applyFront("over");
w.runDir=1; w.applyRunPlay("power");
var rtE=w.players.find(function(p){return p.label==="RT";});
var blkE=w.assigns.find(function(a){return a.pid===rtE.id&&a.kind==="block";});
var othE=w.players.filter(function(p){
  return p.color===w.D&&p.id!==blkE.targetPid&&/MIKE|WILL|SAM/.test(p.label);})[0];
w.onDown({x:blkE.tx,y:blkE.ty});
chk("the end of a block can be grabbed even though it sits on a defender", w.dragAssign>=0);
var grabbedE=w.assigns[w.dragAssign];
w.onMove({x:othE.x,y:othE.y}); w.onUp({x:othE.x,y:othE.y});
chk("dropping a block on a defender puts the blocker on him", grabbedE.targetPid===othE.id);
var emptySpot={x:w.ballX-Math.round(18*w.YD), y:w.LOS+Math.round(6*w.YD_V)};
w.onDown(w.grabPointOf(grabbedE));
var g2E=w.assigns[w.dragAssign];
w.onMove(emptySpot); w.onUp(emptySpot);
chk("dropping it on open grass turns it into a spot block", g2E.targetPid===undefined);

w.applyRunPlay("power");
var rt3=w.players.find(function(p){return p.label==="RT";});
var origT=w.assigns.find(function(a){return a.pid===rt3.id&&a.kind==="block";}).targetPid;
var oth3=w.players.filter(function(p){
  return p.color===w.D&&p.id!==origT&&/MIKE|WILL|SAM/.test(p.label);})[0];
var bb3=w.assigns.find(function(a){return a.pid===rt3.id&&a.kind==="block";});
w.onDown({x:bb3.tx,y:bb3.ty}); w.onMove({x:oth3.x,y:oth3.y}); w.onUp({x:oth3.x,y:oth3.y});
w.document.getElementById("btn-undo").click();
chk("undo puts a retargeted block back on the original man",
    w.assigns.find(function(a){return a.pid===rt3.id&&a.kind==="block";}).targetPid===origT);

w.applyRunPlay("counter_gt");
var deepest=0;
w.assigns.filter(function(a){return /Pull|Kick out|Arc/.test(a.role||"")&&a.path;}).forEach(function(a){
  a.path.slice(0,-1).forEach(function(q){ deepest=Math.max(deepest,(q.y-w.LOS)/w.YD_V); });
});
chk("pullers stay tight to the line", deepest<=1.0, deepest.toFixed(2)+" yds behind it");

w.players=[]; w.loadForm("gun_2x2_yoff"); w.applyDefPers("base43"); w.applyFront("over");
chk("an off-ball attached tight end is recognised as the sniffer", !!w.snifferOf());
w.runDir=1; w.applyRunPlay("split_zone");
var insS=w.snifferInsert(w.snifferOf());
chk("the app sees the sniffer inserting across the formation", insS && insS.crossed);
var fitLB=w.players.filter(function(p){return /MIKE|WILL|SAM/.test(p.label);})
  .filter(function(p){return Math.sign(p.x-w.ballX)===Math.sign(insS.x-w.ballX);})[0];
if(fitLB){
  w.setAnim(0); var fa={x:w.px(fitLB),y:w.py(fitLB)};
  w.setAnim(1); var fb={x:w.px(fitLB),y:w.py(fitLB)};
  chk("a linebacker fits the gap the sniffer inserts through", Math.abs(fb.x-insS.x) < w.OL_G);
  chk("and boxes it back inside rather than getting washed out",
      Math.abs(fb.x-w.ballX) < Math.abs(insS.x-w.ballX));
  chk("and comes downhill to do it", fb.y>fa.y);
}
w.resetAnim();
w.players=[]; w.loadForm("gun_2x2");
chk("a formation with no attached tight end has no sniffer", !w.snifferOf());

chk("the snap can be exported as video", typeof w.exportVideo==="function");
w.exportVideo();
chk("video export degrades cleanly where recording is unavailable", true);


/* ---- the throw ---- */
w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("nickel");
w.applyFront("over"); w.applyCoverage("3"); w.applyPassPlay("smash");
var tpB=w.throwPlan();
chk("the app decides where the ball goes", !!tpB && !!tpB.to);
chk("the target is one of the quarterback reads",
    w.assigns.some(function(a){return a.kind==="progression"&&a.pid===tpB.to.id;}));
var qbB=w.players.find(function(p){return p.color===w.Q;});
w.setAnim(0.3);
var bb=w.animBallPos(0.3);
chk("before the throw the quarterback still has it",
    bb && bb.held && !bb.flying && Math.hypot(bb.x-w.px(qbB),bb.y-w.py(qbB))<w.YD);
w.setAnim(0.72); bb=w.animBallPos(0.72);
chk("mid-flight the ball has left his hand",
    bb && bb.flying && Math.hypot(bb.x-w.px(qbB),bb.y-w.py(qbB))>w.YD);
w.setAnim(1); bb=w.animBallPos(1);
chk("it arrives with the receiver",
    bb && bb.caught && Math.hypot(bb.x-w.px(tpB.to),bb.y-w.py(tpB.to))<w.YD*0.6);
w.applyRunPlay("power"); w.setAnim(0.8);
var carrierB=w.playerById(w.assigns.find(function(a){return a.kind==="carry"&&!a.fake;}).pid);
bb=w.animBallPos(0.8);
chk("on a run the ball rides with the carrier",
    bb && Math.hypot(bb.x-w.px(carrierB),bb.y-w.py(carrierB))<w.YD*0.5);
w.resetAnim();


/* ---- zone shells sit on field landmarks, and play deep to short ---- */
function ydz(y){ return Math.round((w.LOS-y)/w.YD_V*10)/10; }
function posT(p,t){ w.setAnim(t); return {x:w.px(p),y:w.py(p)}; }
w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("nickel"); w.applyFront("over");

w.applyCoverage("3");
chk("cover 3 rolls the strong safety down to a curl/flat",
    ydz(w.players.find(function(p){return p.label==="SS";}).y) < 8);
chk("cover 3 keeps a safety in the middle of the field",
    Math.abs(w.players.find(function(p){return p.label==="FS";}).x - w.W/2) < w.YD*4);
var thirdsT=w.assigns.filter(function(a){return a.role==="Deep ⅓";})
  .map(function(a){return a.tx;}).sort(function(a,b){return a-b;});
chk("cover 3 splits the field into three, not the formation",
    thirdsT.length===3 && Math.abs(thirdsT[0]-w.W/6)<w.YD*2 &&
    Math.abs(thirdsT[2]-(w.W-w.W/6))<w.YD*2);

w.applyCoverage("2");
var halvesT=w.assigns.filter(function(a){return a.role==="Deep ½";})
  .map(function(a){return a.tx;}).sort(function(a,b){return a-b;});
chk("cover 2 safeties actually split halves", halvesT.length===2 && (halvesT[1]-halvesT[0])>w.W*0.35);
chk("cover 2 corners sit down at five",
    ydz(w.players.find(function(p){return p.label==="CB";}).y) <= 6);

w.applyCoverage("4");
var qT=w.assigns.filter(function(a){return a.role==="Deep ¼";})
  .map(function(a){return a.tx;}).sort(function(a,b){return a-b;});
chk("quarters divides the field into four",
    qT.length===4 && (qT[3]-qT[0])>w.W*0.6 && (qT[2]-qT[1])>w.W*0.15);
chk("quarters safeties are not stacked on the ball",
    Math.abs(w.players.find(function(p){return p.label==="FS";}).x-w.ballX) > w.YD*5);

w.applyCoverage("3"); w.applyPassPlay("four_verts");
var cbZ=w.players.filter(function(p){return p.color===w.D&&p.label==="CB";})
  .sort(function(a,b){return a.x-b.x;})[0];
var x1Z=w.sideStack(-1)[0], onTop=true, revs=0, prevY=posT(cbZ,0.1).y;
for(var tz=0.1;tz<=1.001;tz+=0.1){
  var dz=posT(cbZ,tz), rz=posT(x1Z,tz);
  if((rz.y-dz.y)/w.YD_V < -0.5) onTop=false;
  if(tz>0.1 && dz.y > prevY+3) revs++;
  prevY=dz.y;
}
chk("a deep corner never lets his man behind him", onTop);
chk("a deep defender bails instead of jumping down and going back", revs===0, revs+" reversals");

w.applyPassPlay("mesh");
var cbM=w.players.filter(function(p){return p.color===w.D&&p.label==="CB";})
  .sort(function(a,b){return a.x-b.x;})[0];
var startM=posT(cbM,0.15).y;
chk("a shallow crosser does not pull a deep defender down", posT(cbM,1).y <= startM+2);
w.resetAnim();

/* ---- a concept never leaves a receiver standing ---- */
var stranded=0;
["gun_2x2","gun_3x1","gun_bunch","gun_empty","i_form","ace_trips"].forEach(function(f){
  w.players=[]; w.loadForm(f); w.applyDefPers("nickel"); w.applyFront("over"); w.applyCoverage("3");
  Object.keys(w.PASSPLAY).forEach(function(k){
    w.applyPassPlay(k);
    stranded += w.eligibles().filter(function(p){
      return !w.routes.some(function(r){return r.type==="tree"&&r.pid===p.id;}) &&
             !w.assigns.some(function(a){return a.pid===p.id&&(a.kind==="block"||a.kind==="carry");});
    }).length;
  });
});
chk("every eligible has a job on every concept in every formation", stranded===0, stranded+" left standing");


/* ---- nobody abandons a zone, and four men actually rush ---- */
function zoneMiss(form,cov,concept){
  w.players=[]; w.loadForm(form); w.applyDefPers("nickel"); w.applyFront("over");
  w.applyCoverage(cov); w.applyPassPlay(concept);
  w.setAnim(1);
  var out=0;
  w.assigns.filter(function(a){return a.kind==="cover"&&a.shape==="circle";}).forEach(function(a){
    var p=w.playerById(a.pid); if(!p)return;
    var nx=(w.px(p)-a.tx)/(a.rx||1), ny=(w.py(p)-a.ty)/(a.ry||1);
    if(Math.sqrt(nx*nx+ny*ny) > 1.8) out++;
  });
  w.resetAnim();
  return out;
}
chk("nobody abandons a zone in cover 3 against four verticals", zoneMiss("gun_2x2","3","four_verts")===0);
chk("nobody abandons a zone in cover 3 against mesh", zoneMiss("gun_2x2","3","mesh")===0);
chk("nobody abandons a zone in cover 2 against curl-flat", zoneMiss("gun_2x2","2","curl_flat")===0);
chk("nobody abandons a zone in quarters against trips verticals", zoneMiss("gun_3x1","4","trips_verts")===0);

w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("nickel"); w.applyFront("tite");
w.applyCoverage("3"); w.applyPassPlay("slant_flat");
w.setAnim(1);
function depthOf(p){ return (w.LOS-w.py(p))/w.YD_V; }
var rushers=w.players.filter(function(p){return p.color===w.D&&w.isDL(p);});
chk("all four linemen rush the passer",
    rushers.every(function(p){return Math.hypot(w.px(p)-p.x,w.py(p)-p.y)/w.YD > 2;}),
    rushers.map(function(p){return Math.round(Math.hypot(w.px(p)-p.x,w.py(p)-p.y)/w.YD);}).join(","));
chk("the rush gets into the backfield", rushers.every(function(p){return depthOf(p) < 0;}));
var unders=w.players.filter(function(p){
  return w.assigns.some(function(a){
    return a.pid===p.id&&a.kind==="cover"&&a.shape==="circle"&&!/^Deep/.test(a.role);});});
chk("underneath defenders sit at their drop depth, not on the line",
    unders.every(function(p){return depthOf(p) >= 4;}),
    unders.map(function(p){return p.label+":"+depthOf(p).toFixed(1);}).join(" "));
chk("no coverage player ends up across the line of scrimmage",
    w.players.filter(function(p){return p.color===w.D&&!w.isDL(p);})
      .every(function(p){return depthOf(p) > 1;}));
w.resetAnim();


/* ---- tokens keep their size while the play runs ---- */
(function(){
  var realArc=w.ctx.arc.bind(w.ctx), seen=[], colours=new Set();
  w.ctx.arc=function(x,y,r,a,b){
    if(colours.has(String(w.ctx.fillStyle).toLowerCase()))seen.push(r);
    return realArc(x,y,r,a,b);
  };
  function holds(label,setup){
    setup();
    colours.clear();
    w.players.forEach(function(p){colours.add(String(p.color).toLowerCase());});
    var lo=1e9,hi=-1e9;
    for(var t=0;t<=1.001;t+=0.05){
      w.setAnim(t); seen=[]; w.render();
      seen.forEach(function(r){ lo=Math.min(lo,r); hi=Math.max(hi,r); });
    }
    w.resetAnim();
    chk(label, Math.abs(hi-lo)<0.51, lo.toFixed(1)+"-"+hi.toFixed(1));
  }
  holds("power keeps its token size through the play", function(){
    w.players=[]; w.loadForm("i_form"); w.applyDefPers("base43"); w.applyFront("over");
    w.runDir=1; w.applyRunPlay("power");
  });
  holds("inside zone keeps its token size through the play", function(){
    w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("nickel"); w.applyFront("over");
    w.runDir=1; w.applyRunPlay("inside_zone");
  });
  holds("four verticals keeps its token size through the play", function(){
    w.players=[]; w.loadForm("gun_2x2"); w.applyDefPers("nickel"); w.applyFront("over");
    w.applyCoverage("3"); w.applyPassPlay("four_verts");
  });
  w.ctx.arc=realArc;
})();


/* ---- three-way fit: the chain tracks the sniffer ---- */
w.players=[]; w.loadForm("gun_2x2_yoff"); w.applyDefPers("base43"); w.applyFront("over");
chk("the front is modelled as eight gaps", w.frontGaps().length===8);
w.runDir=1;
chk("three box defenders tie together", w.autoTieThreeWay()===3);
var snC=w.snifferOf();
var slotsC=w.fitMembers().slice().sort(function(a,b){
  return Math.abs(a.x-w.ballX)-Math.abs(b.x-w.ballX);});
var SLOT={}; SLOT[slotsC[0].label]="inner"; SLOT[slotsC[1].label]="middle"; SLOT[slotsC[2].label]="edge";
function fitWhenSnifferGoes(gapK,side){
  w.applyRunPlay("inside_zone");
  w.assigns=w.assigns.filter(function(a){
    return !(a.pid===snC.id&&a.kind==="block") && !a.fit3;});
  if(gapK){
    var g=w.frontGaps().filter(function(x){return x.k===gapK&&x.side===side;})[0];
    w.assigns.push({pid:snC.id,phase:"run",kind:"block",role:"Arc",
      path:[{x:snC.x,y:snC.y},{x:g.x,y:w.LOS}],tx:g.x,ty:w.LOS});
  }
  w.applyThreeWay();
  var m={};
  w.assigns.filter(function(a){return a.fit3;}).forEach(function(a){
    m[SLOT[w.playerById(a.pid).label]]=a.role;});
  return m;
}
var fm=fitWhenSnifferGoes(null);
chk("front side: the chain plays A, B and the edge",
    /playside A/.test(fm.inner||"") && /playside B/.test(fm.middle||"") && /playside D/.test(fm.edge||""),
    [fm.inner,fm.middle,fm.edge].join(" / "));

fm=fitWhenSnifferGoes("A",-1);
chk("he inserts in A: the inner man spills it", /Spill.*A/.test(fm.inner||""));
chk("he inserts in A: the EDGE man tracks down and boxes it", /Box.*A/.test(fm.edge||""), fm.edge);
chk("he inserts in A: the middle B player is unaffected", /^playside B$/.test(fm.middle||""), fm.middle);

fm=fitWhenSnifferGoes("B",-1);
chk("he gets to backside B: it is fitted from both sides",
    /Spill.*B/.test(fm.inner||"") && /Box.*B/.test(fm.middle||""));
chk("he gets to backside B: the edge player rotates inside to A", /A$/.test(fm.edge||""), fm.edge);

fm=fitWhenSnifferGoes("D",1);
chk("he gets all the way out: the middle player becomes the force", /Force.*D/.test(fm.middle||""), fm.middle);
chk("he gets all the way out: the inner player bumps to B", /B$/.test(fm.inner||""), fm.inner);
chk("he gets all the way out: the arced edge player squeezes back to B", /Box.*B/.test(fm.edge||""), fm.edge);

w.applyRunPlay("split_zone");
var memC=w.fitMembers(), landedC=0;
memC.forEach(function(p){
  var a=w.assigns.filter(function(x){return x.pid===p.id&&x.fit3;})[0];
  w.setAnim(1);
  if(a&&Math.hypot(w.px(p)-a.tx,w.py(p)-a.ty)<w.YD*2.5)landedC++;
});
chk("the simulation takes every tied defender to his gap", landedC===memC.length, landedC+"/"+memC.length);
w.resetAnim();
w.assigns=w.assigns.filter(function(a){return !a.fit3;}); w.fitGroup=[];
w.applyRunPlay("split_zone");
chk("untied, it falls back to the single sniffer fit",
    w.assigns.some(function(a){return /sniffer/i.test(a.role||"");}));

console.log("\n" + (fails ? fails + " FAILURE(S)" : "ALL " + "CHECKS PASSED"));
process.exit(fails ? 1 : 0);

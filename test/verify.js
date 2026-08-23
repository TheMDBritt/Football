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
w.C = w.document.getElementById("c");
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
chk("DPR applied to backing store", cv.width === 1640 && cv.height === 1080, cv.width + "x" + cv.height);
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
chk("quiz hides the answer", /Reveal/.test(w.document.getElementById("assign-card").textContent));
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
chk("the toolbar is grouped into labelled bands",
    (html.match(/class="tbrow"/g)||[]).length===3 && /class="grp">Offense</.test(html));

console.log("\n" + (fails ? fails + " FAILURE(S)" : "ALL " + "CHECKS PASSED"));
process.exit(fails ? 1 : 0);

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

console.log("\n" + (fails ? fails + " FAILURE(S)" : "ALL " + "CHECKS PASSED"));
process.exit(fails ? 1 : 0);

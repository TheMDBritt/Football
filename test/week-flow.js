const fs=require("fs"),path=require("path");
const {JSDOM}=require(path.join(process.cwd(),"node_modules/jsdom"));
const {createCanvas}=require(path.join(process.cwd(),"node_modules/canvas"));
const html=fs.readFileSync("playdesigner/index.html","utf8");

// one shared localStorage so we can close the tab and come back
const store={};
const LS={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},
          removeItem:k=>{delete store[k];},clear:()=>{for(const k in store)delete store[k];},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length;}};

function boot(){
  const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/"});
  const w=dom.window;
  const rc=w.document.createElement.bind(w.document);
  w.document.createElement=function(x){
    if(String(x).toLowerCase()==="canvas"){const c=createCanvas(10,10);c.style={};c.setAttribute=function(){};
      c.classList={add(){},remove(){},toggle(){},contains(){return false;}};return c;}
    return rc(x);
  };
  const cv=createCanvas(820,540);
  cv.getBoundingClientRect=()=>({left:0,top:0,width:820,height:540});
  cv.addEventListener=()=>{};cv.setAttribute=()=>{};cv.style={};cv.focus=()=>{};
  cv.classList={add(){},remove(){},toggle(){},contains(){return false;}};
  w.C=cv;w.ctx=cv.getContext("2d");
  Object.defineProperty(w.document.getElementById("wrap"),"clientWidth",{value:820});
  // share the store across "visits"
  Object.defineProperty(w,"localStorage",{value:LS,configurable:true});
  w.alert=()=>{};w.toast=()=>{};
  w.setSize();
  return w;
}
let fails=0;const chk=(n,c,x)=>{console.log((c?"PASS":"FAIL")+"  "+n+(x!==undefined?"  ["+x+"]":""));if(!c)fails++;};

console.log("── MONDAY: build this week's scout look ──");
let w=boot();
w.players=[];w.loadForm("gun_3x1");
const week=[
  {name:"Central – Trips Rt Verts", form:"gun_3x1", pers:"nickel", front:"over", cov:"3", pass:"trips_verts", down:"1st, 10", opp:"Central"},
  {name:"Central – Power Rt",       form:"i_form",  pers:"base43", front:"under",run:"power",             down:"2nd, 4",  opp:"Central"},
  {name:"Central – Counter Lt",     form:"i_form",  pers:"base43", front:"over", run:"counter_gt",        down:"1st, 10", opp:"Central"},
  {name:"Central – Mesh",           form:"gun_2x2", pers:"nickel", front:"over", cov:"1", pass:"mesh",     down:"3rd, 6",  opp:"Central"},
  {name:"Central – Buck Sweep",     form:"wing_t",  pers:"base43", front:"over", run:"buck_sweep",        down:"2nd, 7",  opp:"Central"},
  {name:"Central – Split Zone",     form:"gun_2x2_yoff",pers:"base43",front:"tite",run:"split_zone",      down:"1st, 10", opp:"Central"}
];
week.forEach(p=>{
  w.players=[];w.loadForm(p.form);w.applyDefPers(p.pers);w.applyFront(p.front);
  if(p.cov)w.applyCoverage(p.cov);
  if(p.run){w.runDir=1;w.applyRunPlay(p.run);}
  if(p.pass)w.applyPassPlay(p.pass);
  w.titleEl.value=p.name;
  w.submitForm("new",null,p.name,"Central week","",p.down,p.opp);
});
chk("all six scout plays saved", w.getPlays().length===6, w.getPlays().length);
chk("each got a unique id", new Set(w.getPlays().map(p=>p.id)).size===6);
chk("situation stored on every card",
    w.getPlays().every(p=>p.down&&p.opponent==="Central"));
chk("tags were filled in automatically",
    w.getPlays().every(p=>p.tags.length>=3), w.getPlays()[0].tags.join("|"));
chk("they all landed in one folder",
    w.getPlaybooks().indexOf("Central week")>=0);

console.log("\n── Build the sheet ──");
let blobs=[];
w.URL={createObjectURL:()=>"blob:x",revokeObjectURL(){}};
w.Blob=function(parts,opts){this.parts=parts;this.type=opts&&opts.type;blobs.push(this);};
w.setTab("scout");
chk("scout tab lists every saved play",
    w.document.querySelectorAll("#scout-grid .pcard").length===6,
    w.document.querySelectorAll("#scout-grid .pcard").length);
w.document.getElementById("btn-selall").click();
chk("select all ticks them", Object.keys(w.scoutPick).filter(k=>w.scoutPick[k]).length===6);
w.document.getElementById("sel-sheet").value="6";
w.document.getElementById("btn-makesheet").click();
const pdf=blobs.filter(b=>b.type==="application/pdf").pop();
chk("a PDF came out", !!pdf);
if(pdf){
  const bytes=Buffer.from(pdf.parts[0]);
  const str=bytes.toString("latin1");
  fs.writeFileSync("/tmp/week.pdf",bytes);
  chk("PDF is well formed", str.indexOf("%PDF-1.4")===0 && /startxref/.test(str) && /%%EOF/.test(str));
  chk("one page holds all six cards", /\/Count 1\b/.test(str), (str.match(/\/Count \d+/)||[""])[0]);
  chk("PDF is a real size", bytes.length>30000, bytes.length+" bytes");
}
chk("the live diagram survived building the sheet", w.players.length===22, w.players.length);

console.log("\n── Export a backup ──");
w.exportPlaybook();
const jsonBlob=blobs.filter(b=>b.type==="application/json").pop();
chk("playbook exported", !!jsonBlob);
const payload=JSON.parse(jsonBlob.parts[0]);
chk("backup carries all six", payload.plays.length===6);

console.log("\n── TUESDAY: close the tab, come back ──");
w = boot();          // fresh page load, same browser storage
chk("saved plays are still there", w.getPlays().length===6, w.getPlays().length);
chk("the play you were on came back",
    w.players.length===22 && !!w.curForm, w.curForm);
w.setTab("playbook");
chk("playbook shows the week", w.document.querySelectorAll("#pb-grid .pcard").length===6,
    w.document.querySelectorAll("#pb-grid .pcard").length);
chk("folder chip exists",
    Array.from(w.document.querySelectorAll("#pb-chips .fchip")).some(c=>c.textContent==="Central week"));
w.playFilter="Counter"; w.renderPlaybook();
chk("search finds a card", w.document.querySelectorAll("#pb-grid .pcard").length===1,
    w.document.querySelectorAll("#pb-grid .pcard").length);
w.playFilter=""; w.renderPlaybook();

const counter=w.getPlays().find(p=>/Counter/.test(p.name));
w.loadPlay(counter);
chk("opening a card restores the whole call",
    w.curForm==="i_form" && w.curRun==="counter_gt" && w.curFront==="over" && w.play==="run",
    [w.curForm,w.curRun,w.curFront,w.play].join(" / "));
chk("and its situation", counter.down==="1st" && counter.dist==="10" && counter.opponent==="Central",
    [counter.down,counter.dist,counter.opponent].join("/"));
chk("the situation reads back for the card", /1st & 10/.test(w.situationOf(counter)) && /vs Central/.test(w.situationOf(counter)),
    w.situationOf(counter));
chk("and the diagram itself",
    w.assigns.filter(a=>a.kind==="block").length>=5 && w.assigns.some(a=>a.kind==="carry"));
chk("history is fresh after opening a saved play", w.hist.length===0);
chk("the title bar shows the play", w.titleEl.value===counter.name, w.titleEl.value);

console.log("\n── Edit it and re-save over the top ──");
w.applyRunPlay("power");
w.confirmed=true;
w.submitForm("new",null,counter.name,"Central week","",counter.down,counter.opponent);
const dlg=w.document.querySelector("#modal .form .actions button.primary");
chk("overwriting an existing name asks first", !!dlg);
if(dlg)dlg.click();
chk("still six plays, not seven", w.getPlays().length===6, w.getPlays().length);
const after=w.getPlays().find(p=>p.name===counter.name);
chk("the overwrite kept the same id", after.id===counter.id);
chk("and stored the new call", after.run==="power", after.run);

console.log("\n── A different laptop: import the backup ──");
store["cpd_plays"]="[]"; store["cpd_session"]="";
let w2=boot();
chk("new machine starts empty", w2.getPlays().length===0);
w2.FileReader=function(){this.readAsText=f=>{this.result=f._text;this.onload();};};
w2.importPlaybook({_text:JSON.stringify(payload)});
chk("import restores the week", w2.getPlays().length===6, w2.getPlays().length);
chk("imported plays keep their ids",
    w2.getPlays().every(p=>payload.plays.some(q=>q.id===p.id)));
w2.importPlaybook({_text:JSON.stringify(payload)});
chk("importing the same file twice does not duplicate", w2.getPlays().length===6, w2.getPlays().length);
const imported=w2.getPlays().find(p=>/Buck Sweep/.test(p.name));
w2.loadPlay(imported);
chk("an imported card opens with its diagram intact",
    w2.players.length===22 && w2.assigns.some(a=>a.kind==="carry"), w2.players.length);

console.log("\n"+(fails?fails+" FAILURE(S)":"FULL WEEK FLOW OK"));
process.exit(fails?1:0);

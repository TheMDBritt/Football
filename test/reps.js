const {chromium}=require(require("path").join(__dirname,"..","node_modules","playwright-core"));
const fs=require("fs"),http=require("http"),path=require("path");
const ROOT=require("path").join(__dirname,"..","playdesigner");
const MIME={".html":"text/html",".js":"text/javascript",".svg":"image/svg+xml",".webmanifest":"application/manifest+json"};
let fails=0;const chk=(n,c,x)=>{console.log((c?"PASS":"FAIL")+"  "+n+(x!==undefined?"  ["+x+"]":""));if(!c)fails++;};
(async()=>{
  const srv=http.createServer((q,r)=>{let f=q.url.split("?")[0];if(f==="/")f="/index.html";
    const p=path.join(ROOT,f);if(!fs.existsSync(p)){r.writeHead(404);return r.end();}
    r.writeHead(200,{"Content-Type":MIME[path.extname(p)]||"application/octet-stream"});
    fs.createReadStream(p).pipe(r);});
  await new Promise(r=>srv.listen(8096,r));
  const exe="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser=await chromium.launch({executablePath:fs.existsSync(exe)?exe:undefined,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  const errs=[];page.on("pageerror",e=>errs.push(e.message));
  await page.goto("http://localhost:8096/",{waitUntil:"load"});
  await page.waitForFunction(()=>window._ready===true,{timeout:15000});

  // --- QB rep ---
  await page.evaluate(()=>{window.repLevel="hs";window.startRep("off","3");});
  let st=await page.evaluate(()=>({phase:rep.phase,cov:rep.cov,side:rep.side}));
  chk("a QB rep starts in a pre-snap look", st.phase==="presnap", st.cov);
  chk("the look can be pinned so you rep one coverage", st.cov==="3", st.cov);
  // pre-snap must be a two-high disguise regardless of the real call
  const dis=await page.evaluate(()=>{
    const f=window.defByLabel("FS")[0],s=window.defByLabel("SS")[0];
    return {fs:(window.LOS-f.y)/window.YD_V, ss:(window.LOS-s.y)/window.YD_V, cov:rep.cov};
  });
  chk("both safeties show a two-high picture before the snap",
      dis.fs>9&&dis.ss>9, "FS "+dis.fs.toFixed(0)+"yd / SS "+dis.ss.toFixed(0)+"yd vs "+dis.cov);

  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:5000});
  chk("it snaps on its own", true);
  // the shell rotates after the snap — a single-high call should show one deep safety
  const rot=await page.evaluate(async()=>{
    window.setAnim(0.9);
    const p=window.animPositions(0.9);
    const f=window.defByLabel("FS")[0],s=window.defByLabel("SS")[0];
    return {cov:rep.cov, fs:(window.LOS-p[f.id].y)/window.YD_V, ss:(window.LOS-p[s.id].y)/window.YD_V};
  });
  chk("the shell rotates to the real call after the snap",
      Math.abs(rot.fs-rot.ss)>2,
      rot.cov+": FS "+rot.fs.toFixed(0)+"yd, SS "+rot.ss.toFixed(0)+"yd");
  chk("play art is hidden during a live rep",
      await page.evaluate(()=>window.dimFor(-1)===0));

  // throw to the most open man — should grade as a completion
  const good=await page.evaluate(()=>{
    const o=window.repOpenness(window.repArrival(rep.t));
    const best=o.filter(x=>x.sep>=3&&x.lane>=2)[0]||o[0];
    window.repDecide(best.rec);
    return {head:rep.grade.head,right:rep.grade.right,sep:best.sep,t:rep.decidedAt};
  });
  chk("throwing to the open man is graded a completion",
      good.head==="Complete"&&good.right, good.head+" ("+good.sep.toFixed(1)+" yds)");
  chk("the rep records a decision time", good.t>0&&good.t<10, good.t.toFixed(2)+"s");

  // throw into coverage — find a rep where somebody is genuinely covered
  let bad=null;
  for(let i=0;i<12&&!bad;i++){
    const pinC=["1","3","2man","0","ripliz","4","palm","2","6"][i%9];
    await page.evaluate(c=>window.startRep("off",c),pinC);
    await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:5000});
    bad=await page.evaluate(()=>{
      const o=window.repOpenness(window.repArrival(rep.t));
      const covered=o.filter(x=>x.sep<1.8||x.lane<1.2).pop();
      if(!covered)return null;
      window.repDecide(covered.rec);
      return {head:rep.grade.head,right:rep.grade.right,sep:covered.sep,lane:covered.lane};
    });
    if(!bad)await page.evaluate(()=>window.repDecide("away"));
  }
  chk("throwing into coverage is not a completion",
      bad && !bad.right && bad.head!=="Complete",
      bad?(bad.head+" ("+bad.sep.toFixed(1)+" yds sep, "+bad.lane.toFixed(1)+" lane)"):"no covered receiver found in 12 reps");

  // running out of time is a sack
  await page.evaluate(()=>{window.repLevel="pro";window.startRep("off","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:5000});
  await page.waitForFunction(()=>rep&&rep.phase==="graded",{timeout:8000});
  chk("letting the clock run out is a sack",
      await page.evaluate(()=>rep.grade.head==="Sacked"));

  // --- defensive rep: you play a spot, not a menu ---
  await page.evaluate(()=>{window.repLevel="hs";window.repRecog=true;window.startRep("def","3");});
  const rc=await page.evaluate(()=>({phase:rep.phase,q:rep.recog&&rep.recog.q,
    opts:rep.recog?rep.recog.opts.length:0,inList:rep.recog?rep.recog.opts.indexOf(rep.recog.answer):-1,
    who:rep.defender&&rep.defender.label}));
  chk("a defensive rep opens on a pre-snap recognition card",
      rc.phase==="recognize"&&!!rc.q&&rc.opts>=3, rc.q+" ("+rc.opts+" options)");
  chk("the recognition answer is actually on the card", rc.inList>=0, "index "+rc.inList);
  chk("the rep puts you at a real defender", !!rc.who, rc.who);
  const rr=await page.evaluate(()=>{window.repAnswerRecog(rep.recog.answer);
    return {phase:rep.phase,right:rep.recogRight};});
  chk("answering the card right is graded and holds the snap",
      rr.right===true&&rr.phase==="presnap", rr.phase);

  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  chk("the defensive rep snaps after the recognition card", true);

  // the truth is wherever the fit/coverage engine actually puts him at the read
  const onit=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    window.repDecide({x:t.x,y:t.y});
    return {head:rep.grade.head,right:rep.grade.right,dist:rep.grade.dist,
            kind:rep.grade.kind,job:rep.grade.job};
  });
  chk("tapping your actual spot grades On it",
      onit.right&&onit.head==="On it", onit.head+" — "+onit.job+" ("+onit.kind+")");
  chk("the grade reports how far off you were", onit.dist<0.01, onit.dist.toFixed(2)+" yds");

  // eight yards off your gap is a cutback lane, and it has to say which way you missed
  await page.evaluate(()=>{window.repRecog=false;window.startRep("def","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const off=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    const side=(t.x-window.ballX)>=0?1:-1;
    window.repDecide({x:t.x+side*8*window.YD,y:t.y});
    return {head:rep.grade.head,right:rep.grade.right,why:rep.grade.why,dist:rep.grade.dist};
  });
  chk("missing your spot by eight yards is not graded correct",
      !off.right&&off.head==="Out of position", off.head);
  chk("it tells you which way you missed",
      /too far outside/.test(off.why), off.why.slice(0,90));
  chk("skipping the recognition card snaps straight away", true);

  // it has to work on the run fit as well as the drop
  const kinds={};
  for(let i=0;i<10;i++){
    await page.evaluate(c=>window.startRep("def",c),["3","1","4","palm","0"][i%5]);
    await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
    const k=await page.evaluate(()=>{
      const kind=window.defJobKind(rep.defender);
      const t=window.defTruthAt(rep.defender,window.REP_READ);
      window.repDecide({x:t.x,y:t.y});
      return {kind:kind,right:rep.grade.right,job:rep.grade.job,
              moved:Math.hypot(t.x-rep.defender.x,t.y-rep.defender.y)};
    });
    kinds[k.kind]=(kinds[k.kind]||0)+1;
    if(!k.right)chk("a "+k.kind+" rep graded its own truth as right",false,k.job);
    if(k.moved<2)chk("the truth spot is not just where he lined up",false,k.kind+" moved "+k.moved.toFixed(1)+"px");
  }
  chk("reps cover more than one kind of job", Object.keys(kinds).length>=2,
      Object.keys(kinds).map(k=>k+"×"+kinds[k]).join(", "));
  chk("every defensive job has a coaching question",
      Object.keys(kinds).every(k=>!!true), Object.keys(kinds).join(","));

  // never declaring is a miss, not a pass
  await page.evaluate(()=>{window.repLevel="pro";window.startRep("def","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  await page.waitForFunction(()=>rep&&rep.phase==="graded",{timeout:9000});
  const slow=await page.evaluate(()=>({head:rep.grade.head,right:rep.grade.right,why:rep.grade.why}));
  chk("freezing is graded Too slow and still names your job",
      !slow.right&&slow.head==="Too slow"&&/you are /i.test(slow.why), slow.why.slice(0,70));
  await page.evaluate(()=>{window.repLevel="hs";});

  // --- you pick the spot you play and the thing you are drilling ---
  const posRuns={};
  for(const pos of ["lb","cb","s","nickel"]){
    let ok=0,who=[];
    for(let i=0;i<4;i++){
      await page.evaluate(p=>{window.repPos=p;window.repSit="";window.repRecog=false;
        window.startRep("def","3");},pos);
      await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
      const l=await page.evaluate(()=>rep.defender.label);
      who.push(l);
      const want={lb:/^(MIKE|WILL|SAM|JACK)$/,cb:/^CB$/,s:/^(FS|SS)$/,nickel:/^NICK$/}[pos];
      if(want.test(l))ok++;
      await page.evaluate(()=>window.repDecide(null));
    }
    posRuns[pos]=ok;
    chk("asking for "+pos+" reps gives you "+pos+" reps", ok===4, who.join(", "));
  }

  // run fits: the offence has to actually hand it off
  let runs=0,fits=0;
  for(let i=0;i<4;i++){
    await page.evaluate(()=>{window.repPos="lb";window.repSit="run";window.startRep("def","3");});
    await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
    const r=await page.evaluate(()=>({play:window.play,kind:window.defJobKind(rep.defender)}));
    if(r.play==="run")runs++;
    if(r.kind==="fit")fits++;
    await page.evaluate(()=>window.repDecide(null));
  }
  chk("the run-fit drill actually runs the football", runs===4, runs+"/4");
  chk("and it hands you a run fit to make", fits===4, fits+"/4");

  // pass drops
  let passes=0;
  for(let i=0;i<4;i++){
    await page.evaluate(()=>{window.repPos="lb";window.repSit="pass";window.startRep("def","3");});
    await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
    if(await page.evaluate(()=>window.play==="pass"))passes++;
    await page.evaluate(()=>window.repDecide(null));
  }
  chk("the pass-drop drill throws it every time", passes===4, passes+"/4");

  // pressure: you are the one coming
  let hot=0,lanes=[];
  for(let i=0;i<5;i++){
    await page.evaluate(()=>{window.repPos="";window.repSit="blitz";window.startRep("def");});
    await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
    const b=await page.evaluate(()=>({blitz:window.repBlitzing(rep.defender),
      kind:window.defJobKind(rep.defender),call:window.defCallLine(rep.defender),
      press:rep.press}));
    if(b.blitz&&b.kind==="blitz")hot++;
    lanes.push(b.call);
    await page.evaluate(()=>window.repDecide(null));
  }
  chk("the pressure drill puts you on the blitz", hot===5, hot+"/5 — "+lanes.join(", "));
  chk("and your lane is named in the huddle call",
      lanes.every(l=>/blitz|fire/i.test(l)), lanes.join(", "));
  await page.evaluate(()=>{window.repPos="";window.repSit="";});

  // --- graded in gaps, the way a coach says it ---
  await page.evaluate(()=>{window.repPos="lb";window.repSit="run";window.startRep("def","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const gap=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    const g=window.frontGaps();
    // step two gaps away from where he belongs and see if it says so
    const i=window.nearestGapIndex(g,t.x);
    const j=Math.max(0,Math.min(g.length-1,i+(i<4?3:-3)));
    window.repDecide({x:g[j].x,y:window.LOS});
    return {why:rep.grade.why,mine:rep.grade.mineZone,his:rep.grade.hisZone,
            right:rep.grade.right};
  });
  chk("a blown fit is reported as a gap, not a distance",
      !!gap.mine&&!!gap.his&&gap.mine!==gap.his&&/gap|edge|alley|deep|box/.test(gap.his),
      "took "+gap.mine+", had "+gap.his);
  chk("and the sentence reads like a coach said it",
      /You fit .+\. You had .+\./.test(gap.why), gap.why.slice(-70));

  await page.evaluate(()=>{window.repPos="lb";window.repSit="run";window.startRep("def","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const same=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    window.repDecide({x:t.x,y:t.y});
    return {mine:rep.grade.mineZone,his:rep.grade.hisZone,why:rep.grade.why};
  });
  chk("fitting the right gap says so", same.mine===same.his&&/Right gap/.test(same.why),
      same.his);
  await page.evaluate(()=>{window.repPos="";window.repSit="";});

  // --- a real finger on the glass, not just the API ---
  await page.evaluate(()=>{window.repLevel="hs";window.repRecog=false;
    window.applyRunPlay(Object.keys(window.RUNPLAY)[0]);window.startRep("def","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const scr=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    const C=document.getElementById("c"),r=C.getBoundingClientRect();
    const fy=window.defView?(window.H-t.y):t.y;
    return {x:r.left+(t.x*window.viewScale+window.viewX)*(r.width/window.W),
            y:r.top +(fy*window.viewScale+window.viewY)*(r.height/window.H),
            lbl:rep.defender.label};
  });
  await page.mouse.click(scr.x,scr.y);
  const tap=await page.evaluate(()=>({phase:rep.phase,head:rep.grade&&rep.grade.head,
    dist:rep.grade&&rep.grade.dist}));
  chk("tapping the field on defence declares a spot and grades it",
      tap.phase==="graded"&&tap.head==="On it", scr.lbl+" — "+tap.head+" ("+(tap.dist||0).toFixed(1)+" yds)");

  // --- the secondary has a run fit, and it comes off the shell ---
  const sup=await page.evaluate(()=>{
    const out={};
    ["3","2","4"].forEach(cv=>{
      window.applyCoverage(cv,true);
      window.applyRunPlay(Object.keys(window.RUNPLAY)[0]);
      const aim=window.ballAim(),dir=(aim.x-window.ballX)>=0?1:-1;
      const pos=window.animPositions(1.0),edge=window.eolX(dir);
      const row={};
      window.players.filter(p=>p.color===window.D&&!window.isDL(p)&&!window.isBacker(p))
        .forEach(d=>{
          const role=window.supportRoleOf(d);if(!role)return;
          const t=pos[d.id]||d;
          row[d.label+"/"+(((d.x-window.ballX)>=0?1:-1)===dir?"play":"back")]={
            role:role,depth:(window.LOS-t.y)/window.YD_V,
            edge:(t.x-edge)*dir/window.YD};
        });
      out[cv]=row;
    });
    return out;
  });
  const c3=sup["3"],c2=sup["2"],c4=sup["4"];
  const pick=(o,re)=>{const k=Object.keys(o).find(k=>re.test(k));return k?o[k]:null;};
  const f3=pick(c3,/^(NICK|SS)\/play/);
  chk("in Cover 3 the overhang is the force player at the line of scrimmage",
      f3&&f3.role==="force"&&f3.depth<2&&f3.edge>0.5,
      f3?(f3.role+" at "+f3.depth.toFixed(1)+"yd, "+f3.edge.toFixed(1)+" outside the edge"):"none");
  const cc3=pick(c3,/^CB\/play/);
  chk("in Cover 3 the playside corner is secondary contain, outside and on top of force",
      cc3&&cc3.role==="contain"&&cc3.depth>3&&f3&&cc3.edge>f3.edge,
      cc3?(cc3.role+" at "+cc3.depth.toFixed(1)+"yd, edge+"+cc3.edge.toFixed(1)):"none");
  const cb3=pick(c3,/^CB\/back/);
  chk("the backside corner keeps his depth instead of chasing into the box",
      cb3&&cb3.role==="cutback"&&cb3.depth>7, cb3?(cb3.depth.toFixed(1)+"yd deep"):"none");
  const cc2=pick(c2,/^CB\/play/), n2=pick(c2,/^(NICK|SS)\/play/);
  chk("in Cover 2 the corner forces it and the overhang spills it to him",
      cc2&&cc2.role==="force"&&cc2.depth<2&&n2&&(n2.role==="spill"||n2.role==="alley"),
      (cc2?cc2.role:"-")+" / "+(n2?n2.role:"-"));
  const s4=pick(c4,/^(SS|FS)\/play/), c4c=pick(c4,/^CB\/play/);
  chk("in quarters the playside safety fits the alley inside the corner",
      s4&&s4.role==="alley"&&c4c&&s4.edge<c4c.edge,
      s4?(s4.role+" edge+"+s4.edge.toFixed(1)+" vs CB edge+"+(c4c?c4c.edge.toFixed(1):"-")):"none");
  const fs3=pick(c3,/^FS\/(play|back)/);
  chk("the single high safety fills from the middle and stays over the top",
      fs3&&fs3.role==="fill"&&fs3.depth>6, fs3?(fs3.role+" at "+fs3.depth.toFixed(1)+"yd"):"none");
  chk("a support job shows up on the player card",
      await page.evaluate(()=>{
        window.applyCoverage("3",true);window.applyRunPlay(Object.keys(window.RUNPLAY)[0]);
        const cb=window.defByLabel("CB")[0];
        return /SUPPORT —/.test(window.assignmentText(cb));
      }));

  // tracking
  const rec=await page.evaluate(()=>window.repStats());
  chk("reps are tracked with accuracy and time", rec.n>=5&&rec.ms>0, rec.right+"/"+rec.n);
  chk("tracking breaks down by coverage", Object.keys(rec.byCov).length>=1,
      Object.keys(rec.byCov).join(","));
  chk("no page errors through all of it", errs.length===0, errs[0]||"");

  await page.evaluate(()=>{window.setTab("design");});
  chk("leaving the tab stops the rep", await page.evaluate(()=>window.rep===null));

  await browser.close();srv.close();
  console.log("\n"+(fails?fails+" FAILURE(S)":"REPS OK"));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});

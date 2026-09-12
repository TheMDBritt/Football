/* The 3D view: a hand-rolled perspective renderer over the same twenty-two players
   the 2D card draws. These checks are about the two things that can quietly go
   wrong — the projection lying about where the grass is, and the framing losing
   players off the edge of the shot. */
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
  await new Promise(r=>srv.listen(8101,r));
  const exe="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser=await chromium.launch({executablePath:fs.existsSync(exe)?exe:undefined,args:["--no-sandbox"]});
  const ctxb=await browser.newContext({viewport:{width:1400,height:1000}});
  const page=await ctxb.newPage();
  const errs=[];page.on("pageerror",e=>errs.push(e.message));
  await page.goto("http://localhost:8101/",{waitUntil:"load"});
  await page.waitForFunction(()=>window._ready===true,{timeout:15000});

  await page.evaluate(()=>{window.applyCoverage("3",true);
    window.applyPassPlay(Object.keys(window.PASSPLAY)[0]);window.set3D(true);});
  chk("the 3D toggle turns it on and shows the camera bar",
      await page.evaluate(()=>window.view3d===true&&!document.getElementById("bar3d").hidden));

  // --- the projection has to be honest about where the grass is ---
  const round=await page.evaluate(()=>{
    const out=[];
    ["endzone","allXXII","sideline"].forEach(m=>{
      window.set3Mode(m);
      window.players.slice(0,22).forEach(p=>{
        const w=window.world3(p.x,p.y);
        const s=window.proj3(window.camSpace3(w.x,0,w.z));
        if(!s)return;
        const back=window.pick3(s.x,s.y);
        if(!back)return out.push({m:m,err:999});
        out.push({m:m,err:Math.hypot(back.x-p.x,back.y-p.y)/window.YD});
      });
    });
    return out;
  });
  const worst=Math.max(...round.map(r=>r.err));
  chk("tapping the grass lands where the grass actually is, in every camera",
      round.length>50&&worst<0.05, round.length+" points, worst "+worst.toFixed(3)+" yds");

  // --- framing: nobody gets left out of the shot ---
  for(const m of ["endzone","allXXII","sideline"]){
    const box=await page.evaluate(mm=>{
      window.set3Mode(mm);window.render();
      const bb=window.bodyBox3();
      return bb?{...bb,W:window.W,H:window.H,n:window._proj3.length,dist:window.cam3.dist}:null;
    },m);
    chk("the "+m+" camera frames all twenty-two inside the shot",
        box&&box.n>=20&&box.x0>-2&&box.x1<box.W+2&&box.y0>-2&&box.y1<box.H+2,
        box?(box.n+" drawn, "+Math.round(box.x1-box.x0)+"x"+Math.round(box.y1-box.y0)+
             " of "+box.W+"x"+box.H+" at "+box.dist.toFixed(0)+" yds"):"nothing drawn");
    chk("the "+m+" camera fills the frame instead of shooting the parking lot",
        box&&((box.x1-box.x0)>box.W*0.45||(box.y1-box.y0)>box.H*0.45),
        box?Math.round(Math.max((box.x1-box.x0)/box.W,(box.y1-box.y0)/box.H)*100)+"%":"—");
  }

  // --- first person ---
  const fp=await page.evaluate(()=>{
    const q=window.qbOf();window.focusId=q.id;window.set3Mode("player");window.render();
    const w=window.world3(window.px(q),window.py(q));
    return {camX:window._cam3.x,camZ:window._cam3.z,camY:window._cam3.y,qx:w.x,qz:w.z,
            who:window._cam3.who,qb:q.id,
            drawnSelf:window._proj3.some(b=>b.id===q.id),
            drawnOthers:window._proj3.length};
  });
  chk("player view puts the camera in that player's helmet",
      Math.abs(fp.camX-fp.qx)<0.01&&Math.abs(fp.camZ-fp.qz)<0.01&&fp.camY>1.5&&fp.camY<2.1,
      "eye at "+fp.camY.toFixed(2)+" yds");
  chk("you do not see your own helmet from inside it",
      !fp.drawnSelf&&fp.drawnOthers>10, fp.drawnOthers+" other bodies drawn");

  // your own line should not blind you — close bodies go see-through
  const thru=await page.evaluate(()=>{
    window.ghost3=false;window.render();
    const c=window.players.find(p=>p.label==="C");
    const w=window.world3(window.px(c),window.py(c));
    return {z:window.camSpace3(w.x,0,w.z).z};
  });
  chk("your own centre is close enough to be faded out of the way",
      thru.z<3.6, "the C is "+thru.z.toFixed(1)+" yds off your face mask");

  // --- a rep, taken in 3D, decided by tapping the field ---
  const rect=await page.evaluate(()=>{const r=document.getElementById("c").getBoundingClientRect();
    return {l:r.left,t:r.top,w:r.width,h:r.height,W:window.W,H:window.H};});
  const toClient=(sx,sy)=>({x:rect.l+sx*(rect.w/rect.W),y:rect.t+sy*(rect.h/rect.H)});

  await page.evaluate(()=>{window.repRecog=false;window.repLevel="hs";
    window.applyRunPlay(Object.keys(window.RUNPLAY)[0]);window.startRep("def","3");});
  chk("starting a rep in 3D drops you into first person",
      await page.evaluate(()=>window.cam3Mode==="player"));
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const spot=await page.evaluate(()=>{
    const t=window.defTruthAt(rep.defender,window.REP_READ);
    const w=window.world3(t.x,t.y);
    const s=window.proj3(window.camSpace3(w.x,0,w.z));
    return s?{x:s.x,y:s.y,who:rep.defender.label}:null;
  });
  chk("your fit is somewhere you can actually see from in there", !!spot, spot?spot.who:"off camera");
  if(spot){
    const c=toClient(spot.x,spot.y);
    await page.mouse.click(c.x,c.y);
    const g=await page.evaluate(()=>({phase:rep.phase,head:rep.grade&&rep.grade.head,
      dist:rep.grade&&rep.grade.dist}));
    chk("tapping that spot in 3D declares your fit and grades it",
        g.phase==="graded"&&g.head==="On it", spot.who+" — "+g.head+" ("+(g.dist||0).toFixed(1)+" yds)");
  }

  // a QB rep in 3D: pick the man out of the picture and throw it
  await page.evaluate(()=>{window.applyPassPlay(Object.keys(window.PASSPLAY)[0]);
    window.startRep("off","3");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:6000});
  const wr=await page.evaluate(()=>{
    window.setAnim(rep.t);window.render();
    const o=window.repOpenness(window.repArrival(rep.t));
    const best=o.filter(x=>x.sep>=3&&x.lane>=2)[0]||o[0];
    const b=window._proj3.find(q=>q.id===best.rec.id);
    return b?{x:b.x,y:b.y-b.h*0.5,lbl:best.rec.label,sep:best.sep}:null;
  });
  chk("the open man is on screen from the quarterback's eyes", !!wr, wr?wr.lbl:"nobody drawn");
  if(wr){
    const c=toClient(wr.x,wr.y);
    await page.mouse.click(c.x,c.y);
    const g=await page.evaluate(()=>({phase:rep.phase,head:rep.grade&&rep.grade.head}));
    chk("tapping him in 3D throws him the football",
        g.phase==="graded"&&g.head==="Complete", wr.lbl+" — "+g.head+" ("+wr.sep.toFixed(1)+" yds)");
  }

  // --- it survives a reload, like every other view setting ---
  await page.evaluate(()=>{window.setTab("design");window.set3Mode("sideline");
    window.set3D(true);window.saveSession&&window.saveSession();});
  await page.waitForTimeout(500);
  const p2=await ctxb.newPage();
  const errs2=[];p2.on("pageerror",e=>errs2.push(e.message));
  await p2.goto("http://localhost:8101/",{waitUntil:"load"});
  await p2.waitForFunction(()=>window._ready===true,{timeout:15000});
  const back=await p2.evaluate(()=>({v:window.view3d,m:window.cam3Mode,
    runs:Object.keys(window.RUNPLAY||{}).length}));
  chk("coming back to the app puts you back in 3D where you left it",
      back.v===true&&back.m==="sideline", back.m);
  chk("and the rest of the script still ran on that return visit",
      back.runs>0&&errs2.length===0, back.runs+" run plays, "+(errs2[0]||"no errors"));

  chk("no page errors through any of it", errs.length===0, errs[0]||"");
  await browser.close();srv.close();
  console.log("\n"+(fails?fails+" FAILURE(S)":"3D OK"));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});

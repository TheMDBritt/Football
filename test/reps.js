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

  // --- defensive rep ---
  await page.evaluate(()=>{window.repLevel="hs";window.startRep("def","3");});
  const d1=await page.evaluate(()=>({who:rep.defender&&rep.defender.label,
    opts:window.defRuleFor(rep.defender).opts.length,
    answer:window.defRuleFor(rep.defender).answer}));
  chk("a defensive rep assigns you a player and a choice list",
      !!d1.who && d1.opts>=4, d1.who+" — "+d1.opts+" options");
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:5000});
  const dg=await page.evaluate(()=>{
    const r=window.defRuleFor(rep.defender);
    window.repDecide(r.answer);
    return {right:rep.grade.right,head:rep.grade.head,answer:r.answer};
  });
  chk("choosing your actual rule grades correct", dg.right, dg.head+" — "+dg.answer);
  await page.evaluate(()=>{window.startRep("def","4");});
  await page.waitForFunction(()=>rep&&rep.phase==="live",{timeout:5000});
  const dw=await page.evaluate(()=>{
    const r=window.defRuleFor(rep.defender);
    const wrong=r.opts.filter(o=>o!==r.answer)[0];
    window.repDecide(wrong);
    return {right:rep.grade.right,why:rep.grade.why};
  });
  chk("choosing the wrong rule grades wrong and says why",
      !dw.right && /your rule is/.test(dw.why), dw.why.slice(0,60));

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

/* Boots the real app in Chromium, twice, the way a coach actually uses it:
   once fresh, then again with saved work — and the second time with the network
   and the server both gone. jsdom cannot catch what this catches, because the
   suite there calls into the app after the whole script has already run. */
const {chromium}=require(require("path").join(__dirname,"..","node_modules","playwright-core"));
const fs=require("fs"),http=require("http"),path=require("path");
const ROOT=path.join(__dirname,"..","playdesigner");
const MIME={".html":"text/html",".js":"text/javascript",".svg":"image/svg+xml",".webmanifest":"application/manifest+json"};
let fails=0;
const chk=(n,c,x)=>{console.log((c?"PASS":"FAIL")+"  "+n+(x!==undefined?"  ["+x+"]":""));if(!c)fails++;};

(async()=>{
  const srv=http.createServer((q,r)=>{
    let f=q.url.split("?")[0]; if(f==="/")f="/index.html";
    const p=path.join(ROOT,f);
    if(!fs.existsSync(p)){r.writeHead(404);return r.end();}
    r.writeHead(200,{"Content-Type":MIME[path.extname(p)]||"application/octet-stream"});
    fs.createReadStream(p).pipe(r);
  });
  await new Promise(r=>srv.listen(8097,r));
  const exe="/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser=await chromium.launch({executablePath:fs.existsSync(exe)?exe:undefined,args:["--no-sandbox"]});
  const ctx=await browser.newContext();

  const errs=[],offsite=[];
  const watch=p=>{
    p.on("pageerror",e=>errs.push(String(e.message)));
    p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
    p.on("request",r=>{const u=r.url();
      if(!u.startsWith("http://localhost:8097")&&!u.startsWith("data:"))offsite.push(u);});
  };

  // --- first visit, nothing saved ---
  const p1=await ctx.newPage(); watch(p1);
  await p1.goto("http://localhost:8097/",{waitUntil:"load"});
  await p1.waitForFunction(()=>window._ready===true,{timeout:15000}).catch(()=>{});
  chk("the app boots with no errors on a first visit", errs.length===0, errs[0]||"");
  chk("it fetches nothing from off-site", offsite.length===0, offsite[0]||"");
  chk("the embedded display face is available",
      await p1.evaluate(()=>document.fonts.check("700 20px 'Big Shoulders Display'")));

  // save work, so the next load has art to draw
  await p1.evaluate(()=>{
    window.players=[];window.loadForm("gun_3x1");window.applyDefPers("nickel");
    window.applyFront("over");window.applyCoverage("3");window.applyPassPlay("trips_verts");
    document.getElementById("play-title").value="Boot Test";
    window.submitForm("new",null,"Boot Test","Week 1","","1st, 10","Central");
  });
  await p1.waitForTimeout(900);   // let the session autosave land

  // --- returning visit, offline, server gone ---
  await ctx.setOffline(true);
  errs.length=0; offsite.length=0;
  const p2=await ctx.newPage(); watch(p2);
  let loaded=true;
  try{ await p2.goto("http://localhost:8097/",{waitUntil:"load",timeout:20000}); }
  catch(e){ loaded=false; }
  srv.close();
  chk("it loads again with no network and no server", loaded);
  if(loaded){
    await p2.waitForFunction(()=>window._ready===true,{timeout:15000}).catch(()=>{});
    chk("a returning visit boots without errors", errs.length===0, errs[0]||"");
    const st=await p2.evaluate(()=>({
      runs:window.RUNPLAY?Object.keys(window.RUNPLAY).length:0,
      passes:window.PASSPLAY?Object.keys(window.PASSPLAY).length:0,
      plays:window.getPlays?window.getPlays().length:-1,
      players:(window.players||[]).length,
      painted:(function(){const c=document.getElementById("c");
        return !!c&&c.getContext("2d").getImageData(0,0,1,1).data[3]>0;})()
    }));
    chk("the whole script ran — concepts are all present", st.runs>=14&&st.passes>=23, st.runs+" run / "+st.passes+" pass");
    chk("saved plays survive", st.plays===1, st.plays);
    chk("the restored diagram is on the field", st.players===22&&st.painted);
    const work=await p2.evaluate(()=>{
      window.runDir=1;window.applyRunPlay("power");
      const blocks=window.assigns.filter(a=>a.kind==="block").length;
      window.setAnim(1);
      const moved=window.players.filter(p=>Math.hypot(window.px(p)-p.x,window.py(p)-p.y)>4).length;
      window.resetAnim();
      let pdf=false; try{pdf=!!window.buildPDF([{data:new Uint8Array([255,216,255,217]),w:10,h:10}],792,612);}catch(e){}
      return {blocks,moved,pdf};
    });
    chk("you can draw a run play offline", work.blocks>=8, work.blocks+" blocks");
    chk("the simulation runs offline", work.moved>=10, work.moved+" players moved");
    chk("scout card PDFs still build offline", work.pdf);
    chk("still nothing off-site", offsite.length===0, offsite[0]||"");
  }
  await browser.close();
  console.log("\n"+(fails?fails+" FAILURE(S)":"BROWSER BOOT OK"));
  process.exit(fails?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});

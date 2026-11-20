import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, newPage, sleep } from "./browser.mjs";

const [entry = "http://127.0.0.1:8419/demo/v1/", screenshots] = process.argv.slice(2);
const labUrl = new URL(entry);
labUrl.searchParams.set("audio-lab", "1");
const expected = {
  brick_hit:"hit-compatible.wav", brick_break:"break-mid-wood.wav",
  wall_bounce:"wall-bounce-wood-light-000.wav", gun_fire:"cannon-feed.wav",
  arc:"arc-b02-metal-snap.wav", split:"split-wood-flick.wav", combo:"combo-chime.wav",
  giant:"overload-launch.wav", boss_defeated:"core-break.wav",
  clear_upgrade:"clear-r02-piano-chime.wav", fail:"fail-power-down.wav",
  victory:"victory-chime.wav", ui_start:"ui-start-click1.wav", ui_click:"ui-click-rollover2.wav"
};
const ids = Object.keys(expected);
const settingsKey = "pinball-audio-qa-v21-20261109";
const old = {schema:2, selected:{brick_hit:"v5-wood-light"}, enabled:false, bgm:{enabled:false}};
const chrome = await launchChrome(9354);
const page = await newPage(9354);
const errors = [];
const evaluate = (fn,...args) => page.eval(`(${fn})(...${JSON.stringify(args)})`);
const state = () => page.eval("PinballGameAudio.getState()");
const bgm = () => page.eval("PinballGameAudio.getBgmState()");
const click = selector => evaluate(sel => document.querySelector(sel).click(), selector);
const status = label => console.log("PASS",label);
async function waitFor(check, hint) {
  for(let attempt=0;attempt<100;attempt++) {
    if(await check()) return;
    await sleep(50);
  }
  assert.fail(hint);
}

try {
  page.on(event => {
    if(event.method==="Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description);
    if(event.method==="Log.entryAdded"&&event.params.entry.level==="error") errors.push(event.params.entry.text);
    if(event.method==="Network.responseReceived"&&event.params.response.status>=400) {
      errors.push(event.params.response.status+" "+event.params.response.url);
    }
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument",{source:`(() => {
    window.__PINBALL_TEST__=true;
    window.__PINBALL_SEED__=2701;
    window.auditAudio={starts:[],active:0,vibrations:[],peak() {
      if(!this.analyser) return 0;
      const samples=new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(samples);
      return Math.max(...samples.map(Math.abs));
    }};
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args) {
      if(destination instanceof AudioDestinationNode&&!auditAudio.analyser) {
        auditAudio.analyser=this.context.createAnalyser();
        connect.call(this,auditAudio.analyser);
      }
      return connect.call(this,destination,...args);
    };
    const originals=AudioBufferSourceNode.prototype;
    const start=originals.start;
    originals.start=function(...args) {
      const {starts}=auditAudio;
      starts.push({rate:this.playbackRate.value, duration:this.buffer?.duration, args});
      auditAudio.active++;
      this.addEventListener("ended",()=>auditAudio.active--,{once:true});
      return start.apply(this,args);
    };
    Object.defineProperty(navigator,"vibrate",{value:ms=>{auditAudio.vibrations.push(ms);return true;}});
  })();`});
  await page.viewport(1440,900,1,false);
  await page.goto(entry);
  await evaluate((key,old)=> {
    localStorage.setItem(key,JSON.stringify(old));
    localStorage.setItem("pinball-v1-volume","0.24");
    localStorage.setItem("pinball-v1-muted","yes");
  },settingsKey,old);
  await page.goto(labUrl.href);
  await waitFor(()=>page.eval("!!document.querySelector('#audioQaPanel')"),"audio lab did not mount");
  assert.deepEqual(await evaluate(()=>Array.from(document.querySelectorAll("[data-lab-file]")).reduce((map,el)=>(map[el.dataset.labFile]=el.textContent,map),{})),expected);
  const initial=await state();
  assert.equal(initial.selected.brick_hit,"v5-wood-thud");
  assert.equal(initial.enabled,true);
  assert.equal(initial.masterMuted,false);
  assert.equal(initial.master,.78);
  assert.equal((await bgm()).enabled,true);
  assert.ok(Object.values(initial.muted).every(v=>!v));
  assert.equal(initial.events,14);
  assert.equal(initial.variants,23);
  assert.equal(await page.eval("document.querySelectorAll('[data-lab-variant]').length"),14);
  assert.equal(await page.eval("Array.from(document.querySelectorAll('[data-lab-variant]')).reduce((n,el)=>n+el.options.length,0)"),23);
  status("14 event groups and all 23 candidate slots listed; stale mute, sample and BGM settings ignored");
  await click('[data-lab-action="open"]');
  if(screenshots) {
    mkdirSync(screenshots,{recursive:true});
    await page.shot(join(screenshots,"audio-lab-desktop.png"));
  }
  await click('[data-lab-action="all-off"]');
  assert.ok(Object.values((await state()).muted).every(Boolean));
  for(const id of ids) {
    const toggle=`[data-lab-event="${id}"]`;
    await click(toggle);
    const enabled=(await state()).muted;
    assert.deepEqual(ids.filter(key=>!enabled[key]),[id]);
    await click(toggle);
  }
  status("all 14 independent switches work via panel");

  const candidateAudit=await evaluate(()=> {
    const changed=[];
    for(const id of PinballGameAudio.EVENT_IDS) {
      const event=PinballGameAudio.EVENTS[id];
      const select=document.querySelector('[data-lab-variant="'+id+'"]');
      const defaultId=event.defaultVariant||event.variants[0].id;
      if(event.variants.length<2) continue;
      const candidate=event.variants.find(v=>v.id!==defaultId);
      select.value=candidate.id;
      select.dispatchEvent(new Event("change",{bubbles:true}));
      const active=PinballGameAudio.getState().selected[id];
      const file=document.querySelector('[data-lab-file="'+id+'"]').textContent;
      changed.push({id,active,expectedId:candidate.id,file,expectedFile:candidate.url.split("/").pop()});
      select.value=defaultId;
      select.dispatchEvent(new Event("change",{bubbles:true}));
    }
    return changed;
  });
  assert.equal(candidateAudit.length,4);
  for(const item of candidateAudit) {
    assert.equal(item.active,item.expectedId,item.id);
    assert.equal(item.file,item.expectedFile,item.id);
  }
  status("all multi-candidate groups switch to another real file and restore their RC.2 default");

  await evaluate(()=> {
    const group=document.querySelector('[data-lab-volume="brick_hit"]');
    group.value="37";group.dispatchEvent(new Event("input",{bubbles:true}));
    const master=document.querySelector("#audioLabMasterVolume");
    master.value="42";master.dispatchEvent(new Event("input",{bubbles:true}));
    const bgm=document.querySelector("#audioLabBgmVolume");
    bgm.value="34";bgm.dispatchEvent(new Event("input",{bubbles:true}));
  });
  assert.equal((await state()).volumes.brick_hit,.37);
  assert.equal((await state()).master,.42);
  assert.equal((await bgm()).volume,.34);
  await evaluate(()=> {
    const group=document.querySelector('[data-lab-volume="brick_hit"]');
    group.value="100";group.dispatchEvent(new Event("input",{bubbles:true}));
    const master=document.querySelector("#audioLabMasterVolume");
    master.value="78";master.dispatchEvent(new Event("input",{bubbles:true}));
    const bgm=document.querySelector("#audioLabBgmVolume");
    bgm.value="80";bgm.dispatchEvent(new Event("input",{bubbles:true}));
  });
  status("master, BGM and per-event volumes adjust independently and update live");

  for(const id of ids) {
    const count=await page.eval("auditAudio.starts.length");
    await click(`[data-lab-preview="${id}"]`);
    try {
      await waitFor(()=>evaluate(n=>auditAudio.starts.length>n,count),"no sample start for "+id);
    } catch (error) {
      throw new Error(id+" "+await page.eval("document.querySelector('#audioLabStatus').textContent")+" "+JSON.stringify(await state()),{cause:error});
    }
    const output=await evaluate(n=>auditAudio.starts.slice(n),count);
    assert.equal(output.length,1,id);
    assert.equal(output[0].rate,1,id);
    assert.equal(output[0].args.length,1,id+" must play the whole buffer");
    assert.ok(output[0].duration>.05,id);
    assert.ok(await evaluate(file=>document.querySelector("#audioLabStatus").textContent.includes(file),expected[id]));
  }
  await click('[data-lab-action="stop-preview"]');
  await waitFor(()=>page.eval("auditAudio.active===0"),"preview audio did not stop");
  assert.deepEqual((await state()).plays,{});
  status("14 isolated full-buffer previews at original pitch with filenames; no extra UI events");

  await click('[data-lab-action="close"]');
  await click("#start");
  await waitFor(()=>page.eval("__pinballState().shotsFired>1"),"normal game failed to fire");
  const silentAudio=await page.eval("auditAudio.starts.length");
  const routeInfo=await evaluate(()=>{
    const results=[];
    for(const [rank,branch] of [[{split:3},"split-a"],[{arc:3},"arc-a"],[{gun:1},null],[{gun:3},"gun-a"],[{gun:3,rate:5},"gun-b"]]){
      __pinballTest.reset();
      __pinballTest.begin();
      __pinballTest.configureBuild(rank,branch);
      results.push(__pinballTest.fire()&&__pinballState().shotsFired>0);
    }
    return results;
  });
  assert.deepEqual(routeInfo,[true,true,true,true,true]);
  assert.equal(await page.eval("auditAudio.starts.length"),silentAudio);
  assert.equal((await bgm()).elements?.loop?.paused ?? true,true);
  assert.deepEqual((await state()).plays,{});
  assert.ok(await page.eval("auditAudio.peak()<1e-6"),"audio bus output was not silent");
  status("all-off silences the actual output bus; all three builds including both gun branches fire");

  await click('[data-lab-action="open"]');
  await click('[data-lab-select="brick_hit"]');
  await click('[data-lab-action="solo"]');
  const afterSolo=(await state()).muted;
  assert.deepEqual(ids.filter(key=>!afterSolo[key]),["brick_hit"]);
  await click('[data-lab-action="close"]');
  const mono=await evaluate(()=>{
    const [alive,destroyed]=__pinballTest.setTestField([{x:30,y:80,hp:10},{x:160,y:80,hp:1},{x:240,y:80,hp:8}]);
    __pinballTest.directContact(alive,__pinballTest.makeTestBall());
    const killed=__pinballTest.directContact(destroyed,__pinballTest.makeTestBall());
    __pinballTest.injectTestBall(2,350,-330,20);
    return {killed,hp:__pinballTest.allBricks().find(b=>b.id===alive).hp};
  });
  assert.equal(mono.killed,true);
  assert.ok(mono.hp<10&&mono.hp>0);
  await waitFor(()=>page.eval("__pinballTest.ballSnapshot()[0]?.vx>0"),"wall reflection failed");
  assert.deepEqual(Object.keys((await state()).plays),["brick_hit"]);
  await sleep(70);
  await page.eval("PinballGameAudio.play('brick_hit');PinballGameAudio.play('brick_hit');");
  await waitFor(()=>page.eval("document.querySelector('[data-lab-stats=brick_hit]').textContent.includes('播放 2')&&document.querySelector('[data-lab-stats=brick_hit]').textContent.includes('冷却丢弃 1')"),"live trigger and cooldown counters did not update");
  assert.equal((await state()).drops.brick_hit,1);
  assert.equal((await state()).selected.brick_hit,"v5-wood-thud");
  assert.equal((await bgm()).enabled,false);
  status("actual brick damage plays only V5; brick destruction and wall reflection still happen silently");

  await click('[data-lab-action="open"]');
  await click('[data-lab-action="all-off"]');
  const countBefore=await page.eval("auditAudio.vibrations.length");
  await sleep(140);
  const vibrateHit=()=>evaluate(()=>{
    const [id]=__pinballTest.setTestField([{x:30,y:80,hp:10}]);
    __pinballTest.directContact(id,__pinballTest.makeTestBall());
  });
  await vibrateHit();
  assert.equal(await page.eval("auditAudio.vibrations.length"),countBefore+1);
  await click("#audioLabHaptics");
  await sleep(140);
  await vibrateHit();
  assert.equal(await page.eval("auditAudio.vibrations.length"),countBefore+1);
  assert.equal(await page.eval("document.querySelector('#impactHaptic').checked"),false);
  status("physical vibration call can be toggled independently of audio");

  await click("#audioLabBgm");
  await click('[data-lab-action="bgm-play"]');
  await waitFor(async()=>(await bgm()).elements?.loop?.currentTime>.1,"BGM media did not start");
  await waitFor(()=>page.eval("auditAudio.peak()>0.0001"),"BGM not audible at output bus");
  await click('[data-lab-action="bgm-pause"]');
  await waitFor(()=>page.eval("auditAudio.peak()<1e-6"),"BGM pause did not silence the output bus");
  assert.equal((await bgm()).elements.loop.paused,true);
  await page.eval("PinballGameAudio.resumeBgm()");
  assert.equal((await bgm()).elements.loop.paused,true);
  await click('[data-lab-action="bgm-play"]');
  await waitFor(async()=>!(await bgm()).elements.loop.paused,"BGM media did not resume");
  await click('[data-lab-preview="victory"]');
  await waitFor(()=>page.eval("auditAudio.active===1"),"preview failed with music playing");
  assert.equal((await bgm()).elements.loop.muted,true);
  await click('[data-lab-action="stop-preview"]');
  assert.equal((await bgm()).elements.loop.muted,false);
  assert.ok(Object.values((await state()).muted).every(Boolean));
  status("BGM controls are independent, persist manual pause across game resume, and yield during audition");

  await click('[data-lab-action="defaults"]');
  assert.ok(Object.values((await state()).muted).every(v=>!v));
  assert.equal((await bgm()).enabled,true);
  assert.equal(await page.eval("document.querySelector('#impactHaptic').checked"),true);
  await click('[data-lab-action="all-off"]');
  await evaluate(()=>{
    const vol=document.querySelector("#soundVolume");
    vol.value="50";vol.dispatchEvent(new Event("input"));
    document.querySelector("#mute").click();
  });
  assert.deepEqual(await evaluate(key=>[JSON.parse(localStorage.getItem(key)),localStorage.getItem("pinball-v1-volume"),localStorage.getItem("pinball-v1-muted")],settingsKey),[old,"0.24","yes"]);
  await page.goto(labUrl.href);
  await waitFor(()=>page.eval("!!document.querySelector('#audioQaPanel')"),"lab did not reload");
  assert.equal((await state()).master,.78);
  assert.equal((await state()).masterMuted,false);
  assert.ok(Object.values((await state()).muted).every(v=>!v));
  status("reset and refresh restore RC.2 defaults, leaving normal storage intact");

  const mobile=await newPage(9354);
  const mobileErrors=[];
  try {
    mobile.on(event=>{
      if(event.method==="Runtime.exceptionThrown") mobileErrors.push(event.params.exceptionDetails.exception?.description);
      if(event.method==="Log.entryAdded"&&event.params.entry.level==="error") mobileErrors.push(event.params.entry.text);
    });
    await mobile.send("Page.enable");
    await mobile.send("Runtime.enable");
    await mobile.send("Log.enable");
    await mobile.viewport(390,844,2,true);
    await mobile.goto(labUrl.href);
    const point=async sel=>mobile.eval(`(() => {const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    async function touch(sel) {
      const p=await point(sel);
      await mobile.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[p]});
      await mobile.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    }
    await touch("#start");
    await waitFor(()=>mobile.eval("__pinballState().shotsFired>0"),"mobile touch did not start game");
    await touch('[data-lab-action="open"]');
    assert.equal(await mobile.eval("document.querySelector('#audioLabControls').hidden"),false);
    assert.equal(await mobile.eval("document.documentElement.scrollWidth===innerWidth"),true);
    await touch('[data-lab-action="all-off"]');
    assert.ok(await mobile.eval("Object.values(PinballGameAudio.getState().muted).every(Boolean)"));
    if(screenshots) await mobile.shot(join(screenshots,"audio-lab-mobile.png"));
    await touch('[data-lab-action="close"]');
    assert.equal(await mobile.eval("document.querySelector('#audioLabControls').hidden"),true);
    const fps=await mobile.eval("new Promise(resolve=>{let n=0;const start=performance.now();function frame(t){n++;if(t-start>=1000)resolve(n*1000/(t-start));else requestAnimationFrame(frame);}requestAnimationFrame(frame);})");
    assert.ok(fps>=30,"mobile sustained FPS "+fps);
    status("390×844 touch, layout, live controls and mobile FPS "+fps.toFixed(1));
    assert.deepEqual(mobileErrors,[]);
  } finally { await mobile.close(); }

  await page.goto(entry);
  assert.equal(await page.eval("document.querySelector('#audioQaPanel')"),null);
  const normal=await state();
  assert.equal(normal.enabled,false);
  assert.equal(normal.masterMuted,true);
  assert.equal(normal.master,.24);
  assert.equal(normal.selected.brick_hit,"v5-wood-light");
  assert.equal((await bgm()).enabled,false);
  assert.equal(await page.eval("performance.getEntriesByType('resource').some(r=>/audio-lab\\.(?:css|js)/.test(r.name))"),false);
  assert.deepEqual(errors,[]);
  status("normal route has baseline behavior and no lab assets; no console or HTTP errors");
} finally {
  await page.close();
  chrome.kill();
}

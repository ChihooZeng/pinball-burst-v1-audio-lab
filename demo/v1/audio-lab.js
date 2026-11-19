(() => {
  "use strict";
  const audio = window.PinballGameAudio;
  if (!audio?.lab) return;
  const lab = audio.lab;
  const id = name => document.getElementById(name);
  const panel = document.createElement("aside");
  panel.id = "audioQaPanel"; // The game already excludes this subtree from button SFX.
  panel.setAttribute("aria-label","音效实验室");
  panel.innerHTML = `
    <button class="lab-launch" type="button" data-lab-action="open" aria-controls="audioLabControls" aria-expanded="false">音效实验室</button>
    <section id="audioLabControls" class="lab-panel" aria-labelledby="audioLabTitle" hidden>
      <header class="lab-head">
        <div><h2 id="audioLabTitle">音效实验室</h2><span>RC.2 · 仅当前会话</span></div>
        <button type="button" data-lab-action="close">收起</button>
      </header>
      <div class="lab-scroll">
        <div class="lab-actions" aria-label="批量控制">
          <button type="button" data-lab-action="all-on">全部开启</button>
          <button type="button" data-lab-action="all-off">全部关闭</button>
          <button type="button" data-lab-action="solo">只听选中</button>
          <button type="button" data-lab-action="defaults">恢复 RC.2 默认</button>
        </div>
        <div class="lab-music">
          <label for="audioLabBgm"><input type="checkbox" id="audioLabBgm"><strong>背景音乐</strong></label>
          <button type="button" data-lab-action="bgm-play">播放</button>
          <button type="button" data-lab-action="bgm-pause">暂停</button>
          <small id="audioLabTrack"></small>
        </div>
        <label class="lab-haptics" for="audioLabHaptics"><input type="checkbox" id="audioLabHaptics"><strong>手机振动</strong><small>由设备支持情况决定</small></label>
        <div class="lab-list-head"><h3>游戏音效</h3><span id="audioLabCount"></span></div>
        <div id="audioLabEvents" class="lab-list" role="group" aria-label="音效选择与开关"></div>
      </div>
      <footer class="lab-footer">
        <div><output id="audioLabStatus" role="status" aria-live="polite">选择音效试听，或进入游戏对比。</output>
          <button type="button" data-lab-action="stop-preview" disabled>停止试听</button></div>
        <a id="audioLabExit">退出实验室</a>
      </footer>
    </section>`;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "./audio-lab.css?v=1";
  css.dataset.optional = "";
  document.head.append(css);
  document.body.append(panel);

  const controls = id("audioLabControls");
  const launcher = panel.querySelector('[data-lab-action="open"]');
  const closer = panel.querySelector('[data-lab-action="close"]');
  const status = id("audioLabStatus");
  const stopPreview = panel.querySelector('[data-lab-action="stop-preview"]');
  const haptics = id("impactHaptic");
  const music = id("audioLabBgm");
  const exit = new URL(location.href);
  exit.searchParams.delete("audio-lab");
  id("audioLabExit").href = exit.href;
  id("audioLabTrack").textContent = audio.BGM.label;

  const labels = {
    brick_hit:"砖块受击", brick_break:"砖块击破", wall_bounce:"撞墙反弹", gun_fire:"机枪发射",
    arc:"连锁电弧", split:"裂变", combo:"连击", giant:"巨型球发射", boss_defeated:"核心击败",
    clear_upgrade:"清屏升级", fail:"触线失败", victory:"通关", ui_start:"开始 / 重开", ui_click:"其他按钮"
  };
  const rows = new Map();
  let selected = "brick_hit";
  let auditionSequence = 0;
  for (const [eventId, name] of Object.entries(labels)) {
    const row = document.createElement("div");
    row.className = "lab-event";
    row.innerHTML = `
      <input type="radio" name="audio-lab-selected" data-lab-select="${eventId}" aria-label="选中${name}">
      <div class="lab-event-title"><strong>${name}</strong><code data-lab-file="${eventId}"></code></div>
      <input type="checkbox" role="switch" data-lab-event="${eventId}" aria-label="${name}开关">
      <button type="button" data-lab-preview="${eventId}" aria-label="试听${name}">试听</button>`;
    const [radio, toggle] = row.querySelectorAll("input");
    const file = row.querySelector("code");
    rows.set(eventId,{radio,toggle,file,row});
    id("audioLabEvents").append(row);
  }

  function render() {
    const {muted,selected:variants} = audio.getState();
    for (const [eventId,{row,radio,toggle,file}] of rows) {
      const variant = audio.EVENTS[eventId].variants.find(item => item.id === variants[eventId]);
      radio.checked = selected === eventId;
      row.classList.toggle("is-selected",radio.checked);
      toggle.checked = !muted[eventId];
      file.textContent = variant.url.split("/").pop();
    }
    id("audioLabCount").textContent = `${Object.values(muted).filter(val=>!val).length} / ${rows.size} 开启`;
    music.checked = audio.getBgmState().enabled;
    id("audioLabHaptics").checked = haptics.checked;
  }

  function stopAudition(message = "已停止试听。") {
    auditionSequence++;
    lab.stopAudition();
    stopPreview.disabled = true;
    status.textContent = message;
  }

  async function audition(eventId) {
    selected = eventId;
    render();
    const name = rows.get(eventId).file.textContent;
    const sequence = ++auditionSequence;
    status.textContent = "试听 · " + name;
    stopPreview.disabled = false;
    try {
      await lab.auditionOriginal(eventId);
      if (sequence === auditionSequence) status.textContent = "试听结束 · " + name;
    } catch (error) {
      if (sequence === auditionSequence) status.textContent = error.message;
    } finally {
      if (sequence === auditionSequence) stopPreview.disabled = true;
    }
  }

  function setAll(on, only) {
    stopAudition(only ? "实战只播放 · " + labels[only] : on ? "游戏音效与背景音乐已开启。" : "游戏音效与背景音乐已关闭。");
    for (const eventId of rows.keys()) audio.setMuted(eventId,!(on || eventId === only));
    lab.setBgmEnabled(on);
    render();
  }

  function changeInput(input,value,eventName) {
    input.value = value;
    input.dispatchEvent(new Event(eventName));
  }

  function restoreDefaults() {
    stopAudition("已恢复 RC.2 默认。");
    selected = "brick_hit";
    lab.reset();
    changeInput(id("soundVolume"),"78","input");
    id("mute").checked = false;
    id("mute").dispatchEvent(new Event("change"));
    haptics.checked = true;
    haptics.dispatchEvent(new Event("change"));
    render();
  }

  function show(open) {
    controls.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute("aria-expanded",String(open));
    if (open) {render();closer.focus({preventScroll:true});}
    else launcher.focus({preventScroll:true});
  }

  const actions = {
    open:()=>show(true),close:()=>show(false),
    "all-on":()=>setAll(true),"all-off":()=>setAll(false),solo:()=>setAll(false,selected),defaults:restoreDefaults,
    "bgm-play":()=>{lab.playBgm();render();},
    "bgm-pause":()=>lab.pauseBgm(),
    "stop-preview":()=>stopAudition()
  };
  panel.addEventListener("click",event => {
    const {labAction,labPreview} = event.target.closest("button")?.dataset || {};
    if (labPreview) void audition(labPreview);
    else actions[labAction]?.();
  });
  panel.addEventListener("change",event => {
    const input = event.target;
    if (input.dataset.labSelect) selected = input.dataset.labSelect;
    if (input.dataset.labEvent) audio.setMuted(input.dataset.labEvent,!input.checked);
    if (input === music) lab.setBgmEnabled(input.checked);
    if (input.id === "audioLabHaptics") {
      haptics.checked = input.checked;
      haptics.dispatchEvent(new Event("change"));
    }
    render();
  });
  haptics.addEventListener("change",render);
  panel.addEventListener("keydown",event => {
    if (event.key !== "Escape" || controls.hidden) return;
    event.stopPropagation();
    show(false);
  });
  render();
})();

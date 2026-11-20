(() => {
  "use strict";
  const audio = window.PinballGameAudio;
  if (!audio?.lab) return;
  const lab = audio.lab;
  const id = name => document.getElementById(name);
  const labels = {
    brick_hit:"砖块受击", brick_break:"砖块击破", wall_bounce:"撞墙反弹", gun_fire:"机枪发射",
    arc:"连锁电弧", split:"裂变", combo:"连击", giant:"巨型球发射", boss_defeated:"核心击败",
    clear_upgrade:"清屏升级", fail:"触线失败", victory:"通关", ui_start:"开始 / 重开", ui_click:"其他按钮"
  };
  const panel = document.createElement("aside");
  panel.id = "audioQaPanel";
  panel.setAttribute("aria-label","音效实验室");
  panel.innerHTML =
    '<button class="lab-launch" type="button" data-lab-action="open" aria-controls="audioLabControls" aria-expanded="false">音效实验室</button>' +
    '<section id="audioLabControls" class="lab-panel" aria-labelledby="audioLabTitle" hidden>' +
      '<header class="lab-head">' +
        '<div><h2 id="audioLabTitle">音效实验室</h2><span>RC.2 · 候选切换 / 实战监听</span></div>' +
        '<button type="button" data-lab-action="close">收起</button>' +
      '</header>' +
      '<div class="lab-scroll">' +
        '<div class="lab-actions" aria-label="批量控制">' +
          '<button type="button" data-lab-action="all-on">全部开启</button>' +
          '<button type="button" data-lab-action="all-off">全部关闭</button>' +
          '<button type="button" data-lab-action="solo">只听选中</button>' +
          '<button type="button" data-lab-action="defaults">恢复 RC.2 默认</button>' +
        '</div>' +
        '<section class="lab-mix" aria-label="总音量">' +
          '<label for="audioLabMasterVolume"><strong>游戏音效总音量</strong><output id="audioLabMasterValue">78%</output></label>' +
          '<input id="audioLabMasterVolume" type="range" min="0" max="100" step="1" value="78">' +
        '</section>' +
        '<section class="lab-music" aria-label="背景音乐">' +
          '<label for="audioLabBgm"><input type="checkbox" id="audioLabBgm"><strong>背景音乐</strong></label>' +
          '<button type="button" data-lab-action="bgm-play">播放</button>' +
          '<button type="button" data-lab-action="bgm-pause">暂停</button>' +
          '<input id="audioLabBgmVolume" type="range" min="0" max="100" step="1" value="80" aria-label="背景音乐音量">' +
          '<output id="audioLabBgmValue">80%</output>' +
          '<small id="audioLabTrack"></small>' +
        '</section>' +
        '<label class="lab-haptics" for="audioLabHaptics"><input type="checkbox" id="audioLabHaptics"><strong>手机振动</strong><small>由设备支持情况决定</small></label>' +
        '<div class="lab-list-head"><h3>游戏音效</h3><span id="audioLabCount"></span></div>' +
        '<p class="lab-guide">切换候选后会同步应用到实战；每类音效可单独调节音量。试听不会计入实战触发次数。</p>' +
        '<div id="audioLabDiagnostics" class="lab-diagnostics" role="status"></div>' +
        '<div id="audioLabEvents" class="lab-list" role="group" aria-label="音效选择、候选与音量"></div>' +
      '</div>' +
      '<footer class="lab-footer">' +
        '<div><output id="audioLabStatus" role="status" aria-live="polite">切换候选试听，或进入游戏查看真实触发。</output>' +
          '<button type="button" data-lab-action="stop-preview" disabled>停止试听</button></div>' +
        '<a id="audioLabExit">退出实验室</a>' +
      '</footer>' +
    '</section>';
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "./audio-lab.css?v=2";
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
  const masterVolume = id("audioLabMasterVolume");
  const bgmVolume = id("audioLabBgmVolume");
  const exit = new URL(location.href);
  exit.searchParams.delete("audio-lab");
  id("audioLabExit").href = exit.href;
  id("audioLabTrack").textContent = audio.BGM.label + " · " + audio.BGM.license;

  const rows = new Map();
  let selected = "brick_hit";
  let auditionSequence = 0;
  let statsTimer = null;

  function makeRow(eventId) {
    const event = audio.EVENTS[eventId];
    const name = labels[eventId] || event.name || eventId;
    const row = document.createElement("article");
    row.className = "lab-event";
    row.dataset.labRow = eventId;
    row.innerHTML =
      '<div class="lab-event-head">' +
        '<input type="radio" name="audio-lab-selected" data-lab-select="' + eventId + '" aria-label="选中' + name + '">' +
        '<div class="lab-event-title"><strong>' + name + '</strong><code data-lab-file="' + eventId + '"></code></div>' +
        '<input type="checkbox" role="switch" data-lab-event="' + eventId + '" aria-label="' + name + '开关">' +
        '<button type="button" data-lab-preview="' + eventId + '" aria-label="试听' + name + '">试听</button>' +
      '</div>' +
      '<label class="lab-event-variant">候选素材<select data-lab-variant="' + eventId + '" aria-label="' + name + '候选素材"></select></label>' +
      '<p class="lab-event-detail" data-lab-detail="' + eventId + '"></p>' +
      '<div class="lab-event-volume">' +
        '<label for="audioLabVolume-' + eventId + '">独立音量</label>' +
        '<input id="audioLabVolume-' + eventId + '" type="range" min="0" max="150" step="1" value="100" data-lab-volume="' + eventId + '">' +
        '<output data-lab-volume-value="' + eventId + '">100%</output>' +
      '</div>' +
      '<div class="lab-event-stats"><span data-lab-stats="' + eventId + '">播放 0 · 冷却丢弃 0 · 静音跳过 0</span><span data-lab-load="' + eventId + '">素材状态检查中</span></div>';

    const select = row.querySelector('[data-lab-variant="' + eventId + '"]');
    const defaultId = event.defaultVariant || event.variants[0].id;
    for (const variant of event.variants) {
      const option = document.createElement("option");
      option.value = variant.id;
      option.textContent = variant.label + (variant.id === defaultId ? "（RC.2 默认）" : "");
      select.append(option);
    }
    if (event.variants.length < 2) select.disabled = true;
    id("audioLabEvents").append(row);
    rows.set(eventId,{
      row,
      radio:row.querySelector('[data-lab-select]'),
      toggle:row.querySelector('[data-lab-event]'),
      preview:row.querySelector('[data-lab-preview]'),
      select,
      file:row.querySelector('[data-lab-file]'),
      detail:row.querySelector('[data-lab-detail]'),
      volume:row.querySelector('[data-lab-volume]'),
      volumeValue:row.querySelector('[data-lab-volume-value]'),
      stats:row.querySelector('[data-lab-stats]'),
      load:row.querySelector('[data-lab-load]')
    });
  }

  for (const eventId of audio.EVENT_IDS) makeRow(eventId);

  function renderStats() {
    const state = audio.getState();
    for (const [eventId,row] of rows) {
      row.stats.textContent =
        "播放 " + (state.plays[eventId] || 0) +
        " · 冷却丢弃 " + (state.drops[eventId] || 0) +
        " · 静音跳过 " + (state.suppressed[eventId] || 0);
      const variantId = state.selected[eventId];
      row.load.textContent = state.loaded.includes(eventId + ":" + variantId) ? "素材已加载" : "素材加载中 / 未加载";
    }
    const errorText = state.lastError ? " · 最近错误：" + state.lastError : "";
    id("audioLabDiagnostics").textContent =
      "音频上下文 " + state.contextState +
      " · 活跃声部 " + state.voices +
      " · 页面隐藏丢弃 " + state.silentDrops +
      " · 加载错误 " + state.errors + errorText;
  }

  function render() {
    const state = audio.getState();
    const bgm = audio.getBgmState();
    for (const [eventId,row] of rows) {
      const event = audio.EVENTS[eventId];
      const variant = event.variants.find(item => item.id === state.selected[eventId]) || event.variants[0];
      row.radio.checked = selected === eventId;
      row.row.classList.toggle("is-selected",row.radio.checked);
      row.toggle.checked = !state.muted[eventId];
      row.select.value = variant.id;
      row.file.textContent = variant.url.split("/").pop();
      row.detail.textContent = variant.detail || event.hint || "固定素材";
      const volume = Math.round((state.volumes[eventId] || 0) * 100);
      row.volume.value = String(volume);
      row.volumeValue.textContent = volume + "%";
    }
    const active = Object.values(state.muted).filter(value => !value).length;
    const candidates = audio.EVENT_IDS.reduce((sum,eventId) => sum + audio.EVENTS[eventId].variants.length,0);
    id("audioLabCount").textContent = audio.EVENT_IDS.length + " 类 · " + candidates + " 个候选 · " + active + " 类开启";
    masterVolume.value = String(Math.round(state.master * 100));
    id("audioLabMasterValue").textContent = Math.round(state.master * 100) + "%";
    music.checked = bgm.enabled;
    bgmVolume.value = String(Math.round(bgm.volume * 100));
    id("audioLabBgmValue").textContent = Math.round(bgm.volume * 100) + "%";
    id("audioLabHaptics").checked = haptics.checked;
    renderStats();
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
    const row = rows.get(eventId);
    const name = row.file.textContent;
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
    stopAudition(only ? "实战只播放 · " + (labels[only] || only) : on ? "游戏音效与背景音乐已开启。" : "游戏音效与背景音乐已关闭。");
    for (const eventId of rows.keys()) audio.setMuted(eventId,!(on || eventId === only));
    lab.setBgmEnabled(on);
    render();
  }

  function changeInput(input,value,eventName) {
    input.value = String(value);
    input.dispatchEvent(new Event(eventName,{bubbles:true}));
  }

  function restoreDefaults() {
    stopAudition("已恢复 RC.2 默认。");
    selected = "brick_hit";
    lab.reset();
    changeInput(id("soundVolume"),"78","input");
    id("mute").checked = false;
    id("mute").dispatchEvent(new Event("change",{bubbles:true}));
    haptics.checked = true;
    haptics.dispatchEvent(new Event("change",{bubbles:true}));
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
    const button = event.target.closest("button");
    if (!button) return;
    const {labAction,labPreview} = button.dataset;
    if (labPreview) void audition(labPreview);
    else if (labAction) actions[labAction]?.();
  });

  panel.addEventListener("input",event => {
    const input = event.target;
    if (input.dataset.labVolume) {
      const eventId = input.dataset.labVolume;
      audio.setGroupVolume(eventId,Number(input.value)/100);
      rows.get(eventId).volumeValue.textContent = input.value + "%";
    } else if (input === masterVolume) {
      const mainVolume = id("soundVolume");
      if (mainVolume) changeInput(mainVolume,input.value,"input");
      else audio.setVolume(Number(input.value)/100);
      id("audioLabMasterValue").textContent = input.value + "%";
    } else if (input === bgmVolume) {
      audio.setBgmVolume(Number(input.value)/100);
      id("audioLabBgmValue").textContent = input.value + "%";
    }
  });

  panel.addEventListener("change",event => {
    const input = event.target;
    if (input.dataset.labSelect) {
      selected = input.dataset.labSelect;
    } else if (input.dataset.labVariant) {
      const eventId = input.dataset.labVariant;
      const wasMuted = audio.getState().muted[eventId];
      stopAudition("已切换候选 · " + input.value);
      audio.stop(eventId);
      audio.setVariant(eventId,input.value);
      if (wasMuted) audio.setMuted(eventId,true);
      selected = eventId;
      render();
      return;
    } else if (input.dataset.labEvent) {
      audio.setMuted(input.dataset.labEvent,!input.checked);
    } else if (input === music) {
      lab.setBgmEnabled(input.checked);
    } else if (input.id === "audioLabHaptics") {
      haptics.checked = input.checked;
      haptics.dispatchEvent(new Event("change",{bubbles:true}));
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
  statsTimer = window.setInterval(renderStats,350);
  window.addEventListener("pagehide",() => {
    if (statsTimer !== null) window.clearInterval(statsTimer);
    stopAudition("页面已离开，试听已停止。");
  },{once:true});
})();
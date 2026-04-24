/* Pelsona — LLM character chat framework
 * Features:
 *  - 4 character slots per chat (slot 0 = self)
 *  - Character preset library (save / load)
 *  - Multiple saved chats (switch, rename, delete)
 *  - World (global) + Situation (per-chat) settings
 *  - Carryover memo for continuation across chats
 *  - Gemini / Anthropic / OpenAI-compatible providers
 */

// ---------- Constants ----------
const SLOT_COUNT = 4;
const LS = {
  presets: "pelsona.presets.v1",
  chats: "pelsona.chats.v1",
  current: "pelsona.current.v1",
  world: "pelsona.world.v1",
  api: "pelsona.api.v1",
  // legacy
  oldChars: "pelsona.chars.v1",
  oldHistory: "pelsona.history.v1",
};

const DEFAULT_API = {
  provider: "gemini",
  key: "",
  base: "",
  model: "gemini-2.5-flash",
  temperature: 0.8,
  maxTokens: 1024,
};

const DEFAULT_MODELS = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-opus-4-7",
  openai: "gpt-4o-mini",
};

const EMPTY_CHAR = () => ({
  name: "", image: "", persona: "", tone: "", greeting: "",
});

// ---------- Helpers ----------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
const now = () => Date.now();

function newSlots() {
  const a = Array.from({ length: SLOT_COUNT }, () => EMPTY_CHAR());
  a[0].name = "自分";
  return a;
}
function makeChat(opts = {}) {
  return {
    id: opts.id || uid(),
    name: opts.name || "新しい会話",
    createdAt: opts.createdAt || now(),
    updatedAt: opts.updatedAt || now(),
    slots: opts.slots || newSlots(),
    selectedIdxs: opts.selectedIdxs || [],
    situation: opts.situation || "",
    carryover: opts.carryover || "",
    history: opts.history || [],
  };
}

// ---------- State ----------
const state = {
  presets: [],
  chats: [],
  currentChatId: "",
  world: { name: "", description: "" },
  api: { ...DEFAULT_API },
  editingSlot: null,
  sending: false,
  drawerTab: "chats",
};
function currentChat() {
  return state.chats.find((c) => c.id === state.currentChatId) || state.chats[0];
}
function setCurrentChat(id) {
  state.currentChatId = id;
  saveCurrent();
}

// ---------- Persistence ----------
function saveChats() { localStorage.setItem(LS.chats, JSON.stringify(state.chats)); }
function saveCurrent() { localStorage.setItem(LS.current, JSON.stringify({ id: state.currentChatId })); }
function savePresets() { localStorage.setItem(LS.presets, JSON.stringify(state.presets)); }
function saveWorld() { localStorage.setItem(LS.world, JSON.stringify(state.world)); }
function saveApi() { localStorage.setItem(LS.api, JSON.stringify(state.api)); }

function touchChat() {
  const c = currentChat();
  if (c) c.updatedAt = now();
  saveChats();
}

function loadAll() {
  try { state.presets = JSON.parse(localStorage.getItem(LS.presets)) || []; } catch { state.presets = []; }
  try { state.chats = JSON.parse(localStorage.getItem(LS.chats)) || []; } catch { state.chats = []; }
  try {
    const w = JSON.parse(localStorage.getItem(LS.world)) || {};
    state.world = { name: "", description: "", ...w };
  } catch { state.world = { name: "", description: "" }; }
  try {
    const a = JSON.parse(localStorage.getItem(LS.api)) || {};
    state.api = { ...DEFAULT_API, ...a };
  } catch { state.api = { ...DEFAULT_API }; }
  try {
    const c = JSON.parse(localStorage.getItem(LS.current)) || {};
    state.currentChatId = c.id || "";
  } catch { state.currentChatId = ""; }

  // Migration from v1 if no chats exist
  if (state.chats.length === 0) {
    let slots = null, history = [];
    try {
      const old = JSON.parse(localStorage.getItem(LS.oldChars));
      if (Array.isArray(old) && old.length === SLOT_COUNT) {
        slots = old.map((c) => ({ ...EMPTY_CHAR(), ...(c || {}) }));
      }
    } catch {}
    try {
      const h = JSON.parse(localStorage.getItem(LS.oldHistory));
      if (Array.isArray(h)) history = h;
    } catch {}
    const chat = makeChat({
      name: history.length ? "以前の会話" : "最初の会話",
      slots: slots || newSlots(),
      history,
    });
    state.chats.push(chat);
    state.currentChatId = chat.id;
    saveChats(); saveCurrent();
  }
  if (!currentChat()) {
    state.currentChatId = state.chats[0].id;
    saveCurrent();
  }
}

// ---------- DOM refs ----------
const slotBar = $("#slotBar");
const messagesEl = $("#messages");
const placeholderEl = $("#placeholder");
const chatNameLabel = $("#chatNameLabel");
const activeLabel = $("#activeLabel");
const inputEl = $("#input");
const composerEl = $("#composer");
const sendBtn = $("#btnSend");
const toastEl = $("#toast");

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

// ---------- Modal helpers ----------
function showModal(el) { el.classList.remove("hidden"); }
function hideModal(el) { el.classList.add("hidden"); }

// ---------- Top bar / chat label ----------
function renderTopbar() {
  const chat = currentChat();
  chatNameLabel.textContent = chat ? chat.name : "(未選択)";
  updateActiveLabel();
}
function updateActiveLabel() {
  const chat = currentChat();
  if (!chat || !chat.selectedIdxs.length) {
    activeLabel.textContent = "キャラ未選択";
    return;
  }
  const names = chat.selectedIdxs.map((i) => chat.slots[i]?.name || `CH${i}`).join(" / ");
  activeLabel.textContent = `会話中: ${names}`;
}

// ---------- Slots ----------
function renderSlots() {
  const chat = currentChat();
  slotBar.innerHTML = "";
  if (!chat) return;
  chat.slots.forEach((ch, idx) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    if (idx === 0) slot.classList.add("self");
    if (chat.selectedIdxs.includes(idx)) slot.classList.add("selected");
    slot.dataset.idx = String(idx);

    if (ch.image) {
      const img = document.createElement("div");
      img.className = "slot-img";
      img.style.backgroundImage = `url("${ch.image}")`;
      slot.appendChild(img);
    } else {
      const empty = document.createElement("div");
      empty.className = "slot-empty";
      const icon = document.createElement("div");
      icon.className = "slot-empty-icon";
      icon.textContent = idx === 0 ? "👤" : "＋";
      const label = document.createElement("div");
      label.textContent = idx === 0 ? "自分" : "空き枠";
      empty.appendChild(icon);
      empty.appendChild(label);
      slot.appendChild(empty);
    }

    if (ch.name) {
      const name = document.createElement("div");
      name.className = "slot-name";
      name.textContent = ch.name;
      slot.appendChild(name);
    }

    const badge = document.createElement("div");
    badge.className = "slot-badge";
    badge.textContent = idx === 0 ? "YOU" : `CH${idx}`;
    slot.appendChild(badge);

    const editBtn = document.createElement("button");
    editBtn.className = "slot-edit";
    editBtn.type = "button";
    editBtn.textContent = "✎";
    editBtn.title = "編集";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCharModal(idx);
    });
    slot.appendChild(editBtn);

    slot.addEventListener("click", () => onSlotClick(idx));
    slot.addEventListener("dblclick", () => openCharModal(idx));
    slotBar.appendChild(slot);
  });
  updateActiveLabel();
}

function onSlotClick(idx) {
  const chat = currentChat();
  if (!chat) return;
  const ch = chat.slots[idx];
  if (idx === 0) { openCharModal(0); return; }
  const empty = !ch.name && !ch.persona && !ch.tone && !ch.image;
  if (empty) { openCharModal(idx); return; }
  const set = new Set(chat.selectedIdxs);
  if (set.has(idx)) set.delete(idx); else set.add(idx);
  chat.selectedIdxs = [...set].sort((a, b) => a - b);
  touchChat();
  renderSlots();
}

// ---------- Messages ----------
function renderMessages() {
  const chat = currentChat();
  messagesEl.innerHTML = "";
  if (!chat || chat.history.length === 0) {
    placeholderEl.style.display = "flex";
  } else {
    placeholderEl.style.display = "none";
    for (const m of chat.history) appendMessageEl(m);
  }
  scrollMessagesToBottom();
}
function appendMessageEl(m) {
  const chat = currentChat();
  const wrap = document.createElement("div");
  wrap.className = "msg";
  if (m.role === "user") wrap.classList.add("me");
  if (m.role === "system") wrap.classList.add("system");
  if (m.role === "error") wrap.classList.add("error");

  if (m.role !== "system" && m.role !== "error") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const ch = findCharFor(m, chat);
    if (ch && ch.image) {
      avatar.style.backgroundImage = `url("${ch.image}")`;
    } else {
      avatar.textContent = (ch && ch.name ? ch.name : (m.role === "user" ? "自" : "?"))[0] || "?";
    }
    wrap.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "msg-body";
  const name = document.createElement("div");
  name.className = "name";
  if (m.role === "user") name.textContent = (chat?.slots[0].name) || "自分";
  else if (m.role === "assistant") name.textContent = m.name || "assistant";
  if (name.textContent) body.appendChild(name);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.typing) bubble.classList.add("typing");
  bubble.textContent = m.content;
  body.appendChild(bubble);
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
}
function findCharFor(m, chat) {
  if (!chat) return null;
  if (m.role === "user") return chat.slots[0];
  if (m.role === "assistant" && m.name) {
    return chat.slots.find((c, i) => i !== 0 && c.name === m.name) || null;
  }
  return null;
}
function scrollMessagesToBottom() {
  const chatEl = $("#chatArea");
  chatEl.scrollTop = chatEl.scrollHeight;
}
function pushMessage(m) {
  const chat = currentChat();
  if (!chat) return;
  chat.history.push(m);
  touchChat();
  appendMessageEl(m);
  placeholderEl.style.display = "none";
  scrollMessagesToBottom();
}

// ---------- Drawer ----------
const drawerEl = $("#drawer");
function openDrawer(tab) {
  if (tab) state.drawerTab = tab;
  showModal(drawerEl);
  switchDrawerTab(state.drawerTab);
}
function switchDrawerTab(name) {
  state.drawerTab = name;
  $$(".drawer-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".drawer-section").forEach((s) => s.classList.toggle("active", s.dataset.panel === name));
  if (name === "chats") renderChatsList();
  if (name === "presets") renderPresetList();
  if (name === "world") renderWorldForm();
  if (name === "api") renderApiForm();
}
$$(".drawer-tab").forEach((b) => b.addEventListener("click", () => switchDrawerTab(b.dataset.tab)));
$("#btnMenu").addEventListener("click", () => openDrawer(state.drawerTab || "chats"));
drawerEl.addEventListener("click", (e) => { if (e.target === drawerEl) hideModal(drawerEl); });

// ---------- Chats list ----------
function renderChatsList() {
  const list = $("#chatList");
  list.innerHTML = "";
  const sorted = [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!sorted.length) {
    list.innerHTML = '<div class="list-empty">まだチャットがありません。「＋ 新しい会話」で作成してください。</div>';
    return;
  }
  for (const c of sorted) {
    const item = document.createElement("div");
    item.className = "list-item" + (c.id === state.currentChatId ? " active" : "");

    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = c.name || "(無題)";
    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    const last = c.history.length ? c.history[c.history.length - 1].content.slice(0, 40) : "(メッセージなし)";
    sub.textContent = `${new Date(c.updatedAt).toLocaleString()} · ${last}`;
    main.appendChild(title); main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    const renameBtn = document.createElement("button");
    renameBtn.className = "icon-btn"; renameBtn.title = "名前変更"; renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", (e) => { e.stopPropagation(); renameChat(c.id); });
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn"; delBtn.title = "削除"; delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteChat(c.id); });
    actions.appendChild(renameBtn); actions.appendChild(delBtn);

    item.appendChild(main); item.appendChild(actions);
    item.addEventListener("click", () => {
      setCurrentChat(c.id);
      renderAll();
      hideModal(drawerEl);
    });
    list.appendChild(item);
  }
}
function renameChat(id) {
  const c = state.chats.find((x) => x.id === id);
  if (!c) return;
  const name = prompt("新しいチャット名", c.name);
  if (name == null) return;
  c.name = name.trim() || c.name;
  c.updatedAt = now();
  saveChats();
  renderChatsList();
  renderTopbar();
}
function deleteChat(id) {
  if (state.chats.length <= 1) { toast("最後のチャットは削除できません"); return; }
  const c = state.chats.find((x) => x.id === id);
  if (!c) return;
  if (!confirm(`「${c.name}」を削除しますか？`)) return;
  state.chats = state.chats.filter((x) => x.id !== id);
  if (state.currentChatId === id) state.currentChatId = state.chats[0].id;
  saveChats(); saveCurrent();
  renderAll();
  toast("削除しました");
}

// ---------- Preset list (drawer) ----------
function renderPresetList() {
  const list = $("#presetList");
  list.innerHTML = "";
  if (!state.presets.length) {
    list.innerHTML = '<div class="list-empty">プリセットがありません。キャラ編集画面の「プリセットに保存」から登録できます。</div>';
    return;
  }
  for (const p of state.presets) {
    const item = document.createElement("div");
    item.className = "list-item";
    const av = document.createElement("div");
    av.className = "list-item-avatar";
    if (p.image) av.style.backgroundImage = `url("${p.image}")`;
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("div");
    title.className = "list-item-title";
    title.textContent = p.name || "(無名)";
    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    sub.textContent = (p.persona || "").slice(0, 60) || "(設定なし)";
    main.appendChild(title); main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "list-item-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn"; delBtn.title = "削除"; delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(p.id); });
    actions.appendChild(delBtn);

    item.appendChild(av); item.appendChild(main); item.appendChild(actions);
    list.appendChild(item);
  }
}
function deletePreset(id) {
  const p = state.presets.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
  state.presets = state.presets.filter((x) => x.id !== id);
  savePresets();
  renderPresetList();
  toast("削除しました");
}

// ---------- World form ----------
function renderWorldForm() {
  $("#worldName").value = state.world.name || "";
  $("#worldDescription").value = state.world.description || "";
}
$("#btnSaveWorld").addEventListener("click", () => {
  state.world = {
    name: $("#worldName").value.trim(),
    description: $("#worldDescription").value.trim(),
  };
  saveWorld();
  toast("世界観を保存しました");
});

// ---------- API form ----------
function renderApiForm() {
  $("#apiProvider").value = state.api.provider;
  $("#apiKey").value = state.api.key;
  $("#apiBase").value = state.api.base;
  $("#apiModel").value = state.api.model;
  $("#apiTemp").value = state.api.temperature;
  $("#apiMaxTokens").value = state.api.maxTokens;
}
$("#apiProvider").addEventListener("change", () => {
  const cur = $("#apiModel").value.trim();
  const defaults = Object.values(DEFAULT_MODELS);
  if (!cur || defaults.includes(cur)) {
    $("#apiModel").value = DEFAULT_MODELS[$("#apiProvider").value] || "";
  }
});
$("#apiSave").addEventListener("click", () => {
  const provider = $("#apiProvider").value;
  state.api = {
    provider,
    key: $("#apiKey").value.trim(),
    base: $("#apiBase").value.trim(),
    model: $("#apiModel").value.trim() || DEFAULT_MODELS[provider] || DEFAULT_API.model,
    temperature: Number($("#apiTemp").value) || 0.8,
    maxTokens: Math.max(64, Math.min(8192, Number($("#apiMaxTokens").value) || 1024)),
  };
  saveApi();
  toast("API設定を保存しました");
});

// ---------- Character modal ----------
const charModal = $("#charModal");
let editingImage = "";

function openCharModal(idx) {
  state.editingSlot = idx;
  const chat = currentChat();
  const ch = chat.slots[idx];
  const isSelf = idx === 0;
  $("#charModalTitle").textContent = isSelf ? "あなた (自分) の設定" : `キャラクター ${idx} の設定`;
  $("#charName").value = ch.name || "";
  $("#charPersona").value = ch.persona || "";
  $("#charTone").value = ch.tone || "";
  $("#charGreeting").value = ch.greeting || "";
  editingImage = ch.image || "";
  updateAvatarPreview();

  $("#personaField").style.display = isSelf ? "none" : "";
  $("#toneField").style.display = isSelf ? "none" : "";
  $("#greetingField").style.display = isSelf ? "none" : "";
  $("#charDelete").style.display = isSelf ? "none" : "";
  $("#presetControls").style.display = isSelf ? "none" : "";

  showModal(charModal);
  $("#charName").focus();
}

function updateAvatarPreview() {
  const el = $("#avatarPreview");
  if (editingImage) {
    el.style.backgroundImage = `url("${editingImage}")`;
  } else {
    el.style.backgroundImage = "";
  }
}

$("#avatarFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    editingImage = await fileToResizedDataURL(file, 512);
    updateAvatarPreview();
  } catch (err) {
    toast("画像の読込に失敗しました");
  }
  e.target.value = "";
});
$("#avatarClear").addEventListener("click", () => {
  editingImage = "";
  updateAvatarPreview();
});
$("#charSave").addEventListener("click", () => {
  const idx = state.editingSlot;
  if (idx == null) return;
  const chat = currentChat();
  const isSelf = idx === 0;
  const prev = chat.slots[idx];
  const next = {
    name: $("#charName").value.trim(),
    image: editingImage,
    persona: isSelf ? "" : $("#charPersona").value.trim(),
    tone: isSelf ? "" : $("#charTone").value.trim(),
    greeting: isSelf ? "" : $("#charGreeting").value.trim(),
  };
  chat.slots[idx] = next;
  touchChat();
  renderSlots();
  hideModal(charModal);
  // greeting auto-post if newly added
  if (!isSelf && next.greeting && next.greeting !== prev.greeting && !chat.history.some((m) => m.content === next.greeting)) {
    pushMessage({ role: "assistant", name: next.name || `CH${idx}`, content: next.greeting });
  }
});
$("#charDelete").addEventListener("click", () => {
  const idx = state.editingSlot;
  if (idx == null || idx === 0) return;
  const chat = currentChat();
  chat.slots[idx] = EMPTY_CHAR();
  chat.selectedIdxs = chat.selectedIdxs.filter((i) => i !== idx);
  touchChat();
  renderSlots();
  hideModal(charModal);
});

// ---------- Preset picker / save ----------
$("#btnLoadPreset").addEventListener("click", () => {
  renderPresetPickerList();
  showModal($("#presetPickerModal"));
});
$("#btnSavePreset").addEventListener("click", () => {
  $("#savePresetName").value = $("#charName").value.trim() || "";
  showModal($("#savePresetModal"));
});
$("#savePresetConfirm").addEventListener("click", () => {
  const name = $("#savePresetName").value.trim();
  if (!name) { toast("名前を入力してください"); return; }
  const payload = {
    name,
    image: editingImage,
    persona: $("#charPersona").value.trim(),
    tone: $("#charTone").value.trim(),
    greeting: $("#charGreeting").value.trim(),
  };
  const existing = state.presets.find((p) => p.name === name);
  if (existing) {
    Object.assign(existing, payload, { updatedAt: now() });
  } else {
    state.presets.push({ id: uid(), createdAt: now(), updatedAt: now(), ...payload });
  }
  savePresets();
  hideModal($("#savePresetModal"));
  toast(existing ? "上書き保存しました" : "プリセットに保存しました");
});
function renderPresetPickerList() {
  const list = $("#presetPickerList");
  list.innerHTML = "";
  if (!state.presets.length) {
    list.innerHTML = '<div class="list-empty">プリセットがありません。</div>';
    return;
  }
  for (const p of state.presets) {
    const card = document.createElement("div");
    card.className = "preset-card";
    const img = document.createElement("div");
    img.className = "preset-card-img";
    if (p.image) img.style.backgroundImage = `url("${p.image}")`;
    else img.textContent = "🙂";
    const name = document.createElement("div");
    name.className = "preset-card-name";
    name.textContent = p.name;
    card.appendChild(img); card.appendChild(name);
    card.addEventListener("click", () => {
      $("#charName").value = p.name || "";
      $("#charPersona").value = p.persona || "";
      $("#charTone").value = p.tone || "";
      $("#charGreeting").value = p.greeting || "";
      editingImage = p.image || "";
      updateAvatarPreview();
      hideModal($("#presetPickerModal"));
      toast("プリセットを読み込みました");
    });
    list.appendChild(card);
  }
}

// ---------- Image resizer ----------
function fileToResizedDataURL(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像の読込に失敗しました"));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Chat meta modal ----------
const chatMetaModal = $("#chatMetaModal");
$("#btnChatMeta").addEventListener("click", openChatMetaModal);
function openChatMetaModal() {
  const c = currentChat();
  if (!c) return;
  $("#chatNameInput").value = c.name || "";
  $("#chatSituation").value = c.situation || "";
  $("#chatCarryover").value = c.carryover || "";
  showModal(chatMetaModal);
}
$("#chatMetaSave").addEventListener("click", () => {
  const c = currentChat();
  if (!c) return;
  c.name = $("#chatNameInput").value.trim() || c.name;
  c.situation = $("#chatSituation").value.trim();
  c.carryover = $("#chatCarryover").value.trim();
  c.updatedAt = now();
  saveChats();
  hideModal(chatMetaModal);
  renderTopbar();
  toast("チャット設定を保存しました");
});
$("#chatDelete").addEventListener("click", () => {
  const c = currentChat();
  if (!c) return;
  hideModal(chatMetaModal);
  deleteChat(c.id);
});

// ---------- New chat modal ----------
const newChatModal = $("#newChatModal");
$("#btnNewChat").addEventListener("click", () => {
  $("#newChatName").value = "";
  $("#newChatSlotsSource").value = "current";
  $("#newChatSituation").value = "";
  $("#newChatCarryover").value = "";
  showModal(newChatModal);
  $("#newChatName").focus();
});
$("#btnFillCarryover").addEventListener("click", () => {
  const c = currentChat();
  if (!c || !c.history.length) { toast("引用できる履歴がありません"); return; }
  const last = c.history.slice(-8)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      if (m.role === "user") return `${c.slots[0].name || "自分"}: ${m.content}`;
      return `${m.name || "assistant"}: ${m.content}`;
    }).join("\n");
  $("#newChatCarryover").value = last;
});
$("#newChatCreate").addEventListener("click", () => {
  const cur = currentChat();
  const name = $("#newChatName").value.trim() || "新しい会話";
  const src = $("#newChatSlotsSource").value;
  let slots;
  if (src === "current" && cur) {
    slots = cur.slots.map((s) => ({ ...s }));
  } else {
    slots = newSlots();
  }
  const chat = makeChat({
    name,
    slots,
    situation: $("#newChatSituation").value.trim(),
    carryover: $("#newChatCarryover").value.trim(),
  });
  state.chats.push(chat);
  setCurrentChat(chat.id);
  saveChats();
  hideModal(newChatModal);
  hideModal(drawerEl);
  renderAll();
  toast("新しい会話を作成しました");
});

// ---------- Modal close + esc ----------
$$("[data-close]").forEach((b) => {
  b.addEventListener("click", () => {
    const id = b.dataset.close;
    const target = document.getElementById(id);
    if (target) hideModal(target);
  });
});
$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) hideModal(m); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $$(".modal:not(.hidden)").forEach(hideModal);
    if (!drawerEl.classList.contains("hidden")) hideModal(drawerEl);
  }
});

// ---------- Composer ----------
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composerEl.requestSubmit();
  }
});
composerEl.addEventListener("submit", async (e) => { e.preventDefault(); await onSend(); });

async function onSend() {
  if (state.sending) return;
  const text = inputEl.value.trim();
  if (!text) return;
  const chat = currentChat();
  if (!chat) return;
  if (!chat.selectedIdxs.length) {
    pushMessage({ role: "system", content: "下のスロットから会話するキャラを選んでください。" });
    return;
  }
  if (!state.api.key) {
    pushMessage({ role: "system", content: "API キーが未設定です。右上の「☰」→「⚙ API」から設定してください。" });
    return;
  }
  inputEl.value = "";
  inputEl.style.height = "auto";
  pushMessage({ role: "user", content: text });

  const typing = { role: "assistant", name: "…", content: "考え中…", typing: true };
  chat.history.push(typing);
  appendMessageEl(typing);
  scrollMessagesToBottom();

  state.sending = true;
  sendBtn.disabled = true;
  try {
    const reply = await callLLM();
    chat.history.pop(); // remove typing
    saveChats();
    renderMessages();
    for (const m of parseReply(reply, chat)) pushMessage(m);
  } catch (err) {
    chat.history.pop();
    saveChats();
    renderMessages();
    pushMessage({ role: "error", content: "エラー: " + (err?.message || String(err)) });
  } finally {
    state.sending = false;
    sendBtn.disabled = false;
  }
}

// ---------- Prompt builder ----------
function buildSystemPrompt() {
  const chat = currentChat();
  const selected = chat.selectedIdxs.map((i) => ({ ...chat.slots[i], idx: i }));
  const self = chat.slots[0];
  const parts = [];

  if (state.world.name || state.world.description) {
    parts.push("# 世界観");
    if (state.world.name) parts.push(`タイトル: ${state.world.name}`);
    if (state.world.description) parts.push(state.world.description);
  }
  if (chat.situation) {
    parts.push("# 今回のシチュエーション");
    parts.push(chat.situation);
  }
  if (chat.carryover) {
    parts.push("# 前回までの流れ");
    parts.push(chat.carryover);
  }

  const selfLine = self.name ? `ユーザー (対話相手) の名前は「${self.name}」。` : "";

  if (selected.length === 1) {
    const c = selected[0];
    parts.push("# 演じるキャラクター");
    parts.push(`名前: ${c.name || `CH${c.idx}`}`);
    if (c.persona) parts.push(`人格・背景:\n${c.persona}`);
    if (c.tone) parts.push(`口調:\n${c.tone}`);
    if (selfLine) parts.push(selfLine);
    parts.push("常にこのキャラクターとして応答してください。ナレーションやメタ発言を避け、台詞のみを返してください。");
  } else {
    const blocks = selected.map((c) => {
      const lines = [`## ${c.name || `CH${c.idx}`}`];
      if (c.persona) lines.push(`設定: ${c.persona}`);
      if (c.tone) lines.push(`口調: ${c.tone}`);
      return lines.join("\n");
    }).join("\n\n");
    const names = selected.map((c) => c.name || `CH${c.idx}`).join(", ");
    parts.push("# 演じるキャラクター (複数)");
    parts.push(`以下の全員を同時に演じてください: ${names}`);
    parts.push(blocks);
    if (selfLine) parts.push(selfLine);
    parts.push("# 応答ルール");
    parts.push("- キャラごとの発言を次の形式で、1 行ずつ書いてください:\n  [キャラ名] 発言内容");
    parts.push("- 1 ターンに 0 人〜全員まで自由に発言して構いません。話す必要のないキャラは行を省略。");
    parts.push("- [キャラ名] の名前は上の表記と完全一致させてください。ナレーションやメタ発言は書かないでください。");
  }
  return parts.join("\n\n");
}

function buildHistoryForAPI() {
  const chat = currentChat();
  return chat.history
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.typing)
    .map((m) => {
      if (m.role === "user") return { role: "user", content: m.content };
      const prefix = m.name ? `[${m.name}] ` : "";
      return { role: "assistant", content: prefix + m.content };
    });
}

// ---------- LLM providers ----------
async function callLLM() {
  const system = buildSystemPrompt();
  const messages = buildHistoryForAPI();
  if (state.api.provider === "gemini") return await callGemini(system, messages);
  if (state.api.provider === "anthropic") return await callAnthropic(system, messages);
  return await callOpenAI(system, messages);
}

async function callGemini(system, messages) {
  const base = (state.api.base || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = encodeURIComponent(state.api.model);
  const url = `${base}/models/${model}:generateContent`;
  const trimmed = [...messages];
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: state.api.temperature, maxOutputTokens: state.api.maxTokens },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": state.api.key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text && cand?.finishReason && cand.finishReason !== "STOP") {
    throw new Error(`Gemini 応答が空です (finishReason: ${cand.finishReason})`);
  }
  return text;
}

async function callAnthropic(system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.api.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: state.api.model,
      max_tokens: state.api.maxTokens,
      temperature: state.api.temperature,
      system,
      messages: messages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

async function callOpenAI(system, messages) {
  const base = (state.api.base || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${state.api.key}` },
    body: JSON.stringify({
      model: state.api.model,
      temperature: state.api.temperature,
      max_tokens: state.api.maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ---------- Reply parser ----------
function parseReply(text, chat) {
  if (!text) return [{ role: "assistant", name: defaultSpeakerName(chat), content: "(無言)" }];
  const selected = chat.selectedIdxs.map((i) => chat.slots[i]);
  const known = selected.map((c) => c.name).filter(Boolean);
  if (selected.length === 1) {
    return [{ role: "assistant", name: selected[0].name || "CH", content: cleanLine(text) }];
  }
  const lines = text.split(/\r?\n/);
  const msgs = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) cur.content += "\n"; continue; }
    const m = line.match(/^\[([^\]]+)\]\s*[:：]?\s*(.*)$/);
    if (m) {
      if (cur) msgs.push(cur);
      cur = { role: "assistant", name: resolveName(m[1].trim(), known), content: m[2] || "" };
    } else {
      if (cur) cur.content += (cur.content ? "\n" : "") + line;
      else cur = { role: "assistant", name: known[0] || "assistant", content: line };
    }
  }
  if (cur) msgs.push(cur);
  return msgs.map((m) => ({ ...m, content: m.content.trim() })).filter((m) => m.content.length > 0);
}
function resolveName(name, known) {
  if (known.includes(name)) return name;
  const hit = known.find((n) => n && (name.includes(n) || n.includes(name)));
  return hit || name;
}
function defaultSpeakerName(chat) {
  const first = chat.selectedIdxs[0];
  if (first == null) return "assistant";
  return chat.slots[first]?.name || `CH${first}`;
}
function cleanLine(text) {
  return text.replace(/^\s*\[[^\]]+\]\s*[:：]?\s*/, "").trim();
}

// ---------- Init ----------
function renderAll() {
  renderTopbar();
  renderSlots();
  renderMessages();
}

function init() {
  loadAll();
  renderAll();
  if (!state.api.key) {
    pushMessage({
      role: "system",
      content: "最初に右上「☰」→「⚙ API」から API キーを設定してください。続いて下のスロットでキャラを作成し、選択して会話を始めます。",
    });
  }
}
init();

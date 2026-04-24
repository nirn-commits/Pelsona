/* Pelsona — LLM character chat framework
 * Single-page app. State persists in localStorage.
 * Slot 0 = self (user). Slots 1..3 = NPC characters.
 */

const SLOT_COUNT = 4;
const LS_CHARS = "pelsona.chars.v1";
const LS_API = "pelsona.api.v1";
const LS_HISTORY = "pelsona.history.v1";

const DEFAULT_API = {
  provider: "gemini",
  key: "",
  base: "",
  model: "gemini-2.5-flash",
  temperature: 0.8,
  maxTokens: 1024,
};

const DEFAULT_MODEL_BY_PROVIDER = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-opus-4-7",
  openai: "gpt-4o-mini",
};

const EMPTY_CHAR = () => ({
  name: "",
  image: "", // data URL
  persona: "",
  tone: "",
  greeting: "",
});

const state = {
  chars: loadChars(),
  api: loadApi(),
  selected: new Set(), // indices of selected NPC slots (1..3)
  history: loadHistory(), // array of {role: 'user'|'assistant', name?, content}
  sending: false,
  editingSlot: null,
};

// ---------- Persistence ----------
function loadChars() {
  try {
    const raw = localStorage.getItem(LS_CHARS);
    if (!raw) throw 0;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== SLOT_COUNT) throw 0;
    return parsed.map((c, i) => ({ ...EMPTY_CHAR(), ...(c || {}), isSelf: i === 0 }));
  } catch {
    const arr = Array.from({ length: SLOT_COUNT }, () => EMPTY_CHAR());
    arr[0].name = "自分";
    arr[0].isSelf = true;
    return arr;
  }
}
function saveChars() { localStorage.setItem(LS_CHARS, JSON.stringify(state.chars)); }

function loadApi() {
  try {
    return { ...DEFAULT_API, ...JSON.parse(localStorage.getItem(LS_API) || "{}") };
  } catch { return { ...DEFAULT_API }; }
}
function saveApi() { localStorage.setItem(LS_API, JSON.stringify(state.api)); }

function loadHistory() {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveHistory() { localStorage.setItem(LS_HISTORY, JSON.stringify(state.history)); }

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const slotBar = $("#slotBar");
const messagesEl = $("#messages");
const placeholderEl = $("#placeholder");
const inputEl = $("#input");
const composerEl = $("#composer");
const sendBtn = $("#btnSend");
const activeLabel = $("#activeLabel");

// ---------- Slots ----------
function renderSlots() {
  slotBar.innerHTML = "";
  state.chars.forEach((ch, idx) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    if (idx === 0) slot.classList.add("self");
    if (state.selected.has(idx)) slot.classList.add("selected");
    slot.dataset.idx = String(idx);

    if (ch.image) {
      const img = document.createElement("div");
      img.className = "slot-img";
      img.style.backgroundImage = `url("${ch.image}")`;
      slot.appendChild(img);
    } else {
      const empty = document.createElement("div");
      empty.className = "slot-empty";
      empty.textContent = idx === 0 ? "自分\n(クリックで編集)" : "空き枠\n(クリックで設定)";
      empty.style.whiteSpace = "pre-line";
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
  const ch = state.chars[idx];
  // Self slot: edit only
  if (idx === 0) {
    openCharModal(0);
    return;
  }
  // Empty NPC slot: open editor
  if (!ch.name && !ch.persona && !ch.tone && !ch.image) {
    openCharModal(idx);
    return;
  }
  // Toggle selection
  if (state.selected.has(idx)) {
    state.selected.delete(idx);
  } else {
    state.selected.add(idx);
  }
  renderSlots();
  renderMessages();
}

function updateActiveLabel() {
  if (state.selected.size === 0) {
    activeLabel.textContent = "キャラ未選択";
    return;
  }
  const names = [...state.selected]
    .map((i) => state.chars[i].name || `CH${i}`)
    .join(" / ");
  activeLabel.textContent = `会話中: ${names}`;
}

// ---------- Messages ----------
function renderMessages() {
  messagesEl.innerHTML = "";
  if (state.history.length === 0) {
    placeholderEl.style.display = "flex";
  } else {
    placeholderEl.style.display = "none";
  }
  for (const m of state.history) appendMessageEl(m);
  scrollMessagesToBottom();
}

function appendMessageEl(m) {
  const wrap = document.createElement("div");
  wrap.className = "msg";
  if (m.role === "user") wrap.classList.add("me");
  if (m.role === "system") wrap.classList.add("system");
  if (m.role === "error") wrap.classList.add("error");

  if (m.role !== "system" && m.role !== "error") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const ch = findCharFor(m);
    if (ch && ch.image) {
      avatar.style.backgroundImage = `url("${ch.image}")`;
    } else {
      avatar.textContent = (ch && ch.name ? ch.name : (m.role === "user" ? "自" : "?"))[0] || "?";
    }
    wrap.appendChild(avatar);
  }

  const body = document.createElement("div");
  const name = document.createElement("div");
  name.className = "name";
  if (m.role === "user") name.textContent = state.chars[0].name || "自分";
  else if (m.role === "assistant") name.textContent = m.name || "assistant";
  else name.textContent = "";
  if (name.textContent) body.appendChild(name);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.typing) bubble.classList.add("typing");
  bubble.textContent = m.content;
  body.appendChild(bubble);
  wrap.appendChild(body);

  messagesEl.appendChild(wrap);
}

function findCharFor(m) {
  if (m.role === "user") return state.chars[0];
  if (m.role === "assistant" && m.name) {
    return state.chars.find((c, i) => i !== 0 && c.name === m.name) || null;
  }
  return null;
}

function scrollMessagesToBottom() {
  const chat = $("#chatArea");
  chat.scrollTop = chat.scrollHeight;
}

function pushMessage(m) {
  state.history.push(m);
  saveHistory();
  appendMessageEl(m);
  placeholderEl.style.display = "none";
  scrollMessagesToBottom();
}

// ---------- Character modal ----------
const charModal = $("#charModal");
const charModalTitle = $("#charModalTitle");
const charName = $("#charName");
const charPersona = $("#charPersona");
const charTone = $("#charTone");
const charGreeting = $("#charGreeting");
const avatarPreview = $("#avatarPreview");
const avatarFile = $("#avatarFile");

let editingImage = "";

function openCharModal(idx) {
  state.editingSlot = idx;
  const ch = state.chars[idx];
  const isSelf = idx === 0;
  charModalTitle.textContent = isSelf
    ? "あなた (自分)の設定"
    : `キャラクター ${idx} の設定`;
  charName.value = ch.name || "";
  charPersona.value = ch.persona || "";
  charTone.value = ch.tone || "";
  charGreeting.value = ch.greeting || "";
  editingImage = ch.image || "";
  avatarPreview.style.backgroundImage = editingImage ? `url("${editingImage}")` : "";

  // Hide persona/tone/greeting for self slot
  $("#personaField").style.display = isSelf ? "none" : "";
  $("#toneField").style.display = isSelf ? "none" : "";
  $("#greetingField").style.display = isSelf ? "none" : "";
  $("#charDelete").style.display = isSelf ? "none" : "";

  showModal(charModal);
  charName.focus();
}

function saveCharFromModal() {
  const idx = state.editingSlot;
  if (idx == null) return;
  const isSelf = idx === 0;
  const newCh = {
    name: charName.value.trim(),
    image: editingImage,
    persona: isSelf ? "" : charPersona.value.trim(),
    tone: isSelf ? "" : charTone.value.trim(),
    greeting: isSelf ? "" : charGreeting.value.trim(),
    isSelf,
  };
  const prev = state.chars[idx];
  state.chars[idx] = newCh;
  saveChars();
  renderSlots();
  hideModal(charModal);

  // If a brand-new NPC with a greeting, show it as an assistant message
  if (!isSelf && newCh.greeting && !prev.greeting) {
    pushMessage({ role: "assistant", name: newCh.name || `CH${idx}`, content: newCh.greeting });
  }
}

function clearSlot() {
  const idx = state.editingSlot;
  if (idx == null || idx === 0) return;
  state.chars[idx] = { ...EMPTY_CHAR(), isSelf: false };
  state.selected.delete(idx);
  saveChars();
  renderSlots();
  hideModal(charModal);
}

avatarFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await fileToResizedDataURL(file, 512);
  editingImage = dataUrl;
  avatarPreview.style.backgroundImage = `url("${dataUrl}")`;
  avatarFile.value = "";
});

$("#avatarClear").addEventListener("click", () => {
  editingImage = "";
  avatarPreview.style.backgroundImage = "";
});

$("#charSave").addEventListener("click", saveCharFromModal);
$("#charDelete").addEventListener("click", clearSlot);

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
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- API modal ----------
const apiModal = $("#apiModal");
const apiProvider = $("#apiProvider");
const apiKey = $("#apiKey");
const apiBase = $("#apiBase");
const apiModel = $("#apiModel");
const apiTemp = $("#apiTemp");
const apiMaxTokens = $("#apiMaxTokens");

function openApiModal() {
  apiProvider.value = state.api.provider;
  apiKey.value = state.api.key;
  apiBase.value = state.api.base;
  apiModel.value = state.api.model;
  apiTemp.value = state.api.temperature;
  apiMaxTokens.value = state.api.maxTokens;
  showModal(apiModal);
}

$("#apiSave").addEventListener("click", () => {
  const provider = apiProvider.value;
  state.api = {
    provider,
    key: apiKey.value.trim(),
    base: apiBase.value.trim(),
    model: apiModel.value.trim() || DEFAULT_MODEL_BY_PROVIDER[provider] || DEFAULT_API.model,
    temperature: Number(apiTemp.value) || 0.8,
    maxTokens: Math.max(64, Math.min(8192, Number(apiMaxTokens.value) || 1024)),
  };
  saveApi();
  hideModal(apiModal);
});

apiProvider.addEventListener("change", () => {
  const current = apiModel.value.trim();
  const knownDefaults = Object.values(DEFAULT_MODEL_BY_PROVIDER);
  if (!current || knownDefaults.includes(current)) {
    apiModel.value = DEFAULT_MODEL_BY_PROVIDER[apiProvider.value] || "";
  }
});

$("#btnApi").addEventListener("click", openApiModal);

$("#btnClear").addEventListener("click", () => {
  if (!state.history.length) return;
  if (!confirm("会話履歴をすべて削除しますか？")) return;
  state.history = [];
  saveHistory();
  renderMessages();
});

// Modal open/close helpers
function showModal(el) { el.classList.remove("hidden"); }
function hideModal(el) { el.classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach((b) => {
  b.addEventListener("click", () => hideModal(document.getElementById(b.dataset.close)));
});
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) hideModal(m); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal:not(.hidden)").forEach(hideModal);
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

composerEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  await onSend();
});

async function onSend() {
  if (state.sending) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (state.selected.size === 0) {
    pushMessage({ role: "system", content: "会話するキャラを下のスロットから選んでください。" });
    return;
  }
  if (!state.api.key) {
    pushMessage({ role: "system", content: "API キーが未設定です。右上の「⚙ API」から設定してください。" });
    return;
  }

  inputEl.value = "";
  inputEl.style.height = "auto";
  pushMessage({ role: "user", content: text });

  // Add a typing placeholder
  const typingMsg = { role: "assistant", name: "…", content: "考え中…", typing: true };
  state.history.push(typingMsg);
  appendMessageEl(typingMsg);
  scrollMessagesToBottom();

  state.sending = true;
  sendBtn.disabled = true;
  try {
    const reply = await callLLM();
    // Remove typing placeholder
    state.history.pop();
    saveHistory();
    renderMessages();

    const parsed = parseAssistantReply(reply);
    for (const m of parsed) {
      pushMessage(m);
    }
  } catch (err) {
    state.history.pop(); // remove typing
    saveHistory();
    renderMessages();
    pushMessage({ role: "error", content: "エラー: " + (err && err.message ? err.message : String(err)) });
  } finally {
    state.sending = false;
    sendBtn.disabled = false;
  }
}

// ---------- LLM ----------
function buildSystemPrompt() {
  const selected = [...state.selected].map((i) => ({ ...state.chars[i], idx: i }));
  const self = state.chars[0];
  const selfLine = self.name ? `ユーザーの名前は「${self.name}」。` : "";

  if (selected.length === 1) {
    const c = selected[0];
    return [
      `あなたは以下のキャラクターとしてロールプレイしてください。`,
      `# 名前: ${c.name || `CH${c.idx}`}`,
      c.persona ? `# キャラクター設定:\n${c.persona}` : "",
      c.tone ? `# 口調・話し方:\n${c.tone}` : "",
      selfLine,
      `常にこのキャラクターとして応答してください。ナレーションやメタ発言は避け、キャラの台詞のみを返してください。`,
    ].filter(Boolean).join("\n\n");
  }

  // Multi-character roleplay
  const charBlocks = selected.map((c) => {
    const lines = [`## ${c.name || `CH${c.idx}`}`];
    if (c.persona) lines.push(`設定: ${c.persona}`);
    if (c.tone) lines.push(`口調: ${c.tone}`);
    return lines.join("\n");
  }).join("\n\n");

  const namesList = selected.map((c) => c.name || `CH${c.idx}`).join(", ");

  return [
    `あなたは複数のキャラクターを同時に演じるロールプレイ役です。`,
    `以下のキャラクター全員を演じてください: ${namesList}`,
    ``,
    `# キャラクター一覧`,
    charBlocks,
    ``,
    selfLine,
    `# 応答ルール`,
    `- キャラごとの発言を必ず以下の形式で、一行ごとに書いてください:`,
    `  [キャラ名] 発言内容`,
    `- 1ターンで複数のキャラが発言しても構いません。会話が自然に流れるよう、0人〜全員が話せます。`,
    `- 発言する必要がないキャラは行自体を省略してください。`,
    `- [キャラ名] 部分にはカッコを含めて書き、キャラ名は上記の名前と完全一致させてください。`,
    `- ナレーションやメタ発言は書かず、台詞のみを返してください。`,
  ].filter(Boolean).join("\n");
}

function buildHistoryForAPI() {
  // Strip system/error/typing; keep user/assistant only.
  return state.history
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.typing)
    .map((m) => {
      if (m.role === "user") return { role: "user", content: m.content };
      // assistant — prefix name if multi-character mode will be used, to preserve context
      const prefix = m.name ? `[${m.name}] ` : "";
      return { role: "assistant", content: prefix + m.content };
    });
}

async function callLLM() {
  const systemPrompt = buildSystemPrompt();
  const messages = buildHistoryForAPI();

  if (state.api.provider === "gemini") {
    return await callGemini(systemPrompt, messages);
  }
  if (state.api.provider === "anthropic") {
    return await callAnthropic(systemPrompt, messages);
  }
  return await callOpenAI(systemPrompt, messages);
}

async function callGemini(system, messages) {
  const base = (state.api.base || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = encodeURIComponent(state.api.model);
  const url = `${base}/models/${model}:generateContent`;
  // Gemini requires the first content to be role "user".
  // Drop any leading assistant/model messages (e.g. greetings).
  const trimmed = [...messages];
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: state.api.temperature,
      maxOutputTokens: state.api.maxTokens,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": state.api.key,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text && cand?.finishReason && cand.finishReason !== "STOP") {
    throw new Error(`Gemini 応答が空です (finishReason: ${cand.finishReason})`);
  }
  return text;
}

async function callAnthropic(system, messages) {
  const url = "https://api.anthropic.com/v1/messages";
  const body = {
    model: state.api.model,
    max_tokens: state.api.maxTokens,
    temperature: state.api.temperature,
    system,
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content }],
    })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.api.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text;
}

async function callOpenAI(system, messages) {
  const base = (state.api.base || "https://api.openai.com/v1").replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const body = {
    model: state.api.model,
    temperature: state.api.temperature,
    max_tokens: state.api.maxTokens,
    messages: [
      { role: "system", content: system },
      ...messages,
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${state.api.key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

function parseAssistantReply(text) {
  if (!text) return [{ role: "assistant", name: defaultSpeakerName(), content: "(無言)" }];

  const selectedChars = [...state.selected].map((i) => state.chars[i]);
  const known = selectedChars.map((c) => c.name).filter(Boolean);

  // Single character: no parsing needed
  if (selectedChars.length === 1) {
    return [{ role: "assistant", name: selectedChars[0].name || `CH`, content: cleanLine(text) }];
  }

  // Multi: parse [Name] ... lines
  const lines = text.split(/\r?\n/);
  const msgs = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current) current.content += "\n";
      continue;
    }
    const m = line.match(/^\[([^\]]+)\]\s*[:：]?\s*(.*)$/);
    if (m) {
      if (current) msgs.push(current);
      const name = resolveName(m[1].trim(), known);
      current = { role: "assistant", name, content: m[2] || "" };
    } else {
      if (current) {
        current.content += (current.content ? "\n" : "") + line;
      } else {
        // No bracket prefix: attribute to first selected character
        current = { role: "assistant", name: known[0] || "assistant", content: line };
      }
    }
  }
  if (current) msgs.push(current);

  return msgs
    .map((m) => ({ ...m, content: m.content.trim() }))
    .filter((m) => m.content.length > 0);
}

function resolveName(name, known) {
  if (known.includes(name)) return name;
  // Try loose match
  const hit = known.find((n) => n && (name.includes(n) || n.includes(name)));
  return hit || name;
}

function defaultSpeakerName() {
  const first = [...state.selected][0];
  if (first == null) return "assistant";
  return state.chars[first].name || `CH${first}`;
}

function cleanLine(text) {
  // Strip a leading [Name] prefix if the model added one in single-char mode
  return text.replace(/^\s*\[[^\]]+\]\s*[:：]?\s*/, "").trim();
}

// ---------- Init ----------
function init() {
  renderSlots();
  renderMessages();
  if (!state.api.key) {
    // Show a subtle hint
    pushMessage({
      role: "system",
      content: "はじめに右上の「⚙ API」から LLM の API キーを設定してください。次にキャラを 1 つ以上設定し、そのキャラをクリックして会話を始めます。",
    });
  }
}
init();

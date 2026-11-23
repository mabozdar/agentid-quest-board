/* Agent ID Quest Board frontend.
   Read-only UI. All writes are prompts the user pastes in Binance AI Pro,
   signed by their Agentic Wallet. This page never connects a browser wallet. */
(function () {
  const AGENT_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function handleOf(address owner) view returns (string)",
  ];

  const FALLBACK_RPCS = [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed1.binance.org",
  ];

  const cfg = window.QUEST_BOARD_CONFIG || {};
  const ZERO = "0x0000000000000000000000000000000000000000";
  const handleCache = new Map();

  const els = {
    alerts: document.getElementById("alerts"),
    questList: document.getElementById("questList"),
    leaderboard: document.getElementById("leaderboard"),
    createForm: document.getElementById("createForm"),
    rewardPreview: document.getElementById("rewardPreview"),
    endsAt: document.getElementById("endsAt"),
    pool: document.getElementById("pool"),
    maxCompletions: document.getElementById("maxCompletions"),
    refreshBtn: document.getElementById("refreshBtn"),
    checkForm: document.getElementById("checkForm"),
    checkAddr: document.getElementById("checkAddr"),
    checkBtn: document.getElementById("checkBtn"),
    checkResult: document.getElementById("checkResult"),
  };

  const state = {
    provider: null,
    providerPromise: null,
    quests: [],
  };

  function $(sel, root) { return (root || document).querySelector(sel); }

  function shortAddr(a) {
    if (!a) return "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function explorer(path) {
    const base = (cfg.explorerUrl || "https://bscscan.com").replace(/\/$/, "");
    return base + path;
  }

  function isConfigured() {
    const a = (cfg.contractAddress || "").trim();
    return /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() !== ZERO.toLowerCase();
  }

  function nowUnix() { return Math.floor(Date.now() / 1000); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setAlert(kind, html) {
    els.alerts.innerHTML = html ? '<div class="banner ' + kind + '">' + html + "</div>" : "";
  }

  function friendlyError(err) {
    const msg = (err && (err.shortMessage || err.reason || err.message)) || String(err);
    if (/failed to detect network|timeout|403|429|NETWORK_ERROR|could not coalesce/i.test(msg)) {
      return "Could not reach BNB Smart Chain right now. Pull to refresh in a moment.";
    }
    return msg;
  }

  function rpcList() {
    const urls = [cfg.rpcUrl].concat(FALLBACK_RPCS);
    const seen = new Set();
    return urls.filter(function (u) {
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }

  async function getProvider() {
    if (state.provider) return state.provider;
    if (state.providerPromise) return state.providerPromise;
    state.providerPromise = (async function () {
      let lastErr;
      const chainId = Number(cfg.chainId) || 56;
      for (const url of rpcList()) {
        try {
          const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
          await Promise.race([
            p.getBlockNumber(),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error("RPC timeout")); }, 7000); }),
          ]);
          state.provider = p;
          return p;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("No working BSC RPC");
    })();
    try {
      return await state.providerPromise;
    } catch (err) {
      state.providerPromise = null;
      throw err;
    }
  }

  async function boardContract() {
    if (!isConfigured()) throw new Error("Contract address is not set in config.js");
    return new ethers.Contract(cfg.contractAddress, window.QUEST_BOARD_ABI, await getProvider());
  }

  async function agentNft() {
    return new ethers.Contract(cfg.agentIdAddress, AGENT_ABI, await getProvider());
  }

  function formatBnb(wei) {
    const v = ethers.formatEther(wei);
    const n = Number(v);
    if (!isFinite(n) || n === 0) return "0 " + (cfg.currencySymbol || "BNB");
    const s = n >= 0.001 ? n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : v;
    return s + " " + (cfg.currencySymbol || "BNB");
  }

  function timeLeft(endsAt) {
    const t = Number(endsAt);
    const d = t - nowUnix();
    if (d <= 0) return "Ended";
    const days = Math.floor(d / 86400);
    const hours = Math.floor((d % 86400) / 3600);
    const mins = Math.floor((d % 3600) / 60);
    if (days > 0) return days + "d " + hours + "h left";
    if (hours > 0) return hours + "h " + mins + "m left";
    return mins + "m left";
  }

  function defaultEndLocal() {
    const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function updateRewardPreview() {
    const max = Number(els.maxCompletions.value || 0);
    const pool = Number(els.pool.value || 0);
    const sym = cfg.currencySymbol || "BNB";
    if (!max || max <= 0 || !pool) {
      els.rewardPreview.textContent = "Reward per completion: 0 " + sym + " (optional)";
      return;
    }
    const each = pool / max;
    els.rewardPreview.textContent =
      "Reward per completion: " + each.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") +
      " " + sym + " (from this quest's pool only)";
  }

  function promptRules(valueLabel) {
    return "Rules: show me a preview first and wait for my confirmation before sending. Send " +
      valueLabel + " only. If Dev Mode is off or the call fails, stop and tell me. " +
      "Never ask me for keys, codes or seed phrases. After it confirms, tell me the transaction hash.";
  }

  function aiPrompt(q) {
    const id = q.id.toString();
    const data = "0x528be0a9" + BigInt(id).toString(16).padStart(64, "0");
    return "Using my Binance Agentic Wallet (the wallet that holds my Agent ID), complete a quest on Agent ID Quest Board.\n\n" +
      "Call this smart contract on BNB Smart Chain (chain ID 56):\n" +
      "Contract: " + cfg.contractAddress + "\n" +
      "Function: completeQuest(uint256 questId)\n" +
      "questId: " + id + "\n" +
      "Value: 0 BNB\n" +
      "Input data: " + data + "\n\n" +
      "Quest #" + id + ": " + q.title + "\n\n" +
      promptRules("value 0 BNB");
  }

  function withdrawPrompt(q) {
    const id = q.id.toString();
    const iface = new ethers.Interface(["function withdrawUnused(uint256 questId)"]);
    const data = iface.encodeFunctionData("withdrawUnused", [q.id]);
    return "Using my Binance Agentic Wallet, withdraw unused BNB from a quest I created on Agent ID Quest Board.\n\n" +
      "Call this smart contract on BNB Smart Chain (chain ID 56):\n" +
      "Contract: " + cfg.contractAddress + "\n" +
      "Function: withdrawUnused(uint256 questId)\n" +
      "questId: " + id + "\n" +
      "Value: 0 BNB\n" +
      "Input data: " + data + "\n\n" +
      "Only the quest creator can withdraw, and only after the quest has ended or is full. " +
      "Remaining pool: " + formatBnb(q.remainingPool) + ". The contract has no delete function.\n\n" +
      promptRules("value 0 BNB");
  }

  function badgeLabel(handle, holds) {
    const h = (handle || "").trim();
    if (h) return /\.ai$/i.test(h) ? h : h + ".ai";
    if (holds) return "Agent ID holder";
    return "";
  }

  async function lookupHandle(addr) {
    const key = addr.toLowerCase();
    if (handleCache.has(key)) return handleCache.get(key);
    const info = { handle: "", holds: false, badge: "" };
    try {
      const nft = await agentNft();
      const [handleRes, balRes] = await Promise.allSettled([
        nft.handleOf(addr),
        nft.balanceOf(addr),
      ]);
      if (handleRes.status === "fulfilled") info.handle = handleRes.value || "";
      if (balRes.status === "fulfilled") info.holds = balRes.value > 0n;
    } catch (_) { /* ignore */ }
    info.badge = badgeLabel(info.handle, info.holds);
    handleCache.set(key, info);
    return info;
  }

  function renderQuest(q) {
    const ended = Number(q.endsAt) <= nowUnix();
    const full = Number(q.completionCount) >= Number(q.maxCompletions);
    const closed = ended || full;
    const canWithdraw = closed && q.remainingPool > 0n;
    const reward = formatBnb(q.rewardPerCompletion);
    const pool = formatBnb(q.remainingPool);
    const link = (q.link || "").trim();
    const status = ended ? "Ended" : full ? "Full" : "Open";

    const wrap = document.createElement("article");
    wrap.className = "quest";
    wrap.innerHTML =
      '<div class="row">' +
        '<span class="badge gold">#' + q.id.toString() + "</span>" +
        '<span class="badge ' + (status === "Open" ? "yes" : "no") + '">' + status + "</span>" +
      "</div>" +
      "<h3></h3>" +
      "<p></p>" +
      (link ? '<p><a class="task-link" href="#" rel="noopener">Open task link</a></p>' : "") +
      '<div class="meta">' +
        "<span>" + q.completionCount.toString() + " / " + q.maxCompletions.toString() + " completions</span>" +
        "<span>" + timeLeft(q.endsAt) + "</span>" +
        "<span>Reward: " + reward + "</span>" +
        "<span>Pool left: " + pool + "</span>" +
        '<span>Creator: <a href="' + explorer("/address/" + q.creator) + '" target="_blank" rel="noopener">' + shortAddr(q.creator) + "</a></span>" +
      "</div>";

    wrap.querySelector("h3").textContent = q.title;
    wrap.querySelector("p").textContent = q.description;

    const a = wrap.querySelector(".task-link");
    if (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        try {
          const u = new URL(link, window.location.href);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            alert("This quest link is not a normal http(s) URL.");
            return;
          }
          window.open(u.href, "_blank", "noopener");
        } catch (_) {
          alert("This quest link is not valid.");
        }
      });
    }

    if (!closed) {
      const hint = document.createElement("p");
      hint.className = "ai-hint";
      hint.textContent = "Prompt for Binance AI Pro (complete this quest with your Agentic Wallet):";
      const pre = document.createElement("pre");
      pre.className = "ai-prompt";
      pre.textContent = aiPrompt(q);
      const btn = document.createElement("button");
      btn.className = "primary ai-btn";
      btn.type = "button";
      btn.textContent = "Copy prompt";
      btn.addEventListener("click", function () { copyText(aiPrompt(q), btn); });
      wrap.appendChild(hint);
      wrap.appendChild(pre);
      wrap.appendChild(btn);
    }

    if (canWithdraw) {
      const hint = document.createElement("p");
      hint.className = "ai-hint";
      hint.textContent = "This quest has ended or is full and still has unused BNB. Only the quest creator can withdraw it. The contract has no delete function.";
      const pre = document.createElement("pre");
      pre.className = "ai-prompt withdraw-prompt";
      pre.textContent = withdrawPrompt(q);
      const btn = document.createElement("button");
      btn.className = "secondary withdraw-btn";
      btn.type = "button";
      btn.textContent = "Copy withdraw unused BNB prompt";
      btn.addEventListener("click", function () { copyText(withdrawPrompt(q), btn); });
      wrap.appendChild(hint);
      wrap.appendChild(pre);
      wrap.appendChild(btn);
    }

    return wrap;
  }

  function setPlaceholder(el, html, isEmpty) {
    el.className = isEmpty ? "empty placeholder" : "";
    el.innerHTML = html;
  }

  async function loadQuests() {
    if (!isConfigured()) {
      setPlaceholder(els.questList, "Contract address is not set yet.", true);
      return;
    }
    setPlaceholder(els.questList, "Loading quests…", true);
    try {
      const board = await boardContract();
      const total = await board.questCount();
      if (total === 0n) {
        setPlaceholder(els.questList, "No quests yet. Create the first one.", true);
        state.quests = [];
        return;
      }
      const page = await board.getQuests(0, 50);
      const items = [...page].reverse();
      state.quests = items;
      els.questList.className = "";
      els.questList.innerHTML = "";
      for (const q of items) els.questList.appendChild(renderQuest(q));
      if (total > 50n) {
        const note = document.createElement("p");
        note.className = "hint";
        note.textContent = "Showing the 50 most recent of " + total.toString() + " quests.";
        els.questList.appendChild(note);
      }
    } catch (err) {
      console.error(err);
      setPlaceholder(els.questList, "Could not load quests: " + escapeHtml(friendlyError(err)), true);
    }
  }

  async function loadLeaderboard() {
    if (!isConfigured()) {
      setPlaceholder(els.leaderboard, "Contract address is not set yet.", true);
      return;
    }
    try {
      const board = await boardContract();
      const count = await board.getPointHolderCount();
      if (count === 0n) {
        setPlaceholder(els.leaderboard, "No points yet. Complete a quest to appear here.", true);
        return;
      }
      const result = await board.getPointHolders(0, 200);
      const accounts = result[0] || result.accounts;
      const pts = result[1] || result.pts;
      const rows = accounts.map(function (addr, i) { return { addr: addr, pts: pts[i] }; });
      rows.sort(function (a, b) {
        if (a.pts === b.pts) return 0;
        return a.pts > b.pts ? -1 : 1;
      });
      const infos = await Promise.all(rows.map(function (r) { return lookupHandle(r.addr); }));
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>#</th><th>Agent</th><th>Points</th></tr></thead>";
      const tb = document.createElement("tbody");
      rows.forEach(function (r, i) {
        const info = infos[i] || {};
        const tr = document.createElement("tr");
        const rank = document.createElement("td");
        rank.className = "rank";
        rank.textContent = String(i + 1);
        const agent = document.createElement("td");
        if (info.badge) {
          const badge = document.createElement("span");
          badge.className = "agent-badge";
          badge.innerHTML = '<span class="dot"></span>';
          const label = document.createElement("span");
          label.textContent = info.badge;
          badge.appendChild(label);
          agent.appendChild(badge);
        } else {
          const fallback = document.createElement("span");
          fallback.className = "badge no";
          fallback.textContent = "No Agent ID";
          agent.appendChild(fallback);
        }
        const sub = document.createElement("a");
        sub.className = "addr-sub mono";
        sub.href = explorer("/address/" + r.addr);
        sub.target = "_blank";
        sub.rel = "noopener";
        sub.textContent = shortAddr(r.addr);
        agent.appendChild(sub);
        const ptd = document.createElement("td");
        ptd.textContent = r.pts.toString();
        tr.appendChild(rank);
        tr.appendChild(agent);
        tr.appendChild(ptd);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      els.leaderboard.className = "";
      els.leaderboard.innerHTML = "";
      els.leaderboard.appendChild(table);
    } catch (err) {
      setPlaceholder(els.leaderboard, "Could not load leaderboard: " + escapeHtml(friendlyError(err)), true);
    }
  }

  async function onCheck(ev) {
    ev.preventDefault();
    const raw = (els.checkAddr.value || "").trim();
    els.checkResult.hidden = false;
    els.checkResult.className = "agent-result";
    if (!ethers.isAddress(raw)) {
      els.checkResult.innerHTML = '<p class="hint" style="margin:0">That is not a valid wallet address. Paste a 0x address from an Agentic Wallet.</p>';
      return;
    }
    const addr = ethers.getAddress(raw);
    els.checkBtn.disabled = true;
    els.checkResult.textContent = "Looking up this agent…";
    try {
      const board = await boardContract();
      const [info, pts, questPack] = await Promise.all([
        lookupHandle(addr),
        board.points(addr),
        (async function () {
          if (state.quests && state.quests.length) return state.quests;
          const total = await board.questCount();
          if (total === 0n) return [];
          return [...await board.getQuests(0, 50)];
        })(),
      ]);
      const completed = [];
      for (const q of questPack) {
        try {
          const yes = await board.hasCompleted(q.id, addr);
          if (yes) completed.push(q);
        } catch (_) { /* ignore one quest */ }
      }

      const box = document.createElement("div");
      box.className = "agent-result";
      const row = document.createElement("div");
      if (info.badge) {
        const badge = document.createElement("span");
        badge.className = "agent-badge";
        badge.innerHTML = '<span class="dot"></span>';
        const label = document.createElement("span");
        label.textContent = info.badge;
        badge.appendChild(label);
        row.appendChild(badge);
      } else {
        const badge = document.createElement("span");
        badge.className = "badge no";
        badge.textContent = "No Agent ID";
        row.appendChild(badge);
      }
      box.appendChild(row);

      const holds = document.createElement("p");
      holds.className = "hint";
      holds.style.margin = "0 0 4px";
      holds.textContent = info.holds
        ? "This address holds an Agent ID NFT."
        : "This address does not currently hold an Agent ID.";
      box.appendChild(holds);

      const link = document.createElement("a");
      link.className = "mono";
      link.href = explorer("/address/" + addr);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = addr;
      box.appendChild(link);

      const ptsEl = document.createElement("div");
      ptsEl.className = "pts";
      ptsEl.textContent = pts.toString() + (pts === 1n ? " point" : " points");
      box.appendChild(ptsEl);

      const sub = document.createElement("p");
      sub.className = "hint";
      sub.style.margin = "0 0 4px";
      sub.textContent = completed.length
        ? "Completed quests"
        : "No completed quests yet.";
      box.appendChild(sub);

      if (completed.length) {
        const ul = document.createElement("ul");
        ul.className = "completed-list";
        completed.forEach(function (q) {
          const li = document.createElement("li");
          li.textContent = "Quest #" + q.id.toString() + " — " + q.title;
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }

      els.checkResult.replaceWith(box);
      box.id = "checkResult";
      els.checkResult = box;
    } catch (err) {
      console.error(err);
      els.checkResult.innerHTML = '<p class="hint" style="margin:0">Could not look up this agent: ' +
        escapeHtml(friendlyError(err)) + "</p>";
    } finally {
      els.checkBtn.disabled = false;
    }
  }

  async function onCreate(ev) {
    ev.preventDefault();
    const title = $("#title").value.trim();
    const description = $("#description").value.trim();
    const link = $("#link").value.trim();
    const maxC = Number($("#maxCompletions").value);
    const endsLocal = $("#endsAt").value;
    const poolStr = ($("#pool").value || "0").trim() || "0";
    const endsAt = Math.floor(new Date(endsLocal).getTime() / 1000);
    if (!title || !description) {
      setAlert("err", "Title and description are required.");
      return;
    }
    if (!endsAt || endsAt <= nowUnix()) {
      setAlert("err", "Please pick an end time in the future.");
      return;
    }
    let value;
    try { value = ethers.parseEther(poolStr); }
    catch (_) { setAlert("err", "Invalid BNB amount."); return; }

    if (!maxC || maxC < 1) { setAlert("err", "Max completions must be at least 1."); return; }
    const iface = new ethers.Interface(["function createQuest(string title,string description,string link,uint32 maxCompletions,uint64 endsAt)"]);
    const data = iface.encodeFunctionData("createQuest", [title, description, link, maxC, endsAt]);
    const valueLabel = (poolStr === "0" || value === 0n) ? "0 BNB" : poolStr + " BNB (reward pool)";
    const prompt = "Using my Binance Agentic Wallet, create a new quest on Agent ID Quest Board.\n\n" +
      "Call this smart contract on BNB Smart Chain (chain ID 56):\n" +
      "Contract: " + cfg.contractAddress + "\n" +
      "Function: createQuest(string title, string description, string link, uint32 maxCompletions, uint64 endsAt)\n" +
      "title: " + title + "\n" +
      "description: " + description + "\n" +
      "link: " + (link || "(empty)") + "\n" +
      "maxCompletions: " + maxC + "\n" +
      "endsAt: " + endsAt + " (" + new Date(endsAt * 1000).toUTCString() + ")\n" +
      "Value: " + valueLabel + "\n" +
      "Input data: " + data + "\n\n" +
      promptRules("exactly " + (poolStr === "0" || value === 0n ? "0 BNB" : poolStr + " BNB") + " as value, nothing more");
    const pre = document.getElementById("createPrompt");
    const cb = document.getElementById("copyCreateBtn");
    pre.textContent = prompt;
    pre.style.display = "block";
    cb.style.display = "block";
    cb.onclick = function () { copyText(prompt, cb); };
    copyText(prompt, cb);
  }

  function copyText(text, btn) {
    const original = btn ? btn.textContent : "";
    const done = function () {
      if (!btn) return;
      btn.textContent = "Copied — paste it in Binance AI Pro";
      setTimeout(function () { btn.textContent = original; }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this prompt:", text); });
    } else {
      window.prompt("Copy this prompt:", text);
    }
  }

  function showBootAlerts() {
    if (typeof ethers === "undefined") {
      setAlert("err", "Could not load ethers.js (CDN). Check your internet connection and refresh.");
      return;
    }
    if (!isConfigured()) {
      setAlert("warn", "This is the demo UI. After you deploy QuestBoard, paste the contract address into <span class='mono'>frontend/config.js</span> and refresh.");
    } else {
      setAlert("ok", "Contract: <a href='" + explorer("/address/" + cfg.contractAddress) + "' target='_blank' rel='noopener'>" +
        shortAddr(cfg.contractAddress) + "</a> on " + (cfg.chainName || "BNB Smart Chain") +
        ". This site never connects a wallet.");
    }
  }

  function initTabs() {
    document.querySelectorAll("nav.tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll("nav.tabs button").forEach(function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      });
    });
  }

  function init() {
    els.endsAt.value = defaultEndLocal();
    updateRewardPreview();
    els.pool.addEventListener("input", updateRewardPreview);
    els.maxCompletions.addEventListener("input", updateRewardPreview);
    els.refreshBtn.addEventListener("click", function () {
      Promise.all([loadQuests(), loadLeaderboard()]);
    });
    els.createForm.addEventListener("submit", onCreate);
    if (els.checkForm) els.checkForm.addEventListener("submit", onCheck);
    initTabs();
    showBootAlerts();
    loadQuests();
    loadLeaderboard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

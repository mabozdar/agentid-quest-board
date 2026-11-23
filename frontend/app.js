/* Quest Board frontend. All writes go through the user's injected wallet. */
(function () {
  const AGENT_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function handleOf(address owner) view returns (string)",
  ];

  const ERROR_TEXT = {
    NotAgentIdHolder: "This wallet does not hold an Agent ID.",
    AlreadyCompleted: "You already completed this quest.",
    QuestEnded: "This quest has ended.",
    QuestFull: "This quest is full.",
    QuestNotFound: "Quest not found.",
    NotCreator: "Only the quest creator can withdraw unused BNB.",
    QuestStillOpen: "The quest is still open, so unused BNB cannot be withdrawn yet.",
    NothingToWithdraw: "There is no unused BNB left to withdraw.",
    CreateIsPaused: "Creating new quests is currently paused.",
    EmptyTitle: "Title is required.",
    EmptyDescription: "Description is required.",
    TitleTooLong: "Title is too long.",
    DescriptionTooLong: "Description is too long.",
    LinkTooLong: "Link is too long.",
    InvalidMaxCompletions: "Max completions must be between 1 and 10,000.",
    InvalidEndTime: "End time must be in the future and within 365 days.",
    TransferFailed: "BNB transfer failed.",
    DirectTransferDisabled: "Direct BNB transfers are not accepted.",
    Reentrant: "Reentrancy blocked.",
    NotOwner: "Only the owner can do that.",
    NoOwner: "This contract has no owner.",
  };

  const cfg = window.QUEST_BOARD_CONFIG || {};
  const ZERO = "0x0000000000000000000000000000000000000000";

  const els = {
    alerts: document.getElementById("alerts"),
    connectBtn: document.getElementById("connectBtn"),
    walletLabel: document.getElementById("walletLabel"),
    agentLabel: document.getElementById("agentLabel"),
    questList: document.getElementById("questList"),
    leaderboard: document.getElementById("leaderboard"),
    createForm: document.getElementById("createForm"),
    rewardPreview: document.getElementById("rewardPreview"),
    endsAt: document.getElementById("endsAt"),
    pool: document.getElementById("pool"),
    maxCompletions: document.getElementById("maxCompletions"),
    refreshBtn: document.getElementById("refreshBtn"),
  };

  const state = {
    raw: null,
    browser: null,
    signer: null,
    account: null,
    holdsId: false,
    ownHandle: "",
    chainId: null,
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
    return /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() !== ZERO;
  }
  function chainHex() {
    return "0x" + Number(cfg.chainId).toString(16);
  }
  function nowUnix() { return Math.floor(Date.now() / 1000); }

  function setAlert(kind, html) {
    els.alerts.innerHTML = html ? `<div class="banner ${kind}">${html}</div>` : "";
  }
  function appendAlert(kind, html) {
    els.alerts.insertAdjacentHTML("beforeend", `<div class="banner ${kind}">${html}</div>`);
  }

  function friendlyError(err) {
    const msg = (err && (err.shortMessage || err.reason || err.message)) || String(err);
    const nameMatch = msg.match(/([A-Z][A-Za-z0-9]+)\(/);
    if (nameMatch && ERROR_TEXT[nameMatch[1]]) return ERROR_TEXT[nameMatch[1]];
    for (const k of Object.keys(ERROR_TEXT)) {
      if (msg.includes(k)) return ERROR_TEXT[k];
    }
    if (/user rejected|ACTION_REJECTED|denied/i.test(msg)) return "Transaction rejected in the wallet.";
    if (/insufficient funds/i.test(msg)) return "Not enough BNB in this wallet to cover the amount plus gas.";
    return msg;
  }

  function getInjected() {
    const eth = window.ethereum;
    if (eth && Array.isArray(eth.providers) && eth.providers.length) {
      return eth.providers.find((p) => p.isBinance || p.isBinanceWallet || p.isMetaMask) || eth.providers[0];
    }
    return eth || window.binancew3w || window.binance || window.BinanceChain || null;
  }

  function readProvider() {
    if (state.browser) return state.browser;
    return new ethers.JsonRpcProvider(cfg.rpcUrl);
  }

  function boardContract(withSigner) {
    if (!isConfigured()) throw new Error("Contract address is not set in config.js");
    const runner = withSigner && state.signer ? state.signer : readProvider();
    return new ethers.Contract(cfg.contractAddress, window.QUEST_BOARD_ABI, runner);
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
    if (!max || max <= 0 || !pool) {
      els.rewardPreview.textContent = "Reward per completion: 0 " + (cfg.currencySymbol || "BNB") + " (optional)";
      return;
    }
    const each = pool / max;
    els.rewardPreview.textContent =
      "Reward per completion: " + each.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") +
      " " + (cfg.currencySymbol || "BNB") + " (from this quest's pool only)";
  }

  async function ensureChain() {
    const raw = state.raw;
    if (!raw || !raw.request) return;
    const wanted = Number(cfg.chainId);
    const current = Number(await raw.request({ method: "eth_chainId" }));
    if (current === wanted) return;
    try {
      await raw.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex() }],
      });
    } catch (err) {
      if (err && (err.code === 4902 || /unrecognized|not added/i.test(String(err.message || err)))) {
        await raw.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainHex(),
            chainName: cfg.chainName || "BNB Smart Chain",
            nativeCurrency: { name: cfg.currencySymbol || "BNB", symbol: cfg.currencySymbol || "BNB", decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
            blockExplorerUrls: [cfg.explorerUrl],
          }],
        });
        return;
      }
      throw err;
    }
  }

  async function connect() {
    const raw = getInjected();
    if (!raw) {
      setAlert("err", "No wallet found. Open this page in the Binance App browser or MetaMask, then tap Connect. Your wallet will ask you to confirm.");
      return;
    }
    state.raw = raw;
    state.browser = new ethers.BrowserProvider(raw, "any");
    await ensureChain();
    await state.browser.send("eth_requestAccounts", []);
    state.signer = await state.browser.getSigner();
    state.account = await state.signer.getAddress();
    const net = await state.browser.getNetwork();
    state.chainId = Number(net.chainId);
    els.connectBtn.textContent = shortAddr(state.account);
    await refreshAccount();
    await Promise.all([loadQuests(), loadLeaderboard()]);
  }

  async function refreshAccount() {
    if (!state.account) {
      els.walletLabel.textContent = "Not connected";
      els.agentLabel.innerHTML = '<span class="badge no">Unknown</span>';
      return;
    }
    if (state.chainId && Number(cfg.chainId) && state.chainId !== Number(cfg.chainId)) {
      els.walletLabel.textContent = shortAddr(state.account);
      els.agentLabel.innerHTML = '<span class="badge no">Wrong network</span>';
      setAlert("warn", "Please switch your wallet to " + (cfg.chainName || "the correct network") + " (chain ID " + cfg.chainId + ").");
      return;
    }
    let holds = false;
    let handle = "";
    try {
      if (isConfigured()) {
        const board = boardContract(false);
        holds = await board.holdsAgentId(state.account);
      }
      if (cfg.agentIdAddress) {
        const nft = new ethers.Contract(cfg.agentIdAddress, AGENT_ABI, readProvider());
        if (!holds) {
          try {
            const bal = await nft.balanceOf(state.account);
            holds = bal > 0n;
          } catch (_) { /* ignore */ }
        }
        // Reverse-resolve only the connected wallet, never a name search.
        try {
          handle = await nft.handleOf(state.account);
        } catch (_) { handle = ""; }
      }
    } catch (err) {
      console.warn(err);
    }
    state.holdsId = holds;
    state.ownHandle = handle || "";
    els.walletLabel.innerHTML =
      '<a href="' + explorer("/address/" + state.account) + '" target="_blank" rel="noopener">' +
      shortAddr(state.account) + "</a>";
    if (holds) {
      const label = state.ownHandle ? (state.ownHandle + ".ai") : "Holder";
      els.agentLabel.innerHTML = '<span class="badge yes">' + label + "</span>";
    } else {
      els.agentLabel.innerHTML = '<span class="badge no">No Agent ID</span>';
    }
  }

  function renderQuest(q) {
    const ended = Number(q.endsAt) <= nowUnix();
    const full = Number(q.completionCount) >= Number(q.maxCompletions);
    const mine = state.account && q.creator.toLowerCase() === state.account.toLowerCase();
    const reward = formatBnb(q.rewardPerCompletion);
    const pool = formatBnb(q.remainingPool);
    const link = (q.link || "").trim();
    const status = ended ? "Ended" : full ? "Full" : "Open";
    const canWithdraw = mine && (ended || full) && q.remainingPool > 0n;

    const wrap = document.createElement("article");
    wrap.className = "quest";
    wrap.innerHTML =
      '<div class="row">' +
        '<span class="badge gold">#' + q.id.toString() + "</span>" +
        '<span class="badge ' + (status === "Open" ? "yes" : "no") + '">' + status + "</span>" +
        (mine ? '<span class="badge gold">Yours</span>' : "") +
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
      "</div>" +
      '<button class="primary ai-btn" type="button">🤖 Copy prompt for Binance AI Pro</button>' +
      '<p class="ai-hint" style="font-size:13px;opacity:.8;margin:6px 0 10px">Your Agent ID lives in your Agentic Wallet. Copy this prompt, open Binance App → AI Pro, paste and send. Confirm the preview (value 0 BNB).</p>' +
      '<button class="ghost complete-btn" type="button">Complete with browser wallet</button>' +
      (canWithdraw ? '<button class="secondary withdraw-btn" type="button">Withdraw unused BNB</button>' : "") +
      '<div class="tx complete-status"></div>';

    wrap.querySelector("h3").textContent = q.title;
    wrap.querySelector("p").textContent = q.description;
    const a = wrap.querySelector(".task-link");
    if (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        // Do not auto-open javascript: or other unsafe schemes.
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

    const aiBtn = wrap.querySelector(".ai-btn");
    if (ended || full) aiBtn.disabled = true;
    aiBtn.addEventListener("click", function () {
      const prompt = aiPrompt(q);
      const done = function () { const o = aiBtn.textContent; aiBtn.textContent = "✅ Copied! Paste it in Binance AI Pro"; setTimeout(function () { aiBtn.textContent = o; }, 2500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(prompt).then(done, function () { window.prompt("Copy this prompt:", prompt); });
      } else { window.prompt("Copy this prompt:", prompt); }
    });
    const cBtn = wrap.querySelector(".complete-btn");
    const statusEl = wrap.querySelector(".complete-status");
    if (ended || full) cBtn.disabled = true;
    cBtn.addEventListener("click", function () { sendComplete(q.id, cBtn, statusEl); });
    const wBtn = wrap.querySelector(".withdraw-btn");
    if (wBtn) wBtn.addEventListener("click", function () { sendWithdraw(q.id, wBtn, statusEl); });
    return wrap;
  }

  async function loadQuests() {
    if (!isConfigured()) {
      els.questList.innerHTML = '<div class="empty">Contract address is not set yet. After you deploy, paste it into frontend/config.js (see DEPLOY.md).</div>';
      return;
    }
    els.questList.innerHTML = '<div class="empty">Loading quests…</div>';
    try {
      const board = boardContract(false);
      const total = await board.questCount();
      if (total === 0n) {
        els.questList.innerHTML = '<div class="empty">No quests yet. Create the first one.</div>';
        return;
      }
      const page = await board.getQuests(0, 50);
      // Show newest first
      const items = [...page].reverse();
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
      els.questList.innerHTML = '<div class="empty">Could not load quests: ' + friendlyError(err) + "</div>";
    }
  }

  async function loadLeaderboard() {
    if (!isConfigured()) {
      els.leaderboard.innerHTML = '<div class="empty">Contract address is not set yet.</div>';
      return;
    }
    try {
      const board = boardContract(false);
      const count = await board.getPointHolderCount();
      if (count === 0n) {
        els.leaderboard.innerHTML = '<div class="empty">No points yet. Complete a quest to appear here.</div>';
        return;
      }
      const result = await board.getPointHolders(0, 200);
      const accounts = result[0] || result.accounts;
      const pts = result[1] || result.pts;
      const rows = accounts.map(function (addr, i) { return { addr, pts: pts[i] }; });
      rows.sort(function (a, b) {
        if (a.pts === b.pts) return 0;
        return a.pts > b.pts ? -1 : 1;
      });
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>#</th><th>Address</th><th>Points</th></tr></thead>";
      const tb = document.createElement("tbody");
      rows.forEach(function (r, i) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td class="rank">' + (i + 1) + "</td>" +
          '<td class="mono"><a href="' + explorer("/address/" + r.addr) + '" target="_blank" rel="noopener">' +
          shortAddr(r.addr) + "</a></td>" +
          "<td>" + r.pts.toString() + "</td>";
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      els.leaderboard.innerHTML = "";
      els.leaderboard.appendChild(table);
    } catch (err) {
      els.leaderboard.innerHTML = '<div class="empty">Could not load leaderboard: ' + friendlyError(err) + "</div>";
    }
  }

  async function sendTx(button, statusEl, sendFn, pendingLabel) {
    if (!state.signer) {
      await connect();
      if (!state.signer) return;
    }
    button.disabled = true;
    const old = button.textContent;
    button.textContent = pendingLabel || "Confirm in wallet…";
    if (statusEl) statusEl.textContent = "Your wallet will ask you to confirm this transaction.";
    try {
      await ensureChain();
      state.signer = await state.browser.getSigner();
      state.account = await state.signer.getAddress();
      const tx = await sendFn();
      if (statusEl) {
        statusEl.innerHTML = 'Submitted: <a href="' + explorer("/tx/" + tx.hash) + '" target="_blank" rel="noopener">' +
          shortAddr(tx.hash) + "</a>. Waiting for confirmation…";
      }
      await tx.wait();
      if (statusEl) {
        statusEl.innerHTML = 'Confirmed: <a href="' + explorer("/tx/" + tx.hash) + '" target="_blank" rel="noopener">' +
          shortAddr(tx.hash) + "</a>";
      }
      await refreshAccount();
      await Promise.all([loadQuests(), loadLeaderboard()]);
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = friendlyError(err);
      else setAlert("err", friendlyError(err));
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
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
      "Rules: show me a preview first and wait for my confirmation before sending. Send value 0 only. If Dev Mode is off or the call fails, stop and tell me. Never ask me for keys, codes or seed phrases. After it confirms, tell me the transaction hash.";
  }

  function sendComplete(id, btn, statusEl) {
    return sendTx(btn, statusEl, function () {
      return boardContract(true).completeQuest(id);
    }, "Confirm in wallet…");
  }

  function sendWithdraw(id, btn, statusEl) {
    return sendTx(btn, statusEl, function () {
      return boardContract(true).withdrawUnused(id);
    }, "Confirm in wallet…");
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

    const btn = document.getElementById("createBtn");
    await sendTx(btn, null, function () {
      return boardContract(true).createQuest(
        title, description, link, maxC, endsAt, { value }
      );
    }, "Confirm in wallet…");
  }

  function showBootAlerts() {
    if (typeof ethers === "undefined") {
      setAlert("err", "Could not load ethers.js (CDN). Check your internet connection and refresh.");
      return;
    }
    if (!isConfigured()) {
      setAlert("warn", "This is the demo UI. After you deploy QuestBoard, paste the contract address into <span class='mono'>frontend/config.js</span> and refresh. Instructions are in DEPLOY.md.");
    } else {
      setAlert("ok", "Contract: <a href='" + explorer("/address/" + cfg.contractAddress) + "' target='_blank' rel='noopener'>" +
        shortAddr(cfg.contractAddress) + "</a> on " + (cfg.chainName || "BNB Smart Chain") + ".");
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
    els.connectBtn.addEventListener("click", function () {
      connect().catch(function (err) { setAlert("err", friendlyError(err)); });
    });
    els.refreshBtn.addEventListener("click", function () {
      Promise.all([refreshAccount(), loadQuests(), loadLeaderboard()]);
    });
    els.createForm.addEventListener("submit", onCreate);
    initTabs();
    showBootAlerts();
    loadQuests();
    loadLeaderboard();

    const injected = getInjected();
    if (injected && injected.on) {
      injected.on("accountsChanged", function () {
        connect().catch(function (err) { setAlert("err", friendlyError(err)); });
      });
      injected.on("chainChanged", function () { window.location.reload(); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

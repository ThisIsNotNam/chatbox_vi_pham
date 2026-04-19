(function () {
    "use strict";

    /* ═══════════════════════════════════════════════════════════════
       SHARED DOM REFS
    ═══════════════════════════════════════════════════════════════ */
    const monitorRoot           = document.getElementById("monitor-tabs-content");
    const incidentFeed          = document.getElementById("incident-feed");
    const incidentTopStatus     = document.getElementById("incident-top-status");
    const incidentListContainer = document.getElementById("incident-list-container");
    const statsTableContainer   = document.getElementById("stats-table-container");
    const liveConnectionStatus  = document.getElementById("live-connection-status");
    const detailContent         = document.getElementById("candidate-detail-content");
    const detailCanvasEl        = document.getElementById("candidateDetailCanvas");
    const detailCanvas          = detailCanvasEl ? new bootstrap.Offcanvas(detailCanvasEl) : null;

    let liveSocket       = null;
    let reconnectDelayMs = 1000;
    let loadingOlder     = false;
    let loadingUpdates   = false;

    function parseId(v) {
        const p = Number.parseInt(v, 10);
        return Number.isFinite(p) ? p : null;
    }

    let oldestId = incidentListContainer ? parseId(incidentListContainer.dataset.oldestId) : null;
    let newestId = incidentListContainer ? parseId(incidentListContainer.dataset.newestId) : null;
    let hasOlder = incidentListContainer ? incidentListContainer.dataset.hasOlder === "1" : false;

    /* ═══════════════════════════════════════════════════════════════
       UTILITIES
    ═══════════════════════════════════════════════════════════════ */
    function escHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    const SBD_SYNTAX_RE  = /^[A-Za-z0-9]{1,9}$/;
    /* Shape pattern (shared: used for full-match + suggest tooltip):
       0–2 letters + ≥2 digits, total length 2–9. Matches "TS0092", "X123",
       "7728" but NOT "A1" (only 1 digit) or "ABC123" (3 letters). */
    const SBD_SHAPE_RE   = /^(?=.{2,9}$)[A-Za-z]{0,2}\d{2,}$/;
    /* Suggest tooltip: end-of-input scan for a word that looks like an SBD. */
    const SBD_SUGGEST_RE = /(?<![{@])\b([A-Za-z]{0,2}\d{2,9})$/;

    function isValidSbd(s) {
        const v = (s || "").trim();
        return SBD_SYNTAX_RE.test(v) && SBD_SHAPE_RE.test(v);
    }

    /* ═══════════════════════════════════════════════════════════════
       EVIDENCE GUARDS (no download / drag)
    ═══════════════════════════════════════════════════════════════ */
    function bindEvidenceGuards(scope) {
        (scope || document).querySelectorAll(".evidence-guard").forEach((el) => {
            el.setAttribute("draggable", "false");
            el.addEventListener("dragstart",   (e) => e.preventDefault());
            el.addEventListener("contextmenu", (e) => e.preventDefault());
        });
    }

    function blockClipboardForEvidence() {
        document.addEventListener("copy", (e) => {
            if (document.activeElement?.closest(".evidence-wrap,.candidate-detail-shell"))
                e.preventDefault();
        });
        document.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && ["s","u","p"].includes(e.key.toLowerCase())) {
                if (document.querySelector(".incident-video-wrap,.incident-legacy-img,.candidate-detail-shell video"))
                    e.preventDefault();
            }
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       LIGHTGALLERY
       ─────────────────────────────────────────────────────────────
       Dynamic mode: collect all media for each incident on demand.
       Supports:
         • Images embedded in .markdown-body via ![alt](url)
         • Legacy image evidence (.incident-legacy-img)
         • Video evidence (.incident-video-wrap)
    ═══════════════════════════════════════════════════════════════ */
    const LG_LICENSE = "0000-0000-000-0000"; // GPLv3 / dev key

    function buildGalleryItems(incidentEl) {
        const items = [];

        // 1. Images from markdown body
        incidentEl.querySelectorAll(".markdown-body img").forEach((img) => {
            const src = img.src || img.dataset.src;
            if (src) {
                items.push({ src, thumb: src, subHtml: img.alt ? `<p>${escHtml(img.alt)}</p>` : "" });
            }
        });

        // 2. Legacy image evidence
        incidentEl.querySelectorAll(".incident-legacy-img").forEach((img) => {
            const src = img.src || img.dataset.lgSrc;
            if (src) items.push({ src, thumb: src });
        });

        // 3. Video evidence
        const videoWrap = incidentEl.querySelector(".incident-video-wrap");
        if (videoWrap) {
            const videoSrc = videoWrap.dataset.videoSrc;
            if (videoSrc) {
                items.push({
                    video: {
                        source: [{ src: videoSrc, type: "video/mp4" }],
                        attributes: { preload: "metadata", controls: true },
                    },
                    thumb: "",
                    subHtml: "<p>Video Evidence</p>",
                });
            }
        }

        return items;
    }

    function openLightGallery(items, startIndex) {
        if (!items.length) return;
        if (typeof lightGallery === "undefined") {
            console.warn("LightGallery not loaded");
            return;
        }

        const container = document.createElement("div");
        container.style.display = "none";
        document.body.appendChild(container);

        const plugins = [];
        if (typeof lgZoom  !== "undefined") plugins.push(lgZoom);
        if (typeof lgVideo !== "undefined") plugins.push(lgVideo);

        const lg = lightGallery(container, {
            plugins,
            dynamic: true,
            dynamicEl: items,
            index: startIndex,
            licenseKey: LG_LICENSE,
            speed: 380,
            mobileSettings: { controls: true, showCloseIcon: true, download: false },
            download: false,
            // Zoom plugin config — without these, the +/- buttons are hidden by
            // default in LG 2.x and small images / GIFs cannot be scaled up.
            // - showZoomInOutIcons: render the +/- toolbar buttons
            // - actualSize:        adds a "1:1 actual size" toggle
            // - scale:             zoom step per click
            // - enableZoomAfter:   wait for the open animation before binding
            //                      pinch/wheel listeners (avoids first-zoom misfire)
            // - zoomFromOrigin:    cleaner enter animation
            zoom: true,
            showZoomInOutIcons: true,
            actualSize: true,
            scale: 1,
            enableZoomAfter: 300,
            zoomFromOrigin: false,
        });

        // Open after tiny delay to let LG initialise
        requestAnimationFrame(() => lg.openGallery(startIndex));

        container.addEventListener("lgAfterClose", () => {
            lg.destroy();
            container.remove();
        }, { once: true });
    }

    /* ── Bind LightGallery click handlers to a freshly added incident ── */
    function bindLightGallery(scope) {
        const root = scope || document;
        // Images in markdown body
        root.querySelectorAll(".markdown-body img").forEach((img) => {
            if (img.dataset.lgBound) return;
            img.dataset.lgBound = "1";
            img.addEventListener("click", () => {
                const incident = img.closest(".incident-item");
                if (!incident) return;
                const items = buildGalleryItems(incident);
                const idx   = items.findIndex((it) => it.src === (img.src || img.dataset.src));
                openLightGallery(items, Math.max(0, idx));
            });
        });

        // Legacy image evidence
        root.querySelectorAll(".incident-legacy-img").forEach((img) => {
            if (img.dataset.lgBound) return;
            img.dataset.lgBound = "1";
            img.addEventListener("click", () => {
                const incident = img.closest(".incident-item");
                if (!incident) return;
                const items = buildGalleryItems(incident);
                const mdCount = incident.querySelectorAll(".markdown-body img").length;
                openLightGallery(items, mdCount);
            });
        });

        // Video evidence
        root.querySelectorAll(".incident-video-wrap").forEach((wrap) => {
            if (wrap.dataset.lgBound) return;
            wrap.dataset.lgBound = "1";
            wrap.addEventListener("click", () => {
                const incident = wrap.closest(".incident-item");
                if (!incident) return;
                const items = buildGalleryItems(incident);
                // Video is always last item
                openLightGallery(items, items.length - 1);
            });
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       WEBSOCKET
    ═══════════════════════════════════════════════════════════════ */
    function updateConnectionStatus(t) { if (liveConnectionStatus) liveConnectionStatus.textContent = t; }
    function updateTopStatus(t)        { if (incidentTopStatus)    incidentTopStatus.textContent = t || ""; }

    function buildWsUrl() {
        if (!monitorRoot) return "";
        const p = monitorRoot.dataset.wsPath;
        if (!p) return "";
        return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${p}`;
    }

    function connectLiveSocket() {
        if (!monitorRoot) return;
        const url = buildWsUrl();
        if (!url) return;
        if (liveSocket && (liveSocket.readyState === WebSocket.OPEN || liveSocket.readyState === WebSocket.CONNECTING)) return;

        updateConnectionStatus("Connecting websocket...");
        try { liveSocket = new WebSocket(url); }
        catch (_) { updateConnectionStatus("Realtime unavailable"); return; }

        liveSocket.addEventListener("open",    () => { reconnectDelayMs = 1000; updateConnectionStatus("Live updates connected"); });
        liveSocket.addEventListener("message", (e) => {
            try { if (JSON.parse(e.data).type === "live_event") loadNewMessages(false); } catch (_) {}
        });
        liveSocket.addEventListener("error",   () => updateConnectionStatus("Realtime reconnecting..."));
        liveSocket.addEventListener("close",   () => {
            liveSocket = null;
            updateConnectionStatus("Realtime disconnected. Reconnecting...");
            setTimeout(connectLiveSocket, reconnectDelayMs);
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       INCIDENT FEED
    ═══════════════════════════════════════════════════════════════ */
    function isNearBottom() {
        if (!incidentFeed) return true;
        return incidentFeed.scrollHeight - incidentFeed.scrollTop - incidentFeed.clientHeight < 96;
    }
    function scrollToBottom() { if (incidentFeed) incidentFeed.scrollTop = incidentFeed.scrollHeight; }

    function htmlToNodes(html) {
        const w = document.createElement("div");
        w.innerHTML = html || "";
        return Array.from(w.children).filter((n) => !n.classList.contains("empty-state"));
    }

    function removeEmptyState() {
        const e = incidentListContainer?.querySelector(".empty-state");
        if (e) e.remove();
    }

    function afterNodesAdded(scope) {
        bindEvidenceGuards(scope);
        bindLightGallery(scope);
    }

    function prependIncidents(html) {
        if (!incidentListContainer || !incidentFeed) return 0;
        const nodes = htmlToNodes(html);
        if (!nodes.length) return 0;
        removeEmptyState();
        const prevH = incidentFeed.scrollHeight, prevT = incidentFeed.scrollTop;
        const frag = document.createDocumentFragment();
        nodes.forEach((n) => frag.appendChild(n));
        incidentListContainer.prepend(frag);
        afterNodesAdded(incidentListContainer);
        incidentFeed.scrollTop = prevT + (incidentFeed.scrollHeight - prevH);
        return nodes.length;
    }

    function appendIncidents(html) {
        if (!incidentListContainer) return 0;
        const nodes = htmlToNodes(html);
        if (!nodes.length) return 0;
        removeEmptyState();
        const frag = document.createDocumentFragment();
        nodes.forEach((n) => frag.appendChild(n));
        incidentListContainer.append(frag);
        afterNodesAdded(incidentListContainer);
        return nodes.length;
    }

    function mergeStatsHtml(payload) {
        if (statsTableContainer && payload.stats_html) statsTableContainer.innerHTML = payload.stats_html;
    }

    async function loadOlderMessages() {
        if (loadingOlder || !hasOlder || !monitorRoot || !oldestId) return;
        const historyUrl = monitorRoot.dataset.historyUrl;
        if (!historyUrl) return;
        loadingOlder = true;
        updateTopStatus("Loading older messages...");
        try {
            const res = await fetch(`${historyUrl}?before=${encodeURIComponent(oldestId)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
            if (!res.ok) { updateTopStatus("Failed to load older messages."); return; }
            const p = await res.json();
            prependIncidents(p.incidents_html);
            if (p.oldest_id) oldestId = p.oldest_id;
            if (newestId === null && p.newest_id) newestId = p.newest_id;
            hasOlder = Boolean(p.has_older);
            updateTopStatus(!hasOlder ? "You reached the first message." : "");
        } catch (_) { updateTopStatus("Failed to load older messages."); }
        finally { loadingOlder = false; }
    }

    async function loadNewMessages(forceStick) {
        if (loadingUpdates || !monitorRoot) return;
        const updatesUrl = monitorRoot.dataset.updatesUrl;
        if (!updatesUrl) return;
        loadingUpdates = true;
        const shouldStick = forceStick || isNearBottom();
        try {
            const res = await fetch(`${updatesUrl}?after=${encodeURIComponent(newestId || 0)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
            if (!res.ok) return;
            const p = await res.json();
            const added = appendIncidents(p.incidents_html);
            mergeStatsHtml(p);
            if (p.newest_id) newestId = p.newest_id;
            if (oldestId === null && p.oldest_id) oldestId = p.oldest_id;
            if (shouldStick && added > 0) scrollToBottom();
        } catch (e) { console.debug("Update fetch failed:", e); }
        finally { loadingUpdates = false; }
    }

    /* ═══════════════════════════════════════════════════════════════
       CANDIDATE DETAIL PANEL
    ═══════════════════════════════════════════════════════════════ */
    async function openCandidateDetail(sbd) {
        if (!detailContent || !detailCanvas) return;
        detailContent.innerHTML = '<div class="text-center py-4 text-muted">Loading...</div>';
        detailCanvas.show();
        try {
            const res = await fetch(`/stats/candidate/${encodeURIComponent(sbd)}/`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
            if (!res.ok) { detailContent.innerHTML = '<div class="alert alert-danger">Could not load candidate details.</div>'; return; }
            detailContent.innerHTML = await res.text();
            bindEvidenceGuards(detailContent);
            bindLightGallery(detailContent);
        } catch (_) { detailContent.innerHTML = '<div class="alert alert-danger">Could not load candidate details.</div>'; }
    }

    /* ═══════════════════════════════════════════════════════════════
       SBD FIELD CLIENT-SIDE VALIDATION
    ═══════════════════════════════════════════════════════════════ */
    function initSbdValidation() {
        const sbdInput = document.getElementById("id_sbd");
        const sbdError = document.getElementById("sbd-error");
        if (!sbdInput) return;

        function validate() {
            const v = sbdInput.value.trim();
            if (!v) { sbdInput.classList.remove("is-valid","is-invalid"); if (sbdError) sbdError.textContent = ""; return false; }
            const ok = isValidSbd(v);
            sbdInput.classList.toggle("is-valid",   ok);
            sbdInput.classList.toggle("is-invalid", !ok);
            if (sbdError) sbdError.textContent = ok ? "" : "Chỉ dùng chữ cái tiếng Anh (a-z, A-Z) và chữ số (0-9), tối đa 9 ký tự.";
            return ok;
        }

        sbdInput.addEventListener("input", validate);
        sbdInput.addEventListener("blur",  validate);

        const form = sbdInput.closest("form");
        if (form) form.addEventListener("submit", (e) => { if (!validate()) { e.preventDefault(); sbdInput.focus(); } });
    }

    /* ═══════════════════════════════════════════════════════════════
       MENTION SYSTEM
    ═══════════════════════════════════════════════════════════════ */
    const textarea   = document.getElementById("id_violation_text");
    const dropdown   = textarea
        ? textarea.closest(".mention-textarea-wrap")?.querySelector(".mention-dropdown")
        : null;
    const suggestTip = document.getElementById("mention-suggest-tip");

    let mentionState = { active: false, startPos: -1, query: "", items: [], activeIdx: -1, fetchTimer: null };

    async function fetchCandidates(q) {
        try {
            const res = await fetch(`/api/candidates/search/?q=${encodeURIComponent(q)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
            if (!res.ok) return [];
            return (await res.json()).results || [];
        } catch (_) { return []; }
    }

    function renderMentionDropdown(items, activeIdx) {
        if (!dropdown) return;
        dropdown.innerHTML = "";
        if (!items.length) {
            dropdown.innerHTML = '<div class="mention-dropdown-empty">Không tìm thấy SBD</div>';
        } else {
            items.forEach((item, i) => {
                const el = document.createElement("div");
                el.className = "mention-item" + (i === activeIdx ? " active" : "");
                el.setAttribute("role", "option");
                el.dataset.sbd = item.sbd;
                el.innerHTML = `<span class="mention-item-sbd">${escHtml(item.sbd)}</span>
                                <span class="mention-item-name">${escHtml(item.full_name)}</span>`;
                el.addEventListener("mousedown", (e) => { e.preventDefault(); selectMention(item.sbd); });
                dropdown.appendChild(el);
            });
        }
        dropdown.classList.add("open");
        positionMentionDropdown();
    }

    /* Dropdown is position:fixed; compute where relative to the textarea and
       flip between above/below depending on available viewport space. Called
       on open, on every re-render (e.g. arrow key → active index change),
       and on scroll/resize while open. */
    function positionMentionDropdown() {
        if (!dropdown || !textarea || !dropdown.classList.contains("open")) return;
        const rect = textarea.getBoundingClientRect();
        const vh   = window.innerHeight || document.documentElement.clientHeight;
        const vw   = window.innerWidth  || document.documentElement.clientWidth;

        // Measure dropdown size; it has max-height:220px in CSS. Use the
        // actual rendered height when available so the flip decision is
        // accurate even when fewer items are shown.
        const ddH  = Math.min(dropdown.offsetHeight || 220, 220);
        const ddW  = dropdown.offsetWidth  || 260;

        // Horizontal: align to textarea's left, but don't overflow viewport.
        let left = rect.left;
        if (left + ddW > vw - 8) left = Math.max(8, vw - ddW - 8);
        if (left < 8) left = 8;

        // Vertical: prefer ABOVE the textarea (like Slack/VSCode); flip to
        // BELOW if not enough room above.
        const spaceAbove = rect.top;
        const spaceBelow = vh - rect.bottom;
        let top;
        if (spaceAbove >= ddH + 6 || spaceAbove >= spaceBelow) {
            // Above
            top = Math.max(8, rect.top - ddH - 4);
        } else {
            // Below
            top = Math.min(vh - ddH - 8, rect.bottom + 4);
        }

        // Width: match textarea width up to a reasonable maximum.
        const width = Math.max(220, Math.min(rect.width, 380));

        dropdown.style.left  = `${Math.round(left)}px`;
        dropdown.style.top   = `${Math.round(top)}px`;
        dropdown.style.width = `${Math.round(width)}px`;
    }

    function closeMentionDropdown() {
        if (dropdown) dropdown.classList.remove("open");
        Object.assign(mentionState, { active: false, activeIdx: -1, query: "", startPos: -1, items: [] });
    }

    async function openMentionDropdown(query) {
        mentionState.active = true;
        mentionState.query  = query;
        if (mentionState.fetchTimer) clearTimeout(mentionState.fetchTimer);
        mentionState.fetchTimer = setTimeout(async () => {
            const items = await fetchCandidates(query);
            mentionState.items    = items;
            mentionState.activeIdx = items.length ? 0 : -1;
            renderMentionDropdown(items, mentionState.activeIdx);
        }, 120);
    }

    function selectMention(sbd) {
        if (!textarea) return;
        const val    = textarea.value;
        const before = val.slice(0, mentionState.startPos - 1);
        const after  = val.slice(mentionState.startPos + mentionState.query.length);
        const token  = `@{${sbd}}`;
        textarea.value = before + token + (after.startsWith(" ") ? after : " " + after);
        const cur = before.length + token.length + 1;
        textarea.setSelectionRange(cur, cur);
        textarea.focus();
        closeMentionDropdown();
        hideSuggestTip();
        // Invalidate preview cache
        if (textarea._previewDirty !== undefined) textarea._previewDirty = true;
    }

    /* Suggest tooltip */
    let suggestTimer = null, pendingSuggestWord = "";

    function showSuggestTip(word, rect) {
        if (!suggestTip) return;
        pendingSuggestWord = word;
        suggestTip.innerHTML = `Press <kbd>@</kbd> to mention <strong>${escHtml(word.toUpperCase())}</strong>`;
        suggestTip.style.left = rect.left + "px";
        suggestTip.style.top  = (rect.top - 44) + "px";
        suggestTip.classList.add("visible");
    }
    function hideSuggestTip() {
        if (suggestTip) suggestTip.classList.remove("visible");
        pendingSuggestWord = "";
        if (suggestTimer) clearTimeout(suggestTimer);
    }

    function checkSuggestTip() {
        if (!textarea) return;
        const upTo = textarea.value.slice(0, textarea.selectionStart);
        const m = SBD_SUGGEST_RE.exec(upTo);
        // Only offer the tooltip when the trailing word is a full-shape SBD
        // candidate (0–2 letters + ≥2 digits, length ≤ 9).
        if (m && SBD_SHAPE_RE.test(m[1])) {
            if (suggestTimer) clearTimeout(suggestTimer);
            suggestTimer = setTimeout(() => showSuggestTip(m[1], textarea.getBoundingClientRect()), 700);
        } else {
            hideSuggestTip();
        }
    }

    function handleTextareaInput() {
        if (textarea) textarea._previewDirty = true;
        const val   = textarea.value;
        const caret = textarea.selectionStart;
        const upTo  = val.slice(0, caret);
        const atMatch = upTo.match(/@([^\s@]*)$/);
        if (atMatch) {
            mentionState.startPos = caret - atMatch[1].length;
            openMentionDropdown(atMatch[1]);
            hideSuggestTip();
            return;
        }
        if (mentionState.active) closeMentionDropdown();
        checkSuggestTip();
    }

    function handleTextareaKeydown(e) {
        if (suggestTip?.classList.contains("visible") && e.key === "@") {
            const word = pendingSuggestWord;
            if (word) {
                e.preventDefault();
                const val = textarea.value, caret = textarea.selectionStart;
                const wordStart = val.slice(0, caret).lastIndexOf(word);
                if (wordStart >= 0) {
                    textarea.value = val.slice(0, wordStart) + "@" + val.slice(wordStart);
                    textarea.setSelectionRange(wordStart + 1, wordStart + 1);
                    hideSuggestTip();
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                }
                return;
            }
        }
        if (!mentionState.active || !dropdown?.classList.contains("open")) return;
        switch (e.key) {
            case "ArrowDown": e.preventDefault(); mentionState.activeIdx = Math.min(mentionState.activeIdx + 1, mentionState.items.length - 1); renderMentionDropdown(mentionState.items, mentionState.activeIdx); break;
            case "ArrowUp":   e.preventDefault(); mentionState.activeIdx = Math.max(mentionState.activeIdx - 1, 0); renderMentionDropdown(mentionState.items, mentionState.activeIdx); break;
            case "Enter": case "Tab":
                if (mentionState.activeIdx >= 0 && mentionState.items[mentionState.activeIdx]) { e.preventDefault(); selectMention(mentionState.items[mentionState.activeIdx].sbd); }
                break;
            case "Escape": e.preventDefault(); closeMentionDropdown(); break;
            case " ": closeMentionDropdown(); break;
        }
    }

    function initMentionSystem() {
        if (!textarea) return;
        textarea._previewDirty = true;
        textarea.addEventListener("input",   handleTextareaInput);
        textarea.addEventListener("keydown", handleTextareaKeydown);
        textarea.addEventListener("blur",    () => setTimeout(() => { closeMentionDropdown(); hideSuggestTip(); }, 150));
        textarea.addEventListener("click",   () => { if (!mentionState.active) checkSuggestTip(); });

        // Reposition the fixed-position dropdown whenever the page moves under
        // it (scroll anywhere, window resize, etc.). `capture: true` catches
        // scroll events on inner scrollers like .incident-feed too.
        window.addEventListener("scroll", positionMentionDropdown, { passive: true, capture: true });
        window.addEventListener("resize", positionMentionDropdown);
    }

    /* ═══════════════════════════════════════════════════════════════
       MARKDOWN PREVIEW TABS
       ─────────────────────────────────────────────────────────────
       Primary path: POST the draft to /incidents/preview/ and render the
       server's HTML — this guarantees parity with the live feed,
       including DB-aware mention resolution (active vs missing strike)
       and context-aware neutralisation (no live mention inside <a>, <code>,
       <pre>).

       Fallback path (only if the endpoint errors): use marked.js locally.
       In fallback mode we can only show mentions as neutral chips — we
       have no way to know which SBDs exist in the DB from the client —
       and we surface a banner so the author knows the preview is not
       authoritative.
    ═══════════════════════════════════════════════════════════════ */
    const MENTION_TOKEN_RE = /@\{([A-Za-z0-9]{1,9})\}/g;
    const PREVIEW_URL      = "/incidents/preview/";

    function getCsrfToken() {
        const el = document.querySelector("input[name=csrfmiddlewaretoken]");
        if (el) return el.value;
        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : "";
    }

    /* Fallback: pure-client render when the server endpoint isn't reachable.
       Note: mentions cannot be verified against the DB from the client, so
       we render them as neutral chips and show a warning banner. */
    function renderPreviewHtmlClient(mdText) {
        if (typeof marked === "undefined") {
            return '<em class="text-muted">Preview not available (marked.js not loaded).</em>';
        }
        const chips = {};
        const processed = mdText.replace(MENTION_TOKEN_RE, (full, sbd) => {
            const key = `CHIPPH${Object.keys(chips).length}ENDCHIP`;
            chips[key] = `<span class="mention-preview-chip">@${escHtml(sbd.toUpperCase())}</span>`;
            return key;
        });
        marked.setOptions({ breaks: true, gfm: true });
        let html = marked.parse(processed);
        Object.entries(chips).forEach(([k, v]) => { html = html.replace(k, v); });
        return (
            '<div class="alert alert-warning small py-2 mb-2">' +
            '<i class="bi bi-exclamation-triangle me-1"></i>' +
            'Preview offline — mention links are not verified against the candidate list.' +
            '</div>' + html
        );
    }

    async function refreshPreview(editorWrap) {
        const ta      = editorWrap.querySelector("textarea");
        const preview = editorWrap.querySelector(".md-pane-preview");
        const content = preview?.querySelector(".md-preview-content");
        if (!ta || !content) return;

        // Immediate loading state so the user doesn't see stale HTML.
        content.innerHTML = '<div class="text-muted small py-3 text-center">' +
            '<span class="spinner-border spinner-border-sm me-2"></span>Rendering preview…</div>';

        const sbdInput = document.getElementById("id_sbd");
        const form = new FormData();
        form.append("violation_text", ta.value);
        form.append("sbd", sbdInput ? sbdInput.value : "");

        try {
            const res = await fetch(PREVIEW_URL, {
                method: "POST",
                headers: {
                    "X-CSRFToken": getCsrfToken(),
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: form,
                credentials: "same-origin",
            });
            if (!res.ok) throw new Error(`Preview HTTP ${res.status}`);
            const data = await res.json();
            content.innerHTML = data.html || "";
            // Re-bind LightGallery on any preview images
            if (typeof bindLightGallery === "function") bindLightGallery(content);
            if (typeof bindEvidenceGuards === "function") bindEvidenceGuards(content);
        } catch (err) {
            console.warn("Preview endpoint failed, falling back to client render:", err);
            content.innerHTML = renderPreviewHtmlClient(ta.value);
        }

        ta._previewDirty = false;
    }

    function initMarkdownTabs() {
        document.querySelectorAll(".md-editor-wrap").forEach((wrap) => {
            const tabBtns     = wrap.querySelectorAll(".md-tab-btn");
            const inputPane   = wrap.querySelector(".md-pane-input");
            const previewPane = wrap.querySelector(".md-pane-preview");
            if (!tabBtns.length || !inputPane || !previewPane) return;

            tabBtns.forEach((btn) => {
                btn.addEventListener("click", () => {
                    tabBtns.forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");

                    if (btn.dataset.tab === "input") {
                        inputPane.style.display   = "";
                        previewPane.style.display = "none";
                    } else {
                        inputPane.style.display   = "none";
                        previewPane.style.display = "";
                        // Always refresh preview when switching to it
                        refreshPreview(wrap);
                    }
                });
            });

            // Invalidate preview on every input change
            const ta = wrap.querySelector("textarea");
            if (ta) {
                ta.addEventListener("input", () => { ta._previewDirty = true; });
            }
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       MARKDOWN TOOLBAR
       ─────────────────────────────────────────────────────────────
       All mutations go through insertTextAt() which uses
       document.execCommand("insertText", …) so Ctrl+Z / Ctrl+Y on the
       native textarea continue to work. execCommand is deprecated but
       still the only cross-browser way to push into the textarea's own
       undo stack; all modern browsers (Chrome, Firefox, Safari, Edge)
       still support it. If it ever returns false we fall back to direct
       assignment (and undo for that single op is lost).
    ═══════════════════════════════════════════════════════════════ */
    function insertTextAt(ta, text, replaceStart, replaceEnd) {
        ta.focus();
        ta.setSelectionRange(replaceStart, replaceEnd);
        let ok = false;
        try {
            ok = document.execCommand("insertText", false, text);
        } catch (_) { ok = false; }
        if (!ok) {
            // Fallback: direct assignment (loses undo for this op only).
            const v = ta.value;
            ta.value = v.slice(0, replaceStart) + text + v.slice(replaceEnd);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    function insertMarkdown(ta, opts) {
        const { before = "", after = before, placeholder = "text", linePrefix = "", block = false } = opts;
        ta.focus();
        const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        const sel = val.slice(start, end);
        let insert, cursorStart, cursorEnd;

        if (linePrefix) {
            const lines = (sel || placeholder).split("\n").map((l) => linePrefix + l).join("\n");
            const prefix = (block && start > 0 && val[start-1] !== "\n") ? "\n" : "";
            const suffix = (block && end < val.length && val[end] !== "\n") ? "\n" : "";
            insert = prefix + lines + suffix;
            cursorStart = start + prefix.length;
            cursorEnd   = cursorStart + insert.trim().length;
        } else if (sel) {
            insert = before + sel + after;
            cursorStart = start + before.length;
            cursorEnd   = start + before.length + sel.length;
        } else {
            insert = before + placeholder + after;
            cursorStart = start + before.length;
            cursorEnd   = start + before.length + placeholder.length;
        }

        insertTextAt(ta, insert, start, end);
        ta.setSelectionRange(cursorStart, cursorEnd);
    }

    const TOOLBAR_ACTIONS = {
        bold:      (ta) => insertMarkdown(ta, { before: "**", placeholder: "bold text" }),
        italic:    (ta) => insertMarkdown(ta, { before: "*",  placeholder: "italic text" }),
        strike:    (ta) => insertMarkdown(ta, { before: "~~", placeholder: "strikethrough" }),
        code:      (ta) => insertMarkdown(ta, { before: "`",  placeholder: "code" }),
        codeblock: (ta) => {
            const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
            insertMarkdown(ta, { before: "```\n", after: "\n```", placeholder: sel || "code block", block: true });
        },
        quote:  (ta) => insertMarkdown(ta, { linePrefix: "> ",  placeholder: "quote", block: true }),
        ul:     (ta) => insertMarkdown(ta, { linePrefix: "- ",  placeholder: "item",  block: true }),
        ol:     (ta) => insertMarkdown(ta, { linePrefix: "1. ", placeholder: "item",  block: true }),
        link: (ta) => {
            const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
            if (sel) {
                insertTextAt(ta, `[${sel}](url)`, s, e);
                const urlStart = s + sel.length + 3;
                ta.setSelectionRange(urlStart, urlStart + 3);
            } else {
                insertMarkdown(ta, { before: "[", after: "](url)", placeholder: "link text" });
            }
        },
        image: (ta) => {
            const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
            if (sel) {
                insertTextAt(ta, `![${sel}](url)`, s, e);
                const urlStart = s + sel.length + 4;
                ta.setSelectionRange(urlStart, urlStart + 3);
            } else {
                insertMarkdown(ta, { before: "![", after: "](url)", placeholder: "alt text" });
            }
        },
        upload: (ta) => {
            // Click-to-upload: open file picker, reuse the same pipeline as paste/drop.
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/jpeg,image/png,image/gif,image/webp";
            input.addEventListener("change", () => {
                const f = input.files && input.files[0];
                if (f) uploadImageForTextarea(ta, f);
            });
            input.click();
        },
        mention: (ta) => {
            const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
            if (sel && isValidSbd(sel)) {
                const s = ta.selectionStart, e = ta.selectionEnd;
                const token = `@{${sel.toUpperCase()}}`;
                insertTextAt(ta, token, s, e);
                ta.setSelectionRange(s, s + token.length);
            } else {
                insertMarkdown(ta, { before: "@{", after: "}", placeholder: "Số báo danh" });
            }
        },
        undo:   (ta) => { ta.focus(); try { document.execCommand("undo"); } catch(_) {} },
        redo:   (ta) => { ta.focus(); try { document.execCommand("redo"); } catch(_) {} },
    };

    function initMarkdownToolbars() {
        document.querySelectorAll(".md-toolbar").forEach((toolbar) => {
            const targetId = toolbar.dataset.target;
            const ta = targetId ? document.getElementById(targetId) : null;
            if (!ta) return;
            toolbar.querySelectorAll(".md-tb-btn[data-action]").forEach((btn) => {
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    const action = btn.dataset.action;
                    if (TOOLBAR_ACTIONS[action]) TOOLBAR_ACTIONS[action](ta);
                });
            });
        });

        document.querySelectorAll(".md-textarea").forEach((ta) => {
            ta.addEventListener("keydown", (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                const k = e.key.toLowerCase();
                switch (k) {
                    case "b": e.preventDefault(); TOOLBAR_ACTIONS.bold(ta);   break;
                    case "i": e.preventDefault(); TOOLBAR_ACTIONS.italic(ta); break;
                    case "k": e.preventDefault(); TOOLBAR_ACTIONS.link(ta);   break;
                    // Ctrl+Z / Cmd+Z and Ctrl+Y / Cmd+Shift+Z fall through to
                    // the native textarea undo. We don't preventDefault them.
                }
            });

            // ── Paste: if clipboard contains an image, upload it. ──
            ta.addEventListener("paste", (e) => {
                if (!e.clipboardData || !e.clipboardData.items) return;
                for (const item of e.clipboardData.items) {
                    if (item.kind === "file" && item.type.startsWith("image/")) {
                        const file = item.getAsFile();
                        if (file) {
                            e.preventDefault();  // don't paste binary gibberish as text
                            uploadImageForTextarea(ta, file);
                            return;
                        }
                    }
                }
            });

            // ── Drop: accept files dropped onto the textarea. ──
            ta.addEventListener("dragover", (e) => {
                if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(
                    (it) => it.kind === "file" && it.type.startsWith("image/"))
                ) {
                    e.preventDefault();
                }
            });
            ta.addEventListener("drop", (e) => {
                if (!e.dataTransfer || !e.dataTransfer.files) return;
                const file = Array.from(e.dataTransfer.files).find(
                    (f) => f.type.startsWith("image/")
                );
                if (file) {
                    e.preventDefault();
                    uploadImageForTextarea(ta, file);
                }
            });
        });
    }

    /* ═══════════════════════════════════════════════════════════════
       IMAGE UPLOAD (GitHub-style)
       ─────────────────────────────────────────────────────────────
       Flow:
         1. Determine the alt text:
              • if the user has a text selection, use that verbatim,
              • otherwise use the file's base name.
         2. Insert an inline placeholder at the current selection:
              ![Uploading {name}…]()
            This matches GitHub's behaviour and lets the user keep
            typing while the upload is in flight.
         3. POST the file to /incidents/upload-image/.
         4. On success, find the exact placeholder substring and
            replace it with  ![{alt}]({url}).
         5. On failure, replace with ![Upload failed]() and show a
            toast with the error message.
    ═══════════════════════════════════════════════════════════════ */
    const UPLOAD_URL = "/incidents/upload-image/";

    function baseNameForFile(file) {
        const n = (file && file.name) || "image";
        // Strip extension so the placeholder reads ![Uploading photo…]()
        // not ![Uploading photo.png…](); looks cleaner à la GitHub.
        return n.replace(/\.[^.]+$/, "") || "image";
    }

    function showToast(msg, variant) {
        // Use Bootstrap toasts if the container exists (base.html renders it),
        // otherwise fall back to a console warning. Keep this lightweight.
        const container = document.querySelector(".toast-container");
        if (!container || typeof bootstrap === "undefined") {
            console.warn("[upload]", msg);
            return;
        }
        const el = document.createElement("div");
        el.className = `toast app-toast align-items-center text-bg-${variant || "danger"} border-0`;
        el.setAttribute("role", "alert");
        el.innerHTML = `
            <div class="d-flex">
              <div class="toast-body">${escHtml(msg)}</div>
              <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>`;
        container.appendChild(el);
        new bootstrap.Toast(el, { delay: 5000 }).show();
        el.addEventListener("hidden.bs.toast", () => el.remove());
    }

    async function uploadImageForTextarea(ta, file) {
        const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
        const selected = ta.value.slice(selStart, selEnd);
        const alt = (selected && selected.trim()) || baseNameForFile(file);
        const placeholder = `![Uploading ${alt}…]()`;

        // Step 1: drop the placeholder into the textarea using the undo-aware path.
        insertTextAt(ta, placeholder, selStart, selEnd);
        // Move caret just after the placeholder so typing can continue.
        const afterIdx = selStart + placeholder.length;
        ta.setSelectionRange(afterIdx, afterIdx);

        // Step 2: POST the file.
        const form = new FormData();
        form.append("image", file);

        let replacement;
        try {
            const res = await fetch(UPLOAD_URL, {
                method: "POST",
                headers: {
                    "X-CSRFToken": getCsrfToken(),
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: form,
                credentials: "same-origin",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = data.error || `Upload failed (HTTP ${res.status})`;
                showToast(msg);
                replacement = `![Upload failed]()`;
            } else if (!data.url) {
                showToast("Upload succeeded but server did not return a URL.");
                replacement = `![Upload failed]()`;
            } else {
                replacement = `![${alt}](${data.url})`;
            }
        } catch (err) {
            console.warn("Image upload error:", err);
            showToast("Upload failed: " + (err.message || err));
            replacement = `![Upload failed]()`;
        }

        // Step 3: replace the placeholder wherever it now lives (the user may
        // have typed around it in the meantime). Locate the first occurrence
        // and do a single direct replacement — this is a second mutation so
        // it lands as a separate undo step.
        const cur = ta.value;
        const idx = cur.indexOf(placeholder);
        if (idx !== -1) {
            insertTextAt(ta, replacement, idx, idx + placeholder.length);
            const caret = idx + replacement.length;
            ta.setSelectionRange(caret, caret);
        }
        ta._previewDirty = true;
    }

    /* ═══════════════════════════════════════════════════════════════
       GLOBAL CLICK DELEGATION
    ═══════════════════════════════════════════════════════════════ */
    document.addEventListener("click", (e) => {
        const candidateBtn = e.target.closest(".js-open-candidate-detail");
        if (candidateBtn) { openCandidateDetail(candidateBtn.dataset.sbd); return; }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const link = e.target.closest(".mention-link.js-open-candidate-detail");
        if (link) { e.preventDefault(); openCandidateDetail(link.dataset.sbd); }
    });

    /* ═══════════════════════════════════════════════════════════════
       INIT
    ═══════════════════════════════════════════════════════════════ */
    bindEvidenceGuards(document);
    blockClipboardForEvidence();
    bindLightGallery(document); // for pre-rendered incidents on page load
    initSbdValidation();
    initMentionSystem();
    initMarkdownToolbars();
    initMarkdownTabs();

    if (incidentFeed) {
        incidentFeed.addEventListener("scroll", () => {
            if (incidentFeed.scrollTop < 80) loadOlderMessages();
        });
    }

    if (monitorRoot) {
        scrollToBottom();
        connectLiveSocket();
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) { connectLiveSocket(); loadNewMessages(false); }
        });
    }
})();

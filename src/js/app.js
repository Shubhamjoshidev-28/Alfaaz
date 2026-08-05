/* ==========================================================================
   Alfaaz · app.js
   Single-file application logic: routing, rendering, the persistent player,
   the add/edit modal, search, IndexedDB-backed downloads and PWA wiring.
   Vanilla JS only — views are plain sections toggled with a `.is-active`
   class so the app behaves like an SPA without any router library.
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Tiny DOM helpers                                                   */
  /* ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const PLACEHOLDER_COVER = "assets/images/album-placeholder.svg";
  const PLACEHOLDER_ARTIST = "assets/images/artist-placeholder.svg";

  /* ------------------------------------------------------------------ */
  /*  App state                                                          */
  /* ------------------------------------------------------------------ */
  const state = {
    songs: [],              // full song list from the backend
    loading: true,
    view: "songs",
    activeArtist: null,     // artist name currently filtered on
    searchQuery: "",
    openSongId: null,       // song shown in Song Details
    downloads: [],          // cached from IndexedDB: [{id, title, artist, lyrics, downloadedAt}]
    downloadObjectUrls: {}, // id -> blob object URL (created lazily)
    editingSongId: null,    // set when the modal is in "edit" mode
    pendingAudioFile: null, // File selected in the add/edit modal

    // player
    playQueue: [],          // the list the current song was played from
    currentIndex: -1,
    isPlaying: false,
  };

  /* ------------------------------------------------------------------ */
  /*  Utilities                                                          */
  /* ------------------------------------------------------------------ */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function getAudioUrl(song) {
    return song.audio_file || song.audio || song.file || song.audio_url || "";
  }

  function songId(song) {
    return song.id ?? song.pk ?? song.song_id;
  }

  let toastTimer = 0;
  function toast(message, type = "default") {
    const stack = $("#toast-stack");
    const el = document.createElement("div");
    el.className = `toast${type === "error" ? " is-error" : ""}${type === "success" ? " is-success" : ""}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* ------------------------------------------------------------------ */
  /*  IndexedDB — offline downloads store                                */
  /* ------------------------------------------------------------------ */
  const DB_NAME = "alfaaz-db";
  const DB_VERSION = 1;
  const STORE_DOWNLOADS = "downloads";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
          db.createObjectStore(STORE_DOWNLOADS, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOADS, "readwrite");
      tx.objectStore(STORE_DOWNLOADS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOADS, "readwrite");
      tx.objectStore(STORE_DOWNLOADS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DOWNLOADS, "readonly");
      const req = tx.objectStore(STORE_DOWNLOADS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function refreshDownloadsFromDb() {
    try {
      state.downloads = await idbGetAll();
    } catch (err) {
      state.downloads = [];
    }
  }

  function isDownloaded(id) {
    return state.downloads.some((d) => d.id === id);
  }

  /* ------------------------------------------------------------------ */
  /*  Data loading                                                       */
  /* ------------------------------------------------------------------ */
  async function loadSongs() {
    state.loading = true;
    renderCurrentView();
    try {
      const data = await window.alfaazApi.getSongs();
      state.songs = Array.isArray(data.song) ? data.song : [];
    } catch (err) {
      state.songs = [];
      toast("Couldn't reach the backend. Check your connection and try again.", "error");
    } finally {
      state.loading = false;
      renderCurrentView();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Filtering                                                           */
  /* ------------------------------------------------------------------ */
  function matchesSearch(song) {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    return (
      (song.title || "").toLowerCase().includes(q) ||
      (song.artist_name || "").toLowerCase().includes(q)
    );
  }

  function getFilteredSongs() {
    return state.songs.filter(matchesSearch);
  }

  function getArtistGroups() {
    const map = new Map();
    state.songs.forEach((s) => {
      const name = s.artist_name || "Unknown Artist";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(s);
    });
    return map;
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering — Songs grid (reused by Songs / Artist Songs / Downloads) */
  /* ------------------------------------------------------------------ */
  function buildSongCard(song, { fromDownloads = false } = {}) {
    const tpl = $("#song-card-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const id = songId(song);
    node.dataset.id = id;

    $(".song-cover-img", node).src = PLACEHOLDER_COVER;
    $(".song-cover-img", node).alt = `${song.title} cover art`;
    $(".song-card-title", node).textContent = song.title || "Untitled";
    $(".song-card-artist", node).textContent = song.artist_name || "Unknown Artist";

    if (fromDownloads || isDownloaded(id)) {
      $(".downloaded-badge", node).hidden = false;
    }

    if (state.playQueue[state.currentIndex] && songId(state.playQueue[state.currentIndex]) === id) {
      node.classList.add(state.isPlaying ? "is-playing" : "is-selected");
    }

    // Card click → open details (ignore clicks on the menu / play overlay)
    node.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      openSongDetails(song, fromDownloads ? "downloads" : state.view === "artist-songs" ? "artist-songs" : "songs");
    });

    $("[data-action='play-card']", node).addEventListener("click", (e) => {
      e.stopPropagation();
      const list = fromDownloads ? state.downloads : currentListForView();
      playSong(song, list);
    });

    const menuToggle = $("[data-action='toggle-menu']", node);
    const menuList = $(".song-menu-list", node);
    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !menuList.hidden;
      closeAllMenus();
      menuList.hidden = isOpen;
    });

    $("[data-action='edit-card']", node)?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllMenus();
      openEditModal(song);
    });
    $("[data-action='delete-card']", node)?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllMenus();
      confirmDeleteSong(song);
    });
    const dlBtn = $("[data-action='download-card']", node);
    if (fromDownloads) {
      // Downloads offer "remove" instead of "download"
      dlBtn.textContent = "Remove download";
      dlBtn.dataset.action = "remove-download";
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAllMenus();
        removeDownload(id);
      });
    } else {
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAllMenus();
        downloadSong(song);
      });
    }

    return node;
  }

  function closeAllMenus() {
    $$(".song-menu-list").forEach((m) => (m.hidden = true));
  }
  document.addEventListener("click", closeAllMenus);

  function renderSkeletons(container, count = 6) {
    container.innerHTML = "";
    const tpl = $("#skeleton-song-template");
    for (let i = 0; i < count; i++) {
      container.appendChild(tpl.content.firstElementChild.cloneNode(true));
    }
  }

  function renderSongsView() {
    const grid = $("#songs-grid");
    const empty = $("#songs-empty");
    if (state.loading) {
      empty.hidden = true;
      renderSkeletons(grid);
      return;
    }
    const list = getFilteredSongs();
    grid.innerHTML = "";
    if (!list.length) {
      empty.hidden = false;
      empty.querySelector("h3").textContent = state.searchQuery ? "No matches" : "No songs yet";
      empty.querySelector("p").textContent = state.searchQuery
        ? `Nothing matches “${state.searchQuery}.”`
        : "Add your first track and it'll show up here.";
      const addBtn = empty.querySelector("button");
      if (addBtn) addBtn.style.display = state.searchQuery ? "none" : "";
      return;
    }
    empty.hidden = true;
    list.forEach((song) => grid.appendChild(buildSongCard(song)));
  }

  function renderArtistsView() {
    const grid = $("#artists-grid");
    const empty = $("#artists-empty");
    const groups = getArtistGroups();
    grid.innerHTML = "";
    if (!groups.size) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const tpl = $("#artist-card-template");
    [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, songs]) => {
        const node = tpl.content.firstElementChild.cloneNode(true);
        $("img", node).src = PLACEHOLDER_ARTIST;
        $("img", node).alt = name;
        $(".artist-card-name", node).textContent = name;
        $(".artist-card-count", node).textContent = `${songs.length} song${songs.length === 1 ? "" : "s"}`;
        node.addEventListener("click", () => {
          state.activeArtist = name;
          navigate("artist-songs");
        });
        grid.appendChild(node);
      });
  }

  function renderArtistSongsView() {
    const grid = $("#artist-songs-grid");
    const name = state.activeArtist;
    const songs = state.songs.filter((s) => (s.artist || "Unknown Artist") === name && matchesSearch(s));
    $("#artist-songs-name").textContent = name || "Artist";
    $("#artist-songs-count").textContent = `${songs.length} song${songs.length === 1 ? "" : "s"}`;
    $("#artist-songs-avatar").src = PLACEHOLDER_ARTIST;
    grid.innerHTML = "";
    songs.forEach((song) => grid.appendChild(buildSongCard(song)));
  }

  async function renderDownloadsView() {
    await refreshDownloadsFromDb();
    const grid = $("#downloads-grid");
    const empty = $("#downloads-empty");
    const list = state.downloads.filter(matchesSearch);
    grid.innerHTML = "";
    if (!list.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.forEach((song) => grid.appendChild(buildSongCard(song, { fromDownloads: true })));
  }

  /* ------------------------------------------------------------------ */
  /*  Song details view + lyrics flip                                    */
  /* ------------------------------------------------------------------ */
  function openSongDetails(song, fromView) {
    state.openSongId = songId(song);
    state._detailsSourceView = fromView;
    $("#details-artist").textContent = song.artist_name || "Unknown Artist";
    $("#details-title").textContent = song.title || "Untitled";
    $("#details-cover-img").src = PLACEHOLDER_COVER;
    $("#details-lyrics-text").textContent = song.lyrics && song.lyrics.trim() ? song.lyrics : "No lyrics available for this song yet.";
    $("#details-flip").classList.remove("is-flipped");
    $("#details-download").dataset.songId = songId(song);
    navigate("song-details");
    updateDetailsTransportUI();
  }

  function currentListForView() {
    if (state.view === "artist-songs") {
      return state.songs.filter((s) => (s.artist_name || "Unknown Artist") === state.activeArtist);
    }
    if (state.view === "downloads" || state._detailsSourceView === "downloads") {
      return state.downloads;
    }
    return getFilteredSongs();
  }

  /* ------------------------------------------------------------------ */
  /*  Router                                                              */
  /* ------------------------------------------------------------------ */
  const VIEW_TITLES = {
    songs: "Songs",
    "song-details": "Song",
    artists: "Artists",
    "artist-songs": "Artist",
    downloads: "Downloads",
  };

  function navigate(view) {
    state.view = view;
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
    $$(".nav-item[data-route]").forEach((n) => n.classList.toggle("is-active", n.dataset.route === view));
    $("#topbar-title").textContent = VIEW_TITLES[view] || "Alfaaz";

    const searchable = view === "songs" || view === "artist-songs" || view === "downloads";
    $("#topbar-search").style.display = searchable ? "" : "none";
    $("#add-song-btn").style.display = view === "songs" ? "" : "none";
    $("#add-song-btn-mobile").style.display = view === "songs" ? "" : "none";

    closeMobileSidebar();
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function renderCurrentView() {
    switch (state.view) {
      case "songs": renderSongsView(); break;
      case "artists": renderArtistsView(); break;
      case "artist-songs": renderArtistSongsView(); break;
      case "downloads": renderDownloadsView(); break;
      // song-details is rendered directly by openSongDetails()
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Sidebar (desktop hover-expand / mobile drawer) + ripple             */
  /* ------------------------------------------------------------------ */
  function openMobileSidebar() {
    $("#sidebar").classList.add("is-open");
    $("#sidebar-scrim").classList.add("is-visible");
  }
  function closeMobileSidebar() {
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-scrim").classList.remove("is-visible");
  }

  function attachRipple(button) {
    button.addEventListener("click", (e) => {
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement("span");
      const size = Math.max(rect.width, rect.height) * 1.4;
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${(e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
      ripple.style.top = `${(e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
      button.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Global player                                                       */
  /* ------------------------------------------------------------------ */
  const audio = $("#audio-el");

  function playSong(song, list) {
    const list_ = list && list.length ? list : [song];
    const idx = list_.findIndex((s) => songId(s) === songId(song));
    state.playQueue = list_;
    state.currentIndex = idx === -1 ? 0 : idx;
    loadAndPlayCurrent();
  }

  async function loadAndPlayCurrent() {
    const song = state.playQueue[state.currentIndex];
    if (!song) return;

    const id = songId(song);
    let src = "";

    // Prefer an offline blob if this song has been downloaded.
    const downloaded = state.downloads.find((d) => d.id === id) || (isDownloaded(id) ? await idbGetAllOne(id) : null);
    if (downloaded && downloaded.audioBlob) {
      if (!state.downloadObjectUrls[id]) {
        state.downloadObjectUrls[id] = URL.createObjectURL(downloaded.audioBlob);
      }
      src = state.downloadObjectUrls[id];
    } else {
      src = getAudioUrl(song);
    }

    if (!src) {
      toast("This song has no playable audio file.", "error");
      return;
    }

    audio.src = src;
    try {
      await audio.play();
      state.isPlaying = true;
    } catch (err) {
      state.isPlaying = false;
    }

    $("#player").hidden = false;
    updatePlayerMeta(song);
    updateTransportIcons();
    renderCurrentView(); // refresh is-playing highlight on cards
  }

  async function idbGetAllOne(id) {
    const all = await idbGetAll();
    return all.find((d) => d.id === id);
  }

  function updatePlayerMeta(song) {
    const cover = PLACEHOLDER_COVER;
    $("#player-thumb").src = cover;
    $("#player-song-name").textContent = song.title || "Untitled";
    $("#player-artist-name").textContent = song.artist_name || "Unknown Artist";
    $("#player-expanded-thumb").src = cover;
    $("#player-expanded-title").textContent = song.title || "Untitled";
    $("#player-expanded-artist").textContent = song.artist_name || "Unknown Artist";
    updateDetailsTransportUI();
  }

  function updateDetailsTransportUI() {
    // Keep the Song Details play button reflecting the currently open song, if any.
    const current = state.playQueue[state.currentIndex];
    const openId = state.openSongId;
    if (current && openId != null && songId(current) === openId) {
      setPlayIcon($("#details-play"), state.isPlaying);
    } else {
      setPlayIcon($("#details-play"), false);
    }
  }

  function setPlayIcon(btn, playing) {
    if (!btn) return;
    btn.querySelector(".icon-play").hidden = playing;
    btn.querySelector(".icon-pause").hidden = !playing;
  }

  function updateTransportIcons() {
    [$("#player-play"), $("#player-expanded-play")].forEach((b) => setPlayIcon(b, state.isPlaying));
    updateDetailsTransportUI();
  }

  function togglePlay() {
    if (!state.playQueue[state.currentIndex]) return;
    if (audio.paused) {
      audio.play().then(() => { state.isPlaying = true; updateTransportIcons(); renderCurrentView(); });
    } else {
      audio.pause();
      state.isPlaying = false;
      updateTransportIcons();
      renderCurrentView();
    }
  }

  function playNext() {
    if (!state.playQueue.length) return;
    state.currentIndex = (state.currentIndex + 1) % state.playQueue.length;
    loadAndPlayCurrent();
  }
  function playPrev() {
    if (!state.playQueue.length) return;
    state.currentIndex = (state.currentIndex - 1 + state.playQueue.length) % state.playQueue.length;
    loadAndPlayCurrent();
  }

  function setSeekFill(input, pct) {
    input.style.setProperty("--fill", `${pct}%`);
  }

  function syncSeekBars() {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    [$("#details-seek"), $("#player-seek"), $("#player-expanded-seek")].forEach((el) => {
      el.value = pct;
      setSeekFill(el, pct);
    });
    $("#player-progress-fill").style.width = `${pct}%`;

    const cur = formatTime(audio.currentTime);
    const dur = formatTime(audio.duration || 0);
    $("#details-current-time").textContent = cur;
    $("#details-duration").textContent = dur;
    $("#player-current-time").textContent = cur;
    $("#player-duration").textContent = dur;
    $("#player-expanded-current").textContent = cur;
    $("#player-expanded-duration").textContent = dur;
  }

  audio.addEventListener("timeupdate", syncSeekBars);
  audio.addEventListener("loadedmetadata", syncSeekBars);
  audio.addEventListener("ended", playNext);
  audio.addEventListener("play", () => { state.isPlaying = true; updateTransportIcons(); });
  audio.addEventListener("pause", () => { state.isPlaying = false; updateTransportIcons(); });

  function wireSeekInput(input) {
    input.addEventListener("input", () => {
      setSeekFill(input, input.value);
      if (audio.duration) audio.currentTime = (input.value / 100) * audio.duration;
    });
  }
  [$("#details-seek"), $("#player-seek"), $("#player-expanded-seek")].forEach(wireSeekInput);

  $("#player-progress-track").addEventListener("click", (e) => {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });

  $("#player-volume").addEventListener("input", (e) => {
    audio.volume = e.target.value / 100;
    setSeekFill(e.target, e.target.value);
  });
  audio.volume = 0.8;

  [
    ["#details-play", togglePlay], ["#details-prev", playPrev], ["#details-next", playNext],
    ["#player-play", togglePlay], ["#player-prev", playPrev], ["#player-next", playNext],
    ["#player-expanded-play", togglePlay], ["#player-expanded-prev", playPrev], ["#player-expanded-next", playNext],
  ].forEach(([sel, fn]) => $(sel).addEventListener("click", fn));

  $("#player-summary").addEventListener("click", () => setPlayerExpanded(true));
  $("#player-expand-toggle").addEventListener("click", () => setPlayerExpanded($("#player").dataset.state !== "expanded"));
  $("#player-collapse-btn").addEventListener("click", () => setPlayerExpanded(false));

  function setPlayerExpanded(expanded) {
    $("#player").dataset.state = expanded ? "expanded" : "collapsed";
  }

  $("#details-flip").addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")) return;
    $("#details-flip").classList.toggle("is-flipped");
  });

  /* ------------------------------------------------------------------ */
  /*  Song Details action buttons                                         */
  /* ------------------------------------------------------------------ */
  $("#view-song-details").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const song = state.songs.find((s) => songId(s) === state.openSongId) ||
                 state.downloads.find((s) => s.id === state.openSongId);
    if (!song) return;

    if (btn.dataset.action === "download") downloadSong(song, btn);
    if (btn.dataset.action === "edit") openEditModal(song);
    if (btn.dataset.action === "delete") confirmDeleteSong(song);
  });

  $("[data-action='back-to-songs']").addEventListener("click", () => navigate("songs"));
  $("[data-action='back-to-artists']").addEventListener("click", () => navigate("artists"));

  /* ------------------------------------------------------------------ */
  /*  Download flow                                                        */
  /* ------------------------------------------------------------------ */
  async function downloadSong(song, triggerBtn) {
    const id = songId(song);
    if (isDownloaded(id)) {
      toast("Already downloaded.");
      return;
    }
    const url = getAudioUrl(song);
    if (!url) {
      toast("No audio file to download for this song.", "error");
      return;
    }
    const label = triggerBtn ? triggerBtn.innerHTML : null;
    if (triggerBtn) triggerBtn.textContent = "Downloading… 0%";

    try {
      const blob = await window.alfaazApi.downloadAudio(url, (pct) => {
        if (triggerBtn) triggerBtn.textContent = `Downloading… ${pct}%`;
      });
      await idbPut({
        id,
        title: song.title,
        artist: song.artist_name,
        lyrics: song.lyrics || "",
        audioBlob: blob,
        downloadedAt: Date.now(),
      });
      await refreshDownloadsFromDb();
      toast(`“${song.title}” downloaded for offline playback.`, "success");
      renderCurrentView();
    } catch (err) {
      toast(err.message || "Download failed.", "error");
    } finally {
      if (triggerBtn && label) triggerBtn.innerHTML = label;
    }
  }

  async function removeDownload(id) {
    await idbDelete(id);
    if (state.downloadObjectUrls[id]) {
      URL.revokeObjectURL(state.downloadObjectUrls[id]);
      delete state.downloadObjectUrls[id];
    }
    await refreshDownloadsFromDb();
    toast("Removed from downloads.");
    renderCurrentView();
  }

  /* ------------------------------------------------------------------ */
  /*  Delete song (backend)                                               */
  /* ------------------------------------------------------------------ */
  async function confirmDeleteSong(song) {
    const ok = window.confirm(`Delete “${song.title}”? This can't be undone.`);
    if (!ok) return;
    try {
      await window.alfaazApi.deleteSong(songId(song));
      state.songs = state.songs.filter((s) => songId(s) !== songId(song));
      toast("Song deleted.", "success");
      if (state.view === "song-details") navigate(state._detailsSourceView === "artist-songs" ? "artist-songs" : "songs");
      else renderCurrentView();
    } catch (err) {
      toast(err.message || "Couldn't delete song.", "error");
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Add / Edit modal                                                    */
  /* ------------------------------------------------------------------ */
  const modalScrim = $("#song-modal-scrim");
  const songForm = $("#song-form");

  function openAddModal() {
    state.editingSongId = null;
    state.pendingAudioFile = null;
    $("#song-modal-title").textContent = "Add Song";
    $("#song-modal-submit").textContent = "Add Song";
    songForm.reset();
    $("#dropzone-filename").textContent = "";
    modalScrim.hidden = false;
    setTimeout(() => $("#field-title").focus(), 50);
  }

  function openEditModal(song) {
    state.editingSongId = songId(song);
    state.pendingAudioFile = null;
    $("#song-modal-title").textContent = "Edit Song";
    $("#song-modal-submit").textContent = "Update";
    $("#field-title").value = song.title || "";
    $("#field-artist").value = song.artist_name || "";
    $("#field-lyrics").value = song.lyrics || "";
    $("#dropzone-filename").textContent = "";
    modalScrim.hidden = false;
    setTimeout(() => $("#field-title").focus(), 50);
  }

  function closeModal() {
    modalScrim.hidden = true;
  }

  $("#add-song-btn").addEventListener("click", openAddModal);
  $("#add-song-btn-mobile").addEventListener("click", openAddModal);
  $$("[data-action='open-add']").forEach((b) => b.addEventListener("click", openAddModal));
  $("#song-modal-close").addEventListener("click", closeModal);
  $("#song-modal-cancel").addEventListener("click", closeModal);
  modalScrim.addEventListener("click", (e) => { if (e.target === modalScrim) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modalScrim.hidden) closeModal(); });

  // Dropzone
  const dropzone = $("#dropzone");
  const fileInput = $("#field-audio");
  dropzone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("is-dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("is-dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) setPendingAudioFile(file);
  });
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) setPendingAudioFile(file);
  });
  function setPendingAudioFile(file) {
    state.pendingAudioFile = file;
    $("#dropzone-filename").textContent = file.name;
  }

  songForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#field-title").value.trim();
    const artist = $("#field-artist").value.trim();
    const lyrics = $("#field-lyrics").value.trim();
    if (!title || !artist) return;

    const submitBtn = $("#song-modal-submit");
    const original = submitBtn.textContent;
    submitBtn.textContent = state.editingSongId ? "Updating…" : "Adding…";
    submitBtn.disabled = true;

    try {
      if (state.editingSongId) {
        const updated = await window.alfaazApi.updateSong(state.editingSongId, {
          title, artist_name, lyrics, audioFile: state.pendingAudioFile,
        });
        const idx = state.songs.findIndex((s) => songId(s) === state.editingSongId);
        if (idx !== -1) state.songs[idx] = { ...state.songs[idx], ...(updated || { title, artist_name, lyrics }) };
        toast("Song updated.", "success");
      } else {
        const created = await window.alfaazApi.addSong({ title, artist_name, lyrics, audioFile: state.pendingAudioFile });
        state.songs.unshift(created || { id: `local-${Date.now()}`, title, artist_name, lyrics });
        toast("Song added.", "success");
      }
      closeModal();
      renderCurrentView();
    } catch (err) {
      toast(err.message || "Something went wrong. Please try again.", "error");
    } finally {
      submitBtn.textContent = original;
      submitBtn.disabled = false;
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Search                                                               */
  /* ------------------------------------------------------------------ */
  $("#search-input").addEventListener(
    "input",
    debounce((e) => {
      state.searchQuery = e.target.value.trim();
      renderCurrentView();
    }, 120)
  );

  /* ------------------------------------------------------------------ */
  /*  Sidebar / navigation wiring                                         */
  /* ------------------------------------------------------------------ */
  $$(".nav-item[data-route]").forEach((btn) => {
    attachRipple(btn);
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
  $("#menu-toggle").addEventListener("click", openMobileSidebar);
  $("#sidebar-close").addEventListener("click", closeMobileSidebar);
  $("#sidebar-scrim").addEventListener("click", closeMobileSidebar);

  /* ------------------------------------------------------------------ */
  /*  Connection status                                                    */
  /* ------------------------------------------------------------------ */
  function updateConnectionStatus() {
    const online = navigator.onLine;
    $("#connection-dot").classList.toggle("is-offline", !online);
    $("#connection-label").textContent = online ? "Online" : "Offline";
    if (!online) toast("You're offline — downloaded songs still play.", "default");
  }
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  /* ------------------------------------------------------------------ */
  /*  Service worker registration                                         */
  /* ------------------------------------------------------------------ */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {
        /* offline-first still works via IndexedDB even if SW registration fails */
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                                 */
  /* ------------------------------------------------------------------ */
  async function boot() {
    updateConnectionStatus();
    await refreshDownloadsFromDb();
    navigate("songs");
    await loadSongs();
  }

  boot();
})();

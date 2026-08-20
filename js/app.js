/* ===========================================================
   app.js — Alfaaz
   Vanilla ES6. No frameworks. Organized into small classes/modules
   that are wired together in App.init().
   =========================================================== */

'use strict';

/* ===========================================================
   1. OFFLINE STORE (IndexedDB) — downloaded songs for offline playback
   =========================================================== */
class OfflineStore {
  static DB_NAME = 'alfaaz-db';
  static DB_VERSION = 1;
  static STORE = 'downloads';
  static _dbPromise = null;

  static open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OfflineStore.STORE)) {
          db.createObjectStore(OfflineStore.STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  static async saveSong(song, audioBlob, lyricsText) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put({
        id: song.id,
        title: song.title,
        artist_name: song.artist_name,
        lyrics_text: lyricsText || '',
        audio_blob: audioBlob,
        downloaded_at: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  static async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  static async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  static async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  static async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

/* ===========================================================
   2. AUDIO PLAYER CONTROLLER
   =========================================================== */
class AudioPlayerController {
  constructor(audioEl) {
    this.audio = audioEl;
    this.playlist = [];
    this.index = -1;
    this.shuffle = false;
    this.loop = false;
    this._objectUrl = null;

    this.audio.addEventListener('timeupdate', () => this._emit());
    this.audio.addEventListener('loadedmetadata', () => this._emit());
    this.audio.addEventListener('play', () => this._emit());
    this.audio.addEventListener('pause', () => this._emit());
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => {
      this._emit({ error: 'This song could not be played.' });
    });

    this._initMediaSession();
  }

  /**
   * Wires OS/browser-level media controls (lock screen, headset buttons,
   * hardware media keys) to the same playback engine. Purely additive —
   * the app works identically when the Media Session API is unavailable.
   */
  _initMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const safeSetHandler = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch (_) { /* action not supported by this browser — ignore */ }
    };

    safeSetHandler('play', () => this._safePlay());
    safeSetHandler('pause', () => this.audio.pause());
    safeSetHandler('previoustrack', () => this.prev());
    safeSetHandler('nexttrack', () => this.next(true));
    safeSetHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      this.audio.currentTime = Math.max(0, this.audio.currentTime - skip);
    });
    safeSetHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      const max = isFinite(this.audio.duration) ? this.audio.duration : Infinity;
      this.audio.currentTime = Math.min(max, this.audio.currentTime + skip);
    });
  }

  _updateMediaSessionMetadata(song) {
    if (!('mediaSession' in navigator) || !song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'Untitled',
        artist: song.artist_name || 'Unknown Artist',
        album: 'Alfaaz'
      });
    } catch (_) { /* MediaMetadata unavailable — ignore */ }
  }

  get current() {
    return this.index >= 0 ? this.playlist[this.index] : null;
  }

  async playAt(playlist, index) {
   if (!playlist?.length) return;
 
   this.playlist = playlist;
   this.index = index;
 
   const loaded = await this._loadCurrent();
 
   if (!loaded) return;
 
   try {
     await this.audio.play();
   } catch (error) {
     console.error('Audio playback failed:', error);
 
     this._emit({
       error: 'Unable to play this song.'
     });
   }
  } 

  async playSong(song, contextList) {
    const list = contextList && contextList.length ? contextList : [song];
    const idx = list.findIndex(s => s.id === song.id);
    await this.playAt(list, idx === -1 ? 0 : idx);
  }

  async _loadCurrent() {
   const song = this.current;
 
   if (!song) return false;
 
   if (this._objectUrl) {
     URL.revokeObjectURL(this._objectUrl);
     this._objectUrl = null;
   }
 
   let src = null;
 
   // First try the offline copy.
   try {
     const offline = await OfflineStore.get(song.id);
 
     if (offline?.audio_blob) {
       this._objectUrl = URL.createObjectURL(
         offline.audio_blob
       );
 
       src = this._objectUrl;
     }
   } catch (error) {
     console.warn(
       'Offline storage unavailable:',
       error
     );
   }
 
   // Otherwise use the backend audio file.
   if (!src) {
     if (!song.audio_path) {
       this._emit({
         error: 'This song has no audio file.'
       });
 
       return false;
     }
 
     src = ApiService.resolveMediaUrl(
       song.audio_path
     );
   }
 
   this.audio.pause();
 
   this.audio.src = src;
   this.audio.currentTime = 0;
   this.audio.load();

   this._updateMediaSessionMetadata(song);
 
   return true;
  }

  _safePlay() {
    const p = this.audio.play();
    if (p && p.catch) p.catch(() => this._emit({ error: 'Playback was blocked. Tap play again.' }));
  }

  togglePlay() {
    if (!this.current) return;
    if (this.audio.paused) this._safePlay();
    else this.audio.pause();
  }

  async next(manual) {
    if (!this.playlist.length) return;
    let nextIndex;
    if (this.shuffle) {
      if (this.playlist.length === 1) nextIndex = 0;
      else {
        do { nextIndex = Math.floor(Math.random() * this.playlist.length); }
        while (nextIndex === this.index);
      }
    } else {
      nextIndex = this.index + 1;
      if (nextIndex >= this.playlist.length) {
        if (!manual && !this.loop) { this._emit(); return; }
        nextIndex = 0;
      }
    }
    this.index = nextIndex;
    const loaded = await this._loadCurrent();
    if (!loaded) return;
    try {     await this.audio.play();  } catch (error) {      console.error('Next song playback failed:', error);   }
  }

  async prev() {
    if (!this.playlist.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    let prevIndex = this.index - 1;
    if (prevIndex < 0) prevIndex = this.playlist.length - 1;
    this.index = prevIndex;
    const loaded = await this._loadCurrent();
    if (!loaded) return;
    try {     await this.audio.play();  } catch (error) {      console.error('Previous song playback failed:', error);   }
  }

  _onEnded() {
    if (this.loop && this.playlist.length === 1) {
      this.audio.currentTime = 0;
      this._safePlay();
      return;
    }
    this.next(false);
  }

  seekToFraction(fraction) {
    if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    const clampedFraction = Math.min(Math.max(fraction, 0), 1);
    const target = Math.min(Math.max(clampedFraction * this.audio.duration, 0), this.audio.duration);
    this.audio.currentTime = target;
  }

  setVolume(v) { this.audio.volume = v; }

  toggleShuffle() { this.shuffle = !this.shuffle; this._emit(); }
  toggleLoop() { this.loop = !this.loop; this._emit(); }

  _emit(extra) {
    const isPlaying = !this.audio.paused && !this.audio.ended;

    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('alfaaz:player-update', {
      detail: Object.assign({
        song: this.current,
        isPlaying,
        currentTime: this.audio.currentTime || 0,
        duration: this.audio.duration || 0,
        shuffle: this.shuffle,
        loop: this.loop
      }, extra || {})
    }));
  }
}

/* ===========================================================
   3. SMALL HELPERS
   =========================================================== */
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message, type = 'default') {
  const container = el('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s ease, transform .3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    setTimeout(() => toast.remove(), 320);
  }, 3400);
}

function renderStatus(container, { icon = '', title, sub, retry }) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'status-box';
  box.innerHTML = `
    ${icon}
    <p class="status-title"></p>
    <p class="status-sub"></p>
  `;
  box.querySelector('.status-title').textContent = title;
  box.querySelector('.status-sub').textContent = sub || '';
  if (retry) {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.textContent = 'Retry';
    btn.addEventListener('click', retry);
    box.appendChild(btn);
  }
  container.appendChild(box);
}

function renderLoading(container, label) {
  renderStatus(container, { icon: '<div class="spinner"></div>', title: label || 'Loading…', sub: '' });
}

function renderEmpty(container, title, sub) {
  renderStatus(container, { icon: '<div style="font-size:34px;opacity:.5;">🎵</div>', title, sub });
}

function renderError(container, message, retry) {
  renderStatus(container, { icon: '<div style="font-size:30px;">⚠️</div>', title: 'Something went wrong', sub: message, retry });
}

/* ===========================================================
   4. MAIN APP
   =========================================================== */
const App = {
  songs: [],
  currentView: 'songs',
  currentArtist: null,
  activeSongForDetail: null,
  editingSongId: null,
  openMenuEl: null,
  downloadedIds: new Set(),

  // Seek-bar drag state: while true, player-update events must not
  // overwrite the seek bar's visual position (see onPlayerUpdate).
  isSeeking: false,

  // Bulk upload modal state.
  bulkFiles: [],
  bulkUploading: false,
  _bulkTriggerEl: null,

  player: null,

  init() {
    this.player = new AudioPlayerController(el('audioEl'));
    this.bindNav();
    this.bindSongsView();
    this.bindModal();
    this.bindBulkUploadModal();
    this.bindDetail();
    this.bindMiniPlayer();
    this.bindSettings();
    this.bindMobileHeader();
    window.addEventListener('alfaaz:player-update', (e) => this.onPlayerUpdate(e.detail));
    document.addEventListener('click', (e) => this.onGlobalClick(e));

    this.refreshDownloadedIds();
    this.loadSongs();
    this.registerServiceWorker();
    this.updateConnectionStatus();
    window.addEventListener('online', () => this.updateConnectionStatus());
    window.addEventListener('offline', () => this.updateConnectionStatus());
  },

  /** Refreshes the in-memory set of offline-downloaded song ids from IndexedDB. */
  async refreshDownloadedIds() {
    try {
      const records = await OfflineStore.getAll();
      this.downloadedIds = new Set(records.map(r => r.id));
    } catch (_) {
      this.downloadedIds = new Set();
    }
    this.reflectDownloadedState();
  },

  reflectDownloadedState() {
    document.querySelectorAll('.song-row[data-song-id]').forEach(row => {
      const id = Number(row.dataset.songId);
      const btn = row.querySelector('.row-download-btn');
      if (!btn) return;
      const downloaded = this.downloadedIds.has(id);
      btn.classList.toggle('downloaded', downloaded);
      btn.setAttribute('aria-label', downloaded ? 'Downloaded for offline playback' : `Download ${row.dataset.songTitle || 'song'}`);
    });
  },

  /** Mobile top header: logo stays visible; the search button jumps to & focuses the search field. */
  bindMobileHeader() {
    const btn = el('mobileSearchBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this.showView('songs');
      const input = el('searchInput');
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
    });
  },

  /* ---------------- NAVIGATION ---------------- */
  bindNav() {
    // Single delegated listener — not one per button — so mobile's four
    // equal-width nav items each stay independently, reliably clickable
    // without stacking duplicate handlers.
    el('sidebar').addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (!item || !el('sidebar').contains(item)) return;
      e.preventDefault();
      e.stopPropagation();
      const view = item.dataset.view;
      if (view) this.showView(view);
    });
    el('backFromArtist').addEventListener('click', () => this.showView('artists'));
  },

  showView(name) {
    this.currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    const target = el(`view-${name}`);
    if (target) target.classList.add('active');

    if (name === 'artists') this.renderArtists();
    if (name === 'downloads') this.loadDownloads();
    if (name === 'settings') this.refreshSettings();
  },

  /* ---------------- LOAD SONGS ---------------- */
  async loadSongs() {
    const status = el('songsStatus');
    const grid = el('songsGrid');
    grid.innerHTML = '';
    renderLoading(status, 'Loading your songs…');
    try {
      const songs = await ApiService.getSongs();
      this.songs = songs;
      status.innerHTML = '';
      if (!songs.length) {
        renderEmpty(status, 'No songs yet', 'Add your first song to get started.');
        return;
      }
      this.renderSongs(songs);
      this.applySearchFilter();
    } catch (err) {
      this.songs = [];
      renderError(status, err.message, () => this.loadSongs());
    }
  },

  renderSongs(songs) {
    const grid = el('songsGrid');
    grid.innerHTML = '';
    songs.forEach((song, i) => grid.appendChild(this.buildSongRow(song, songs, i)));
    this.reflectPlayingState();
    this.reflectDownloadedState();
  },

  /**
   * Builds one song-list row: [ play/pause ] [ title + artist ] [ download ] [ options ]
   * Required layout per design spec — list rows, not cards.
   */
  buildSongRow(song, contextList, index) {
    const row = document.createElement('div');
    row.className = 'song-row';
    row.style.animationDelay = `${Math.min(index * 25, 250)}ms`;
    row.dataset.songId = song.id;
    row.dataset.songTitle = song.title;

    row.innerHTML = `
      <button class="row-play-btn" type="button" aria-label="Play ${escapeHtml(song.title)}">
        <svg class="row-play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l12 7-12 7z"/></svg>
        <svg class="row-pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        <div class="row-eq" hidden><span></span><span></span><span></span></div>
      </button>
      <button class="row-meta" type="button">
        <p class="row-title"></p>
        <p class="row-artist"></p>
      </button>
      <button class="row-download-btn" type="button" aria-label="Download ${escapeHtml(song.title)}">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 17.5v2A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-1.5v-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
      <button class="row-menu-btn" type="button" aria-label="More options for ${escapeHtml(song.title)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
      </button>
      <div class="row-menu">
        <button type="button" data-action="edit">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          Edit
        </button>
        <button type="button" data-action="delete" class="danger">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Delete
        </button>
      </div>
    `;
    row.querySelector('.row-title').textContent = song.title;
    row.querySelector('.row-artist').textContent = song.artist_name;

    // Play/pause: toggles this song directly from the row.
    row.querySelector('.row-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.playFromRow(song, contextList);
    });

    // Clicking the title/artist opens the full detail view (with lyrics).
    row.querySelector('.row-meta').addEventListener('click', () => {
      this.openDetail(song, contextList);
    });

    // Download button: works right from the list, mirrors the detail-view download.
    const downloadBtn = row.querySelector('.row-download-btn');
    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.downloadedIds.has(song.id)) {
        showToast('Already downloaded for offline playback');
        return;
      }
      await this.downloadSong(song);
    });

    const menuBtn = row.querySelector('.row-menu-btn');
    const menu = row.querySelector('.row-menu');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRowMenu(menu);
    });
    menu.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAllMenus();
      this.openEditModal(song);
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAllMenus();
      this.deleteSong(song);
    });

    return row;
  },

  /** Play button on a row: toggle if it's already current, otherwise actually load and play it within its list context. */
  async playFromRow(song, contextList) {
    const isCurrent = this.player.current && this.player.current.id === song.id;

    if (isCurrent) {
      // Same song already loaded — just flip play/pause.
      this.player.togglePlay();
      return;
    }

    // Different song — this must actually load and play it, not just
    // update the internal index (that left the row's play button inert).
    this.activeSongForDetail = song;
    await this.player.playSong(song, contextList || this.songs);
  },

  toggleRowMenu(menu) {
    const wasOpen = menu.classList.contains('open');
    this.closeAllMenus();
    if (!wasOpen) { menu.classList.add('open'); this.openMenuEl = menu; }
  },
  closeAllMenus() {
    document.querySelectorAll('.row-menu.open').forEach(m => m.classList.remove('open'));
    this.openMenuEl = null;
  },
  onGlobalClick(e) {
    if (this.openMenuEl && !e.target.closest('.row-menu') && !e.target.closest('.row-menu-btn')) {
      this.closeAllMenus();
    }
  },

  /* ---------------- SEARCH ---------------- */
  bindSongsView() {
    el('searchInput').addEventListener('input', () => this.applySearchFilter());
    el('addSongBtn').addEventListener('click', () => this.openAddModal());
    el('bulkUploadBtn').addEventListener('click', (e) => this.openBulkModal(e.currentTarget));
  },

  applySearchFilter() {
    const q = el('searchInput').value.trim().toLowerCase();
    const grid = el('songsGrid');
    const status = el('songsStatus');
    if (!this.songs.length) return;

    const filtered = !q ? this.songs : this.songs.filter(s =>
      s.title.toLowerCase().includes(q) || s.artist_name.toLowerCase().includes(q)
    );

    if (!filtered.length) {
      grid.innerHTML = '';
      renderEmpty(status, 'No matches', `Nothing found for "${q}".`);
      return;
    }
    status.innerHTML = '';
    this.renderSongs(filtered);
  },

  /* ---------------- ARTISTS ---------------- */
  renderArtists() {
    const grid = el('artistsGrid');
    const status = el('artistsStatus');
    grid.innerHTML = '';
    if (!this.songs.length) {
      renderEmpty(status, 'No artists yet', 'Add a song to see artists here.');
      return;
    }
    status.innerHTML = '';
    const groups = new Map();
    this.songs.forEach(s => {
      const key = s.artist_name || 'Unknown Artist';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });

    [...groups.entries()].forEach(([artist, songs], i) => {
      const card = document.createElement('button');
      card.className = 'artist-card';
      card.style.animationDelay = `${Math.min(i * 30, 300)}ms`;
      card.type = 'button';
      const initials = artist.trim().slice(0, 2).toUpperCase();
      card.innerHTML = `
        <div class="artist-avatar"></div>
        <p class="artist-name"></p>
        <p class="artist-count"></p>
      `;
      card.querySelector('.artist-avatar').textContent = initials;
      card.querySelector('.artist-name').textContent = artist;
      card.querySelector('.artist-count').textContent = `${songs.length} song${songs.length === 1 ? '' : 's'}`;
      card.addEventListener('click', () => this.openArtist(artist, songs));
      grid.appendChild(card);
    });
  },

  openArtist(artist, songs) {
    this.currentArtist = artist;
    el('artistSongsTitle').textContent = artist;
    const grid = el('artistSongsGrid');
    grid.innerHTML = '';
    songs.forEach((song, i) => grid.appendChild(this.buildSongRow(song, songs, i)));
    this.showView('artist-songs');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'artists'));
    this.reflectPlayingState();
    this.reflectDownloadedState();
  },

  /* ---------------- ADD / EDIT MODAL ---------------- */
  bindModal() {
    el('cancelModalBtn').addEventListener('click', () => this.closeModal());
    el('songModal').addEventListener('click', (e) => { if (e.target.id === 'songModal') this.closeModal(); });
    el('songForm').addEventListener('submit', (e) => this.submitSongForm(e));
  },

  openAddModal() {
    this.editingSongId = null;
    el('modalTitle').textContent = 'Add Song';
    el('submitModalLabel').textContent = 'Add Song';
    el('fieldTitle').value = '';
    el('fieldArtist').value = '';
    el('fieldLyrics').value = '';
    el('fieldAudio').value = '';
    el('fieldAudio').required = true;
    el('audioFileHint').textContent = 'MP3, WAV or other audio file';
    el('lyricsFileHint').textContent = '.txt file (optional)';
    el('modalError').hidden = true;
    this.showModal();
  },

  openEditModal(song) {
    this.editingSongId = song.id;
    el('modalTitle').textContent = 'Edit Song';
    el('submitModalLabel').textContent = 'Save Changes';
    el('fieldTitle').value = song.title;
    el('fieldArtist').value = song.artist_name;
    el('fieldLyrics').value = '';
    el('fieldAudio').value = '';
    el('fieldAudio').required = false;
    el('audioFileHint').textContent = 'Leave empty to keep the existing audio file';
    el('lyricsFileHint').textContent = song.lyrics
      ? 'Leave empty to keep the existing lyrics file'
      : '.txt file (optional)';
    el('modalError').hidden = true;
    this.showModal();
  },

  showModal() {
    const overlay = el('songModal');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('open'));
    el('fieldTitle').focus();
  },
  closeModal() {
    const overlay = el('songModal');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  },

  async submitSongForm(e) {
    e.preventDefault();
    const title = el('fieldTitle').value.trim();
    const artist = el('fieldArtist').value.trim();
    const lyricsFile = el('fieldLyrics').files[0];
    const audioFile = el('fieldAudio').files[0];
    const errorBox = el('modalError');
    errorBox.hidden = true;

    if (!title || !artist) {
      errorBox.textContent = 'Title and artist are required.';
      errorBox.hidden = false;
      return;
    }
    if (!this.editingSongId && !audioFile) {
      errorBox.textContent = 'Please choose an audio file.';
      errorBox.hidden = false;
      return;
    }

    const submitBtn = el('submitModalBtn');
    submitBtn.disabled = true;
    const originalLabel = el('submitModalLabel').textContent;
    el('submitModalLabel').textContent = this.editingSongId ? 'Saving…' : 'Adding…';

    const formData = new FormData();
    formData.append('title', title);
    formData.append('artist_name', artist);
    // Only attach files the user actually chose — on edit, an empty file
    // input means "keep the existing file", so we must not send the key at all.
    if (lyricsFile) formData.append('lyrics', lyricsFile);
    if (audioFile) formData.append('audio_path', audioFile);

    try {
      if (this.editingSongId) {
        await ApiService.updateSong(this.editingSongId, formData);
        showToast('Song updated', 'success');
      } else {
        await ApiService.addSong(formData);
        showToast('Song added', 'success');
      }
      this.closeModal();
      await this.loadSongs();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      el('submitModalLabel').textContent = originalLabel;
    }
  },

  /* ---------------- BULK UPLOAD ---------------- */
  bindBulkUploadModal() {
    const dropzone = el('bulkDropzone');
    const fileInput = el('bulkFileInput');

    el('bulkCancelBtn').addEventListener('click', () => this.closeBulkModal());
    el('bulkUploadModal').addEventListener('click', (e) => {
      if (e.target.id === 'bulkUploadModal') this.closeBulkModal();
    });
    el('bulkClearAllBtn').addEventListener('click', () => this.clearBulkFiles());
    el('bulkUploadSubmitBtn').addEventListener('click', () => this.submitBulkUpload());

    // Clicking/activating the dropzone opens the native file picker.
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      this.addBulkFiles(fileInput.files);
      fileInput.value = ''; // allow re-selecting the same file(s) later
    });

    // Drag-and-drop: prevent the browser's default "open file" behavior
    // on every relevant event, not just drop.
    let dragDepth = 0;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => e.preventDefault());
    });
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      dropzone.classList.remove('dragover');
      if (e.dataTransfer?.files?.length) this.addBulkFiles(e.dataTransfer.files);
    });
  },

  openBulkModal(triggerEl) {
    this._bulkTriggerEl = triggerEl || document.activeElement;
    this.bulkFiles = [];
    this.bulkUploading = false;
    this.renderBulkFileList();
    this.setBulkStatus(null);
    this.setBulkUploadingState(false);

    const overlay = el('bulkUploadModal');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('open'));
    el('bulkDropzone').focus();
  },

  closeBulkModal() {
    if (this.bulkUploading) return; // don't allow closing mid-upload
    const overlay = el('bulkUploadModal');
    // Never set aria-hidden on an element that still contains focus.
    if (overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (this._bulkTriggerEl && typeof this._bulkTriggerEl.focus === 'function') {
      this._bulkTriggerEl.focus();
    }
    this._bulkTriggerEl = null;
  },

  /** Accepts audio files only; rejects everything else and reports the reject count. */
  addBulkFiles(fileList) {
    const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff|alac)$/i;
    const incoming = Array.from(fileList || []);
    let rejected = 0;
    let duplicates = 0;

    incoming.forEach(file => {
      const isAudio = file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
      if (!isAudio) { rejected++; return; }

      const isDuplicate = this.bulkFiles.some(f =>
        f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
      );
      if (isDuplicate) { duplicates++; return; }

      this.bulkFiles.push(file);
    });

    this.renderBulkFileList();

    if (rejected > 0) {
      showToast(`${rejected} file${rejected === 1 ? '' : 's'} skipped — only audio files are supported.`, 'error');
    } else if (duplicates > 0 && incoming.length === duplicates) {
      showToast('Those file(s) are already selected.');
    }
  },

  removeBulkFile(index) {
    this.bulkFiles.splice(index, 1);
    this.renderBulkFileList();
  },

  clearBulkFiles() {
    this.bulkFiles = [];
    this.renderBulkFileList();
  },

  renderBulkFileList() {
    const list = el('bulkFileList');
    const count = this.bulkFiles.length;

    el('bulkFileCount').textContent = `Selected: ${count} song${count === 1 ? '' : 's'}`;
    el('bulkClearAllBtn').hidden = count === 0;
    el('bulkUploadSubmitBtn').disabled = count === 0 || this.bulkUploading;

    list.innerHTML = '';
    this.bulkFiles.forEach((file, i) => {
      const item = document.createElement('div');
      item.className = 'bulk-file-item';
      item.innerHTML = `
        <svg class="bulk-file-icon" viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.6"/></svg>
        <span class="bulk-file-name"></span>
        <button type="button" class="bulk-file-remove" aria-label="Remove ${escapeHtml(file.name)}">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
      `;
      item.querySelector('.bulk-file-name').textContent = file.name;
      item.querySelector('.bulk-file-remove').addEventListener('click', () => this.removeBulkFile(i));
      list.appendChild(item);
    });
  },

  setBulkStatus(message, type) {
    const errorBox = el('bulkUploadError');
    const successBox = el('bulkUploadSuccess');
    errorBox.hidden = true;
    successBox.hidden = true;
    if (!message) return;
    if (type === 'success') {
      successBox.textContent = message;
      successBox.hidden = false;
    } else {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }
  },

  setBulkUploadingState(isUploading) {
    this.bulkUploading = isUploading;
    el('bulkUploadSubmitBtn').disabled = isUploading || this.bulkFiles.length === 0;
    el('bulkUploadSubmitLabel').textContent = isUploading ? 'Uploading…' : 'Upload Songs';
    el('bulkCancelBtn').disabled = isUploading;
    el('bulkClearAllBtn').disabled = isUploading;
    el('bulkDropzone').style.pointerEvents = isUploading ? 'none' : '';
  },

  async submitBulkUpload() {
    if (this.bulkUploading) return;
  
    if (!this.bulkFiles.length) {
      this.setBulkStatus('Please select at least one audio file.', 'error');
      return;
    }
  
    const files = [...this.bulkFiles];
  
    this.setBulkStatus(null);
    this.setBulkUploadingState(true);
  
    let uploaded = 0;
    let failed = 0;
  
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('audio_files', file);
  
        try {
          console.log(`Uploading ${file.name}...`);
  
          await ApiService.bulkUpload(formData);
  
          uploaded++;
          console.log(`Uploaded ${file.name}`);
  
        } catch (err) {
          failed++;
          console.error(`Failed: ${file.name}`, err);
        }
      }
  
      this.setBulkUploadingState(false);
  
      await this.loadSongs();
  
      if (this.currentView === 'artists') {
        this.renderArtists();
      }
  
      if (failed === 0) {
        this.closeBulkModal();
        showToast(
          `${uploaded} song${uploaded === 1 ? '' : 's'} uploaded successfully`,
          'success'
        );
      } else {
        this.setBulkStatus(
          `${uploaded} uploaded, ${failed} failed. You can retry the failed files.`,
          'error'
        );
      }
  
    } finally {
      this.setBulkUploadingState(false);
    }
  },

  /* ---------------- DELETE ---------------- */
  async deleteSong(song) {
    const ok = confirm(`Delete "${song.title}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await ApiService.deleteSong(song.id);
      showToast('Song deleted', 'success');
      if (this.player.current && this.player.current.id === song.id) {
        this.player.audio.pause();
        this.closeDetail();
      }
      try { await OfflineStore.remove(song.id); this.downloadedIds.delete(song.id); } catch (_) {}
      await this.loadSongs();
      if (this.currentView === 'artist-songs') this.showView('artists');
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  /* ---------------- SONG DETAIL ---------------- */
  bindDetail() {
    el('closeDetail').addEventListener('click', () => this.closeDetail());
    el('songDetail').addEventListener('click', (e) => {
      if (e.target.classList.contains('detail-scrim')) this.closeDetail();
    });
    el('detailCover').addEventListener('click', () => this.toggleLyrics());

    el('playBtn').addEventListener('click', () => this.player.togglePlay());
    el('prevBtn').addEventListener('click', () => this.player.prev());
    el('nextBtn').addEventListener('click', () => this.player.next(true));
    el('shuffleBtn').addEventListener('click', () => this.player.toggleShuffle());
    el('loopBtn').addEventListener('click', () => this.player.toggleLoop());

  const seekBar = el('seekBar');

    // Dragging begins: block player-update events from overwriting the
    // bar while the user has their finger/mouse on it (pointer events
    // unify mouse, touch, and pen).
    seekBar.addEventListener('pointerdown', () => { this.isSeeking = true; });

    // While dragging (or using arrow keys): update the visual position
    // and the time label immediately, but do NOT touch audio.currentTime
    // yet — that would fight the drag and cause stutter/snapping.
    seekBar.addEventListener('input', () => {
      const fraction = Number(seekBar.value) / 100;
      seekBar.style.setProperty('--fill', `${seekBar.value}%`);
      const duration = this.player.audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        el('curTime').textContent = formatTime(fraction * duration);
      }
    });

    // Release: commit the seek exactly once, using the final slider value.
    // 'change' fires on mouseup/touchend for range inputs, and also after
    // a keyboard-driven adjustment. 'pointerup' is a second, explicit
    // signal for the same release moment so touch/mobile browsers that are
    // inconsistent about firing 'change' still commit the seek. Calling
    // this twice for one release is harmless — both read the same final
    // slider value.
    const commitSeek = () => {
      const fraction = Number(seekBar.value) / 100;
      this.player.seekToFraction(fraction);
      this.isSeeking = false;
    };
    seekBar.addEventListener('change', commitSeek);
    seekBar.addEventListener('pointerup', commitSeek);

    // Safety net: if a touch/pointer gesture is cancelled (e.g. an
    // interrupting system gesture) without a 'change'/'pointerup' event,
    // don't leave the seek bar permanently frozen out of normal playback
    // updates.
    seekBar.addEventListener('pointercancel', () => { this.isSeeking = false; });

    el('volumeSlider').addEventListener('input', (e) => this.player.setVolume(parseFloat(e.target.value)));
    el('volumeToggle').addEventListener('click', () => {
      const slider = el('volumeSlider');
      const muted = this.player.audio.volume === 0;
      const val = muted ? 1 : 0;
      slider.value = val;
      this.player.setVolume(val);
    });

    el('detailDownloadBtn').addEventListener('click', () => this.downloadSong(this.activeSongForDetail));
    el('detailEditBtn').addEventListener('click', () => {
      if (this.activeSongForDetail) this.openEditModal(this.activeSongForDetail);
    });
    el('detailDeleteBtn').addEventListener('click', () => {
      if (this.activeSongForDetail) this.deleteSong(this.activeSongForDetail);
    });
  },

  async openDetail(song, contextList) {
    this.activeSongForDetail = song;
    el('detailTitle').textContent = song.title;
    el('detailArtist').textContent = song.artist_name;
    el('lyricsPanel').classList.remove('open');
    el('lyricsScroll').innerHTML = '<p class="lyrics-empty">Loading lyrics…</p>';

    const overlay = el('songDetail');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('open'));

    if (!this.player.current || this.player.current.id !== song.id) {
      await this.player.playSong(song, contextList || this.songs);
    }

    if (song.lyrics) {
      try {
        const text = await ApiService.fetchLyricsText(song.lyrics);
        el('lyricsScroll').textContent = text.trim() || 'No lyrics available for this song.';
      } catch (_) {
        el('lyricsScroll').innerHTML = '<p class="lyrics-empty">Lyrics could not be loaded.</p>';
      }
    } else {
      el('lyricsScroll').innerHTML = '<p class="lyrics-empty">No lyrics available for this song.</p>';
    }
  },

  closeDetail() {
    const overlay = el('songDetail');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  },

  toggleLyrics() {
    const panel = el('lyricsPanel');
    const isOpen = panel.classList.toggle('open');
    el('detailCover').style.display = isOpen ? 'none' : 'flex';
  },

  /* ---------------- MINI PLAYER ---------------- */
  bindMiniPlayer() {
    el('miniPlayer').addEventListener('click', (e) => {
      if (e.target.closest('#miniPrev') || e.target.closest('#miniNext') || e.target.closest('#miniPlay')) return;
      if (this.activeSongForDetail) this.openDetail(this.activeSongForDetail, this.songs);
    });
    el('miniPrev').addEventListener('click', (e) => { e.stopPropagation(); this.player.prev(); });
    el('miniNext').addEventListener('click', (e) => { e.stopPropagation(); this.player.next(true); });
    el('miniPlay').addEventListener('click', (e) => { e.stopPropagation(); this.player.togglePlay(); });
  },

  /* ---------------- PLAYER STATE -> UI ---------------- */
  onPlayerUpdate(detail) {
    if (detail.error) showToast(detail.error, 'error');
    if (!detail.song) return;

    this.activeSongForDetail = this.activeSongForDetail || detail.song;

    // detail panel
    if (this.activeSongForDetail && detail.song.id === this.activeSongForDetail.id) {
      el('curTime').textContent = formatTime(detail.currentTime);
      el('durTime').textContent = formatTime(detail.duration);
      const fraction = detail.duration ? (detail.currentTime / detail.duration) * 100 : 0;
      const seekBar = el('seekBar');
      if (!this.isSeeking) {
        seekBar.value = fraction;
        seekBar.style.setProperty('--fill', fraction + '%');
      }
      el('playIcon').style.display = detail.isPlaying ? 'none' : '';
      el('pauseIcon').style.display = detail.isPlaying ? '' : 'none';
      el('detailDisc').classList.toggle('spinning', detail.isPlaying);
      el('shuffleBtn').classList.toggle('active', detail.shuffle);
      el('loopBtn').classList.toggle('active', detail.loop);

      // mini player
      el('miniTitle').textContent = detail.song.title;
      el('miniArtist').textContent = detail.song.artist_name;
      el('miniProgressFill').style.width = fraction + '%';
      el('miniPlayIcon').style.display = detail.isPlaying ? 'none' : '';
      el('miniPauseIcon').style.display = detail.isPlaying ? '' : 'none';
      // Visibility is handled purely through CSS (.visible toggles
      // visibility/opacity/pointer-events) — never via aria-hidden, since
      // this is a focusable <button> and toggling aria-hidden on an
      // element that can retain focus triggers a browser warning.
      el('miniPlayer').classList.add('visible');
    }

    this.reflectPlayingState();
  },

  reflectPlayingState() {
    const current = this.player.current;
    const isPlaying = current && !this.player.audio.paused;
    document.querySelectorAll('.song-row[data-song-id]').forEach(row => {
      const id = Number(row.dataset.songId);
      const matches = current && id === current.id;
      row.classList.toggle('playing', !!matches);

      const playIcon = row.querySelector('.row-play-icon');
      const pauseIcon = row.querySelector('.row-pause-icon');
      const eq = row.querySelector('.row-eq');
      const showPause = matches && isPlaying;
      if (playIcon) playIcon.style.display = showPause ? 'none' : '';
      if (pauseIcon) pauseIcon.style.display = showPause ? '' : 'none';
      if (eq) eq.hidden = !showPause;

      const playBtn = row.querySelector('.row-play-btn');
      if (playBtn) playBtn.setAttribute('aria-label', showPause ? `Pause ${row.dataset.songTitle}` : `Play ${row.dataset.songTitle}`);
    });
  },

  /* ---------------- DOWNLOADS ---------------- */
  async downloadSong(song) {
    if (!song) return;
    if (!song.audio_path) { showToast('This song has no audio file to download.', 'error'); return; }
    showToast('Downloading…');
    try {
      const [audioBlob, lyricsText] = await Promise.all([
        ApiService.fetchAudioBlob(song.audio_path),
        song.lyrics ? ApiService.fetchLyricsText(song.lyrics).catch(() => '') : Promise.resolve('')
      ]);
      await OfflineStore.saveSong(song, audioBlob, lyricsText);
      this.downloadedIds.add(song.id);
      this.reflectDownloadedState();
      showToast('Saved for offline playback', 'success');
      if (this.currentView === 'downloads') this.loadDownloads();
    } catch (err) {
      showToast(err.message || 'Download failed', 'error');
    }
  },

  async loadDownloads() {
    const status = el('downloadsStatus');
    const grid = el('downloadsGrid');
    grid.innerHTML = '';
    renderLoading(status, 'Loading downloads…');
    try {
      const records = await OfflineStore.getAll();
      status.innerHTML = '';
      if (!records.length) {
        renderEmpty(status, 'No downloads yet', 'Download a song from its detail page to play it offline.');
        return;
      }
      const asSongs = records.map(r => ({
        id: r.id, title: r.title, artist_name: r.artist_name, lyrics: null, audio_path: null
      }));
      records.forEach((r, i) => {
        const row = this.buildSongRow(asSongs[i], asSongs, i);
        // Downloaded rows show "remove" instead of a re-download control.
        const downloadBtn = row.querySelector('.row-download-btn');
        downloadBtn.classList.add('downloaded');
        downloadBtn.setAttribute('aria-label', `Remove ${r.title} from downloads`);
        downloadBtn.replaceWith(downloadBtn.cloneNode(true)); // strip the default download handler
        row.querySelector('.row-download-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await OfflineStore.remove(r.id);
          this.downloadedIds.delete(r.id);
          showToast('Removed from downloads', 'success');
          this.loadDownloads();
        });
        row.querySelector('.row-meta').addEventListener('click', () => {
          this.playDownloadedRecord(r, records);
        });
        grid.appendChild(row);
      });
      this.reflectPlayingState();
    } catch (err) {
      renderError(status, 'Downloads could not be loaded from this device.', () => this.loadDownloads());
    }
  },

  async playDownloadedRecord(record, allRecords) {
    const song = { id: record.id, title: record.title, artist_name: record.artist_name, lyrics: null, audio_path: null };
    this.activeSongForDetail = song;
    el('detailTitle').textContent = song.title;
    el('detailArtist').textContent = song.artist_name;
    el('lyricsScroll').textContent = record.lyrics_text && record.lyrics_text.trim()
      ? record.lyrics_text
      : 'No lyrics available for this song.';
    el('lyricsPanel').classList.remove('open');
    el('detailCover').style.display = 'flex';

    const overlay = el('songDetail');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('open'));

    const list = allRecords.map(r => ({ id: r.id, title: r.title, artist_name: r.artist_name, lyrics: null, audio_path: null }));
    await this.player.playSong(song, list);
  },

  /* ---------------- SETTINGS ---------------- */
  bindSettings() {
    el('clearDownloadsBtn').addEventListener('click', async () => {
      const ok = confirm('Remove all downloaded songs from this device?');
      if (!ok) return;
      await OfflineStore.clear();
      this.downloadedIds.clear();
      this.reflectDownloadedState();
      showToast('Downloads cleared', 'success');
      this.refreshSettings();
    });
  },

  async refreshSettings() {
    this.updateConnectionStatus();
    try {
      const records = await OfflineStore.getAll();
      el('downloadCount').textContent = `${records.length} song${records.length === 1 ? '' : 's'} stored offline`;
    } catch (_) {
      el('downloadCount').textContent = 'Offline storage unavailable';
    }
  },

  updateConnectionStatus() {
    const online = navigator.onLine;
    el('connectionStatus').textContent = online ? 'Online' : 'Offline';
    el('connectionDot').className = `status-dot ${online ? 'online' : 'offline'}`;
  },

  /* ---------------- SERVICE WORKER ---------------- */
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch(() => { /* offline-first still works via IndexedDB */ });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
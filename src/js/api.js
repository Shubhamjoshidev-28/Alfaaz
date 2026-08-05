/* ==========================================================================
   Alfaaz · api.js
   Every network call the app makes lives in this file. Nothing else talks
   to the backend directly — keeps the surface area easy to change if the
   Django API moves or evolves.
   ========================================================================== */

// Change this single value if the backend moves (e.g. to a production host).
const API_BASE = window.ALFAAZ_API_BASE || "http://127.0.0.1:8000";

const ENDPOINTS = {
  songList: () => `${API_BASE}/music/song_list/`,
  songDetail: (id) => `${API_BASE}/music/song_detail/${id}/`,
  addSong: () => `${API_BASE}/music/add_song/`,
  updateSong: (id) => `${API_BASE}/music/update_song/${id}/`,
  deleteSong: (id) => `${API_BASE}/music/delete_song/${id}/`,
};

/**
 * Wraps fetch with consistent error handling so every caller gets a
 * predictable rejection shape: { status, message }.
 */
async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkErr) {
    throw { status: 0, message: "Network unreachable. You may be offline." };
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || body.message || message;
    } catch (_) {
      /* response had no JSON body — keep default message */
    }
    throw { status: response.status, message };
  }

  // Some endpoints (e.g. delete) may return no content.
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const api = {
  /** GET /music/song_list/ */
  getSongs() {
    return request(ENDPOINTS.songList());
  },

  /** GET /music/song_detail/:id/ */
  getSongDetail(id) {
    return request(ENDPOINTS.songDetail(id));
  },

  /** POST /music/add_song/  — multipart form (title, artist_name, lyrics, audio file) */
  addSong({ title, artist_name, lyrics, audioFile }) {
    const form = new FormData();
    form.append("title", title);
    form.append("artist_name", artist_name);
    form.append("lyrics", lyrics || "");
    if (audioFile) form.append("audio_file", audioFile);

    return request(ENDPOINTS.addSong(), {
      method: "POST",
      body: form,
    });
  },

  /** PATCH /music/update_song/:id/ — multipart form, partial fields allowed */
  updateSong(id, { title, artist_name, lyrics, audioFile }) {
    const form = new FormData();
    if (title !== undefined) form.append("title", title);
    if (artist_name !== undefined) form.append("artist_name", artist_name);
    if (lyrics !== undefined) form.append("lyrics", lyrics);
    if (audioFile) form.append("audio_file", audioFile);

    return request(ENDPOINTS.updateSong(id), {
      method: "PATCH",
      body: form,
    });
  },

  /** DELETE /music/delete_song/:id/ */
  deleteSong(id) {
    return request(ENDPOINTS.deleteSong(id), { method: "DELETE" });
  },

  /**
   * Downloads the raw audio bytes for offline storage.
   * Reports progress via onProgress(percent) when Content-Length is known.
   */
  async downloadAudio(url, onProgress) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw { status: response.status, message: "Could not download audio file." };
    }

    const total = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total && onProgress) onProgress(Math.round((received / total) * 100));
    }

    if (!total && onProgress) onProgress(100);
    return new Blob(chunks);
  },
};

// Exposed as a global since the project intentionally avoids ES module
// bundling — app.js consumes `window.alfaazApi` directly.
window.alfaazApi = api;

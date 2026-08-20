/* ===========================================================
   api.js — thin wrapper around the Alfaaz backend.
   No framework, no guessing at fields that weren't specified.
   Every method returns the parsed JSON / throws a normalized Error.
   =========================================================== */

const API_BASE = 'http://127.0.0.1:8000';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 0;
  }
}

const ApiService = {

  BASE: API_BASE,

  /**
   * Turns a backend-relative media path (e.g. "/media/songs/x.mp3")
   * into a fully qualified, playable URL. Leaves absolute URLs untouched.
   */
  resolveMediaUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return API_BASE + (path.startsWith('/') ? path : `/${path}`);
  },

  async _request(path, options = {}) {
    let res;
    try {
      res = await fetch(API_BASE + path, options);
    } catch (err) {
      throw new ApiError('Could not reach the server. Check that the backend is running.', 0);
    }

    let body = null;
    const text = await res.text();
    if (text) {
      try { body = JSON.parse(text); } catch (_) { body = null; }
    }

    if (!res.ok) {
      const msg = (body && body.message) ? body.message : `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    if (body && body.success === false) {
      throw new ApiError(body.message || 'Request was not successful.', res.status);
    }
    return body;
  },

  /** GET /music/song_list/ -> normalized array of songs */
  async getSongs() {
    const body = await this._request('/music/song_list/');
    return normalizeSongList(body);
  },

  /** GET /music/song_detail/{id}/ -> single normalized song */
  async getSongDetail(id) {
    const body = await this._request(`/music/song_detail/${id}/`);
    const list = normalizeSongList(body);
    return list[0] || null;
  },

  /** POST /music/add_song/  (multipart/form-data) */
  async addSong(formData) {
    return this._request('/music/add_song/', { method: 'POST', body: formData });
  },

  /** PATCH /music/edit_song/{id}/  (multipart/form-data) */
  async updateSong(id, formData) {
    return this._request(`/music/edit_song/${id}/`, { method: 'PATCH', body: formData });
  },

  /** DELETE /music/delete_song/{id}/ — always uses the real database id */
  async deleteSong(id) {
    return this._request(`/music/delete_song/${id}/`, { method: 'DELETE' });
  },

  /**
   * POST /music/bulk_upload/  (multipart/form-data)
   * Backend serializer expects repeated `audio_files` entries and nothing else.
   * Response shape is { success, message, count } — no song objects, so the
   * caller must reload the song list afterwards rather than assume more.
   */
  async bulkUpload(formData) {
    return this._request('/music/bulk_upload/', { method: 'POST', body: formData });
  },

  /** Fetches the lyrics .txt file referenced by song.lyrics and returns its text content */
  async fetchLyricsText(lyricsPath) {
    if (!lyricsPath) return '';
    const url = this.resolveMediaUrl(lyricsPath);
    const res = await fetch(url);
    if (!res.ok) throw new ApiError('Lyrics file could not be loaded.', res.status);
    return res.text();
  },

  /** Fetches raw audio bytes as a Blob, used for offline downloads */
  async fetchAudioBlob(audioPath) {
    const url = this.resolveMediaUrl(audioPath);
    const res = await fetch(url);
    if (!res.ok) throw new ApiError('Audio file could not be downloaded.', res.status);
    return res.blob();
  }
};

/**
 * The backend always responds with: { success, message, song: [ {...} ] }
 * for both the list and detail endpoints (detail simply contains one item).
 * This normalizes both shapes into a flat array, defensively.
 */
function normalizeSongList(body) {
  if (!body) return [];
  const raw = body.song;
  if (Array.isArray(raw)) return raw.map(normalizeSong);
  if (raw && typeof raw === 'object') return [normalizeSong(raw)];
  return [];
}

function normalizeSong(s) {
  return {
    id: s.id,
    title: s.title || 'Untitled',
    artist_name: s.artist_name || 'Unknown Artist',
    lyrics: s.lyrics || null,
    audio_path: s.audio_path || null,
    created_at: s.created_at || null
  };
}
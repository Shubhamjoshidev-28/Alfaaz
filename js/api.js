/* ===========================================================
   api.js — thin wrapper around the Alfaaz backend.
   No framework, no guessing at fields that weren't specified.
   Every method returns the parsed JSON / throws a normalized Error.
   =========================================================== */

// Local frontend can test against the deployed HTTPS API.
// Change this only when intentionally running Django locally.
const API_BASE = 'https://80.225.231.54';  // no trailing slash

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

  /**
   * Seeking only works smoothly when the server answers HTTP Range requests
   * (206 Partial Content). Django's dev server / plain `serve` view does NOT,
   * so the browser can't jump to a position it hasn't downloaded yet.
   * We probe once per origin and the player falls back to a Blob if needed.
   */
  _rangeCache: {},
  async supportsRange(url) {
    let origin;
    try { origin = new URL(url, location.href).origin; } catch (_) { return false; }
    if (origin in this._rangeCache) return this._rangeCache[origin];

    let ok = false;
    const ctrl = new AbortController();
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal });
      ok = res.status === 206;
    } catch (_) { ok = false; }
    finally { ctrl.abort(); }   // never download the whole file just to probe

    this._rangeCache[origin] = ok;
    return ok;
  },

  async _request(path, options = {}) {
    let res;
    try {
      res = await fetch(API_BASE + (path.startsWith('/') ? path : `/${path}`), options);
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
    let res;
    try { res = await fetch(url); }
    catch (_) { throw new ApiError('Lyrics file could not be reached.', 0); }
    if (!res.ok) throw new ApiError('Lyrics file could not be loaded.', res.status);
    return res.text();
  },

  /** Fetches raw audio bytes as a Blob, used for offline downloads */
  async fetchAudioBlob(audioPath) {
    const url = this.resolveMediaUrl(audioPath);
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      // fetch() rejects for network failures AND for missing CORS headers.
      // <audio> can play cross-origin files without CORS, but fetch() cannot read them.
      throw new ApiError(
        'Could not download the audio file. Make sure the server is running and allows CORS for /media/ files.',
        0
      );
    }
    if (!res.ok) throw new ApiError(`Audio file could not be downloaded (${res.status}).`, res.status);

    const blob = await res.blob();
    if (!blob.size) throw new ApiError('The audio file downloaded empty.', res.status);

    // Some servers send application/octet-stream; make sure the blob is playable.
    if (!blob.type || !blob.type.startsWith('audio/')) {
      const ext = (audioPath.split('?')[0].split('.').pop() || '').toLowerCase();
      const types = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg' };
      return new Blob([blob], { type: types[ext] || 'audio/mpeg' });
    }
    return blob;
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
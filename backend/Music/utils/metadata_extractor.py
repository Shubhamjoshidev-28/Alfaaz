from pathlib import Path

from mutagen import File as MutagenFile


def metadata_extrator(audio_file):
    """Read optional tags safely; files without tags still upload."""
    fallback_title = Path(getattr(audio_file, "name", "song.mp3")).stem or "Untitled"
    title = fallback_title
    artist = "Unknown Artist"

    try:
        audio_file.seek(0)
        tagged_audio = MutagenFile(audio_file, easy=True)
        tags = getattr(tagged_audio, "tags", None) if tagged_audio else None
        if tags:
            title_values = tags.get("title") or []
            artist_values = tags.get("artist") or []
            if title_values and str(title_values[0]).strip():
                title = str(title_values[0]).strip()
            if artist_values and str(artist_values[0]).strip():
                artist = str(artist_values[0]).strip()
    except Exception:
        # Metadata is optional; do not reject an otherwise uploadable file.
        pass
    finally:
        try:
            audio_file.seek(0)
        except Exception:
            pass

    return {
        "title": title[:30],
        "artist_name": artist[:30],
        "audio_filename": getattr(audio_file, "name", "song.mp3"),
    }

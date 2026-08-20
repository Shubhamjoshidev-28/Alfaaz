from mutagen.easyid3 import (
    EasyID3
)

def metadata_extrator(
        audio_file
):
    song = EasyID3(
        audio_file
    )

    title = song.get("title", ["Unknown"])[0]
    artist = song.get("artist", ["Unknown"])[0]

    return {
        "title": title,
        "artist_name": artist,
        "audio_filename": audio_file.name
    }
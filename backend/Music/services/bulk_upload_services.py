from django.db import transaction

from Music.services.songs_services import SongService
from Music.utils.metadata_extractor import metadata_extrator


class BulkSongUpload:
    @staticmethod
    def metadata(audio_file):
        return metadata_extrator(audio_file)

    @staticmethod
    def bulk_upload(audio_files):
        created_songs = []
        # Each request from the frontend contains one file. Keeping this loop
        # preserves compatibility with existing clients that submit multiple.
        for audio_file in audio_files:
            metadata = BulkSongUpload.metadata(audio_file)
            song_data = {
                "title": metadata["title"],
                "artist_name": metadata["artist_name"],
                "audio_path": audio_file,
            }
            created_songs.append(SongService.create_song(validated_data=song_data))
        return created_songs

    @staticmethod
    def count(created_songs):
        return len(created_songs)

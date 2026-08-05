from Music.models.songs import (
    Songs
)
from Music.selectors.song_selectors import (
    get_songs_by_id,
    get_all_song
)

class SongService:

    @staticmethod
    def create_song(validated_data):
        return Songs.objects.create(**validated_data)
        

    @staticmethod
    def update_song(
        validated_data,
        song_id
    ):
        song = get_songs_by_id(song_id)

        for field, value in validated_data.items():
            setattr(song, field, value)

        song.save()

        return song

    @staticmethod
    def songs_list():
        song = get_all_song()
        return song

    @staticmethod
    def delete_song(
        song_id
    ):
        song = get_songs_by_id(song_id)

        if song.audio_path:
            song.audio_path.delete(save=False)

        song.delete()

    @staticmethod
    def song_detail(
        song_id
    ):
        song = get_songs_by_id(
            song_id
        )
        return song
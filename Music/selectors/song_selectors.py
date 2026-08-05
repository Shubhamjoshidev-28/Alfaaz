from Music.models.songs import (
    Songs
)

def get_songs_by_id(
    song_id
):
    song = Songs.objects.get(
        id=song_id
    )
    return song

def get_all_song(
        
):
    return Songs.objects.all()
    
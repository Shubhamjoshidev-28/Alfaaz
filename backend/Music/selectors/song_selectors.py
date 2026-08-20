from Music.models.songs import (
    Songs
)
from django.shortcuts import (
    get_object_or_404
)

def get_song_by_id(song_id):
    return get_object_or_404(
        Songs,
        id=song_id
    )

def get_all_songs(
        
):
    return Songs.objects.all()
    
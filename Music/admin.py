from django.contrib import admin
from Music.models.songs import (
    Songs
)

@admin.register(Songs)
class SongsAdmin(
    admin.ModelAdmin
):
    model = 'Songs'
    list_display=[
        'title',
        'artist_name',
        'lyrics',
        'audio_path',
        'created_at'  
    ]

from rest_framework import (
    serializers
)
from Music.models.songs import (
    Songs
)

class CreateSongSerializer (
    serializers.ModelSerializer
):
    class Meta:
        model = Songs
        fields = [
            'title',
            'artist_name',
            'lyrics',
            'audio_path',
            'created_at'  
        ]
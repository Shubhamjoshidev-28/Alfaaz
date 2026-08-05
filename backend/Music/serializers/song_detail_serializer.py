from rest_framework import (
    serializers
)
from Music.models.songs import (
    Songs
)

class SongDetailSerializer (
    serializers.ModelSerializer
):
    class Meta:
        model = Songs
        fields = [
            'id',
            'title',
            'artist_name',
            'lyrics',
            'audio_path',
            'created_at'  
        ]
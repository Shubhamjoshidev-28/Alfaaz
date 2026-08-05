from rest_framework.views import (
    APIView
)
from Music.services.songs_services import (
    SongService
)
from Music.serializers.create_song_serializer import (
    CreateSongSerializer
)
from rest_framework.response import (
    Response
)
from Music.models.songs import (
    Songs
)
from rest_framework import (
    status
)

class DeleteSongView(
    APIView
):
    def delete(
            self,
            request,
            song_id
    ):

        song = SongService.delete_song(
            song_id=song_id
        )
        return Response (
            {
                "success": True,
                "message":"Song delete Successfully"
            },
            status = status.HTTP_200_OK
        )
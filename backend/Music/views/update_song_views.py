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

class UpdateSongView(
    APIView
):
    def patch(
            self,
            request,
            song_id
    ):
        serializer = CreateSongSerializer (
            data=request.data,
            partial = True
        )

        serializer.is_valid(
            raise_exception=True
        )

        song = SongService.update_song(
            validated_data=serializer.validated_data,
            song_id=song_id
        )

        return Response ( 
            {
                "success":True,
                "message":"Song Updated successfully",
                "song": CreateSongSerializer(song).data
            },
            status = status.HTTP_200_OK
        )

    




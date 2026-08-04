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

class CreateSongView(
    APIView
):
    def post(
            self,
            request
    ):
        serializer = CreateSongSerializer (
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        song = SongService.create_song(
            validated_data=serializer.validated_data
        )

        return Response ( 
            {
                "success":True,
                "message":"Song Added successfully",
                "song": CreateSongSerializer(Songs).data
            },
            status = status.HTTP_201_CREATED
        )

    




from rest_framework.views import (
    APIView
)
from Music.services.songs_services import (
    SongService
)
from Music.serializers.song_detail_serializer import (
    SongDetailSerializer
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

class SongDetailView(
    APIView
):
    def get(
            self,
            request,
            song_id
    ):
        serializer = SongDetailSerializer (
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        song = SongService.song_detail(
            song_id
        )

        return Response ( 
            {
                "success":True,
                "message":"Song Details Fetched successfully",
                "song": serializer.data
            },
            status = status.HTTP_200_OK
        )

    




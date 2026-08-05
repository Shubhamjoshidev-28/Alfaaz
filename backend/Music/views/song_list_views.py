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

class SongListView(
    APIView
):
    def get(
            self,
            request,
    ):

        song = SongService.songs_list()
        serializer = SongDetailSerializer(
            song,
            many=True
        )

        return Response ( 
            {
                "success":True,
                "message":"Song Details Fetched successfully",
                "song": serializer.data
            },
            status = status.HTTP_200_OK
        )

    




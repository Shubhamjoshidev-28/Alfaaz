from Music.serializers.bulk_upload_serializer import (
    BulkSongSerializer
)
from Music.services.bulk_upload_services import (
    BulkSongUpload
)
from rest_framework.views import (
    APIView
)
from rest_framework.response import (
    Response
)
from rest_framework import (
    status
)

class BulkSongUploadView(APIView):

    def post(
        self,
        request
    ):

        serializer = BulkSongSerializer(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        audio_files = serializer.validated_data[
            "audio_files"
        ]

        songs = BulkSongUpload.bulk_upload(
            audio_files=audio_files
        )

        return Response(
            {
                "success": True,
                "message": "Metadata extracted successfully",
                "count": len(songs)
            },
            status=status.HTTP_200_OK
        )
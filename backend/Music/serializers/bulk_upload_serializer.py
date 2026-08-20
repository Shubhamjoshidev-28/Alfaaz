from rest_framework import serializers


class BulkSongSerializer(serializers.Serializer):

    audio_files = serializers.ListField(
        child=serializers.FileField(),
        allow_empty=False
    )
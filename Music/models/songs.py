from django.db import (
    models
)


class Songs(
    models.Model
):

    title = models.CharField(
        max_length=30,
        null=True,
        blank=True
    )
    artist_name = models.CharField(
        max_length=30,
        null=True,
        blank=True
    )
    lyrics = models.FileField(
        upload_to='lyrics/',
        null=True,
        blank=True
    )
    audio_path = models.FileField(
        upload_to='songs/',
        null=True,
        blank=True
    )
    created_at = models.DateTimeField(
        auto_now_add=True
    )
    def __str__(self):
        return self.title


from django.urls import (
    path
)
from Music.views.create_song_views import (
    CreateSongView
)
from Music.views.update_song_views import (
    UpdateSongView
)
from Music.views.song_list_views import (
    SongListView
)
from Music.views.song_details_views import (
    SongDetailView
)
from Music.views.delete_song_views import (
    DeleteSongView
)
from Music.views.bulk_song_upload_views import (
    BulkSongUploadView
)

urlpatterns = [
    path ('add_song/',CreateSongView.as_view(),name ='add_song'),
    path ('edit_song/<int:song_id>/',UpdateSongView.as_view(),name='edit_song'),
    path ('song_list/',SongListView.as_view(),name='song_list'),
    path ('song_detail/<int:song_id>/',SongDetailView.as_view(),name= 'song_detail'),
    path ('delete_song/<int:song_id>/',DeleteSongView.as_view(),name='delete_song'),
    path ('bulk_upload/',BulkSongUploadView.as_view(),name='bulk_upload')
]
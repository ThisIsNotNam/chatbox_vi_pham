from django.urls import re_path

from .consumers import LiveDashboardConsumer

websocket_urlpatterns = [
    re_path(r"ws/live/$", LiveDashboardConsumer.as_asgi()),
]

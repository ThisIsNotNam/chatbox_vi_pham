from channels.auth import AuthMiddlewareStack
from channels.routing import URLRouter

from violations.routing import websocket_urlpatterns

websocket_application = AuthMiddlewareStack(
    URLRouter(websocket_urlpatterns)
)

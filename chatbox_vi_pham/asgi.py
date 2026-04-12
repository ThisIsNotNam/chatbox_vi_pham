"""
ASGI config for chatbox_vi_pham project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chatbox_vi_pham.settings')

from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application

django_asgi_application = get_asgi_application()

from .routing import websocket_application

application = ProtocolTypeRouter(
    {
        'http': django_asgi_application,
        'websocket': websocket_application,
    }
)

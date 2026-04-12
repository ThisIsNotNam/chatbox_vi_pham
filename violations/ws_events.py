from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

LIVE_GROUP_NAME = "violations_live_updates"


def notify_live_update():
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    async_to_sync(channel_layer.group_send)(
        LIVE_GROUP_NAME,
        {
            "type": "live.update",
        },
    )

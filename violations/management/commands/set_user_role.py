from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from violations.models import RoomAdminProfile


class Command(BaseCommand):
    help = "Assign role/group for a user and optionally set exam room for room admin."

    def add_arguments(self, parser):
        parser.add_argument("username", type=str)
        parser.add_argument(
            "--role",
            choices=["super_admin", "room_admin", "viewer"],
            required=True,
            help="Role to assign",
        )
        parser.add_argument(
            "--room",
            type=str,
            default="",
            help="Room code/name (required for room_admin)",
        )

    def handle(self, *args, **options):
        username = options["username"]
        role = options["role"]
        room_name = (options["room"] or "").strip()

        User = get_user_model()
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist as exc:
            raise CommandError(f"User '{username}' does not exist.") from exc

        # Ensure groups exist even if migrations were skipped in some environments.
        super_admin_group, _ = Group.objects.get_or_create(name="super_admin")
        room_admin_group, _ = Group.objects.get_or_create(name="room_admin")

        user.groups.remove(super_admin_group, room_admin_group)

        if role == "super_admin":
            user.groups.add(super_admin_group)
            RoomAdminProfile.objects.filter(user=user).delete()
            self.stdout.write(self.style.SUCCESS(f"{username} set as super_admin."))
            return

        if role == "room_admin":
            if not room_name:
                raise CommandError("--room is required for role room_admin")
            user.groups.add(room_admin_group)
            RoomAdminProfile.objects.update_or_create(
                user=user,
                defaults={"room_name": room_name},
            )
            self.stdout.write(
                self.style.SUCCESS(f"{username} set as room_admin for room '{room_name}'.")
            )
            return

        # Viewer
        RoomAdminProfile.objects.filter(user=user).delete()
        self.stdout.write(self.style.SUCCESS(f"{username} set as viewer."))

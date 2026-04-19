import re
from collections import OrderedDict

from django.contrib.auth.models import Group
from django.db import transaction
from django.db.models.functions import Upper

from .models import Candidate, IncidentParticipant, RoomAdminProfile

SBD_PATTERN = re.compile(r"\b[Tt][Ss]\d{4}\b")
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ROOM_ADMIN = "room_admin"
ROLE_VIEWER = "viewer"
ROLE_CHOICES = (
    (ROLE_SUPER_ADMIN, "Super Admin"),
    (ROLE_ROOM_ADMIN, "Room Admin"),
    (ROLE_VIEWER, "Viewer"),
)
ROLE_LABELS = dict(ROLE_CHOICES)


def normalize_sbd(value):
    return (value or "").upper().strip()


def extract_sbd_codes(text):
    normalized = OrderedDict()
    for code in SBD_PATTERN.findall(text or ""):
        normalized[normalize_sbd(code)] = True
    return list(normalized.keys())


def normalize_room_name(value):
    return (value or "").strip()


def role_requires_room(role):
    return role == ROLE_ROOM_ADMIN


def ensure_valid_role_room(role, room_name):
    normalized_room_name = normalize_room_name(room_name)
    if role_requires_room(role) and not normalized_room_name:
        raise ValueError(f"Room name is required for {ROLE_LABELS[ROLE_ROOM_ADMIN]}.")
    return normalized_room_name


def format_role_assignment_success(username, role, room_name=""):
    normalized_room_name = normalize_room_name(room_name)
    role_label = ROLE_LABELS.get(role, role)
    if role == ROLE_ROOM_ADMIN and normalized_room_name:
        return f"{username} set as {role_label} for room '{normalized_room_name}'."
    return f"{username} set as {role_label}."


def detect_user_role(user):
    if user.groups.filter(name=ROLE_SUPER_ADMIN).exists():
        return ROLE_SUPER_ADMIN
    if user.groups.filter(name=ROLE_ROOM_ADMIN).exists():
        return ROLE_ROOM_ADMIN
    return ROLE_VIEWER


def apply_user_role(user, role, room_name=""):
    normalized_room_name = ensure_valid_role_room(role, room_name)

    super_admin_group, _ = Group.objects.get_or_create(name=ROLE_SUPER_ADMIN)
    room_admin_group, _ = Group.objects.get_or_create(name=ROLE_ROOM_ADMIN)

    user.groups.remove(super_admin_group, room_admin_group)

    if role == ROLE_SUPER_ADMIN:
        user.groups.add(super_admin_group)
        RoomAdminProfile.objects.filter(user=user).delete()
        return

    if role == ROLE_ROOM_ADMIN:
        user.groups.add(room_admin_group)
        RoomAdminProfile.objects.update_or_create(
            user=user,
            defaults={"room_name": normalized_room_name},
        )
        return

    RoomAdminProfile.objects.filter(user=user).delete()


@transaction.atomic
def sync_incident_references(incident, primary_sbd, violation_text):
    primary_sbd = normalize_sbd(primary_sbd)
    referenced_codes = extract_sbd_codes(violation_text)

    ordered_codes = [primary_sbd]
    for code in referenced_codes:
        if code != primary_sbd:
            ordered_codes.append(code)

    candidates = {
        candidate.normalized_sbd: candidate
        for candidate in Candidate.objects.annotate(
            normalized_sbd=Upper("sbd")
        ).filter(normalized_sbd__in=ordered_codes)
    }

    incident.reported_sbd = primary_sbd
    incident.reported_candidate = candidates.get(primary_sbd)
    incident.violation_text = violation_text.strip()
    incident.save()

    incident.participants.all().delete()
    participant_rows = []
    for index, sbd in enumerate(ordered_codes):
        participant_rows.append(
            IncidentParticipant(
                incident=incident,
                candidate=candidates.get(sbd),
                sbd_snapshot=sbd,
                relation_type=(
                    IncidentParticipant.RELATION_REPORTED
                    if index == 0
                    else IncidentParticipant.RELATION_MENTIONED
                ),
            )
        )

    IncidentParticipant.objects.bulk_create(participant_rows)

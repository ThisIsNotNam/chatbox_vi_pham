import re
from collections import OrderedDict

from django.db import transaction
from django.db.models.functions import Upper

from .models import Candidate, IncidentParticipant

# SBD patterns (ADD-4): 0–2 letters followed by ≥2 digits, total length 1–9.
#   Examples that match: TS0092, CT983, X123, 7728, 99 (all-digit ≥2 chars).
#   Examples that do NOT match: A1 (only 1 digit), X (no digit), ABC123 (3 letters).
# The (?=.{2,9}$) lookahead caps total length at 9 and guarantees ≥2 chars.
SBD_PATTERN      = re.compile(r"^(?=.{2,9}$)[A-Za-z]{0,2}\d{2,}$")

# For scanning bare SBDs within free text (word-boundary version).
SBD_TEXT_PATTERN = re.compile(r"\b[A-Za-z]{0,2}\d{2,9}\b")

# Explicit mention tokens stored in violation_text: @{TS0031}
# Content inside braces is 1..9 chars of [A-Za-z0-9] (hard cap; validated further below).
MENTION_TOKEN_PATTERN = re.compile(r"@\{([A-Za-z0-9]{1,9})\}")

# Valid SBD syntax: only Latin letters + digits, 1–9 chars.
_SBD_SYNTAX_RE = re.compile(r"^[A-Za-z0-9]{1,9}$")

# Hard cap exposed to other layers so UI/validation stay consistent.
MAX_SBD_LENGTH = 9

# Max violation text length enforced in services (model is TextField, no DB limit)
MAX_VIOLATION_TEXT_LEN = 10_000


def normalize_sbd(value):
    return (value or "").upper().strip()


def is_valid_sbd_syntax(value):
    """Return True if value is a syntactically valid SBD (Latin letters + digits only,
    1–20 chars, no spaces or special characters).
    """
    return bool(_SBD_SYNTAX_RE.match((value or "").strip()))


def extract_sbd_codes(text):
    """Extract SBD codes that should be tracked as incident participants.

    Only explicit @{SBD} tokens count. The SBD inside must also match the
    full SBD_PATTERN (letters + digits in correct form) to be a valid participant.
    """
    normalized = OrderedDict()
    for raw in MENTION_TOKEN_PATTERN.findall(text or ""):
        upper = normalize_sbd(raw)
        # Use fullmatch via SBD_PATTERN (anchored ^ and $) so partial matches are rejected
        if SBD_PATTERN.match(upper):
            normalized[upper] = True
    return list(normalized.keys())


@transaction.atomic
def sync_incident_references(incident, primary_sbd, violation_text):
    primary_sbd = normalize_sbd(primary_sbd)

    # Enforce max length at service layer (defence-in-depth against form bypass)
    if len(violation_text) > MAX_VIOLATION_TEXT_LEN:
        violation_text = violation_text[:MAX_VIOLATION_TEXT_LEN]

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

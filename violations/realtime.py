from django.db.models import Count, Max, OuterRef, Subquery
from django.db.models.functions import Upper
from django.template.loader import render_to_string
from django.utils import timezone

from .models import Candidate, Incident, IncidentParticipant

INCIDENT_PAGE_SIZE = 30
INCIDENT_UPDATE_LIMIT = 80


def build_candidate_stats():
    latest_violation = Incident.objects.filter(
        participants__candidate=OuterRef("pk")
    ).order_by("-created_at")

    stats = Candidate.objects.annotate(
        total_violations=Count("incident_links__incident", distinct=True),
        last_violation_at=Max("incident_links__incident__created_at"),
        latest_violation_text=Subquery(latest_violation.values("violation_text")[:1]),
    ).filter(total_violations__gt=0).order_by("-total_violations", "sbd")

    unknown_stats = (
        IncidentParticipant.objects.filter(candidate__isnull=True)
        .annotate(normalized_sbd=Upper("sbd_snapshot"))
        .values("normalized_sbd")
        .annotate(
            total_violations=Count("incident", distinct=True),
            last_violation_at=Max("incident__created_at"),
        )
        .order_by("-total_violations", "normalized_sbd")
    )
    return stats, unknown_stats


def fetch_incidents_page(before_id=None, after_id=None, limit=INCIDENT_PAGE_SIZE):
    query = Incident.objects.select_related("created_by", "reported_candidate").prefetch_related(
        "participants__candidate"
    )

    if after_id is not None:
        return list(query.filter(id__gt=after_id).order_by("id")[:limit])

    if before_id is not None:
        incidents = list(query.filter(id__lt=before_id).order_by("-id")[:limit])
        incidents.reverse()
        return incidents

    incidents = list(query.order_by("-id")[:limit])
    incidents.reverse()
    return incidents


def get_editable_incident_ids(incidents, user):
    if not getattr(user, "is_authenticated", False):
        return []
    return [incident.id for incident in incidents if incident.can_edit(user)]


def render_incident_rows_html(incidents, user):
    return render_to_string(
        "violations/_incident_rows.html",
        {
            "incidents": incidents,
            "editable_incident_ids": get_editable_incident_ids(incidents, user),
            "current_user_id": user.id if getattr(user, "is_authenticated", False) else None,
        },
    )


def build_stats_payload():
    candidate_stats, unknown_stats = build_candidate_stats()
    return {
        "stats_html": render_to_string(
            "violations/_stats_table.html",
            {
                "candidate_stats": candidate_stats,
                "unknown_stats": unknown_stats,
            },
        ),
        "timestamp": timezone.now().isoformat(),
    }


def build_live_payload(user):
    incidents = fetch_incidents_page(limit=INCIDENT_PAGE_SIZE)
    oldest_id = incidents[0].id if incidents else None
    newest_id = incidents[-1].id if incidents else None

    payload = build_stats_payload()
    payload.update(
        {
            "incidents_html": render_incident_rows_html(incidents, user),
            "oldest_id": oldest_id,
            "newest_id": newest_id,
            "has_older": Incident.objects.filter(id__lt=oldest_id).exists() if oldest_id else False,
        }
    )
    return payload

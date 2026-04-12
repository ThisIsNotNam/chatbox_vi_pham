from django.contrib import admin

from .models import Candidate, Incident, IncidentParticipant, RoomAdminProfile


class IncidentParticipantInline(admin.TabularInline):
    model = IncidentParticipant
    extra = 0
    readonly_fields = ("created_at",)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ("sbd", "full_name", "school", "supervisor_teacher", "exam_room")
    search_fields = ("sbd", "full_name", "school", "supervisor_teacher", "exam_room")


@admin.register(RoomAdminProfile)
class RoomAdminProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "room_name")
    search_fields = ("user__username", "room_name")


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ("reported_sbd", "room_name", "created_by", "created_at", "updated_at")
    list_filter = ("room_name", "created_at")
    search_fields = ("reported_sbd", "violation_text", "created_by__username")
    inlines = [IncidentParticipantInline]


@admin.register(IncidentParticipant)
class IncidentParticipantAdmin(admin.ModelAdmin):
    list_display = ("incident", "sbd_snapshot", "relation_type", "candidate", "created_at")
    search_fields = ("sbd_snapshot", "candidate__sbd")
    list_filter = ("relation_type", "created_at")

from pathlib import Path

from django import forms

ALLOWED_EVIDENCE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".mp4",
    ".mov",
    ".webm",
    ".mkv",
    ".avi",
}
MAX_EVIDENCE_SIZE = 100 * 1024 * 1024


class IncidentBaseForm(forms.Form):
    sbd = forms.CharField(max_length=20, label="SBD")
    violation_text = forms.CharField(
        label="Violation Content",
        widget=forms.Textarea(attrs={"rows": 2}),
        max_length=2000,
    )
    evidence = forms.FileField(label="Image/Video", required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            if isinstance(field.widget, forms.CheckboxInput):
                field.widget.attrs["class"] = "form-check-input"
            else:
                field.widget.attrs["class"] = "form-control"

    def clean_sbd(self):
        return self.cleaned_data["sbd"].upper().strip()

    def clean_violation_text(self):
        return self.cleaned_data["violation_text"].strip()

    def clean_evidence(self):
        evidence = self.cleaned_data.get("evidence")
        if not evidence:
            return evidence

        extension = Path(evidence.name).suffix.lower()
        if extension not in ALLOWED_EVIDENCE_EXTENSIONS:
            raise forms.ValidationError("Only image/video files are allowed.")

        if evidence.size > MAX_EVIDENCE_SIZE:
            raise forms.ValidationError("The evidence file must be <= 100MB.")
        return evidence


class IncidentCreateForm(IncidentBaseForm):
    pass


class IncidentEditForm(IncidentBaseForm):
    remove_evidence = forms.BooleanField(required=False, label="Remove existing evidence")


class CandidateImportForm(forms.Form):
    csv_file = forms.FileField(label="CSV file")

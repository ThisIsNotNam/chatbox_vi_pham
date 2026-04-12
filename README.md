# Exam Fraud Monitor (Django + Bootstrap)

This project provides a live fraud-monitoring chat feed and automatic candidate statistics.

## Documentation Index

- Project structure and architecture: [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
- Setup, role management, and workflows: [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)

## Features

- Live incident feed (read-only for viewers/candidates)
- Incident input with:
  - SBD
  - Violation content
  - Optional image/video evidence
- Automatic cross-reference:
  - If message text mentions another SBD (for example `TS0032 exchanged with TS0030`), both SBDs are counted
- Statistics table enriched from candidate master data (name, school, room, supervisor)
- Candidate detail panel (offcanvas, about 2/3 width)
- Roles:
  - `super_admin`: can edit any incident at any time
  - `room_admin`: can post; can edit only own incident within 24 hours
  - viewer/candidate: read-only
- CSV import for candidate list

## Run with your venv

Use the project-local venv at `/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv`:

```bash
cd /var/www/chatbox_vi_pham/chatbox_vi_pham
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py migrate
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/pip install daphne
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/daphne -b 0.0.0.0 -p 8000 chatbox_vi_pham.asgi:application
```

Open: `http://127.0.0.1:8000/`

## Initial admin setup

Create a user:

```bash
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py createsuperuser
```

Assign role quickly:

```bash
# Super admin
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role super_admin

# Room admin
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role room_admin --room P2

# Viewer (remove admin roles)
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role viewer
```

## Candidate CSV format

Recommended columns (header names can be Vietnamese or English variants):

- `SBD`
- `Họ và tên` or `Full Name`
- `Trường` or `School`
- `GVPT` or `Supervisor Teacher`
- `Phòng thi` or `Exam Room`

You can import/update this CSV from the **Statistics** tab.

Use sample file: [sample_candidates.csv](sample_candidates.csv)

## Notes on evidence protection

The UI blocks common copy/download actions for evidence previews (context menu, drag, download controls). This is deterrence at browser level and cannot guarantee absolute anti-capture protection.

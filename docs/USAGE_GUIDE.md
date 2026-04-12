# Usage Guide

This guide explains how to run, configure, and use the Exam Fraud Monitor app.

## 1. Start the application

```bash
cd /var/www/chatbox_vi_pham/chatbox_vi_pham
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py migrate
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/pip install daphne
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/daphne -b 0.0.0.0 -p 8000 chatbox_vi_pham.asgi:application
```

Open:

- http://127.0.0.1:8000/

## 2. Create and manage users

### Create first admin account

```bash
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py createsuperuser
```

### Assign role with command

```bash
# Super admin
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role super_admin

# Room admin (room required)
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role room_admin --room P2

# Viewer
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py set_user_role <username> --role viewer
```

## 3. Role permissions

| Role | View Dashboard | Post Incident | Edit Any Incident | Edit Own Incident | Edit Time Limit |
|---|---|---|---|---|---|
| Super Admin | Yes | Yes | Yes | Yes | No limit |
| Room Admin | Yes | Yes | No | Yes | 24 hours |
| Viewer/Candidate | Yes | No | No | No | N/A |

## 4. Candidate data import

Go to **Statistics** tab, upload CSV.

Recommended columns:

- `SBD`
- `Họ và tên` or `Full Name`
- `Trường` or `School`
- `GVPT` or `Supervisor Teacher`
- `Phòng thi` or `Exam Room`

A sample file is available at `sample_candidates.csv`.

## 5. Incident posting workflow

1. Open Chat Box tab.
2. Enter `SBD`.
3. Enter `Violation Content`.
4. Optionally upload image/video evidence.
5. Click send.

Example:

- SBD: `TS0032`
- Violation Content: `TS0032 exchanged with TS0030`

Result:

- `TS0032` and `TS0030` are both counted in statistics.

## 6. Live monitoring and statistics

- Incident feed updates in realtime via websocket push (no periodic polling).
- Statistics aggregate all related incidents by SBD.
- Click an SBD in statistics to open candidate detail panel with timeline.

## 7. Evidence behavior

- Images and videos are shown inline or in preview modal.
- UI blocks common copy/download actions for evidence previews.
- This is browser-level deterrence and cannot fully prevent screenshots or external capture.

## 8. Admin web interface

Use Django admin:

- http://127.0.0.1:8000/admin/

Useful models:

- Candidates
- Incidents
- Incident Participants
- Room Admin Profiles

## 9. Troubleshooting

### `No module named 'django'`

Use the correct interpreter path:

```bash
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py check
```

### Migrations missing

```bash
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py makemigrations
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py migrate
```

### Verify project health

```bash
/var/www/chatbox_vi_pham/chatbox_vi_pham/.venv/bin/python manage.py check
```

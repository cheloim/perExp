"""The notification stream must not hold a DB session while idle (GHSA-3p3m).

Each poll opens and closes its own session. The old generator kept one
``SessionLocal`` for the whole connection and polled twice per second, which
exhausted the pool under a handful of clients.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Notification
from app.routers.notifications import _load_initial_notifications, _load_notification_updates


def _make_notification(db, user_id: int) -> Notification:
    notif = Notification(
        user_id=user_id,
        type="test",
        title="Título",
        body="Cuerpo",
        data="{}",
        read=False,
    )
    db.add(notif)
    db.commit()
    return notif


def test_helpers_open_and_close_a_session_per_call(db, test_user):
    _make_notification(db, test_user.id)

    sessions = []

    # Share the fixture's connection so the test sees its uncommitted rows,
    # but use independent Session objects so we can assert they get closed.
    class TrackingSession(Session):
        closed = False

        def close(self):
            self.closed = True
            super().close()

    def factory():
        session = TrackingSession(bind=db.get_bind())
        sessions.append(session)
        return session

    initial = _load_initial_notifications(test_user.id, factory)
    assert initial["unread_count"] >= 1

    rows, unread, _pending, latest = _load_notification_updates(
        test_user.id, datetime.utcnow() - timedelta(minutes=1), factory
    )
    assert rows
    assert unread >= 1
    assert latest is not None

    assert len(sessions) == 2
    assert all(session.closed for session in sessions)

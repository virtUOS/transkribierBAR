import email
import email.policy
import smtplib
import socket
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from unittest.mock import MagicMock, patch

from app.services.email import (
    EmailConfigError,
    InvalidRecipientError,
    send_invitation_email,
    send_token_expiry_email,
)
from app.services.token_expiry import build_expiry_message


def test_send_invitation_email_uses_settings(monkeypatch):
    mock_settings = MagicMock()
    mock_settings.SMTP_HOST = "smtp.example.com"
    mock_settings.SMTP_PORT = 587
    mock_settings.SMTP_STARTTLS = True
    mock_settings.SMTP_USER = "u"
    mock_settings.SMTP_PASSWORD = "p"
    mock_settings.SMTP_FROM = "noreply@example.com"

    fake_smtp = MagicMock()
    fake_smtp.__enter__.return_value = fake_smtp

    with patch("app.services.email.settings", mock_settings):
        with patch("app.services.email.smtplib.SMTP", return_value=fake_smtp):
            send_invitation_email(
                to_email="new@example.com",
                invite_url="https://app.example.com/invite/tw_inv_xyz",
            )

    fake_smtp.starttls.assert_called_once()
    fake_smtp.login.assert_called_once_with("u", "p")
    fake_smtp.send_message.assert_called_once()
    msg = fake_smtp.send_message.call_args[0][0]
    assert msg["To"] == "new@example.com"
    assert msg["From"] == "noreply@example.com"
    assert "https://app.example.com/invite/tw_inv_xyz" in str(msg)


def test_send_invitation_email_skips_starttls_when_disabled(monkeypatch):
    mock_settings = MagicMock()
    mock_settings.SMTP_HOST = "relay.internal"
    mock_settings.SMTP_PORT = 25
    mock_settings.SMTP_STARTTLS = False
    mock_settings.SMTP_USER = ""
    mock_settings.SMTP_PASSWORD = ""
    mock_settings.SMTP_FROM = "noreply@internal"

    fake_smtp = MagicMock()
    fake_smtp.__enter__.return_value = fake_smtp

    with patch("app.services.email.settings", mock_settings):
        with patch("app.services.email.smtplib.SMTP", return_value=fake_smtp):
            send_invitation_email(
                to_email="x@internal",
                invite_url="https://app.internal/invite/tw_inv_a",
            )

    fake_smtp.starttls.assert_not_called()
    fake_smtp.login.assert_not_called()
    fake_smtp.send_message.assert_called_once()


def test_send_invitation_email_raises_when_smtp_unset(monkeypatch):
    mock_settings = MagicMock()
    mock_settings.SMTP_HOST = ""
    mock_settings.SMTP_FROM = ""

    with patch("app.services.email.settings", mock_settings):
        with pytest.raises(EmailConfigError):
            send_invitation_email(
                to_email="x@example.com",
                invite_url="https://app.example.com/invite/tw_inv_y",
            )


def _smtp_settings():
    mock_settings = MagicMock()
    mock_settings.SMTP_HOST = "smtp.example.com"
    mock_settings.SMTP_PORT = 587
    mock_settings.SMTP_STARTTLS = True
    mock_settings.SMTP_USER = "u"
    mock_settings.SMTP_PASSWORD = "p"
    mock_settings.SMTP_FROM = "noreply@example.com"
    return mock_settings


def _send_expiry(fake_smtp, *, subject="Subject", body="Body\n"):
    with patch("app.services.email.settings", _smtp_settings()):
        with patch("app.services.email.smtplib.SMTP", return_value=fake_smtp):
            send_token_expiry_email(to_email="owner@example.com", subject=subject, body=body)


def _fake_smtp():
    fake_smtp = MagicMock()
    fake_smtp.__enter__.return_value = fake_smtp
    return fake_smtp


def test_send_token_expiry_email_uses_settings():
    fake_smtp = _fake_smtp()
    _send_expiry(fake_smtp, subject="Token expires", body="Your token expires soon.\n")

    fake_smtp.starttls.assert_called_once()
    fake_smtp.login.assert_called_once_with("u", "p")
    fake_smtp.send_message.assert_called_once()
    msg = fake_smtp.send_message.call_args[0][0]
    assert msg["To"] == "owner@example.com"
    assert msg["From"] == "noreply@example.com"
    assert msg["Subject"] == "Token expires"
    assert not msg.is_multipart()
    assert msg.get_content_type() == "text/plain"
    assert msg.get_content() == "Your token expires soon.\n"


def test_mail_is_ascii_on_the_wire_and_reads_back():
    subject, body = build_expiry_message(
        name="Größe", prefix="tw_abcdefgh1",
        expires_at=datetime(2027, 1, 15, 10, 30, tzinfo=timezone.utc),
        days=3, app_url="https://app.example.com",
    )
    assert "ü" in subject and "„Größe“" in body

    fake_smtp = _fake_smtp()
    _send_expiry(fake_smtp, subject=subject, body=body)
    raw = fake_smtp.send_message.call_args[0][0].as_bytes()

    for line in raw.splitlines():
        line.decode("ascii")
    parsed = email.message_from_bytes(raw, policy=email.policy.default)
    assert parsed["Subject"] == subject
    assert parsed.get_content() == body


def test_mail_has_date_and_message_id():
    fake_smtp = _fake_smtp()
    _send_expiry(fake_smtp)
    _send_expiry(fake_smtp)

    first, second = (c[0][0] for c in fake_smtp.send_message.call_args_list)
    for msg in (first, second):
        assert msg["Date"]
        assert msg["Message-ID"].endswith("@example.com>")
    assert first["Message-ID"] != second["Message-ID"]


def test_recipient_with_line_break_is_refused():
    with patch("app.services.email.settings", _smtp_settings()):
        with patch("app.services.email.smtplib.SMTP") as smtp_cls:
            with pytest.raises(ValueError) as exc:
                send_token_expiry_email(
                    to_email="a@example.com\r\nBcc: x@example.com",
                    subject="Subject",
                    body="Body\n",
                )
    assert isinstance(exc.value, InvalidRecipientError)
    smtp_cls.assert_not_called()


@contextmanager
def fake_relay(*, quit_reply: bytes = b"250 2.0.0 Bye"):
    """A one-connection SMTP relay on localhost that accepts every mail.

    It answers QUIT with `quit_reply`; a real relay should say 221. Yields the
    port and what it saw: the DATA payload and whether the client then closed.
    """
    server = socket.create_server(("127.0.0.1", 0))
    server.settimeout(5)
    seen = {"data": b"", "closed": False}
    # smtplib.SMTP() calls socket.getfqdn() after the greeting (no local_hostname
    # is passed). A slow lookup would outlast the 5 s socket timeout below. The stub
    # must contain a dot, else smtplib falls back to gethostbyname(gethostname()).
    fqdn_stub = patch("app.services.email.smtplib.socket.getfqdn", lambda *a, **k: "client.test")
    fqdn_stub.start()

    def serve():
        try:
            conn, _ = server.accept()
        except OSError:
            return
        conn.settimeout(5)
        with conn, conn.makefile("rb") as rfile:
            def reply(line: bytes) -> None:
                conn.sendall(line + b"\r\n")

            reply(b"220 relay.test ESMTP")
            while line := rfile.readline():
                verb = line.strip().upper()[:4]
                if verb in (b"EHLO", b"HELO"):
                    reply(b"250 relay.test")
                elif verb == b"DATA":
                    reply(b"354 End data with <CR><LF>.<CR><LF>")
                    while (data_line := rfile.readline()) not in (b".\r\n", b""):
                        seen["data"] += data_line
                    reply(b"250 2.0.0 Ok: queued")
                elif verb == b"QUIT":
                    reply(quit_reply)
                    seen["closed"] = rfile.readline() == b""
                    return
                else:
                    reply(b"250 2.1.0 Ok")
            seen["closed"] = True

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield server.getsockname()[1], seen
    finally:
        thread.join(5)
        server.close()
        fqdn_stub.stop()


def relay_settings(port: int) -> SimpleNamespace:
    return SimpleNamespace(
        SMTP_HOST="127.0.0.1", SMTP_PORT=port, SMTP_STARTTLS=False,
        SMTP_USER="", SMTP_PASSWORD="", SMTP_FROM="noreply@example.com",
    )


def test_relay_that_accepted_the_mail_but_fumbles_quit_counts_as_sent():
    """Python 3.12's `with SMTP()` raises on a QUIT reply other than 221, after the relay took the mail."""
    with fake_relay(quit_reply=b"250 2.0.0 Bye") as (port, seen):
        with patch("app.services.email.settings", relay_settings(port)):
            send_token_expiry_email(to_email="owner@example.com", subject="Subject", body="Body\n")

    assert b"Body" in seen["data"]
    assert seen["closed"]


def test_failed_quit_after_send_does_not_raise_and_closes():
    fake_smtp = _fake_smtp()
    fake_smtp.quit.side_effect = smtplib.SMTPResponseException(250, b"2.0.0 Bye")
    _send_expiry(fake_smtp)

    fake_smtp.send_message.assert_called_once()
    fake_smtp.close.assert_called()


@pytest.mark.parametrize(
    "error", [smtplib.SMTPServerDisconnected("gone"), ConnectionResetError("reset")]
)
def test_lost_connection_at_quit_does_not_raise(error):
    fake_smtp = _fake_smtp()
    fake_smtp.quit.side_effect = error
    _send_expiry(fake_smtp)

    fake_smtp.close.assert_called()


def test_failed_send_raises_and_closes_the_connection():
    fake_smtp = _fake_smtp()
    fake_smtp.send_message.side_effect = smtplib.SMTPServerDisconnected("gone")
    with pytest.raises(smtplib.SMTPServerDisconnected):
        _send_expiry(fake_smtp)

    fake_smtp.close.assert_called()


def test_invitation_survives_a_failed_quit():
    fake_smtp = _fake_smtp()
    fake_smtp.quit.side_effect = smtplib.SMTPResponseException(250, b"2.0.0 Bye")
    with patch("app.services.email.settings", _smtp_settings()):
        with patch("app.services.email.smtplib.SMTP", return_value=fake_smtp):
            send_invitation_email(
                to_email="new@example.com", invite_url="https://app.example.com/invite/tw_inv_q",
            )

    fake_smtp.send_message.assert_called_once()
    fake_smtp.close.assert_called()

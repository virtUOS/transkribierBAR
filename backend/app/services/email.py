import smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from app.config import settings


class EmailConfigError(Exception):
    """Raised when SMTP settings are missing or incomplete."""


class InvalidRecipientError(ValueError):
    """Raised before connecting for a recipient address no mail can carry."""


def _body_text(invite_url: str) -> str:
    return (
        "You have been invited to transkribierBAR.\n\n"
        f"Click the link below to set up your account:\n\n{invite_url}\n\n"
        "This link expires in 7 days. If you did not expect this email, you can ignore it.\n"
    )


def _body_html(invite_url: str) -> str:
    return (
        "<p>You have been invited to transkribierBAR.</p>"
        f'<p><a href="{invite_url}">Click here to set up your account</a></p>'
        f'<p>Or paste this link into your browser:<br><code>{invite_url}</code></p>'
        "<p>This link expires in 7 days. If you did not expect this email, you can ignore it.</p>"
    )


def _sender_domain() -> str:
    _, at, domain = parseaddr(settings.SMTP_FROM)[1].rpartition("@")
    return domain if at and domain else "localhost"


def _message(*, to_email: str, subject: str) -> EmailMessage:
    if not settings.SMTP_HOST or not settings.SMTP_FROM:
        raise EmailConfigError("SMTP_HOST and SMTP_FROM must be set to send emails")
    # The address comes from the identity provider; a line break in it would
    # let it add headers of its own.
    if "\r" in to_email or "\n" in to_email:
        raise InvalidRecipientError("line break in recipient address")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    return msg


def _send(msg: EmailMessage) -> None:
    """Send `msg` through the configured relay, stamping Date and Message-ID.

    Spam filters score mail without them, so they are not left to the relay.
    """
    msg["Date"] = formatdate(usegmt=True)
    msg["Message-ID"] = make_msgid(domain=_sender_domain())
    # Not `with SMTP(...)`: its exit raises when the QUIT reply is not 221,
    # after the relay has accepted the mail, and the caller would send again.
    s = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)
    try:
        if settings.SMTP_STARTTLS:
            s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        s.send_message(msg)
        try:
            s.quit()
        except (smtplib.SMTPException, OSError):
            pass  # the mail is accepted; the connection is closed below
    finally:
        s.close()


def send_invitation_email(*, to_email: str, invite_url: str) -> None:
    msg = _message(to_email=to_email, subject="You have been invited to transkribierBAR")
    msg.set_content(_body_text(invite_url))
    msg.add_alternative(_body_html(invite_url), subtype="html")
    _send(msg)


def send_token_expiry_email(*, to_email: str, subject: str, body: str) -> None:
    """Send a plain-text mail; raises EmailConfigError without a relay configured."""
    msg = _message(to_email=to_email, subject=subject)
    # The default policy would send non-ASCII text as raw 8bit; quoted-printable
    # keeps the wire ASCII for relays without 8BITMIME.
    msg.set_content(body, cte="quoted-printable")
    _send(msg)

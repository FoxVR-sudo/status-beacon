from app.config import settings


def _app_name() -> str:
    return "Status Beacon"


def _base_footer() -> str:
    return (
        "\n\n"
        f"---\n"
        f"{_app_name()}\n"
        f"{settings.FRONTEND_URL.rstrip('/')}"
    )


def build_verify_email_message(first_name: str, verify_url: str) -> tuple[str, str, str]:
    greeting_name = first_name.strip() or "there"
    subject = f"Verify your {_app_name()} account"
    text_body = (
        f"Hi {greeting_name},\n\n"
        "Thanks for registering. Please verify your email to activate login.\n\n"
        f"Verify email: {verify_url}\n\n"
        f"This link expires in {settings.EMAIL_VERIFICATION_EXPIRE_HOURS} hours."
        f"{_base_footer()}"
    )
    html_body = (
        f"<p>Hi {greeting_name},</p>"
        "<p>Thanks for registering. Please verify your email to activate login.</p>"
        f"<p><a href=\"{verify_url}\">Verify email</a></p>"
        f"<p>This link expires in {settings.EMAIL_VERIFICATION_EXPIRE_HOURS} hours.</p>"
        f"<hr><p>{_app_name()}<br>{settings.FRONTEND_URL.rstrip('/')}</p>"
    )
    return subject, text_body, html_body


def build_password_reset_message(reset_url: str) -> tuple[str, str, str]:
    subject = f"Reset your {_app_name()} password"
    text_body = (
        "We received a request to reset your password.\n\n"
        f"Open this link to choose a new password: {reset_url}\n\n"
        f"This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes."
        f"{_base_footer()}"
    )
    html_body = (
        "<p>We received a request to reset your password.</p>"
        f"<p><a href=\"{reset_url}\">Choose a new password</a></p>"
        f"<p>This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.</p>"
        f"<hr><p>{_app_name()}<br>{settings.FRONTEND_URL.rstrip('/')}</p>"
    )
    return subject, text_body, html_body


def build_password_changed_message() -> tuple[str, str, str]:
    subject = f"Your {_app_name()} password was changed"
    text_body = (
        "Your account password was changed successfully.\n\n"
        "If this wasn't you, reset your password immediately."
        f"{_base_footer()}"
    )
    html_body = (
        "<p>Your account password was changed successfully.</p>"
        "<p>If this wasn't you, reset your password immediately.</p>"
        f"<hr><p>{_app_name()}<br>{settings.FRONTEND_URL.rstrip('/')}</p>"
    )
    return subject, text_body, html_body

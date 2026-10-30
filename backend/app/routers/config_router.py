from fastapi import APIRouter, Depends
from app.config import settings
from app.dependencies import get_current_user
from app.models import ConfigResponse, UserInfo
from app.metrics import metrics_response
from app.routers import public_pages
from app.services import support_assistant

router = APIRouter()


@router.get("/api/health")
async def health():
    return {"status": "healthy"}


@router.get("/api/config", response_model=ConfigResponse)
async def get_config(user: UserInfo = Depends(get_current_user)):
    return ConfigResponse(
        asr_backend=settings.ASR_BACKEND,
        whisper_models=settings.WHISPER_MODELS,
        default_model=settings.DEFAULT_WHISPER_MODEL,
        llm_available=bool(settings.LLM_PROVIDER),
        logout_url=settings.LOGOUT_URL,
        popular_languages=settings.POPULAR_LANGUAGES,
        enabled_languages=settings.ENABLED_LANGUAGES,
        api_tokens_enabled=settings.ENABLE_API_TOKENS,
        api_token_default_expiry_days=settings.API_TOKEN_DEFAULT_EXPIRY_DAYS,
        contact_email=settings.CONTACT_EMAIL,
        is_admin=user.is_admin,
        invitation_mode=settings.INVITATION_MODE,
        default_expiry_hours=settings.DEFAULT_EXPIRY_HOURS,
        archive_expiry_hours=settings.ARCHIVE_EXPIRY_HOURS,
        privacy_notice=bool(public_pages.NOTICES),
        support_assistant_enabled=support_assistant.support_assistant_available(),
    )


@router.get("/metrics")
async def get_metrics():
    return metrics_response()

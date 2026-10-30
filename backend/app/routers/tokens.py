from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, Response

from app.config import settings
from app.database import get_db
from app.dependencies import get_session_user
from app.metrics import inc, api_tokens_created_total, api_tokens_revoked_total
from app.models import (
    TokenCreateRequest, TokenCreateResponse, TokenListItem, UserInfo,
)
from app.services.api_tokens import (
    create_token, list_tokens, revoke_token,
    DuplicateTokenNameError, TokenLimitError,
)


async def _require_tokens_enabled() -> None:
    if not settings.ENABLE_API_TOKENS:
        raise HTTPException(status_code=404)


router = APIRouter(dependencies=[Depends(_require_tokens_enabled)])


@router.post("/api/tokens", response_model=TokenCreateResponse)
async def create_api_token(
    req: TokenCreateRequest,
    user: UserInfo = Depends(get_session_user),
):
    async with get_db() as db:
        # Ensure user row exists (mirrors upload.py pattern)
        await db.execute(
            "INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)",
            (user.id, user.email),
        )
        try:
            created = await create_token(
                db, user_id=user.id, name=req.name, expires_in_days=req.expires_in_days,
            )
        except DuplicateTokenNameError as e:
            # The code is for the frontend, which shows its own localized text.
            return JSONResponse(
                status_code=409, content={"detail": str(e), "code": "duplicate_token_name"},
            )
        except TokenLimitError as e:
            return JSONResponse(
                status_code=429, content={"detail": str(e), "code": "token_limit_reached"},
            )
    inc(api_tokens_created_total)
    return TokenCreateResponse(**created)


@router.get("/api/tokens", response_model=list[TokenListItem])
async def list_api_tokens(user: UserInfo = Depends(get_session_user)):
    async with get_db() as db:
        items = await list_tokens(db, user_id=user.id)
    return [TokenListItem(**row) for row in items]


@router.delete("/api/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_token(
    token_id: str,
    user: UserInfo = Depends(get_session_user),
):
    async with get_db() as db:
        ok = await revoke_token(db, user_id=user.id, token_id=token_id)
    if not ok:
        return JSONResponse(
            status_code=404, content={"detail": "Token not found", "code": "token_not_found"},
        )
    inc(api_tokens_revoked_total)
    return Response(status_code=204)

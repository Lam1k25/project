import base64
import hashlib
import hmac
import os
import re
import secrets
import sys
import webbrowser
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import inspect, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

if __package__:
    from .ai import AIChatRequest, AIChatResponse, generate_ai_response
    from .database import Base, SessionLocal, engine
    from .models import AuthSession, Message, User
    from .serializers import MessageSerializer, serialize_message
else:
    from ai import AIChatRequest, AIChatResponse, generate_ai_response
    from database import Base, SessionLocal, engine
    from models import AuthSession, Message, User
    from serializers import MessageSerializer, serialize_message


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
OPEN_BROWSER_ON_START = False
SESSION_LIFETIME = timedelta(days=30)
PASSWORD_ITERATIONS = 310_000
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
bearer_scheme = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address.")
        return value


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address.")
        return value


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    email: str | None = Field(default=None, min_length=3, max_length=254)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        if value is None:
            return value
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address.")
        return value


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class MessageCreate(BaseModel):
    peer_id: int
    text: str = Field(min_length=1, max_length=4000)


@asynccontextmanager
async def lifespan(_app):
    if OPEN_BROWSER_ON_START:
        webbrowser.open("http://127.0.0.1:8000/messenger.html")
    yield


def migrate_legacy_schema():
    Base.metadata.create_all(bind=engine)
    columns = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        if "password_hash" not in columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)")
        if "is_active" not in columns:
            connection.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1"
            )


migrate_legacy_schema()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    if stored_hash is None:
        return False
    try:
        algorithm, iteration_text, salt_text, digest_text = stored_hash.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        if iterations < 100_000 or iterations > 1_000_000:
            return False
        salt = base64.b64decode(salt_text, validate=True)
        expected_digest = base64.b64decode(digest_text, validate=True)
        actual_digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, iterations
        )
        return hmac.compare_digest(actual_digest, expected_digest)
    except (ValueError, TypeError):
        return False


DUMMY_PASSWORD_HASH = hash_password("invalid-login-timing-placeholder")


def public_user(user: User):
    return {"id": user.id, "name": user.name, "email": user.email}


def create_session(db: Session, user: User):
    raw_token = secrets.token_urlsafe(32)
    session = AuthSession(
        user_id=user.id,
        token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
        expires_at=datetime.utcnow() + SESSION_LIFETIME,
    )
    db.add(session)
    db.commit()
    return {"token": raw_token, "user": public_user(user)}


def get_current_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue.")

    token_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
    session = (
        db.query(AuthSession)
        .filter(AuthSession.token_hash == token_hash)
        .first()
    )
    if session is None or session.expires_at <= datetime.utcnow() or not session.user.is_active:
        if session is not None:
            db.delete(session)
            db.commit()
        raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.")
    return session


def get_current_user(
    current_session: AuthSession = Depends(get_current_session),
):
    return current_session.user


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.post("/auth/register", status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    return create_session(db, user)


@app.post("/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    password_hash = (
        user.password_hash
        if user is not None and user.password_hash
        else DUMMY_PASSWORD_HASH
    )
    password_is_valid = verify_password(payload.password, password_hash)
    if (
        user is None
        or not user.is_active
        or not password_is_valid
    ):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return create_session(db, user)


@app.get("/auth/me")
def read_profile(current_user: User = Depends(get_current_user)):
    return public_user(current_user)


@app.patch("/auth/me")
def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No profile changes were provided.")
    for field, value in updates.items():
        if value is not None:
            setattr(current_user, field, value)
    try:
        db.commit()
        db.refresh(current_user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    return public_user(current_user)


@app.post("/auth/change-password")
def change_password(
    payload: PasswordChange,
    current_session: AuthSession = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    user = current_session.user
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="The current password is incorrect.")
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=400,
            detail="The new password must be different from the current password.",
        )

    user.password_hash = hash_password(payload.new_password)
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(
        synchronize_session=False
    )
    db.commit()
    return create_session(db, user)


@app.post("/auth/logout", status_code=204)
def logout(
    current_session: AuthSession = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    db.delete(current_session)
    db.commit()


@app.get("/users/")
def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    users = (
        db.query(User)
        .filter(
            User.is_active.is_(True),
            User.password_hash.is_not(None),
            User.id != current_user.id,
        )
        .order_by(User.name, User.id)
        .all()
    )
    return [public_user(user) for user in users]


@app.get("/messages/", response_model=list[MessageSerializer])
def list_messages(
    peer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if peer_id == current_user.id:
        raise HTTPException(status_code=400, detail="Choose a different account to chat with.")
    peer = (
        db.query(User)
        .filter(
            User.id == peer_id,
            User.is_active.is_(True),
            User.password_hash.is_not(None),
        )
        .first()
    )
    if peer is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    conversation = (
        db.query(Message)
        .options(joinedload(Message.sender))
        .filter(
            or_(
                (Message.sender_id == current_user.id) & (Message.recipient_id == peer_id),
                (Message.sender_id == peer_id) & (Message.recipient_id == current_user.id),
            )
        )
        .order_by(Message.created_at, Message.id)
        .all()
    )
    return [serialize_message(message) for message in conversation]


@app.post("/messages/", status_code=201, response_model=MessageSerializer)
def send_message(
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    peer = (
        db.query(User)
        .filter(
            User.id == payload.peer_id,
            User.is_active.is_(True),
            User.password_hash.is_not(None),
        )
        .first()
    )
    if peer is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    if peer.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot send a message to yourself.")

    saved_message = Message(
        sender_id=current_user.id,
        recipient_id=peer.id,
        text=text,
        sender=current_user,
    )
    db.add(saved_message)
    db.commit()
    db.refresh(saved_message)
    return serialize_message(saved_message)


@app.post("/ai/chat", response_model=AIChatResponse)
def chat_with_ai(
    payload: AIChatRequest,
    _current_user: User = Depends(get_current_user),
):
    return AIChatResponse(
        answer=generate_ai_response(payload.messages, mode=payload.mode)
    )


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse(url="/messenger.html")


@app.get("/health", include_in_schema=False)
def health_check():
    return {"status": "ok"}


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")


if __name__ == "__main__":
    if sys.argv[1:] != ["runserver"]:
        raise SystemExit("Usage: python main.py runserver")

    OPEN_BROWSER_ON_START = True
    uvicorn.run(
        app,
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
    )

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

if __package__:
    from .models import Message
else:
    from models import Message


class MessageSenderSerializer(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str


class MessageSerializer(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sender_id: int
    recipient_id: int
    text: str
    created_at: datetime
    sender: MessageSenderSerializer = Field(exclude=True)

    @computed_field
    @property
    def sender_name(self) -> str:
        return self.sender.name


def serialize_message(message: Message) -> MessageSerializer:
    return MessageSerializer.model_validate(message)

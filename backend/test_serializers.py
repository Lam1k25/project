import unittest

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, joinedload

if __package__:
    from .database import Base
    from .models import Message, User
    from .serializers import serialize_message
else:
    from database import Base
    from models import Message, User
    from serializers import serialize_message


class MessageSerializerTests(unittest.TestCase):
    def test_serializes_message_history_without_n_plus_one_queries(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            sender = User(name="Отправитель", email="sender@example.com")
            recipient = User(name="Получатель", email="recipient@example.com")
            db.add_all([sender, recipient])
            db.flush()
            db.add_all(
                [
                    Message(sender=sender, recipient=recipient, text=f"Сообщение {index}")
                    for index in range(3)
                ]
            )
            db.commit()

            statements = []
            event.listen(
                engine,
                "before_cursor_execute",
                lambda *_args: statements.append(_args[2]),
            )
            messages = (
                db.query(Message)
                .options(joinedload(Message.sender))
                .order_by(Message.id)
                .all()
            )
            serialized = [serialize_message(message).model_dump(mode="json") for message in messages]

        self.assertEqual(len(statements), 1)
        self.assertEqual([item["sender_name"] for item in serialized], ["Отправитель"] * 3)
        self.assertEqual(serialized[0]["text"], "Сообщение 0")
        self.assertNotIn("sender", serialized[0])


if __name__ == "__main__":
    unittest.main()

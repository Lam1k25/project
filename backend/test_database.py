import unittest

if __package__:
    from .database import normalize_database_url
else:
    from database import normalize_database_url


class DatabaseUrlTests(unittest.TestCase):
    def test_normalizes_render_postgres_url(self):
        self.assertEqual(
            normalize_database_url("postgres://user:pass@host/db"),
            "postgresql+psycopg://user:pass@host/db",
        )

    def test_normalizes_postgresql_url(self):
        self.assertEqual(
            normalize_database_url("postgresql://user:pass@host/db"),
            "postgresql+psycopg://user:pass@host/db",
        )

    def test_leaves_other_database_urls_unchanged(self):
        sqlite_url = "sqlite:///local.db"
        self.assertEqual(normalize_database_url(sqlite_url), sqlite_url)


if __name__ == "__main__":
    unittest.main()

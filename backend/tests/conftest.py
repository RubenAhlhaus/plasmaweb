"""Shared pytest fixtures for backend tests."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_user_preferences(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """Prevent tests from reading the developer's real user-preferences file."""
    path = tmp_path / "user-preferences.json"
    monkeypatch.setenv("LCNCGUI_USER_PREFERENCES", str(path))
    return path

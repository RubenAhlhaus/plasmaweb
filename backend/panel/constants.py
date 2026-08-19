"""Panel HAL constants — keep in sync with frontend where noted."""

from __future__ import annotations

# Must match ``HAL_SOFTKEY_DISPLAY_SLOT_BY_BUTTON_ID`` in
# ``src/lib/virtualSidebarButtons.ts`` (internal button id → API slot 14/15/16).
HAL_SOFTKEY_SLOT_BY_SIDEBAR_BUTTON: dict[int, int] = {
    8: 14,
    13: 15,
    16: 16,
}

# Virtual sidebar buttons that open UI dialogs (frontend event bus).
UI_SIDEBAR_BUTTON_IDS: frozenset[int] = frozenset({2, 5, 6, 7})

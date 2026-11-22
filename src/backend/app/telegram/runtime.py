"""Shared runtime hooks for the Telegram bot package.

Handlers resolve mutable collaborators through :func:`bot_module` so the
composition root (``app.telegram_bot``) remains the single patchable namespace
and logging keeps the historical ``app.telegram_bot`` channel.
"""

import logging
import sys
from types import ModuleType

logger = logging.getLogger("app.telegram_bot")


def bot_module() -> ModuleType:
    """Return the ``app.telegram_bot`` compatibility module.

    It is imported before any handler runs, so looking it up in ``sys.modules``
    avoids a circular import at module load time while keeping attribute access
    (and monkeypatching in tests) live.
    """
    return sys.modules["app.telegram_bot"]

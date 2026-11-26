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

    Looking it up in ``sys.modules`` avoids a circular import at module load
    time. Some callers (the analysis export endpoint, for example) send a
    message without ever starting the bot, so the module may not be imported
    yet; import it lazily instead of raising ``KeyError`` in production.
    """
    module = sys.modules.get("app.telegram_bot")
    if module is None:
        import app.telegram_bot as module
    return module

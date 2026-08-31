import logging
import sys

import structlog

_configured = False


def configure_logging() -> None:
    """Idempotent, and called once at the bottom of this module - importing
    logging_config anywhere (directly or via get_logger) is enough to have
    structlog configured, so import order across main.py/services/kafka
    doesn't matter."""
    global _configured
    if _configured:
        return

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


configure_logging()


def get_logger(name: str = "") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)

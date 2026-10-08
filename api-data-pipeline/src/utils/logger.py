"""
Centralized logging configuration module.
Provides formatted console and rotating file logging for pipeline traceability.
"""

import logging
import os
from logging.handlers import RotatingFileHandler
from typing import Optional


def setup_logger(
    name: str = "pipeline",
    log_level: str = "INFO",
    log_file: Optional[str] = "logs/pipeline.log",
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 5,
) -> logging.Logger:
    """
    Configures and returns a robust logger instance.

    Args:
        name: Logger name (defaults to 'pipeline').
        log_level: Logging severity level (DEBUG, INFO, WARNING, ERROR, CRITICAL).
        log_file: Destination file path for log persistence.
        max_bytes: Maximum size of a log file before rotation (10 MB default).
        backup_count: Number of rotated backup logs to retain.

    Returns:
        Configured logging.Logger instance.
    """
    logger = logging.getLogger(name)
    level = getattr(logging, log_level.upper(), logging.INFO)
    logger.setLevel(level)

    # Avoid adding duplicate handlers if logger was already initialized
    if logger.handlers:
        return logger

    # Structured format
    log_format = "%(asctime)s [%(levelname)-8s] [%(name)s:%(funcName)s:%(lineno)d] %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt=log_format, datefmt=date_format)

    # 1. Console Stream Handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # 2. Rotating File Handler (persists logs to disk safely)
    if log_file:
        try:
            log_dir = os.path.dirname(log_file)
            if log_dir and not os.path.exists(log_dir):
                os.makedirs(log_dir, exist_ok=True)

            file_handler = RotatingFileHandler(
                filename=log_file,
                maxBytes=max_bytes,
                backupCount=backup_count,
                encoding="utf-8",
            )
            file_handler.setLevel(level)
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)
        except OSError as e:
            logger.warning("Could not set up file logger at %s: %s", log_file, e)

    return logger

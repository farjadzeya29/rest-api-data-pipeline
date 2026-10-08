"""
Raw Data Contract & Ingestion Validation Module.
Validates structural integrity, required schema attributes, and field datatypes
on raw JSON before data is loaded into Pandas DataFrames.
"""

import logging
from typing import Any, Dict, List, Set, Tuple

logger = logging.getLogger("pipeline.validate")


class ValidationError(Exception):
    """Raised when critical schema contract failure occurs."""
    pass


class RawDataValidator:
    """
    Validates structural contracts and data integrity of raw API payloads.
    """

    # Non-nullable essential fields required to construct a valid entity
    REQUIRED_FIELDS: Set[str] = {
        "id",
        "title",
        "price",
        "category",
    }

    # Expected primitive types for core attributes
    TYPE_CONSTRAINTS = {
        "id": int,
        "title": str,
        "price": (int, float),
        "category": str,
    }

    def __init__(self, reject_invalid: bool = True):
        """
        Args:
            reject_invalid: If True, bad individual records are quarantined/filtered.
                            If False, raises ValidationError on first failure.
        """
        self.reject_invalid = reject_invalid

    def validate_record(self, record: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Validates an individual record dictionary against required contract rules.

        Returns:
            Tuple of (is_valid: bool, issues: list of str).
        """
        issues: List[str] = []

        if not isinstance(record, dict):
            return False, ["Record is not a valid JSON object/dict."]

        # 1. Required fields presence check
        missing_fields = self.REQUIRED_FIELDS - set(record.keys())
        if missing_fields:
            issues.append(f"Missing required fields: {list(missing_fields)}")

        # 2. Check for null values in required fields
        for field in self.REQUIRED_FIELDS:
            if field in record and record[field] is None:
                issues.append(f"Required field '{field}' contains null value.")

        # 3. Type check on essential fields
        for field, expected_type in self.TYPE_CONSTRAINTS.items():
            val = record.get(field)
            if val is not None and not isinstance(val, expected_type):
                issues.append(
                    f"Field '{field}' has invalid type {type(val).__name__}, expected {expected_type}"
                )

        # 4. Domain boundary sanity checks
        if "id" in record and isinstance(record["id"], int) and record["id"] <= 0:
            issues.append(f"Invalid non-positive ID: {record['id']}")

        if "price" in record and isinstance(record["price"], (int, float)) and record["price"] < 0:
            issues.append(f"Negative price encountered: {record['price']}")

        return len(issues) == 0, issues

    def validate_batch(
        self, records: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Validates a batch of records. Segregates into valid records and quarantined records.

        Args:
            records: List of raw dictionaries.

        Returns:
            Tuple of (valid_records, quarantined_records).
        """
        valid_records: List[Dict[str, Any]] = []
        quarantined: List[Dict[str, Any]] = []

        if not records:
            logger.warning("Empty records batch passed to validator.")
            return [], []

        for idx, record in enumerate(records):
            is_valid, issues = self.validate_record(record)
            if is_valid:
                valid_records.append(record)
            else:
                record_id = record.get("id", f"index_{idx}") if isinstance(record, dict) else f"index_{idx}"
                logger.warning(
                    "Record %s failed contract validation: %s",
                    record_id,
                    "; ".join(issues),
                )
                if not self.reject_invalid:
                    raise ValidationError(
                        f"Critical validation failure on record {record_id}: {'; '.join(issues)}"
                    )
                quarantined.append({"record": record, "reasons": issues})

        logger.info(
            "Contract validation finished: %d valid records, %d quarantined records (Total evaluated: %d)",
            len(valid_records),
            len(quarantined),
            len(records),
        )

        return valid_records, quarantined

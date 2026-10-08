"""
Data Extraction Module.
Orchestrates paginated batch extraction from the REST API,
tracking progress, boundary conditions, and yields extracted raw payloads.
"""

import logging
from typing import Any, Dict, Generator, List, Optional
from src.api_client import APIClient, APIClientError

logger = logging.getLogger("pipeline.extract")


class Extractor:
    """
    Handles paginated extraction of product records from the target REST API.
    """

    def __init__(
        self,
        api_client: APIClient,
        endpoint: str = "/products",
        page_size: int = 30,
        max_records: Optional[int] = None,
    ):
        """
        Initializes the Extractor.

        Args:
            api_client: Instantiated APIClient.
            endpoint: Relative path to resource endpoint.
            page_size: Number of records requested per API page.
            max_records: Optional ceiling on total records to extract (None = fetch all).
        """
        self.client = api_client
        self.endpoint = endpoint
        self.page_size = max(1, page_size)
        self.max_records = max_records if (max_records and max_records > 0) else None

    def extract_pages(self) -> Generator[List[Dict[str, Any]], None, None]:
        """
        Paginates through the API using skip/limit parameters, yielding records page by page.

        Yields:
            List of raw product dictionaries per page.
        """
        skip = 0
        page_num = 1
        total_extracted = 0
        api_total: Optional[int] = None

        logger.info(
            "Starting paginated extraction: endpoint='%s', page_size=%d, max_records=%s",
            self.endpoint,
            self.page_size,
            self.max_records or "ALL",
        )

        while True:
            # Determine limit for this page (respecting max_records if provided)
            current_limit = self.page_size
            if self.max_records:
                remaining = self.max_records - total_extracted
                if remaining <= 0:
                    logger.info("Reached configured extraction limit of %d records.", self.max_records)
                    break
                current_limit = min(self.page_size, remaining)

            params = {
                "limit": current_limit,
                "skip": skip,
            }

            logger.info("Requesting Page %d: skip=%d, limit=%d", page_num, skip, current_limit)

            try:
                response = self.client.get(self.endpoint, params=params)
            except APIClientError as exc:
                logger.error("Failed to extract page %d at skip=%d: %s", page_num, skip, exc)
                raise

            # Extract records list from payload envelope
            records = response.get("products", [])
            page_record_count = len(records)

            if api_total is None and "total" in response:
                api_total = response["total"]
                logger.info("Target API reports total catalog size of %d records.", api_total)

            logger.info(
                "Page %d extracted successfully: %d records received (cumulative: %d%s)",
                page_num,
                page_record_count,
                total_extracted + page_record_count,
                f" / {min(api_total, self.max_records or api_total)}" if api_total else "",
            )

            if page_record_count == 0:
                logger.info("Empty page returned. End of API records reached.")
                break

            total_extracted += page_record_count
            yield records

            skip += page_record_count
            page_num += 1

            # Termination conditions:
            # 1. Total records extracted matches or exceeds max_records
            if self.max_records and total_extracted >= self.max_records:
                logger.info("Extraction ceiling reached: %d records.", total_extracted)
                break

            # 2. Reached API total reported count
            if api_total is not None and skip >= api_total:
                logger.info("All %d records from catalog have been extracted.", api_total)
                break

            # 3. Last page returned fewer items than requested
            if page_record_count < current_limit:
                logger.info("Partial page received (%d < %d). No further records available.", page_record_count, current_limit)
                break

        logger.info(
            "Extraction completed. Total pages: %d, total records extracted: %d",
            page_num - 1 if page_record_count == 0 else page_num,
            total_extracted,
        )

    def extract_all(self) -> List[Dict[str, Any]]:
        """
        Helper method that aggregates all extracted pages into a single flat list.

        Returns:
            List of all raw record dicts.
        """
        all_records: List[Dict[str, Any]] = []
        for page_records in self.extract_pages():
            all_records.extend(page_records)
        return all_records

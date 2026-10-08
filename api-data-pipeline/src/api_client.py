"""
Robust HTTP Client for REST API Ingestion.
Implements retry logic with exponential backoff, rate limit handling,
timeouts, session reuse, and granular error classification.
"""

import logging
import time
from typing import Any, Dict, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

logger = logging.getLogger("pipeline.api_client")


class APIClientError(Exception):
    """Base exception for all API client failures."""
    pass


class APITimeoutError(APIClientError):
    """Raised when an API request exceeds the configured timeout."""
    pass


class APIRateLimitError(APIClientError):
    """Raised when the API returns HTTP 429 Too Many Requests."""
    pass


class APIResponseError(APIClientError):
    """Raised when the API returns an unexpected HTTP 4xx or 5xx status."""
    def __init__(self, message: str, status_code: int, response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class APIMalformedJSONError(APIClientError):
    """Raised when the API response payload cannot be decoded as valid JSON."""
    pass


class APIClient:
    """
    Production-grade REST API Client with connection pooling, retries, and rate-limiting.
    """

    def __init__(
        self,
        base_url: str,
        timeout: int = 15,
        max_retries: int = 3,
        backoff_factor: float = 1.5,
        retry_status_codes: Optional[list] = None,
        headers: Optional[Dict[str, str]] = None,
        auth_token: Optional[str] = None,
    ):
        """
        Initializes the API client.

        Args:
            base_url: Base endpoint URL.
            timeout: Per-request timeout in seconds.
            max_retries: Maximum automatic retries on transient errors.
            backoff_factor: Multiplier for exponential backoff sleep intervals.
            retry_status_codes: HTTP status codes to automatically retry.
            headers: Default headers to send with every request.
            auth_token: Optional bearer token or API key for Authorization header.
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

        # Default headers
        merged_headers = {
            "Accept": "application/json",
            "User-Agent": "DataPipeline-ETL/1.2.0 (Junior Data Engineer Portfolio)",
        }
        if headers:
            merged_headers.update(headers)
        if auth_token:
            merged_headers["Authorization"] = f"Bearer {auth_token}"
        self.session.headers.update(merged_headers)

        # Retry configuration using urllib3.util.Retry mounted on HTTPAdapter
        retry_codes = retry_status_codes or [429, 500, 502, 503, 504]
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=retry_codes,
            allowed_methods=["GET", "HEAD", "OPTIONS"],
            raise_on_status=False,  # We evaluate and log status manually
        )

        adapter = HTTPAdapter(
            max_retries=retry_strategy,
            pool_connections=10,
            pool_maxsize=10,
        )
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        logger.info(
            "APIClient initialized for %s (timeout=%ds, max_retries=%d)",
            self.base_url,
            self.timeout,
            max_retries,
        )

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes an HTTP GET request with error handling and JSON validation.

        Args:
            endpoint: URL path relative to base_url (e.g., '/products').
            params: Dictionary of URL query parameters (e.g. {'limit': 30, 'skip': 0}).

        Returns:
            Parsed JSON dictionary.

        Raises:
            APITimeoutError: If the request timed out.
            APIRateLimitError: If HTTP 429 is encountered and unresolved.
            APIResponseError: If non-retryable 4xx/5xx HTTP error is returned.
            APIMalformedJSONError: If response body cannot be parsed as JSON.
        """
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        logger.debug("Requesting GET %s with params=%s", url, params)
        start_time = time.time()

        try:
            response = self.session.get(url, params=params, timeout=self.timeout)
            duration = time.time() - start_time
            logger.debug(
                "GET %s finished in %.3fs with status %d",
                url,
                duration,
                response.status_code,
            )

        except requests.exceptions.Timeout as exc:
            duration = time.time() - start_time
            logger.error("Request timed out for GET %s after %.3fs: %s", url, duration, exc)
            raise APITimeoutError(f"Request timed out after {self.timeout}s: {url}") from exc

        except requests.exceptions.ConnectionError as exc:
            duration = time.time() - start_time
            logger.error("Network connection failed for %s after %.3fs: %s", url, duration, exc)
            raise APIClientError(f"Connection error to {url}: {exc}") from exc

        except requests.exceptions.RequestException as exc:
            logger.error("Unexpected network exception during GET %s: %s", url, exc)
            raise APIClientError(f"Request failed: {exc}") from exc

        # Rate Limit handling (HTTP 429)
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After", "10")
            try:
                sleep_sec = float(retry_after)
            except ValueError:
                sleep_sec = 10.0
            logger.warning(
                "Rate limit encountered (HTTP 429) on %s. Server requested Retry-After: %.1fs",
                url,
                sleep_sec,
            )
            raise APIRateLimitError(
                f"Rate limit exceeded (HTTP 429). Retry after {sleep_sec} seconds."
            )

        # HTTP error verification
        if response.status_code >= 400:
            error_body = response.text[:500]
            logger.error(
                "HTTP %d error for %s. Response body snippet: %s",
                response.status_code,
                url,
                error_body,
            )
            raise APIResponseError(
                f"HTTP {response.status_code} client/server error",
                status_code=response.status_code,
                response_body=error_body,
            )

        # JSON Decoding verification
        try:
            json_payload = response.json()
        except ValueError as exc:
            logger.error(
                "Failed to parse JSON response from %s (HTTP %d). Content: %s",
                url,
                response.status_code,
                response.text[:300],
            )
            raise APIMalformedJSONError(
                f"Malformed JSON response from {url}: {exc}"
            ) from exc

        return json_payload

    def close(self) -> None:
        """Closes the underlying HTTP session connection pool."""
        self.session.close()
        logger.debug("APIClient session closed.")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

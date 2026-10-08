"""Unit tests for APIClient retry and error handling."""

import pytest
from unittest.mock import Mock, patch
import requests
from src.api_client import APIClient, APITimeoutError, APIRateLimitError, APIResponseError, APIMalformedJSONError


def test_api_client_successful_get():
    client = APIClient(base_url="https://fake-api.test")
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"products": [{"id": 1, "title": "Test"}], "total": 1}

    with patch.object(client.session, "get", return_value=mock_response):
        data = client.get("/products", params={"limit": 10})
        assert "products" in data
        assert len(data["products"]) == 1
        assert data["products"][0]["title"] == "Test"


def test_api_client_timeout_raises_custom_exception():
    client = APIClient(base_url="https://fake-api.test", timeout=2)
    with patch.object(client.session, "get", side_effect=requests.exceptions.Timeout("Read timeout")):
        with pytest.raises(APITimeoutError):
            client.get("/products")


def test_api_client_rate_limit_429():
    client = APIClient(base_url="https://fake-api.test")
    mock_response = Mock()
    mock_response.status_code = 429
    mock_response.headers = {"Retry-After": "5"}

    with patch.object(client.session, "get", return_value=mock_response):
        with pytest.raises(APIRateLimitError) as exc_info:
            client.get("/products")
        assert "Retry after 5.0 seconds" in str(exc_info.value)


def test_api_client_http_500_error():
    client = APIClient(base_url="https://fake-api.test")
    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with patch.object(client.session, "get", return_value=mock_response):
        with pytest.raises(APIResponseError) as exc_info:
            client.get("/products")
        assert exc_info.value.status_code == 500


def test_api_client_malformed_json():
    client = APIClient(base_url="https://fake-api.test")
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.text = "<html>Not JSON</html>"
    mock_response.json.side_effect = ValueError("Invalid JSON")

    with patch.object(client.session, "get", return_value=mock_response):
        with pytest.raises(APIMalformedJSONError):
            client.get("/products")

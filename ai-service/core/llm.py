"""
Groq client factory. Uses separate API keys per task to spread rate limits
across the 4 free-tier keys (README Section 7.5).
"""
import logging
from groq import Groq
from core.config import get_settings

logger = logging.getLogger(__name__)

# Model allocation (README Section 7.5)
MODEL_SUMMARIZATION = "llama-3.3-70b-versatile"
MODEL_STRUCTURED = "llama-3.1-8b-instant"
MODEL_RAG = "llama-3.3-70b-versatile"
MODEL_LIGHT = "llama-3.1-8b-instant"

_clients: dict[str, Groq] = {}


def _get_client(key_name: str) -> Groq:
    """Cache one Groq client per API key so we don't reconnect per request."""
    if key_name not in _clients:
        s = get_settings()
        api_key = {
            "summarization": s.groq_api_key_summarization,
            "structured": s.groq_api_key_structured,
            "rag": s.groq_api_key_rag,
            "light": s.groq_api_key_light,
        }[key_name]
        _clients[key_name] = Groq(api_key=api_key)
    return _clients[key_name]


def chat_completion(
    key_name: str,
    model: str,
    messages: list[dict],
    max_tokens: int = 1024,
    temperature: float = 0.3,
) -> str:
    """
    Call Groq chat completions.
    Returns the assistant's response text.
    Raises on error (caller decides how to handle it).
    """
    client = _get_client(key_name)

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"Groq call failed ({key_name}/{model}): {e}")
        raise
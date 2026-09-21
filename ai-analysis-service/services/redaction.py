"""Secret/PII redaction - submitted code is untrusted third-party input
(the platform's own user, but still: code a person pasted or wrote, which
routinely contains copy-pasted credentials) about to be sent to a
third-party API (Groq). This scans it BEFORE it's ever put in a prompt and
replaces anything matching a known secret shape with a placeholder, so the
real value never leaves this service, is never logged, and is never sent
to Groq. Every redaction is logged (the fact that one happened, and which
pattern matched - never the matched value itself).

Regex-based, not a full entropy/ML-based secret scanner (e.g. TruffleHog,
gitleaks) - deliberately scoped to a fixed set of well-known, high-signal
credential shapes. A dedicated secret-scanning tool would catch more (e.g.
high-entropy strings with no recognizable prefix), and is a legitimate
follow-up; this covers the common, cheaply-detectable cases without adding
a new dependency this phase didn't already need.
"""

import re

from logging_config import get_logger

log = get_logger(__name__)

# (pattern_name, compiled regex). Order matters only for readability - every
# pattern is applied to the whole text independently.
_SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("aws_secret_access_key", re.compile(r"(?i)aws_secret_access_key\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{40}['\"]?")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("stripe_live_key", re.compile(r"sk_live_[A-Za-z0-9]{20,}")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")),
    ("generic_credential_assignment", re.compile(
        r"(?i)\w*(api[_-]?key|secret|token|password|passwd)\w*\s*[:=]\s*['\"][A-Za-z0-9\-_./+=]{8,}['\"]"
    )),
]

_PLACEHOLDER = "[REDACTED-SECRET:{name}]"


def redact_secrets(text: str) -> tuple[str, list[str]]:
    """Returns (redacted_text, list_of_pattern_names_matched). The matched
    values themselves are never returned or logged - only which pattern(s)
    fired, so a caller can log/alert on the fact of a redaction without
    the log line itself becoming a secret leak."""
    redacted = text
    found: list[str] = []

    for name, pattern in _SECRET_PATTERNS:
        def _replace(match: re.Match, _name=name) -> str:
            found.append(_name)
            return _PLACEHOLDER.format(name=_name)

        redacted = pattern.sub(_replace, redacted)

    if found:
        log.warning("redaction.secrets_found", patterns=sorted(set(found)), count=len(found))

    return redacted, found

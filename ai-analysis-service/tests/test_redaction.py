from services.redaction import redact_secrets


def test_redacts_aws_access_key():
    code = 'key = "AKIAABCDEFGHIJKLMNOP"\n'
    redacted, found = redact_secrets(code)
    assert "AKIAABCDEFGHIJKLMNOP" not in redacted
    assert "aws_access_key_id" in found
    assert "[REDACTED-SECRET:aws_access_key_id]" in redacted


def test_redacts_github_token():
    code = 'token = "ghp_1234567890abcdefghijklmnopqrstuvwx12"\n'
    redacted, found = redact_secrets(code)
    assert "ghp_1234567890abcdefghijklmnopqrstuvwx12" not in redacted
    assert "github_token" in found


def test_redacts_private_key_block():
    code = (
        "key = '''\n"
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIBOgIBAAJBAK...\n"
        "-----END RSA PRIVATE KEY-----\n"
        "'''\n"
    )
    redacted, found = redact_secrets(code)
    assert "MIIBOgIBAAJBAK" not in redacted
    assert "private_key_block" in found


def test_redacts_generic_credential_assignment():
    code = 'db_password = "hunter2hunter2"\n'
    redacted, found = redact_secrets(code)
    assert "hunter2hunter2" not in redacted
    assert "generic_credential_assignment" in found


def test_clean_code_is_unchanged_and_no_findings():
    code = "def add(a, b):\n    return a + b\n"
    redacted, found = redact_secrets(code)
    assert redacted == code
    assert found == []


def test_multiple_secrets_all_redacted():
    code = (
        'aws = "AKIAABCDEFGHIJKLMNOP"\n'
        'gh = "ghp_1234567890abcdefghijklmnopqrstuvwx12"\n'
    )
    redacted, found = redact_secrets(code)
    assert "AKIAABCDEFGHIJKLMNOP" not in redacted
    assert "ghp_1234567890abcdefghijklmnopqrstuvwx12" not in redacted
    assert set(found) == {"aws_access_key_id", "github_token"}

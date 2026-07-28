# Key Management

## SECRET_KEY

The `SECRET_KEY` is used for:
1. **JWT signing** (authentication)
2. **Fernet encryption** (data at rest via AES-128-CBC)
3. **HMAC computation** (Telegram bot lookups)

## Critical Rules

1. **NEVER change SECRET_KEY after deployment** - all encrypted data becomes irrecoverable
2. **NEVER commit SECRET_KEY to git** - use Podman secrets or environment variables
3. **Back up SECRET_KEY immediately** - store in a secure location

## How to Get the Current SECRET_KEY

```bash
# From Podman secret (production)
podman secret inspect creditcard_backend_prod_secret_key --show-secret

# From Podman secret (development)
podman secret inspect creditcard_backend_dev_secret_key --show-secret

# From .env file
grep SECRET_KEY .env
```

## Backup Procedure

1. Copy the SECRET_KEY value
2. Store in **at least 2** of these locations:
   - Password manager (1Password, Bitwarden, etc.)
   - Sealed envelope in physical safe
   - Encrypted USB drive in secure location
   - Hardware security module (HSM)
3. Document the location in your emergency procedures
4. Test that you can retrieve the backup

## What Happens If SECRET_KEY Is Lost

| Data | Impact |
|------|--------|
| User names | Permanently lost (shows "[encrypted]") |
| Card names/banks | Permanently lost |
| Expense descriptions | Permanently lost |
| MFA secrets | Permanently lost (users locked out of MFA) |
| Telegram links | Permanently broken |
| JWT tokens | All users logged out |

**Recovery:** Users must re-enter ALL data. MFA must be re-setup. Telegram must be re-linked.

## What Happens If SECRET_KEY Changes

| Component | Impact |
|-----------|--------|
| Encrypted fields | Cannot decrypt (shows "[encrypted]") |
| HMAC hashes | Telegram lookups fail |
| JWT tokens | All users logged out |
| New data | Encrypted with new key (mixed old/new) |

**There is NO automatic recovery from a key change.**

## Key Rotation (Not Currently Supported)

If key rotation is needed in the future:
1. Implement dual-key support (decrypt with old, encrypt with new)
2. Re-encrypt all data with new key
3. Update all HMAC hashes
4. Remove old key after verification

## Verification

After deployment, verify the key works:
```bash
# The app does this automatically on startup
# If it fails, the app won't start
```

Manual verification:
```python
from app.services.encryption import verify_key_works
assert verify_key_works(), "SECRET_KEY is invalid!"
```

## Current Keys (DO NOT COMMIT THIS FILE WITH REAL VALUES)

| Environment | Location | Status |
|-------------|----------|--------|
| Development | Podman secret `creditcard_backend_dev_secret_key` | Active |
| Production | `/opt/creditcardanalyzer/.env` | Active |

## Emergency Recovery

If SECRET_KEY is compromised:
1. **Immediately** generate a new SECRET_KEY
2. **Accept** that all encrypted data is lost
3. Deploy with new key
4. Notify users to re-enter data
5. Have users re-setup MFA
6. Have users re-link Telegram

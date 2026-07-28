# Security

## Field-Level Encryption

Oikonomia implements application-level field encryption to protect sensitive user data. Even if an administrator has direct database access, they cannot read the encrypted fields without the `SECRET_KEY`.

### What's Encrypted

| Model | Field | Why Encrypted |
|-------|-------|---------------|
| `User` | `full_name` | PII - User's real name |
| `User` | `telegram_chat_id` | PII - Telegram identifier |
| `User` | `mfa_secret` | Security - TOTP secret key |
| `Card` | `card_name` | Financial - Card brand (Visa, etc.) |
| `Card` | `bank` | Financial - Bank name |
| `Card` | `holder` | PII - Cardholder name |
| `Expense` | `description` | Financial - Merchant/transaction details |
| `Expense` | `notes` | Financial - User notes |
| `Investment` | `notes` | Financial - Investment notes |
| `AuditLog` | `ip_address` | PII - User's IP address |
| `AuditLog` | `user_agent` | PII - Browser/device info |
| `MonthlyReport` | `report_data` | Financial - Report JSON |

### What's NOT Encrypted (and why)

| Field | Reason |
|-------|--------|
| `User.email` | Needed for login, unique constraint, lookups |
| `User.telegram_key` | Temporary auth token, not PII |
| `User.hashed_password` | Already bcrypt hashed |
| `Expense.amount` | Needed for calculations/summaries |
| `Expense.currency` | Not sensitive |
| `Card.card_type` | Not sensitive (credito/debito) |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                           │
├─────────────────────────────────────────────────────────────────┤
│  routers/auth.py  │  routers/cards.py  │  routers/expenses.py   │
├─────────────────────────────────────────────────────────────────┤
│                   SQLAlchemy Models                              │
│  User.full_name   │  Card.holder       │  Expense.description   │
│  (EncryptedType)  │  (EncryptedType)   │  (EncryptedType)       │
├─────────────────────────────────────────────────────────────────┤
│              EncryptedType (TypeDecorator)                       │
│         Auto-encrypt on write, auto-decrypt on read              │
├─────────────────────────────────────────────────────────────────┤
│              encryption.py (Fernet wrapper)                      │
│    SECRET_KEY → SHA-256 → Fernet key → AES-128-CBC              │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

**Encryption (writing to DB):**
```python
# User saves "Farmacity $1500"
expense.description = "Farmacity $1500 medicamentos"

# EncryptedType.process_bind_param() encrypts automatically
# Stored in DB: gAAAAABqZ3jJ-1GzGpLcQ3aZhNOdG5EN0V2hRzbqNolmyIfMrp...
```

**Decryption (reading from DB):**
```python
# Read from DB: gAAAAABqZ3jJ-1GzGpLcQ3aZhNOdG5EN0V2hRzbqNolmyIfMrp...
expense.description  # Returns: "Farmacity $1500 medicamentos"

# EncryptedType.process_result_value() decrypts automatically
```

### Search on Encrypted Fields

Encrypted fields cannot be searched with SQL `LIKE` or `WHERE`. For searchable fields, we maintain a separate plaintext search column:

```
Expense {
    description: EncryptedType     # "Farmacity $1500 medicamentos"
    description_search: String     # "farmacity 1500 medicamentos" (tokenized)
}
```

**How search works:**
```python
# User searches "farmacia"
# 1. Query: SELECT * WHERE description_search LIKE '%farmacia%'
# 2. For each result: decrypt(description) → show to user
```

**Tokenization:**
- Lowercase
- Remove accents (é → e)
- Keep only alphanumeric + spaces
- Collapse multiple spaces

### Telegram Bot Lookup (HMAC)

The bot needs fast user lookups by `telegram_chat_id`. Since the field is encrypted, we maintain a separate HMAC hash column:

```
User {
    telegram_chat_id: EncryptedType  # Encrypted
    telegram_chat_hash: String       # HMAC-SHA256 (plaintext, indexed)
}
```

**Bot lookup flow:**
```python
# Bot receives message from chat_id "123456"
chat_hash = compute_hmac("123456")  # HMAC-SHA256
user = db.query(User).filter(User.telegram_chat_hash == chat_hash).first()
# O(1) index seek → decrypt single row → respond
```

### Key Management

**SECRET_KEY** is used for:
1. Fernet encryption (AES-128-CBC)
2. HMAC computation (SHA-256)
3. JWT signing

**Requirements:**
- Minimum 32 characters
- Validated at startup (app won't start if too short)
- Stored in environment variable (`.env` or deployment config)

**Generate a new key:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### Migration

The migration script (`backend/scripts/migrate_encrypt_fields.py`) runs automatically on startup. It:

1. Checks each field for plaintext values
2. Encrypts plaintext values (EncryptedType handles this automatically)
3. Generates HMAC hashes for telegram_chat_id
4. Generates search tokens for description fields

**Idempotent:** Safe to run multiple times (skips already-encrypted values).

**Run manually:**
```bash
cd backend
DATABASE_URL="..." SECRET_KEY="..." python scripts/migrate_encrypt_fields.py
```

### Security Considerations

**What encryption protects against:**
- Database dumps/exfiltration
- SQL injection attacks
- Administrator snooping (without SECRET_KEY)
- Backup exposure

**What encryption does NOT protect against:**
- Application-level breaches (app has SECRET_KEY in memory)
- Compromised server (attacker can read SECRET_KEY)
- Social engineering (user shares their data)

**Recommendations:**
1. Rotate SECRET_KEY periodically (requires re-encrypting all data)
2. Store SECRET_KEY in secure environment variables (not in code)
3. Use different SECRET_KEYs for dev/staging/production
4. Monitor audit logs for suspicious access patterns

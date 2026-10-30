# AI Integration

## Overview

NikoFin uses **OpenAI** in production through the provider-neutral `app/services/llm` layer. `LLM_PROVIDER=openai` and `LLM_MODEL_NAME=gpt-6-luna` are the production defaults; Google remains available for text-only compatibility. Three separate API keys are used for different purposes.

## API Keys

| Key                        | Usage                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `LLM_API_KEY`              | PDF/statement import, AI expense analysis, trend analysis, card extraction |
| `INVESTMENTS_LLM_API_KEY`  | Investment assistant chat (falls back to `LLM_API_KEY`)                    |
| `MESSAGES_BOT_LLM_API_KEY` | Telegram bot natural language expense parsing                              |

## Use Cases

### 1. Statement Import Parsing

**File**: `services/smart_import_core.py`

Sends extracted PDF text (or CSV/XLSX content) to the configured text model with `SMART_IMPORT_PROMPT`. The LLM:

- Parses Argentine bank statement formats
- Extracts transactions (date, description, amount, currency, card_header, transaction_id)
- Detects installment patterns (C.XX/YY)
- Identifies closing dates
- Filters by user's full_name (skips additional cardholders)

**Input**: Raw text (cleaned, with card markers injected)
**Output**: JSON array of transactions

### 2. Expense Parsing (Telegram)

**File**: `telegram_bot.py`

Parses natural language messages like "gasté 1500 en farmacity":

```python
prompt = EXPENSE_PARSE_PROMPT.format(
    text=user_message,
    today=date.today().isoformat()
)
```

**Input**: User message text
**Output**: `{amount, description, date, currency}`

### 3. Card Info Extraction

**File**: `telegram_bot.py`

When user types a card name like "Visa Galicia":

```python
prompt = CARD_EXTRACT_PROMPT.format(raw_input=user_input, card_type=card_type)
```

**Input**: Card name text
**Output**: `{card_name, bank}`

### 4. Expense Analysis Chat

**File**: `routers/analysis.py`

Formats expense data into structured text and sends to the configured text model:

```python
prompt = f"""{ANALYSIS_SYSTEM_PROMPT}

Data:
{expense_summary}

User question: {question}"""
```

**Input**: Expense summary + user question
**Output**: Streaming text response (SSE)

### 5. Chat Summarization

**File**: `routers/analysis.py`

Summarizes a conversation for session resume:

- Takes last N messages
- Returns concise summary
- Used when user returns to analysis after time away

### 6. Trend Analysis

**File**: `routers/dashboard.py`

Structured prompt `AI_TRENDS_PROMPT` asks the configured text model to return JSON:

```json
{
  "trend": "increasing|decreasing|stable",
  "projections": [
    { "month": "2026-07", "amount": 125000 },
    { "month": "2026-08", "amount": 130000 },
    { "month": "2026-09", "amount": 135000 }
  ],
  "alerts": ["Spending on dining increased 30%"],
  "recommendations": ["Consider reducing dining budget"]
}
```

**Input**: Monthly expense aggregates
**Output**: JSON with trends, projections, alerts, recommendations

### 7. Investment Assistant

**File**: `routers/investments.py`

SSE streaming chat for investment queries:

- Uses `INVESTMENTS_LLM_API_KEY` (separate from expense analysis)
- Portfolio data formatted into context
- Streaming responses via SSE

### 8. Miscategorization Review (internal)

**File**: `services/categorization_review.py`

Second opinion on expenses that *have* a category but look miscategorized
(issue #414). Deterministic rules generate the candidates; the LLM only reviews
those candidates, in batches of 25, via `CATEGORY_REVIEW_PROMPT`:

```json
[{"expense_id": 12, "is_mismatch": true, "suggested_category_id": 17,
  "confidence": 0.9, "reason": "es una librería, no un servicio público"}]
```

- Metric label: `categorization_review`
- Nothing is auto-applied: the verdict only feeds an internal review
- A failed batch falls back to the rule score, never to per-expense calls

### 9. Voice transcription and payment-proof extraction

`POST /capture/transcribe` sends supported audio (OGG, WebM, MP3, M4A, WAV; up to
10 MB / 120 seconds) to OpenAI Audio using `LLM_AUDIO_MODEL` (default
`whisper-1`). Transcription cost is estimated at USD 0.006 per audio minute and
is recorded in the existing LLM budget metrics. Unclear audio returns a retry
signal instead of an empty expense.

`POST /capture/expense-image` accepts JPEG, PNG, or WebP (up to 8 MB / 20 MP);
Pillow strips EXIF and downsizes images to at most 1600 px per side before
OpenAI Vision receives them. `LLM_VISION_MODEL` defaults to `LLM_MODEL_NAME`.
The model returns a single-expense draft or a rejection reason; the user must
review and save it. A receipt with many line items is valid when it has one
clear final total, while multiple transactions, credits, balances, and pending
payments are rejected. HEIC is not supported in v1.

Audio and image bytes are processed in memory only: the application does not
persist them in the database or filesystem and does not log their content.
OpenAI calls remain subject to the existing monthly budget. The Google adapter
supports text only; capture explicitly returns unavailable when configured with
Google rather than silently dropping media.

The app uses hand-written multipart wrappers in `frontend/src/api/client.ts`
for these two operations because Orval's generated functions set
`Content-Type: multipart/form-data` themselves. The wrappers leave that header
unset so the browser can add the required multipart boundary.

## Prompt Templates

All prompts are defined in `backend/app/prompts.py`:

| Prompt                   | Purpose                           |
| ------------------------ | --------------------------------- |
| `SMART_IMPORT_PROMPT`    | PDF/statement parsing             |
| `EXPENSE_PARSE_PROMPT`   | Telegram natural language parsing |
| `CARD_EXTRACT_PROMPT`    | Card name/bank extraction         |
| `ANALYSIS_SYSTEM_PROMPT` | Expense analysis chat             |
| `AI_TRENDS_PROMPT`       | Dashboard trend analysis          |
| `CATEGORY_SUGGEST_PROMPT`| Category suggestion (single expense) |
| `BATCH_CATEGORY_PROMPT`  | Category suggestion (batch of uncategorized expenses) |
| `CATEGORY_REVIEW_PROMPT` | Miscategorization review (internal, issue #414) |
| `EXPENSE_IMAGE_PROMPT` | Single payment-proof extraction with rejection taxonomy |

## Cost Optimization

- **Token reduction**: Prompts optimized from 10,800 → 3,669 chars (66% reduction)
- **Model choice**: OpenAI `gpt-6-luna` for production text; vision inherits `LLM_MODEL_NAME` unless `LLM_VISION_MODEL` is set; audio defaults to `whisper-1`
- **Caching**: Analysis history saved to avoid re-analysis
- **Batch processing**: Import processes all transactions in one LLM call

## Error Handling

- LLM timeout → retry once, then fail
- Invalid JSON response → fallback to basic parsing
- API key issues → graceful degradation (features disabled)
- Rate limiting → exponential backoff

## Streaming

Analysis and investment chats use Server-Sent Events (SSE):

```python
async def generate():
    async for chunk in llm_stream(prompt):
        yield f"data: {json.dumps({'text': chunk})}\n\n"
    yield "data: [DONE]\n\n"
```

Frontend receives via `EventSource` and renders incrementally.

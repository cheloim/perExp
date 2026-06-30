# AI Integration

## Overview

NikoFin uses **Google Gemini Flash** (`gemini-flash-latest`) via the `google-genai` SDK for multiple AI-powered features. Three separate API keys are used for different purposes.

## API Keys

| Key                        | Usage                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `LLM_API_KEY`              | PDF/statement import, AI expense analysis, trend analysis, card extraction |
| `INVESTMENTS_LLM_API_KEY`  | Investment assistant chat (falls back to `LLM_API_KEY`)                    |
| `MESSAGES_BOT_LLM_API_KEY` | Telegram bot natural language expense parsing                              |

## Use Cases

### 1. Statement Import Parsing

**File**: `services/smart_import_core.py`

Sends extracted PDF text (or CSV/XLSX content) to Gemini with `SMART_IMPORT_PROMPT`. The LLM:

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

Formats expense data into structured text and sends to Gemini:

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

Structured prompt `AI_TRENDS_PROMPT` asks Gemini to return JSON:

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

## Prompt Templates

All prompts are defined in `backend/app/prompts.py`:

| Prompt                   | Purpose                           |
| ------------------------ | --------------------------------- |
| `SMART_IMPORT_PROMPT`    | PDF/statement parsing             |
| `EXPENSE_PARSE_PROMPT`   | Telegram natural language parsing |
| `CARD_EXTRACT_PROMPT`    | Card name/bank extraction         |
| `ANALYSIS_SYSTEM_PROMPT` | Expense analysis chat             |
| `AI_TRENDS_PROMPT`       | Dashboard trend analysis          |

## Cost Optimization

- **Token reduction**: Prompts optimized from 10,800 → 3,669 chars (66% reduction)
- **Model choice**: Gemini Flash (fastest, cheapest)
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

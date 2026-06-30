# Smart Import

## Overview

NikoFin's Smart Import system parses bank and credit card statements (PDF, CSV, XLSX) using AI to automatically extract and categorize transactions. The system uses Google Gemini Flash for LLM-based parsing, with a Celery background worker for async processing and Redis for per-user queuing.

## Supported Formats

| Format | Method       | Details                                               |
| ------ | ------------ | ----------------------------------------------------- |
| PDF    | LLM (Gemini) | pdfplumber extracts text → Gemini parses transactions |
| CSV    | LLM (Gemini) | Read as text → Gemini parses (unified approach)       |
| XLSX   | LLM (Gemini) | Read as text → Gemini parses (unified approach)       |

Max file size: 10MB.

## Import Flow

```
1. User uploads file via POST /import-jobs
   └─ File stored as LargeBinary in ImportJob table
   └─ Returns job_id immediately (status: PROCESSING)

2. Celery task dispatched
   └─ Acquires Redis lock (per-user FIFO)
   └─ If another job running → status: QUEUED

3. Smart Import Core (smart_import_core.py)
   └─ PDF: pdfplumber → text extraction → card markers → cleaning
   └─ All formats: Send to Gemini with SMART_IMPORT_PROMPT
   └─ Gemini returns JSON array of transactions

4. Post-processing
   └─ Expand installments into future dates
   └─ Detect duplicates (transaction_id, date, amount, description)
   └─ Auto-categorize based on keywords

5. Preview ready (status: READY_PREVIEW)
   └─ Notification created (import_ready)
   └─ SSE pushes to frontend (toast + bell icon)

6. User reviews preview
   └─ Sees rows with duplicate flags, card mapping
   └─ Can edit categories, amounts, dates
   └─ Maps card_headers to existing or new cards

7. Confirmation (POST /import-jobs/{id}/confirm)
   └─ Re-checks duplicates at confirm time (safety net)
   └─ Creates Expense or ScheduledExpense records
   └─ Finds or creates cards as needed
   └─ Status: COMPLETED
```

## LLM Prompt

The `SMART_IMPORT_PROMPT` instructs Gemini to:

1. Parse Argentine bank statement formats (multiple banks supported)
2. Extract: date, description, amount, currency (ARS/USD), card_header, transaction_id, installment_number, installment_total
3. Detect closing dates from statement metadata
4. Filter by user's full_name (skip additional cardholders)
5. Return structured JSON array

The prompt includes:

- User's full name for holder filtering
- Current date for context
- Instructions for installment detection (C.XX/YY patterns)
- Currency detection (USD vs ARS)

## Duplicate Detection

Two-layer protection:

### Layer 1: During LLM Processing

- Checks `transaction_id` match (exact)
- Checks date + amount + description (fuzzy)
- Checks installment_group_id for scheduled expenses
- Marks rows as `is_duplicate: true` in preview

### Layer 2: At Confirm Time

- Re-checks against database before inserting
- Prevents race conditions from concurrent imports
- Skips duplicates silently (counted in response)

## Per-User FIFO Queue

```python
lock_key = f"import_lock:user:{job.user_id}"
lock = redis_client.lock(lock_key, timeout=600)  # 10 min timeout
```

- Different users process in parallel
- Same user's jobs process sequentially
- If lock held → job status becomes QUEUED
- Lock timeout: 10 minutes (matches task time limit)

## Preview Data Structure

```json
{
  "rows": [
    {
      "date": "2026-06-15",
      "description": "FARMACITY",
      "amount": -1500.0,
      "currency": "ARS",
      "card_header": "VISA ****1234",
      "transaction_id": "TXN123456",
      "installment_number": null,
      "installment_total": null,
      "is_duplicate": false,
      "is_scheduled": false,
      "suggested_category": "Salud"
    }
  ],
  "detected_cards": [
    {
      "card_header": "VISA ****1234",
      "card_type": "credito",
      "matched_card_id": 42
    }
  ],
  "summary": {
    "total_ars": 45000.0,
    "total_usd": 120.5,
    "transaction_count": 35,
    "closing_dates": ["2026-06-20"]
  }
}
```

## Cleanup

Celery Beat runs daily at 3:30 AM:

- Deletes import jobs older than 24 hours
- Deletes associated notifications
- Cascading cleanup

## Token Optimization

The LLM prompt was optimized from 10,800 to 3,669 characters (66% reduction):

- Removed redundant examples
- Condensed instructions
- Used structured output format
- Kept essential parsing rules

## Error Handling

- File too large (>10MB) → HTTP 400
- Invalid format → HTTP 415
- LLM failure → job status FAILED, notification created
- Redis lock timeout → job status FAILED
- Celery task exception → job status FAILED, error logged

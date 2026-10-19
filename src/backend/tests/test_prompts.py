"""The two assistant prompts keep the domain focus without a canned refusal.

Both prompts used to instruct the model to answer out-of-scope questions with
one fixed sentence. Users got a muletilla instead of a conversation, and the
sentence was the same every time regardless of what they had actually asked.
The focus stays; the wording is the model's.
"""

from app.prompts import ANALYSIS_SYSTEM_PROMPT, INVESTMENTS_SYSTEM_PROMPT

# The exact sentences the prompts used to dictate, plus the instructions that
# forced them. None of these may come back.
DICTATED_PHRASES = [
    "Solo puedo ayudarte con el análisis de tus gastos y finanzas personales.",
    "Solo puedo ayudarte con temas de inversiones y mercados financieros.",
    "respondé únicamente",
    "respondés exactamente",
    "No hagas excepciones",
]

PROMPTS = {
    "analysis": ANALYSIS_SYSTEM_PROMPT,
    "investments": INVESTMENTS_SYSTEM_PROMPT,
}


def test_no_prompt_dicts_the_words_of_the_refusal():
    for name, prompt in PROMPTS.items():
        for phrase in DICTATED_PHRASES:
            assert phrase not in prompt, f"{name} prompt still dictates: {phrase!r}"


def test_each_prompt_still_stays_inside_its_own_domain():
    # The focus is the product. Dropping it is not an option — the fix is
    # refusing in natural words, not refusing less.
    assert "gastos" in ANALYSIS_SYSTEM_PROMPT
    assert "finanzas personales" in ANALYSIS_SYSTEM_PROMPT

    assert "inversiones" in INVESTMENTS_SYSTEM_PROMPT
    assert "mercad" in INVESTMENTS_SYSTEM_PROMPT


def test_each_prompt_says_what_to_do_when_asked_something_else():
    for name, prompt in PROMPTS.items():
        assert "foco" in prompt, f"{name} prompt never tells the model to keep the focus"


def test_the_analysis_prompt_keeps_its_analysis_structure():
    for section in ("Resumen general", "Top categorías", "Insights clave", "Sugerencias concretas"):
        assert section in ANALYSIS_SYSTEM_PROMPT


def test_the_investments_prompt_keeps_its_advice_boundaries():
    assert "asesoramiento financiero" in INVESTMENTS_SYSTEM_PROMPT
    assert "garantiz" in INVESTMENTS_SYSTEM_PROMPT


def test_both_prompts_answer_in_argentine_spanish():
    for name, prompt in PROMPTS.items():
        assert "español" in prompt, f"{name} prompt does not pin the language"

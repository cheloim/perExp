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


def test_each_prompt_names_the_other_domain_as_out_of_scope():
    # Without this, a cross-domain question that slips past the router is
    # *answered* by the wrong prompt instead of declined — "¿en qué me
    # conviene invertir?" is a legitimate personal-finance question to the
    # spending prompt, so only an explicit boundary stops it.
    assert "inversiones" in ANALYSIS_SYSTEM_PROMPT
    assert "gasto del día a día" in INVESTMENTS_SYSTEM_PROMPT


def test_the_analysis_prompt_only_arms_the_full_report_for_a_full_analysis():
    # Follow-ups exist now ("¿Y en diciembre?"). A one-word pronoun must not
    # inherit a mandatory five-section report.
    assert "pregunta concreta" in ANALYSIS_SYSTEM_PROMPT


def test_the_investments_prompt_says_what_to_do_without_a_portfolio():
    # The snapshot is fetched on demand and can be missing; the model must say
    # so instead of estimating positions.
    assert "estimar" in INVESTMENTS_SYSTEM_PROMPT
    assert "cartera" in INVESTMENTS_SYSTEM_PROMPT


def test_the_analysis_prompt_keeps_its_analysis_structure():
    for section in ("Resumen general", "Top categorías", "Insights clave", "Sugerencias concretas"):
        assert section in ANALYSIS_SYSTEM_PROMPT


def test_the_investments_prompt_keeps_its_advice_boundaries():
    assert "asesoramiento financiero" in INVESTMENTS_SYSTEM_PROMPT
    assert "garantiz" in INVESTMENTS_SYSTEM_PROMPT


def test_the_analysis_prompt_never_says_the_category_detail_is_missing():
    # The data blocks carry every category of every month with spending and
    # name the months without it. The model once answered "no tengo el detalle
    # individual de esos rubros" after showing a five-row block — half the fix
    # is the full data, the other half is answering from it, and never
    # estimating what the blocks do not have.
    assert "detalle completo por categoría y por mes" in ANALYSIS_SYSTEM_PROMPT
    assert "no estimés" in ANALYSIS_SYSTEM_PROMPT


def test_both_prompts_answer_in_argentine_spanish():
    for name, prompt in PROMPTS.items():
        assert "español" in prompt, f"{name} prompt does not pin the language"

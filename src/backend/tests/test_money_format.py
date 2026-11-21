from app.services.money import format_money, format_totals


def test_formats_pesos_with_local_symbol_and_separators():
    assert format_money(30000, "ARS") == "$ 30.000,00"
    assert format_money(1234.5, "ARS") == "$ 1.234,50"


def test_formats_dollars_with_u_s_s_so_they_cannot_be_read_as_pesos():
    assert format_money(7, "USD") == "U$S 7,00"
    assert format_money(1234.5, "USD") == "U$S 1.234,50"


def test_keeps_the_sign_in_front_of_the_currency_prefix():
    assert format_money(-500, "ARS") == "-$ 500,00"
    assert format_money(-7, "USD") == "-U$S 7,00"


def test_formats_zero():
    assert format_money(0, "ARS") == "$ 0,00"


def test_treats_a_missing_currency_as_pesos():
    assert format_money(1500, None) == "$ 1.500,00"
    assert format_money(1500, "") == "$ 1.500,00"


def test_normalizes_the_currency_code():
    assert format_money(7, "usd") == "U$S 7,00"


def test_totals_show_each_currency_separately_pesos_first():
    total = format_totals([(7, "USD"), (30000, "ARS")])
    assert total == "$ 30.000,00 + U$S 7,00"


def test_totals_do_not_invent_a_second_currency():
    assert format_totals([(7, "USD")]) == "U$S 7,00"
    assert format_totals([(30000, "ARS")]) == "$ 30.000,00"


def test_totals_default_missing_currencies_to_pesos():
    assert format_totals([(1500, None)]) == "$ 1.500,00"


def test_totals_of_an_empty_list_are_zero_pesos():
    assert format_totals([]) == "$ 0,00"

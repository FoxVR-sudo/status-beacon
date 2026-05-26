DEFAULT_PERFORMANCE_BUDGETS: dict[str, float] = {
    'ttfb_ms': 800.0,
    'first_contentful_paint_ms': 1800.0,
    'largest_contentful_paint_ms': 2500.0,
    'cumulative_layout_shift': 0.1,
    'total_blocking_time_ms': 200.0,
    'dom_content_loaded_ms': 1500.0,
    'transfer_size_kb': 512.0,
}

PERFORMANCE_BUDGET_KEYS = tuple(DEFAULT_PERFORMANCE_BUDGETS.keys())


def effective_performance_budgets(value: dict[str, float] | None) -> dict[str, float]:
    budgets = DEFAULT_PERFORMANCE_BUDGETS.copy()
    if not value:
        return budgets

    for key in PERFORMANCE_BUDGET_KEYS:
        if key not in value:
            continue
        normalized = float(value[key])
        if normalized > 0:
            budgets[key] = normalized

    return budgets
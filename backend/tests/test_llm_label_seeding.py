"""init_label_series must seed the LLM duration histogram alongside the LLM
counters. Prometheus reports increase() of a series that appears mid-window
at value 1 as 0, so the first call per operation after a restart was invisible
on the duration panel while requests and errors, which are seeded, showed it.
"""
import pytest

from app import metrics


OPERATIONS = ("analysis", "translation", "refinement", "title")


@pytest.mark.parametrize("operation", OPERATIONS)
def test_llm_duration_histogram_is_seeded(monkeypatch, operation):
    monkeypatch.setattr(metrics.settings, "LLM_PROVIDER", "seed-test-provider")
    monkeypatch.setattr(metrics.settings, "LLM_MODEL", "seed-test-model")

    metrics.init_label_series()

    labels = {"provider": "seed-test-provider", "model": "seed-test-model", "operation": operation}
    registry = metrics.llm_duration_seconds._metrics  # child metrics keyed by label values
    key = tuple(labels[name] for name in metrics.llm_duration_seconds._labelnames)
    assert key in registry, f"duration histogram not seeded for {labels}"
    assert registry[key]._sum.get() == 0


@pytest.mark.parametrize("flag,provider", [(True, "seed-support-on"), (False, "seed-support-off")])
def test_support_operation_seeded_only_when_assistant_enabled(monkeypatch, flag, provider):
    monkeypatch.setattr(metrics.settings, "ENABLE_SUPPORT_ASSISTANT", flag)
    monkeypatch.setattr(metrics.settings, "LLM_PROVIDER", provider)
    monkeypatch.setattr(metrics.settings, "LLM_MODEL", "m")

    metrics.init_label_series()

    assert ((provider, "m", "support") in metrics.llm_requests_total._metrics) is flag

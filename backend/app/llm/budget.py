from dataclasses import dataclass

from app.llm.types import LLMBudgetError, LLMResult


@dataclass
class RunBudget:
    """Counts spend on uncached calls. A cap of 0 disables that guard."""

    max_tokens: int
    max_cost_usd: float
    tokens: int = 0
    cost_usd: float = 0.0

    def add(self, result: LLMResult) -> None:
        if result.cached:
            return
        self.tokens += result.tokens_in + result.tokens_out
        self.cost_usd += result.cost_usd or 0.0

    def would_exceed(self, extra_tokens: int, extra_cost_usd: float | None) -> bool:
        if self.max_tokens and self.tokens + extra_tokens > self.max_tokens:
            return True
        # unknown prices make the cost guard inert; the token guard still applies
        return bool(
            self.max_cost_usd
            and extra_cost_usd is not None
            and self.cost_usd + extra_cost_usd > self.max_cost_usd
        )

    def check(self, extra_tokens: int = 0, extra_cost_usd: float | None = None) -> None:
        if self.would_exceed(extra_tokens, extra_cost_usd):
            raise LLMBudgetError(
                f"run budget reached ({self.tokens} tokens, ${self.cost_usd:.4f} spent)"
            )
